import chalk from 'chalk';
import { marked } from 'marked';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PLATFORMS } from '../config.js';
import { withPage, ensureLoggedIn, pasteHtml, findElement, fillTitle } from '../browser.js';
import { preprocessCallouts, prepareCoverImage, coverFileMeta, stripFirstImage } from '../parser.js';

const config = PLATFORMS.smzdm;

/**
 * Upload + set the 长图 cover (文章详情主封面). Verified live (2026-06):
 *   添加长图 → 上传弹窗 → 本地上传(inject) → 图片入库 → 设为封面图 → 裁剪弹窗(cropperjs).
 * The crop dialog (「封面图-长图编辑」, 取消/确认) is the manual-crop point, so the
 * final 确认 is gated on options.autoCover — off ⇒ leave it open for the user.
 * Never throws — returns false on failure so publishing still succeeds.
 * @param {import('playwright').Page} page
 * @param {string} coverB64
 * @param {boolean} autoConfirm - click 确认 to apply the crop (false ⇒ leave for user)
 * @returns {Promise<boolean>}
 */
async function setSmzdmCover(page, coverB64, autoConfirm) {
  let tmpPath = null;
  try {
    const ext = coverFileMeta(coverB64).name.split('.').pop();
    tmpPath = join(tmpdir(), `md-pub-cover-${process.pid}-smzdm.${ext}`);
    await writeFile(tmpPath, Buffer.from(coverB64, 'base64'));

    // Open the 长图 upload dialog and inject the file via 本地上传.
    await page.getByText('封面图', { exact: true }).first().scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    await page.getByText('添加长图', { exact: true }).first().click({ timeout: 6000 });
    const fileInput = page.locator('.btn-item input[type="file"]').first();
    await fileInput.waitFor({ state: 'attached', timeout: 8000 });
    await fileInput.setInputFiles(tmpPath);

    // The uploaded image gets a 「设为封面图」 button → click it to open the cropper.
    const setBtn = page.getByText('设为封面图', { exact: true }).first();
    await setBtn.waitFor({ state: 'visible', timeout: 20000 });
    await setBtn.click();

    const cropDialog = page.locator('.el-dialog:has(.cropper-container)');
    const cropConfirm = cropDialog.getByText('确认', { exact: true });
    await cropConfirm.waitFor({ state: 'visible', timeout: 8000 });

    if (!autoConfirm) {
      console.log(chalk.green('   ✓ 已上传封面图（长图），请在弹窗中手动裁切并确认'));
      return true; // cover uploaded; crop left to the user (封面自动确认 已关闭)
    }
    await cropConfirm.click();
    await cropConfirm.waitFor({ state: 'hidden', timeout: 10000 });
    console.log(chalk.green('   ✓ 已设置封面图（长图）'));
    return true;
  } catch (err) {
    console.log(chalk.yellow(`   ⚠ 封面图片设置失败: ${err.message}`));
    return false;
  } finally {
    if (tmpPath) await unlink(tmpPath).catch(() => {});
  }
}

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

    // Prepare cover early — must read the body's first image BEFORE we strip it.
    const coverB64 = await prepareCoverImage(page, article).catch(() => null);

    // Step 3: Convert markdown to HTML, paste as rich text into ProseMirror.
    // When the cover came from the body's first image (no frontmatter `cover`),
    // strip that image so it isn't duplicated as both cover and body content.
    let content = article.content;
    if (options.removeCoverImg && coverB64 && !article.meta?.cover) content = stripFirstImage(content);
    const html = marked(preprocessCallouts(content));

    const editorEl = await findElement(page, ['.ProseMirror', '[contenteditable="true"]', 'div[data-placeholder="请输入正文"]']);
    if (editorEl) {
      await pasteHtml(page, editorEl.selector, html);
      console.log(chalk.green('   ✓ 已粘贴内容'));
      filledContent = true;
    } else {
      console.log(chalk.yellow('   ⚠ 未找到编辑器，请手动粘贴内容'));
    }

    // Step 4 (last): upload + set the 长图 cover. Respects 封面自动确认 (autoCover).
    let setCover = false;
    if (coverB64) {
      console.log(chalk.gray('   ℹ 正在上传封面图片...'));
      setCover = await setSmzdmCover(page, coverB64, options.autoCover !== false);
    }

    const parts = [filledTitle && '标题', filledContent && '内容', setCover && '封面'].filter(Boolean);
    const message = parts.length ? `已填充${parts.join('、')}` : '未能自动填充，请手动操作';
    return { success: filledContent, platform: config.name, message };
  });
}
