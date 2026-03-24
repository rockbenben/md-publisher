import { writeFile, unlink, mkdtemp } from 'fs/promises';
import { resolve, dirname, join } from 'path';
import { tmpdir } from 'os';
import chalk from 'chalk';
import { marked } from 'marked';
import { PLATFORMS, TIMEOUTS } from '../config.js';
import { withPage, ensureLoggedIn, pasteHtml, findElement, fillTitle } from '../browser.js';
import { preprocessCallouts, stripFirstImage } from '../parser.js';

const config = PLATFORMS.x;

const MIME_EXTS = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };

const EDITOR_SELECTORS = [
  '.public-DraftEditor-content',
  '[data-testid="composer"]',
  '[contenteditable="true"]',
];

const IMG_MARKER_PREFIX = '\u200B___IMG_';
const CODE_MARKER_PREFIX = '\u200B___CODE_';
const MARKER_SUFFIX = '___\u200B';

/**
 * Normalize headings to two levels: highest → h1, next → h2.
 * Scans for the minimum heading level actually used (outside code blocks),
 * then remaps: minLevel → #, minLevel+1..6 → ##.
 */
function normalizeHeadings(markdown) {
  const lines = markdown.split('\n');
  let inCode = false;
  let minLevel = 7;

  for (const line of lines) {
    if (/^```/.test(line)) { inCode = !inCode; continue; }
    if (inCode) continue;
    const m = line.match(/^(#{1,6})\s/);
    if (m && m[1].length < minLevel) minLevel = m[1].length;
  }
  if (minLevel >= 7 || minLevel === 1) return markdown; // no headings or already h1-based

  inCode = false; // reset for second pass
  return lines.map(line => {
    if (/^```/.test(line)) { inCode = !inCode; return line; }
    if (inCode) return line;
    const m = line.match(/^(#{1,6})\s/);
    if (!m) return line;
    const level = m[1].length;
    const mapped = level === minLevel ? 1 : 2;
    return '#'.repeat(mapped) + line.slice(m[1].length);
  }).join('\n');
}

// ─── Markdown → segments (split at images AND code blocks) ──────────────────

function parseSegments(markdown, filePath) {
  markdown = preprocessCallouts(markdown);
  markdown = normalizeHeadings(markdown);
  const lines = markdown.split('\n');
  const imgRegex = /^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/;
  const codeStartRegex = /^```(\w*)\s*$/;
  const articleDir = filePath ? dirname(filePath) : process.cwd();

  const segments = [];
  const images = [];
  const codeBlocks = [];
  let textBuf = [];
  let inCode = false;
  let codeLang = '';
  let codeBuf = [];

  const flushText = () => {
    if (textBuf.length > 0) {
      const content = textBuf.join('\n');
      if (content.trim()) segments.push({ type: 'text', content });
      textBuf = [];
    }
  };

  for (const line of lines) {
    if (inCode) {
      if (line.match(/^```\s*$/)) {
        inCode = false;
        const code = { type: 'code', lang: codeLang, content: codeBuf.join('\n') };
        segments.push(code);
        codeBlocks.push(code);
        codeBuf = [];
        codeLang = '';
      } else {
        codeBuf.push(line);
      }
      continue;
    }

    const codeMatch = line.match(codeStartRegex);
    if (codeMatch) {
      flushText();
      inCode = true;
      codeLang = codeMatch[1] || '';
      continue;
    }

    const imgMatch = line.match(imgRegex);
    if (imgMatch) {
      flushText();
      const src = imgMatch[2].trim();
      const alt = imgMatch[1].trim();
      const isLocal = !src.startsWith('http://') && !src.startsWith('https://');
      const img = { type: 'image', src, alt, localPath: isLocal ? resolve(articleDir, src) : null };
      segments.push(img);
      images.push(img);
      continue;
    }

    textBuf.push(line);
  }

  if (inCode && codeBuf.length > 0) {
    const code = { type: 'code', lang: codeLang, content: codeBuf.join('\n') };
    segments.push(code);
    codeBlocks.push(code);
  }
  flushText();

  return { segments, images, codeBlocks };
}

