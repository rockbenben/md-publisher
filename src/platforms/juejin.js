import chalk from 'chalk';
import { PLATFORMS } from '../config.js';
import { withPage, ensureLoggedIn, pasteText, pasteToFocused, findElement, MOD } from '../browser.js';

const config = PLATFORMS.juejin;

/**
 * 掘金 - Native markdown editor (ByteMD), simplest platform.
 */
export async function publish(article, options = {}) {
  console.log(chalk.blue(`\n📝 正在发布到 ${config.name}...`));

  return withPage(config.url, async (page) => {
    await ensureLoggedIn(page, config);

    let filledTitle = false;
    let filledContent = false;

    // Fill title — wait for element to confirm editor loaded
    const titleEl = await findElement(page, ['.title-input input', 'input[placeholder*="标题"]', '.byte-md-editor input']);
    if (titleEl) {
      await page.click(titleEl.selector);
      await page.keyboard.press(`${MOD}+A`);
      await page.keyboard.type(article.meta.title);
      console.log(chalk.green('   ✓ 已填写标题'));
      filledTitle = true;
    } else {
      console.log(chalk.yellow('   ⚠ 未找到标题输入框，请手动填写'));
    }

    // Paste markdown into editor
    const editorEl = await findElement(page, ['.bytemd-editor .CodeMirror', '.CodeMirror-code', '.bytemd-editor', '[role="textbox"]']);
    if (editorEl) {
      await pasteText(page, editorEl.selector, article.content);
      console.log(chalk.green('   ✓ 已粘贴文章内容'));
      filledContent = true;
    } else {
      // Fallback: click editor area and paste
      console.log(chalk.yellow('   ⚠ 尝试备用方式粘贴...'));
      try {
        await page.click('.bytemd', { timeout: 5000 });
        await pasteToFocused(page, article.content);
        console.log(chalk.green('   ✓ 已粘贴文章内容（备用方式）'));
        filledContent = true;
      } catch {
        console.log(chalk.red('   ✗ 无法找到编辑器，请手动粘贴'));
      }
    }

    // Fill category and tags via the publish settings panel
    const categories = article.meta.category?.length ? article.meta.category : options.category;
    const tags = article.meta.tag?.length ? article.meta.tag : options.tag;

    if (filledContent && (categories?.length || tags?.length)) {
      const publishBtn = await findElement(page, ['.publish-popup-btn', 'button:has-text("发布")'], 5000);
      if (publishBtn) {
        try {
          await page.click(publishBtn.selector);
          await page.waitForTimeout(500);

          // Select category — Juejin shows a grid of category buttons
          if (categories?.length) {
            for (const cat of categories) {
              try {
                await page.getByText(cat, { exact: true }).click({ timeout: 3000 });
                console.log(chalk.green(`   ✓ 已选择分类: ${cat}`));
                break; // Juejin typically allows only one category
              } catch {
                // Category not found, try next
              }
            }
          }

          // Fill tags
          if (tags?.length) {
            const tagInput = await findElement(page, ['.tag-input input', 'input[placeholder*="搜索标签"]', 'input[placeholder*="标签"]'], 3000);
            if (tagInput) {
              const tagsToFill = tags.slice(0, 3);
              for (const tag of tagsToFill) {
                await page.click(tagInput.selector);
                await page.keyboard.type(tag);
                await page.keyboard.press('Enter');
                await page.waitForTimeout(300);
              }
              console.log(chalk.green(`   ✓ 已填写标签: ${tagsToFill.join(', ')}`));
            }
          }
        } catch {
          console.log(chalk.yellow('   ⚠ 自动填写分类/标签失败，请手动操作'));
        }
      }
    }

    const parts = [filledTitle && '标题', filledContent && '内容'].filter(Boolean);
    const message = parts.length ? `已填充${parts.join('和')}` : '未能自动填充，请手动操作';
    return { success: filledContent, platform: config.name, message };
  });
}
