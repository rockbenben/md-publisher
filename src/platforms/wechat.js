import chalk from 'chalk';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PLATFORMS } from '../config.js';
import { openPage, getContext, ensureLoggedIn, alertUser, findElement, fillTitle, waitForEnter, MOD } from '../browser.js';
import { preprocessCallouts, prepareCoverImage, coverFileMeta, stripFirstImage } from '../parser.js';

const config = PLATFORMS.wechat;

/**
 * Upload the article cover into WeChat's 图片库 and set it as the 封面.
 *
 * Verified live against the real appmsg editor (2026-06):
 *   封面热区 → 从图片库选择 → 上传文件(webuploader) → 选中首图(此前「下一步」是灰的)
 *   → 下一步 → 编辑封面(2.35:1 / 1:1) → 确认.
 *
 * Never throws — returns false on any failure so publishing still succeeds.
 * @param {import('playwright').Page} page - editor page
 * @param {string} coverB64 - base64 cover image (from prepareCoverImage)
 * @returns {Promise<boolean>} true if the cover was set
 */
async function setWechatCover(page, coverB64, autoConfirm) {
  let tmpPath = null;
  try {
    // Materialise the (already downloaded/normalised) cover to a temp file —
    // WeChat's uploader is webuploader, which reliably accepts setInputFiles.
    const ext = coverFileMeta(coverB64).name.split('.').pop();
    tmpPath = join(tmpdir(), `md-pub-cover-${process.pid}-${ext}.${ext}`);
    await writeFile(tmpPath, Buffer.from(coverB64, 'base64'));

    // 1. Open the cover picker (从图片库选择). Clicking the cover hot-zone
    //    surfaces the entry buttons; each click auto-waits for its target, so
    //    no fixed sleeps are needed between these steps.
    await page.locator('#js_cover_area .js_cover_btn_area').first().click();
    await page.locator('#js_cover_area a.js_imagedialog:visible').first().click();
    const dialog = page.locator('.weui-desktop-dialog:visible');
    await dialog.waitFor({ state: 'visible', timeout: 8000 });

    // 2. Inject the file into the (hidden) webuploader input. Wait for the
    //    「上传文件」pick button to render first — that signals webuploader has
    //    initialised and bound its change handler, so the injection is picked up.
    await dialog.locator('.single_upload_btn_container').first().waitFor({ state: 'visible', timeout: 8000 });
    await dialog.locator('input[type="file"]').first().setInputFiles(tmpPath);

    // 3. Wait for the upload to land as the first thumbnail, then select it.
    //    「下一步」stays disabled until a thumbnail is selected, so poll-click
    //    the newest image until the button enables (skip if already enabled —
    //    avoids deselecting an auto-selected upload).
    const firstThumb = dialog.locator('.weui-desktop-img-picker__item').first();
    await firstThumb.waitFor({ state: 'visible', timeout: 20000 });
    const nextBtn = dialog.locator('button.weui-desktop-btn_primary', { hasText: '下一步' }).first();
    let ready = false;
    for (let i = 0; i < 15; i++) {
      const disabled = await nextBtn.evaluate(b => /weui-desktop-btn_disabled/.test(b.className)).catch(() => true);
      if (!disabled) { ready = true; break; }
      await firstThumb.click().catch(() => {});
      await page.waitForTimeout(600);
    }
    if (!ready) throw new Error('上传后「下一步」未激活（图片可能仍在上传）');

    // 4. 下一步 → 编辑封面(裁剪). The 确认 (apply crop) is the manual-crop point,
    //    so it's gated on autoConfirm — off ⇒ leave the crop dialog for the user.
    await nextBtn.click({ timeout: 8000 });
    const cropConfirm = dialog.locator('button.weui-desktop-btn_primary', { hasText: '确认' }).first();
    await cropConfirm.waitFor({ state: 'visible', timeout: 8000 });
    if (!autoConfirm) {
      console.log(chalk.green('   ✓ 已上传封面，请在弹窗中手动裁切并确认'));
      return true;
    }
    await cropConfirm.click({ timeout: 8000 });

    // 5. Verify the cover actually landed. WeChat renders the preview's
    //    background image asynchronously after the dialog closes, so poll
    //    (up to ~6s) rather than guessing a single fixed wait.
    const coverSet = () => page.evaluate(() => {
      const p = document.querySelector('.js_cover_preview_new');
      const bg = p && getComputedStyle(p).backgroundImage;
      return !!(bg && bg !== 'none' && /https?:|mmbiz/.test(bg));
    });
    for (let i = 0; i < 12; i++) {
      if (await coverSet()) { console.log(chalk.green('   ✓ 已设置封面')); return true; }
      await page.waitForTimeout(500);
    }
    return false;
  } catch (err) {
    console.log(chalk.yellow(`   ⚠ 封面设置失败: ${err.message}`));
    return false;
  } finally {
    if (tmpPath) await unlink(tmpPath).catch(() => {});
  }
}

