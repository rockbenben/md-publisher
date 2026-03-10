import chalk from 'chalk';
import { PLATFORMS } from '../config.js';
import { openPage, getContext, ensureLoggedIn, alertUser, findElement, waitForEnter, MOD } from '../browser.js';

const config = PLATFORMS.wechat;

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

  try {
    // ============================================================
    // Stage 1: Convert markdown via doocs/md → clipboard gets rich HTML
    // ============================================================
    console.log(chalk.gray('   Stage 1: 通过 md.doocs.org 转换文章格式...'));

    converterPage = await openPage(config.converterUrl);

    // Wait for CodeMirror editor
    const cmEl = await findElement(converterPage, ['.CodeMirror', '.cm-editor .cm-content', '.CodeMirror-code'], 10000);

    if (cmEl) {
      await converterPage.click(cmEl.selector);
      await converterPage.waitForTimeout(200);
      await converterPage.keyboard.press(`${MOD}+A`);
      const clipOk = await converterPage.evaluate(async (text) => {
        try { await navigator.clipboard.writeText(text); return true; }
        catch { return false; }
      }, article.content);
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
    console.log(chalk.gray('   Stage 2: 打开公众号编辑器...'));

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
            }
            console.log(chalk.green('   ✓ 已进入图文消息编辑页'));
            enteredEditor = true;
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

    let filledTitle = false;
    let filledContent = false;

    // --- Fill title (also serves as page-ready signal) ---
    const titleEl = await findElement(editorPage, ['#title', 'span[data-placeholder="标题"]', '[contenteditable="true"][data-placeholder*="标题"]', 'input[placeholder*="标题"]', 'textarea[placeholder*="标题"]', '.title-editor [contenteditable]'], 15000);
    if (titleEl) {
      await editorPage.click(titleEl.selector);
      await editorPage.waitForTimeout(150);
      await editorPage.keyboard.press(`${MOD}+A`);
      await editorPage.keyboard.type(article.meta.title);
      console.log(chalk.green('   ✓ 已填写标题'));
      filledTitle = true;
    } else {
      console.log(chalk.yellow('   ⚠ 未找到标题输入框，请手动填写'));
    }

    // --- Paste rich HTML into editor via Ctrl+V ---
    // WeChat MP now uses ProseMirror (not iframe UEditor).
    try {
      console.log(chalk.gray('   寻找编辑器...'));
      const editorEl = await findElement(editorPage, ['.ProseMirror[contenteditable="true"]', '.editor_content_placeholder', '.edui-default[contenteditable="true"]', '.js_editor_area [contenteditable="true"]', '.editor_area [contenteditable="true"]'], 10000);
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

    // Log unsupported category/tag pass-through
    const categories = article.meta.category?.length ? article.meta.category : options.category;
    const tags = article.meta.tag?.length ? article.meta.tag : options.tag;
    if (filledContent && (categories?.length || tags?.length)) {
      console.log(chalk.gray(`   ℹ ${config.name} 暂不支持自动填写分类/标签`));
    }

    // Converter no longer needed — close it, keep editor open for user review
    await converterPage.close().catch(() => {});
    converterPage = null; // Prevent double-close in finally

    const parts = [filledTitle && '标题', filledContent && '内容'].filter(Boolean);
    const message = parts.length ? `已填充${parts.join('和')}` : '未能自动填充，请手动操作';
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
