import chalk from 'chalk';
import { PLATFORMS } from '../config.js';
import { withPage, ensureLoggedIn, pasteText, findElement, MOD } from '../browser.js';

const config = PLATFORMS.sspai;

/**
 * Transform content for 少数派: remove image optimization params.
 */
function transformContent(content) {
  return content.replace(/\?imageMogr2\/format\/webp/g, '');
}

/**
 * 少数派 - Paste markdown, click "立即转换" in the stable modal dialog.
 *
 * Editor: CKEditor 5 (classes: .ck-editor__editable, .ck-content)
 * The dialog is a persistent modal (stays until user clicks).
 * Use Playwright's auto-waiting click which handles visibility detection natively.
 */
export async function publish(article, options = {}) {
  console.log(chalk.blue(`\n📝 正在发布到 ${config.name}...`));

  const transformed = transformContent(article.content);

  return withPage(config.url, async (page) => {
    await ensureLoggedIn(page, config);

    let filledTitle = false;
    let filledContent = false;

    // Step 1: Fill title
    const titleEl = await findElement(page, ['input[placeholder*="请输入标题"]', 'textarea[placeholder*="标题"]', '[placeholder*="标题"]']);
    if (titleEl) {
      await page.click(titleEl.selector);
      await page.waitForTimeout(200);
      await page.keyboard.press(`${MOD}+A`);
      await page.keyboard.type(article.meta.title);
      console.log(chalk.green('   ✓ 已填写标题'));
      filledTitle = true;
    } else {
      console.log(chalk.yellow('   ⚠ 未找到标题输入框，请手动填写'));
    }

    // Step 2: Paste markdown into CKEditor body
    const editorEl = await findElement(page, ['.ck-editor__editable', '.ck-content', '.ck-editor__editable_inline', '.wangEditor-txt', '.ProseMirror', '[contenteditable="true"]', 'div[role="textbox"]']);
    if (editorEl) {
      await pasteText(page, editorEl.selector, transformed);
      console.log(chalk.green('   ✓ 已粘贴文章内容'));
      filledContent = true;

      // Step 3: Click "立即转换"
      try {
        await page.getByText('立即转换', { exact: true }).click({ timeout: 10000 });
        console.log(chalk.green('   ✓ 已点击「立即转换」'));
        await page.waitForTimeout(1000);
      } catch {
        console.log(chalk.yellow('   ⚠ 未检测到 Markdown 转换对话框'));
      }
    } else {
      console.log(chalk.yellow('   ⚠ 未找到编辑器，请手动粘贴内容'));
    }

    const categories = article.meta.category?.length ? article.meta.category : options.category;
    const tags = article.meta.tag?.length ? article.meta.tag : options.tag;
    if (filledContent && (categories?.length || tags?.length)) {
      console.log(chalk.gray(`   ℹ ${config.name} 暂不支持自动填写分类/标签`));
    }

    const parts = [filledTitle && '标题', filledContent && '内容'].filter(Boolean);
    const message = parts.length ? `已填充${parts.join('和')}` : '未能自动填充，请手动操作';
    return { success: filledContent, platform: config.name, message };
  });
}