/**
 * 公众号 - Two-stage flow (manual page management, can't use withPage):
 * 1. Convert markdown via md.doocs.org (copies rich HTML to clipboard)
 * 2. Open WeChat MP editor, paste via Ctrl+V
 *
 * Both pages managed with try/catch/finally to guarantee cleanup on any exit path.
 */
export async function publish(article, options = {}) {
  console.log(chalk.blue(`\n📝 正在发布到 ${config.name}...`));

  let converterPage = null;
  let wechatPage = null;
  let editorPage = null;
  let coverB64 = null;

  try {
    // ============================================================
    // Stage 1: Convert markdown via doocs/md → clipboard gets rich HTML
    // ============================================================
    console.log(chalk.gray('   ℹ 阶段一：通过 md.doocs.org 转换格式...'));

    converterPage = await openPage(config.converterUrl);

    // Prepare cover early — must read the body's first image BEFORE we strip it.
    // When the cover came from that first image (no frontmatter `cover`), strip it
    // so it isn't duplicated as both cover and body content.
    coverB64 = await prepareCoverImage(converterPage, article).catch(() => null);
    let bodyContent = article.content;
    if (options.removeCoverImg && coverB64 && !article.meta?.cover) bodyContent = stripFirstImage(bodyContent);

    // Wait for CodeMirror editor
    const cmEl = await findElement(converterPage, ['.CodeMirror', '.cm-editor .cm-content', '.CodeMirror-code'], 10000);

    if (cmEl) {
      await converterPage.click(cmEl.selector);
      await converterPage.waitForTimeout(200);
      await converterPage.keyboard.press(`${MOD}+A`);
      const clipOk = await converterPage.evaluate(async (text) => {
        try { await navigator.clipboard.writeText(text); return true; }
        catch { return false; }
      }, preprocessCallouts(bodyContent));
      if (!clipOk) throw new Error('剪贴板写入失败，请检查浏览器权限');
      await converterPage.keyboard.press(`${MOD}+V`);
      await converterPage.waitForTimeout(800);
      console.log(chalk.green('   ✓ 已粘贴 Markdown 到转换器'));
    } else {
      alertUser('未找到转换器编辑器，请手动粘贴 Markdown');
      await waitForEnter('   完成后按 Enter 继续...');
    }

    // Click "复制" — rich HTML goes to clipboard
    try {
      const copyBtn = await converterPage.waitForSelector('button:has-text("复制")', { timeout: 5000 });
      await copyBtn.click();
      console.log(chalk.green('   ✓ 已复制渲染后的 HTML 到剪贴板'));
      await converterPage.waitForTimeout(300);
    } catch {
      alertUser('未找到「复制」按钮，请手动点击');
      await waitForEnter('   完成后按 Enter 继续...');
    }

    // ============================================================
    // Stage 2: Open WeChat MP editor, paste clipboard content
    // ============================================================
    console.log(chalk.gray('   ℹ 阶段二：打开公众号编辑器...'));

    wechatPage = await openPage(config.url);
    await ensureLoggedIn(wechatPage, config);

    // Extract token → navigate directly to editor
    editorPage = wechatPage;
    let enteredEditor = false;

    try {
      await wechatPage.waitForURL(/token=\d+/, { timeout: 10000 });
      const tokenMatch = wechatPage.url().match(/token=(\d+)/);

      if (tokenMatch?.[1]) {
        const token = tokenMatch[1];
        const editorUrl = `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&token=${token}&lang=zh_CN`;
        await wechatPage.goto(editorUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        console.log(chalk.green('   ✓ 已直接进入图文消息编辑页'));
        enteredEditor = true;
      }
    } catch { /* token extraction failed */ }

    // Fallback: click through dashboard
    if (!enteredEditor) {
      const ctx = await getContext();
      try {
        const createBtn = await findElement(wechatPage, ['.new-creation__title', 'text=新的创作', 'button:has-text("新的创作")'], 5000);
        if (createBtn) {
          await wechatPage.click(createBtn.selector);
          await wechatPage.waitForTimeout(500);
          const articleBtn = await findElement(wechatPage, ['text=图文消息', 'a:has-text("图文")'], 3000);
          if (articleBtn) {
            // Register page event BEFORE click to avoid race condition
            const newPagePromise = ctx.waitForEvent('page', { timeout: 5000 }).catch(() => null);
            await wechatPage.click(articleBtn.selector);
            const newPage = await newPagePromise;
            if (newPage) {
              await newPage.waitForLoadState('domcontentloaded');
              editorPage = newPage;
              console.log(chalk.green('   ✓ 已进入图文消息编辑页'));
              enteredEditor = true;
            }
          }
        }
      } catch { /* click-through failed */ }
    }

    // Last resort: manual
    if (!enteredEditor) {
      alertUser('请手动进入公众号图文消息编辑页面');
      await waitForEnter('   进入编辑页后按 Enter 继续...');
      const ctx = await getContext();
      const pages = ctx.pages();
      if (pages.length === 0) throw new Error('浏览器中没有打开的页面');
      editorPage = pages[pages.length - 1];
    }

    let filledContent = false;

    // --- Fill title (also serves as page-ready signal) ---
    const filledTitle = await fillTitle(editorPage, ['#title', 'span[data-placeholder="标题"]', '[contenteditable="true"][data-placeholder*="标题"]', 'input[placeholder*="标题"]', 'textarea[placeholder*="标题"]', '.title-editor [contenteditable]'], article.meta.title, 15000);

    // --- Paste rich HTML into editor via Ctrl+V ---
    // WeChat MP now uses ProseMirror (not iframe UEditor).
    try {
      console.log(chalk.gray('   寻找编辑器...'));
      // WeChat's title is ALSO a contenteditable and precedes the body in the
      // DOM, so a bare .ProseMirror selector resolves to the title and dumps the
      // content into it. Put the body-scoped selectors (.js_editor_area /
      // .editor_area, already established in this codebase) first, and make the
      // fallback .ProseMirror explicitly exclude the title field.
      const editorEl = await findElement(editorPage, ['.js_editor_area .ProseMirror[contenteditable="true"]', '.js_editor_area [contenteditable="true"]', '.editor_area [contenteditable="true"]', '.ProseMirror[contenteditable="true"]:not(#title):not([data-placeholder*="标题"])', '.editor_content_placeholder', '.edui-default[contenteditable="true"]'], 10000);
      if (editorEl) {
        await editorPage.click(editorEl.selector);
        await editorPage.waitForTimeout(200);
        await editorPage.keyboard.press(`${MOD}+V`);
        await editorPage.waitForTimeout(500);
        console.log(chalk.green(`   ✓ 已粘贴内容到编辑器 (${editorEl.selector})`));
        filledContent = true;
      }
    } catch { /* not found */ }

    if (!filledContent) {
      console.log(chalk.yellow(`   ⚠ 未找到编辑器，请手动 ${MOD === 'Meta' ? 'Cmd' : 'Ctrl'}+V 粘贴`));
    }

    // Fill description
    if (article.meta.description) {
      const descEl = await findElement(editorPage, ['#js_description', 'textarea[placeholder*="摘要"]'], 3000);
      if (descEl) {
        await editorPage.click(descEl.selector);
        await editorPage.waitForTimeout(150);
        await editorPage.keyboard.type(article.meta.description);
        console.log(chalk.green('   ✓ 已填写摘要'));
      }
    }

    // Upload + set cover (prepared above from frontmatter `cover` / first image).
    // The crop confirmation respects 封面自动确认 (autoCover).
    let setCover = false;
    if (coverB64) {
      console.log(chalk.gray('   ℹ 正在上传封面到图片库...'));
      setCover = await setWechatCover(editorPage, coverB64, options.autoCover !== false);
    }

    // Log unsupported category/tag pass-through
    const categories = article.meta.category?.length ? article.meta.category : options.category;
    const tags = article.meta.tag?.length ? article.meta.tag : options.tag;
    if (filledContent && (categories?.length || tags?.length)) {
      console.log(chalk.gray('   ℹ 分类/标签请手动设置'));
    }

    // Converter no longer needed — close it, keep editor open for user review
    await converterPage.close().catch(() => {});
    converterPage = null; // Prevent double-close in finally

    const parts = [filledTitle && '标题', filledContent && '内容', setCover && '封面'].filter(Boolean);
    const message = parts.length ? `已填充${parts.join('、')}` : '未能自动填充，请手动操作';
    return { success: filledContent, platform: config.name, message };
  } catch (err) {
    // On error: close both pages (converter handled by finally)
    if (editorPage && editorPage !== wechatPage) await editorPage.close().catch(() => {});
    if (wechatPage) await wechatPage.close().catch(() => {});
    throw err;
  } finally {
    // Guarantee converter page cleanup on any exit path
    if (converterPage) await converterPage.close().catch(() => {});
  }
}