// ─── Image helpers ───────────────────────────────────────────────────────────

async function downloadToTemp(url, tempDir) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = (res.headers.get('content-type') || 'image/png').split(';')[0];
    const ext = MIME_EXTS[contentType] || '.png';
    const tempPath = join(tempDir, `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(tempPath, buf);
    return tempPath;
  } catch { return null; }
}

/**
 * Insert image via X Articles native media dialog (file input).
 */
async function insertImage(page, filePath) {
  const imgCountBefore = await page.evaluate(() =>
    document.querySelectorAll('.public-DraftEditor-content img').length
  ).catch(() => 0);

  const mediaBtn = await findElement(page, [
    'button[aria-label="添加媒体内容"]',
    '[aria-label="Add media"]',
  ]);
  if (!mediaBtn) throw new Error('找不到插入媒体按钮');
  await page.click(mediaBtn.selector);

  await page.waitForFunction(
    () => Array.from(document.querySelectorAll('[role="menuitem"]')).some(i => i.offsetParent !== null),
    { timeout: 3000 }
  );

  const clicked = await page.evaluate(() => {
    const items = document.querySelectorAll('[role="menuitem"]');
    for (const item of items) {
      const t = item.textContent.trim();
      if (t === '媒体' || t === 'Media') { item.click(); return true; }
    }
    return false;
  });
  if (!clicked) throw new Error('找不到媒体菜单项');

  await page.waitForFunction(
    () => {
      const sheet = document.querySelector('[data-testid="sheetDialog"]');
      return sheet && sheet.querySelector('input[type="file"]');
    },
    { timeout: 5000 }
  );

  const sheetInput = page.locator('[data-testid="sheetDialog"] input[type="file"]');
  if (await sheetInput.count() === 0) throw new Error('找不到文件上传输入框');
  await sheetInput.setInputFiles(filePath);

  // Wait for dialog to close or action button
  try {
    await Promise.race([
      page.waitForSelector('[data-testid="sheetDialog"]', { state: 'detached', timeout: 30000 }),
      page.waitForFunction(
        () => {
          const sheet = document.querySelector('[data-testid="sheetDialog"]');
          if (!sheet) return true;
          return Array.from(sheet.querySelectorAll('button')).some(b => {
            const t = b.textContent.trim();
            return /^(插入|保存|Insert|Save|完成|Done|确认)$/.test(t) &&
              b.offsetParent !== null && !b.disabled;
          });
        },
        { timeout: 30000 }
      ),
    ]);
  } catch {}

  await page.evaluate(() => {
    const sheet = document.querySelector('[data-testid="sheetDialog"]');
    if (!sheet) return;
    for (const btn of sheet.querySelectorAll('button')) {
      const t = btn.textContent.trim();
      if (/^(插入|保存|Insert|Save|完成|Done|确认)$/.test(t) && btn.offsetParent !== null && !btn.disabled) {
        btn.click(); return;
      }
    }
  });

  try {
    await page.waitForSelector('[data-testid="sheetDialog"]', { state: 'detached', timeout: 5000 });
  } catch {}

  // Wait for image to fully load
  try {
    await page.waitForFunction(
      (before) => {
        const imgs = document.querySelectorAll('.public-DraftEditor-content img');
        if (imgs.length <= before) return false;
        return Array.from(imgs).slice(before).every(img => img.complete && img.naturalWidth > 0);
      },
      imgCountBefore,
      { timeout: 15000 }
    );
  } catch {}
  await page.waitForTimeout(500);
}

/**
 * Reorder DraftJS blocks: move image atomic blocks from the end
 * to replace marker blocks at their correct positions.
 */
async function replaceMarkers(page, codeBlocks) {
  return await page.evaluate(({ codeBlocks, IMG_M, CODE_M, M_END }) => {
    try {
      const editorEl = document.querySelector('[data-testid="composer"]');
      if (!editorEl) return { ok: false, error: 'no editor' };

      const fk = Object.keys(editorEl).find(k => k.startsWith('__reactFiber'));
      if (!fk) return { ok: false, error: 'no fiber' };

      let fiber = editorEl[fk];
      for (let i = 0; i < 30 && fiber; i++) {
        if (fiber.memoizedProps?.editorState && fiber.memoizedProps?.onChange) break;
        fiber = fiber.return;
      }
      if (!fiber?.memoizedProps?.editorState) return { ok: false, error: 'no editorState' };

      const EditorState = fiber.memoizedProps.editorState.constructor;
      const es = fiber.memoizedProps.editorState;
      const onChange = fiber.memoizedProps.onChange;
      let cs = es.getCurrentContent();
      const ContentState = cs.constructor;
      const genKey = () => Math.random().toString(36).substring(2, 7);

      const blocks = cs.getBlocksAsArray();

      // Classify blocks
      const imgMarkers = new Set();
      const codeMarkers = new Set();
      const mediaBlocks = [];

      blocks.forEach((block, i) => {
        const text = block.getText();
        if (text.includes(IMG_M) && text.includes(M_END)) {
          imgMarkers.add(i);
        } else if (text.includes(CODE_M) && text.includes(M_END)) {
          codeMarkers.add(i);
        } else if (block.getType() === 'atomic') {
          const cl = block.getCharacterList();
          if (cl.size > 0) {
            const ek = cl.first().getEntity();
            if (ek) {
              const entity = cs.getEntity(ek);
              if (entity.getType() === 'MEDIA') {
                mediaBlocks.push({ index: i, block });
              }
            }
          }
        }
      });

      // Create MARKDOWN atomic blocks for code
      const codeAtomics = codeBlocks.map(code => {
        const md = '```' + (code.lang || '') + '\n' + code.content + '\n```';
        cs = cs.createEntity('MARKDOWN', 'MUTABLE', { markdown: md });
        const ek = cs.getLastCreatedEntityKey();
        return ContentState.createContentBlockFromJS({
          key: genKey(), type: 'atomic', text: ' ',
          characterList: [{ style: [], entity: ek }],
          depth: 0, data: {}
        });
      });

      // First uploaded image ends up last in DraftJS (cursor stays before it);
      // rotate so mediaBlocks[0] = first uploaded image
      if (mediaBlocks.length > 1) mediaBlocks.unshift(mediaBlocks.pop());

      // Build new block array
      const mediaSet = new Set(mediaBlocks.map(mb => mb.index));
      const newBlocks = [];
      let imgIdx = 0;
      let codeIdx = 0;
      let movedImages = 0;
      let movedCode = 0;

      for (let i = 0; i < blocks.length; i++) {
        if (imgMarkers.has(i) && imgIdx < mediaBlocks.length) {
          newBlocks.push(mediaBlocks[imgIdx].block);
          imgIdx++;
          movedImages++;
        } else if (codeMarkers.has(i) && codeIdx < codeAtomics.length) {
          newBlocks.push(codeAtomics[codeIdx]);
          codeIdx++;
          movedCode++;
        } else if (!mediaSet.has(i)) {
          newBlocks.push(blocks[i]);
        }
      }
      while (imgIdx < mediaBlocks.length) {
        newBlocks.push(mediaBlocks[imgIdx].block);
        imgIdx++;
      }

      // Skip state rebuild if nothing was actually moved — avoids
      // overwriting a still-settling paste with stale blocks
      if (movedImages === 0 && movedCode === 0) {
        return { ok: true, movedImages: 0, movedCode: 0 };
      }

      const newCs = ContentState.createFromBlockArray(newBlocks, cs.getEntityMap());
      const newEs = EditorState.push(es, newCs, 'insert-fragment');
      onChange(newEs);

      return { ok: true, movedImages, movedCode };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }, { codeBlocks, IMG_M: IMG_MARKER_PREFIX, CODE_M: CODE_MARKER_PREFIX, M_END: MARKER_SUFFIX });
}

// ─── Main Publish Flow ──────────────────────────────────────────────────────

export async function publish(article, options = {}) {
  console.log(chalk.blue(`\n📝 正在发布到 ${config.name}...`));

  return withPage(config.url, async (page) => {
    await ensureLoggedIn(page, config);

    // ── Navigate to editor ──
    const composeBtn = await findElement(page, [
      'button[aria-label="create"]',
      'button[aria-label="Create"]',
      '[data-testid="empty_state_button_text"]',
    ]);
    if (composeBtn) {
      await page.click(composeBtn.selector);
      try {
        await page.waitForURL(/\/compose\/articles\/edit\//, { timeout: 10000 });
        await page.waitForTimeout(1000);
        console.log(chalk.green('   ✓ 已创建新文章'));
      } catch {
        await page.waitForTimeout(2000);
        console.log(chalk.yellow('   ⚠ 已点击撰写，但页面未跳转'));
      }
    } else {
      console.log(chalk.yellow('   ⚠ 未找到撰写按钮'));
    }

    let filledContent = false;
    let insertedImages = 0;
    let failedSegments = 0;

    // ── Fill title ──
    const filledTitle = await fillTitle(page, [
      'textarea[placeholder*="标题"]',
      'textarea[placeholder*="Title" i]',
    ], article.meta.title);

    // ── Parse content ──
    // If removeCoverImg, strip first image from content (it's used as cover via Phase 4)
    const contentForParse = options.removeCoverImg ? stripFirstImage(article.content) : article.content;
    const { segments, images, codeBlocks } = parseSegments(contentForParse, article.filePath);
    const textCount = segments.filter(s => s.type === 'text').length;
    console.log(chalk.gray(`   ℹ 解析: ${textCount} 段文本, ${images.length} 张图片, ${codeBlocks.length} 个代码块`));

    // ── Download remote images (parallel) ──
    let tempDir = null;
    const tempFiles = [];
    try {
    const remoteImages = images.filter(img => !img.localPath);
    if (remoteImages.length > 0) {
      tempDir = await mkdtemp(join(tmpdir(), 'x-article-'));
      console.log(chalk.gray(`   ℹ 并行下载 ${remoteImages.length} 张远程图片...`));
      const results = await Promise.allSettled(
        remoteImages.map(img => downloadToTemp(img.src, tempDir))
      );
      results.forEach((result, i) => {
        if (result.status === 'fulfilled' && result.value) {
          remoteImages[i].tempPath = result.value;
          tempFiles.push(result.value);
        } else {
          console.log(chalk.yellow(`   ⚠ 无法下载: ${remoteImages[i].src}`));
        }
      });
      if (tempFiles.length > 0) {
        console.log(chalk.green(`   ✓ 已下载 ${tempFiles.length}/${remoteImages.length} 张图片`));
      }
    }

    // ── Phase 1: Build complete HTML with markers and paste at once ──
    let imgMarkerIdx = 0;
    let codeMarkerIdx = 0;
    const htmlParts = [];
    for (const seg of segments) {
      if (seg.type === 'text') {
        htmlParts.push(marked(seg.content));
      } else if (seg.type === 'image') {
        htmlParts.push(`<p>${IMG_MARKER_PREFIX}${imgMarkerIdx}${MARKER_SUFFIX}</p>`);
        imgMarkerIdx++;
      } else if (seg.type === 'code') {
        htmlParts.push(`<p>${CODE_MARKER_PREFIX}${codeMarkerIdx}${MARKER_SUFFIX}</p>`);
        codeMarkerIdx++;
      }
    }

    const fullHtml = htmlParts.join('');
    const editorEl = await findElement(page, EDITOR_SELECTORS);
    if (!editorEl) {
      console.log(chalk.yellow('   ⚠ 未找到编辑器'));
      return { success: false, platform: config.name, message: '未找到编辑器' };
    }
    await pasteHtml(page, editorEl.selector, fullHtml);
    filledContent = true;
    console.log(chalk.green('   ✓ 已粘贴文章内容'));

    // ── Phase 2: Upload all images via dialog (they append at the end) ──
    for (const img of images) {
      const imgPath = img.localPath || img.tempPath;
      if (!imgPath) {
        console.log(chalk.yellow(`   ⚠ 跳过图片: ${img.src}`));
        failedSegments++;
        continue;
      }

      try {
        await insertImage(page, imgPath);
        insertedImages++;
        console.log(chalk.green(`   ✓ 已上传图片 (${insertedImages}/${images.length}): ${img.alt || img.src.substring(0, 40)}`));
      } catch (err) {
        failedSegments++;
        console.log(chalk.yellow(`   ⚠ 图片失败: ${err.message}`));
        try { await page.keyboard.press('Escape'); await page.waitForTimeout(300); } catch {}
      }
    }

    // Wait for all images to fully settle before reordering
    if (insertedImages > 0) {
      try {
        await page.waitForFunction(
          (count) => {
            const imgs = document.querySelectorAll('.public-DraftEditor-content img');
            return imgs.length >= count && Array.from(imgs).every(img => img.complete && img.naturalWidth > 0);
          },
          insertedImages,
          { timeout: 10000 }
        );
      } catch {}
      await page.waitForTimeout(3000);
    }

    // ── Phase 3: Replace markers — move images + create code blocks ──
    // When no images were uploaded, DraftJS needs extra time to process paste
    // (image uploads naturally provide this delay via upload + 3s wait)
    if (insertedImages === 0 && codeBlocks.length > 0) {
      await page.waitForTimeout(2000);
    }
    if (insertedImages > 0 || codeBlocks.length > 0) {
      const result = await replaceMarkers(page, codeBlocks);
      if (result.ok) {
        const moved = [];
        if (result.movedImages > 0) moved.push(`${result.movedImages} 张图片`);
        if (result.movedCode > 0) moved.push(`${result.movedCode} 个代码块`);
        console.log(chalk.green(`   ✓ 已定位 ${moved.join(' + ')}`));
      } else {
        console.log(chalk.yellow(`   ⚠ 内容定位失败: ${result.error}`));
      }
    }

    // ── Phase 4: Set cover image (always from ORIGINAL article content) ──
    let setCover = false;
    const allOrigImages = options.removeCoverImg
      ? parseSegments(article.content, article.filePath).images
      : images;
    const coverImg = allOrigImages[0];
    if (coverImg) {
      console.log(chalk.gray('   ℹ 正在处理封面图片...'));
      // Download cover image if remote and not already downloaded
      let coverPath = coverImg.localPath || coverImg.tempPath;
      if (!coverPath && coverImg.src && /^https?:\/\//.test(coverImg.src)) {
        if (!tempDir) tempDir = await mkdtemp(join(tmpdir(), 'x-article-'));
        coverPath = await downloadToTemp(coverImg.src, tempDir);
      }
      if (coverPath) {
        try {
          const coverInput = page.locator('[data-testid="fileInput"]');
          if (await coverInput.count() > 0) {
            await coverInput.setInputFiles(coverPath);
            await page.waitForTimeout(2000);
            // Click "应用" to apply cover
            if (options.autoCover !== false) {
              try {
                await page.locator('[data-testid="applyButton"]').click({ timeout: 5000 });
                await page.waitForTimeout(1000);
              } catch {}
            }
            setCover = true;
            console.log(chalk.green('   ✓ 已设置封面图片'));
          }
        } catch (err) {
          console.log(chalk.yellow(`   ⚠ 封面图片设置失败: ${err.message}`));
        }
      }
    }

    const parts = [
      filledTitle && '标题',
      filledContent && '内容',
      insertedImages > 0 && `${insertedImages}张图片`,
      codeBlocks.length > 0 && `${codeBlocks.length}个代码块`,
      setCover && '封面',
    ].filter(Boolean);
    const failNote = failedSegments > 0 ? `（${failedSegments} 项失败）` : '';
    const message = parts.length ? `已填充${parts.join('、')}${failNote}` : '未能自动填充';
    return { success: parts.length > 0, platform: config.name, message };
    } finally {
      for (const f of tempFiles) {
        try { await unlink(f); } catch {}
      }
    }
  });
}
