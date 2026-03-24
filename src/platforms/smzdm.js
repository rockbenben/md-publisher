import chalk from 'chalk';
import { marked } from 'marked';
import { PLATFORMS } from '../config.js';
import { withPage, ensureLoggedIn, pasteHtml, findElement, fillTitle } from '../browser.js';
import { preprocessCallouts } from '../parser.js';

const config = PLATFORMS.smzdm;

/**
 * 什么值得买 - Click "发布新文章", wait for editor, paste HTML content.
 */
export async function publish(article, options = {}) {
  console.log(chalk.blue(`\n📝 正在发布到 ${config.name}...`));

  return withPage(config.url, async (page) => {
    await ensureLoggedIn(page, config);

    // Step 1: Click "发布新文章" and wait for editor page
    try {
      const newArticleBtn = await findElement(page, ['a:has-text("发布新文章")', 'text=发布新文章', 'a[href*="/edit/"]'], 5000);

      if (newArticleBtn) {
        await Promise.all([
          page.waitForURL('**/edit/**', { timeout: 10000 }),
          page.click(newArticleBtn.selector),
        ]);
        console.log(chalk.green('   ✓ 已进入编辑页'));
      } else {
        console.log(chalk.yellow('   ⚠ 未找到「发布新文章」，可能已在编辑页'));
      }
    } catch {
      console.log(chalk.yellow('   ⚠ 导航到编辑页超时，继续尝试...'));
    }

    let filledContent = false;

    // Step 2: Fill title — wait for element to confirm editor loaded
    const filledTitle = await fillTitle(page, ['input[placeholder*="请输入文章标题"]', 'input[placeholder*="标题"]', '[placeholder*="标题"]'], article.meta.title);

    // Step 3: Convert markdown to HTML, paste as rich text into ProseMirror
    const html = marked(preprocessCallouts(article.content));

    const editorEl = await findElement(page, ['.ProseMirror', '[contenteditable="true"]', 'div[data-placeholder="请输入正文"]']);
    if (editorEl) {
      await pasteHtml(page, editorEl.selector, html);
      console.log(chalk.green('   ✓ 已粘贴内容'));
      filledContent = true;
    } else {
      console.log(chalk.yellow('   ⚠ 未找到编辑器，请手动粘贴内容'));
    }

    const parts = [filledTitle && '标题', filledContent && '内容'].filter(Boolean);
    const message = parts.length ? `已填充${parts.join('、')}` : '未能自动填充，请手动操作';
    return { success: filledContent, platform: config.name, message };
  });
}
