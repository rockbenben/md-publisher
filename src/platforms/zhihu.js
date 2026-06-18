import chalk from 'chalk';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PLATFORMS } from '../config.js';
import { withPage, ensureLoggedIn, pasteText, findElement, fillTitle } from '../browser.js';
import { preprocessCallouts, prepareCoverImage, coverFileMeta, stripFirstImage } from '../parser.js';

const config = PLATFORMS.zhihu;

/**
 * Transform content for 知乎: remove blank lines around image lines.
 * Zhihu's markdown parser doesn't handle blank lines around ![...](...)
 * properly — they cause layout issues after conversion.
 */
export function transformContent(content) {
  const lines = content.split('\n');
  const isImage = lines.map(l => /^\s*!\[/.test(l));
  const result = [];

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '') {
      // Skip blank line if previous output line was an image
      if (result.length > 0 && /^\s*!\[.*\]\(.*\)/.test(result[result.length - 1])) continue;
      // Skip blank line if next non-blank line is an image (linear scan with precomputed flags)
      let skip = false;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() !== '') { skip = isImage[j]; break; }
      }
      if (skip) continue;
    }
    result.push(lines[i]);
  }

  return result.join('\n');
}

/**
 * 知乎 - Paste markdown, auto-click "确认并解析" notification bar.
 *
 * The notification uses react-transition-group with classes:
 *   .Notification .Notification-white .Notification-enter-done
 * It only appears for a few seconds after pasting markdown.
 *
 * Solution: Start Playwright locator click BEFORE paste.
 * Playwright auto-waits for .Notification to become visible, then performs
 * a trusted click (isTrusted=true) which React properly handles.
 */
export async function publish(article, options = {}) {
  console.log(chalk.blue(`\n📝 正在发布到 ${config.name}...`));

  return withPage(config.url, async (page) => {
    await ensureLoggedIn(page, config);

    // Prepare cover early (extract URL from original content before any stripping)
    const coverB64 = await prepareCoverImage(page, article).catch(() => null);

    let content = article.content;
    if (options.removeCoverImg && coverB64 && !article.meta?.cover) content = stripFirstImage(content);
    const transformed = transformContent(preprocessCallouts(content));

    let filledContent = false;

    // Step 1: Fill title
    const filledTitle = await fillTitle(page, ['textarea[placeholder*="标题"]', 'input[placeholder*="标题"]', '[placeholder*="请输入标题"]'], article.meta.title);

    // Step 2: Paste content — start locator click BEFORE paste to catch the notification
    const editorEl = await findElement(page, ['.public-DraftEditor-content', '[contenteditable="true"]', '.ProseMirror', 'div[role="textbox"]']);
    if (editorEl) {
      // Try two locator strategies — Promise.any waits for the first SUCCESS.
      // Individual .catch() prevents unhandled rejection from the losing promise.
      const p1 = page.locator('.Notification').getByText('确认并解析').click({ timeout: 20000 }).then(() => 'locator-notification');
      const p2 = page.getByText('确认并解析').click({ timeout: 20000 }).then(() => 'locator-getbytext');
      p1.catch(() => {});
      p2.catch(() => {});
      const confirmClick = Promise.any([p1, p2]).catch(() => null);

      await pasteText(page, editorEl.selector, transformed);
      console.log(chalk.green('   ✓ 已粘贴文章内容'));
      filledContent = true;

      const method = await confirmClick;
      if (method) {
        console.log(chalk.green(`   ✓ 已自动点击「确认并解析」(${method})`));
        await page.waitForTimeout(2000);
      } else {
        console.log(chalk.yellow('   ⚠ 未检测到 Markdown 解析提示，可能需要手动点击'));
      }
    } else {
      console.log(chalk.yellow('   ⚠ 未找到编辑器，请手动粘贴内容'));
    }

    const categories = article.meta.category?.length ? article.meta.category : options.category;
    const tags = article.meta.tag?.length ? article.meta.tag : options.tag;
    if (filledContent && (categories?.length || tags?.length)) {
      console.log(chalk.gray('   ℹ 分类/标签请手动设置'));
    }

    // Step 3: Set cover image (frontmatter `cover`, else first content image).
    // 知乎的封面框（发布设置 → 添加文章封面）触发的是一个【原生文件选择框】，
    // 隐藏的 .UploadPicture-input 并不响应程序化注入 —— 旧的 injectCoverToInput
    // 会静默失败却仍报成功。正解：拦截 filechooser 并点击封面框；上传后直接渲染
    // 预览（无裁剪步骤），成功信号是出现 <img alt="封面图">。
    let setCover = false;
    if (coverB64) {
      let tmpPath = null;
      try {
        const ext = coverFileMeta(coverB64).name.split('.').pop();
        tmpPath = join(tmpdir(), `md-pub-cover-${process.pid}-zhihu.${ext}`);
        await writeFile(tmpPath, Buffer.from(coverB64, 'base64'));

        // The cover box is a <label> wrapping the file input; clicking it opens
        // a native file chooser. Use an actionable locator click (auto-scrolls,
        // targets the element, avoids covered points) — raw coordinate clicks
        // miss once pasted content shifts the layout under the sticky footer.
        const coverBox = page.locator('.UploadPicture-wrapper').first();
        await coverBox.scrollIntoViewIfNeeded({ timeout: 5000 });

        console.log(chalk.gray('   ℹ 正在上传封面图片...'));
        const chooserPromise = page.waitForEvent('filechooser', { timeout: 8000 });
        await coverBox.click({ timeout: 5000 });
        const chooser = await chooserPromise;
        await chooser.setFiles(tmpPath);

        // Wait for the uploaded cover preview to render before claiming success.
        await page.locator('img[alt="封面图"]').first().waitFor({ state: 'visible', timeout: 15000 });
        setCover = true;
        console.log(chalk.green('   ✓ 已设置封面图片'));
      } catch (err) {
        console.log(chalk.yellow(`   ⚠ 封面图片设置失败: ${err.message}`));
      } finally {
        if (tmpPath) await unlink(tmpPath).catch(() => {});
      }
    }

    const parts = [filledTitle && '标题', filledContent && '内容', setCover && '封面'].filter(Boolean);
    const message = parts.length ? `已填充${parts.join('、')}` : '未能自动填充，请手动操作';
    return { success: filledContent, platform: config.name, message };
  });
}
