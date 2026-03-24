import chalk from 'chalk';
import { PLATFORMS } from '../config.js';
import { withPage, ensureLoggedIn, pasteText, findElement, fillTitle } from '../browser.js';
import { preprocessCallouts, prepareCoverImage, injectCoverToInput, stripFirstImage } from '../parser.js';

const config = PLATFORMS.sspai;

/**
 * Transform content for 少数派: remove image optimization params.
 */
function transformContent(content) {
  return preprocessCallouts(content).replace(/\?imageMogr2\/format\/webp/g, '');
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

  return withPage(config.url, async (page) => {
    await ensureLoggedIn(page, config);

    let filledContent = false;

    // Step 1: Fill title
    const filledTitle = await fillTitle(page, ['input[placeholder*="请输入标题"]', 'textarea[placeholder*="标题"]', '[placeholder*="标题"]'], article.meta.title);

    // Prepare cover early (extract URL from original content before any stripping)
    const coverB64 = await prepareCoverImage(page, article).catch(() => null);

    // Step 2: Paste markdown into CKEditor body
    let content = article.content;
    if (options.removeCoverImg && coverB64) content = stripFirstImage(content);
    const transformed = transformContent(content);
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
      console.log(chalk.gray('   ℹ 分类/标签请手动设置'));
    }

    // Step 4: Set cover image (first article image)
    let setCover = false;
    if (coverB64 && await page.locator('.upload-image-container input[type="file"]').count() > 0) {
      console.log(chalk.gray('   ℹ 正在上传封面图片...'));
      try {
        await injectCoverToInput(page, '.upload-image-container input[type="file"]', coverB64);
        await page.waitForTimeout(3000);
        if (options.autoCover !== false) {
          try {
            await page.getByText('裁切并使用', { exact: true }).click({ timeout: 5000 });
            await page.waitForTimeout(1000);
          } catch {}
        }
        setCover = true;
        console.log(chalk.green('   ✓ 已设置封面图片'));
      } catch (err) {
        console.log(chalk.yellow(`   ⚠ 封面图片设置失败: ${err.message}`));
      }
    }

    const parts = [filledTitle && '标题', filledContent && '内容', setCover && '封面'].filter(Boolean);
    const message = parts.length ? `已填充${parts.join('、')}` : '未能自动填充，请手动操作';
    return { success: filledContent, platform: config.name, message };
  });
}
