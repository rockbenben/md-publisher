import chalk from 'chalk';
import { marked } from 'marked';
import { PLATFORMS } from '../config.js';
import { withPage, ensureLoggedIn, pasteHtml, findElement, MOD } from '../browser.js';

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

    let filledTitle = false;
    let filledContent = false;

    // Step 2: Fill title — wait for element to confirm editor loaded
    const titleEl = await findElement(page, ['input[placeholder*="请输入文章标题"]', 'input[placeholder*="标题"]', '[placeholder*="标题"]']);
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

    // Step 3: Convert markdown to HTML, paste as rich text into ProseMirror
    const html = marked(article.content);

    const editorEl = await findElement(page, ['.ProseMirror', '[contenteditable="true"]', 'div[data-placeholder="请输入正文"]']);
    if (editorEl) {
      await pasteHtml(page, editorEl.selector, html);
      console.log(chalk.green('   ✓ 已粘贴内容'));
      filledContent = true;
    } else {
      console.log(chalk.yellow('   ⚠ 未找到编辑器，请手动粘贴内容'));
    }

    // Try to fill category and tags
    const categories = article.meta.category?.length ? article.meta.category : options.category;
    const tags = article.meta.tag?.length ? article.meta.tag : options.tag;

    if (filledContent && categories?.length) {
      try {
        const catSelect = await findElement(page, ['.editor-tag-select', '.category-select', '[class*="category"]'], 3000);
        if (catSelect) {
          await page.click(catSelect.selector);
          await page.waitForTimeout(300);
          for (const cat of categories) {
            try {
              await page.getByText(cat, { exact: true }).click({ timeout: 2000 });
              console.log(chalk.green(`   ✓ 已选择分类: ${cat}`));
              break;
            } catch { /* try next */ }
          }
        }
      } catch {
        console.log(chalk.yellow('   ⚠ 未能自动选择分类'));
      }
    }

    if (filledContent && tags?.length) {
      try {
        const tagInput = await findElement(page, ['input[placeholder*="标签"]', 'input[placeholder*="tag"]', '.tag-input input'], 3000);
        if (tagInput) {
          const tagsToFill = tags.slice(0, 5);
          for (const tag of tagsToFill) {
            await page.click(tagInput.selector);
            await page.keyboard.type(tag);
            await page.keyboard.press('Enter');
            await page.waitForTimeout(300);
          }
          console.log(chalk.green(`   ✓ 已填写标签: ${tagsToFill.join(', ')}`));
        }
      } catch {
        console.log(chalk.yellow('   ⚠ 未能自动填写标签'));
      }
    }

    const parts = [filledTitle && '标题', filledContent && '内容'].filter(Boolean);
    const message = parts.length ? `已填充${parts.join('和')}` : '未能自动填充，请手动操作';
    return { success: filledContent, platform: config.name, message };
  });
}
