import chalk from 'chalk';
import { PLATFORMS } from '../config.js';
import { withPage, ensureLoggedIn, pasteText, pasteToFocused, findElement, MOD } from '../browser.js';
import { preprocessCallouts } from '../parser.js';

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
    const contentWithCallouts = preprocessCallouts(article.content);
    const editorEl = await findElement(page, ['.bytemd-editor .CodeMirror', '.CodeMirror-code', '.bytemd-editor', '[role="textbox"]']);
    if (editorEl) {
      await pasteText(page, editorEl.selector, contentWithCallouts);
      console.log(chalk.green('   ✓ 已粘贴文章内容'));
      filledContent = true;
    } else {
      // Fallback: click editor area and paste
      console.log(chalk.yellow('   ⚠ 尝试备用方式粘贴...'));
      try {
        await page.click('.bytemd', { timeout: 5000 });
        await pasteToFocused(page, contentWithCallouts);
        console.log(chalk.green('   ✓ 已粘贴文章内容（备用方式）'));
        filledContent = true;
      } catch {
        console.log(chalk.red('   ✗ 无法找到编辑器，请手动粘贴'));
      }
    }

    const parts = [filledTitle && '标题', filledContent && '内容'].filter(Boolean);
    const message = parts.length ? `已填充${parts.join('、')}` : '未能自动填充，请手动操作';
    return { success: filledContent, platform: config.name, message };
  });
}
