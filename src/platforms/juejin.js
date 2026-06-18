import chalk from 'chalk';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PLATFORMS } from '../config.js';
import { withPage, ensureLoggedIn, pasteText, pasteToFocused, findElement, fillTitle } from '../browser.js';
import { preprocessCallouts, prepareCoverImage, coverFileMeta, stripFirstImage } from '../parser.js';

const config = PLATFORMS.juejin;

/**
 * Set the article cover. 掘金's 文章封面 only exists inside the 发布 drawer, so we
 * open it, inject the file, and LEAVE the drawer open — the user reviews the
 * required 分类/标签 and clicks 确定并发布 themselves (we never auto-publish).
 *
 * Verified live (2026-06): the cover uploads directly with NO crop step, so there
 * is nothing for 封面自动确认 (autoCover) to gate here.
 * Never throws — returns false on failure so publishing still succeeds.
 * @param {import('playwright').Page} page
 * @param {string} coverB64
 * @returns {Promise<boolean>}
 */
async function setJuejinCover(page, coverB64) {
  let tmpPath = null;
  try {
    const ext = coverFileMeta(coverB64).name.split('.').pop();
    tmpPath = join(tmpdir(), `md-pub-cover-${process.pid}-juejin.${ext}`);
    await writeFile(tmpPath, Buffer.from(coverB64, 'base64'));

    // Open the publish drawer, then inject into the cover uploader's input.
    await page.getByText('发布', { exact: true }).first().click({ timeout: 8000 });
    const fileInput = page.locator('.coverselector_container input[type="file"]').first();
    await fileInput.waitFor({ state: 'attached', timeout: 8000 });
    await fileInput.setInputFiles(tmpPath);

    // Cover uploads straight to juejin's CDN (xtjj) — wait for the preview img.
    await page.locator('.coverselector_container img[src*="xtjj"]').first().waitFor({ state: 'visible', timeout: 15000 });
    console.log(chalk.green('   ✓ 已设置封面（发布抽屉已打开，请选择分类/标签后发布）'));
    return true;
  } catch (err) {
    console.log(chalk.yellow(`   ⚠ 封面图片设置失败: ${err.message}`));
    return false;
  } finally {
    if (tmpPath) await unlink(tmpPath).catch(() => {});
  }
}

/**
 * 掘金 - Native markdown editor (ByteMD), simplest platform.
 */
export async function publish(article, options = {}) {
  console.log(chalk.blue(`\n📝 正在发布到 ${config.name}...`));

  return withPage(config.url, async (page) => {
    await ensureLoggedIn(page, config);

    let filledContent = false;

    // Fill title — wait for element to confirm editor loaded
    const filledTitle = await fillTitle(page, ['.title-input input', 'input[placeholder*="标题"]', '.byte-md-editor input'], article.meta.title);

    // Prepare cover early — must read the body's first image BEFORE we strip it.
    const coverB64 = await prepareCoverImage(page, article).catch(() => null);

    // Paste markdown into editor. When the cover came from the body's first image
    // (no frontmatter `cover`), strip it so it isn't duplicated in the body.
    let content = article.content;
    if (options.removeCoverImg && coverB64 && !article.meta?.cover) content = stripFirstImage(content);
    const contentWithCallouts = preprocessCallouts(content);
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

    // Last step: cover via the publish drawer (frontmatter `cover`, else first image).
    let setCover = false;
    if (coverB64) {
      console.log(chalk.gray('   ℹ 正在上传封面图片...'));
      setCover = await setJuejinCover(page, coverB64);
    }

    const parts = [filledTitle && '标题', filledContent && '内容', setCover && '封面'].filter(Boolean);
    const message = parts.length ? `已填充${parts.join('、')}` : '未能自动填充，请手动操作';
    return { success: filledContent, platform: config.name, message };
  });
}
