import chalk from 'chalk';
import { PLATFORMS } from '../config.js';
import { withPage, ensureLoggedIn, pasteToFocused, findElement } from '../browser.js';

const config = PLATFORMS.x;

/**
 * Test whether a character counts as "wide" (weight 2) under X's rules.
 * Covers CJK Unified Ideographs, Hangul, Kana, fullwidth forms, and CJK symbols.
 */
const WIDE_RANGES = [
  [0x1100, 0x115F],   // Hangul Jamo
  [0x2E80, 0x303E],   // CJK Radicals, Kangxi, CJK Symbols
  [0x3041, 0x33BF],   // Hiragana, Katakana, Bopomofo, Hangul Compat, Kanbun, CJK Letters
  [0x3400, 0x4DBF],   // CJK Unified Ext A
  [0x4E00, 0x9FFF],   // CJK Unified Ideographs
  [0xA960, 0xA97F],   // Hangul Jamo Extended-A
  [0xAC00, 0xD7FF],   // Hangul Syllables + Jamo Extended-B
  [0xF900, 0xFAFF],   // CJK Compatibility Ideographs
  [0xFE30, 0xFE6F],   // CJK Compatibility Forms + Small Form Variants
  [0xFF01, 0xFF60],   // Fullwidth Latin + Halfwidth CJK punctuation
  [0xFFE0, 0xFFE6],   // Fullwidth signs (¢ £ ¥ etc.)
  [0x20000, 0x2FA1F], // CJK Unified Ext B-F + Compatibility Supplement
];
function isWide(cp) {
  for (const [lo, hi] of WIDE_RANGES) {
    if (cp >= lo && cp <= hi) return true;
  }
  return false;
}

/**
 * Calculate weighted tweet length per X's rules:
 * - URLs (https?://...) count as 23 characters each
 * - CJK / fullwidth characters count as 2
 * - Everything else counts as 1
 */
function tweetLength(text) {
  const urls = text.match(/https?:\/\/\S+/g) || [];
  const withoutUrls = text.replace(/https?:\/\/\S+/g, '');
  let len = urls.length * 23;
  for (const ch of withoutUrls) {
    len += isWide(ch.codePointAt(0)) ? 2 : 1;
  }
  return len;
}

/**
 * X (Twitter) - Paste custom tweet text.
 */
export async function publish(article, options = {}) {
  const { customText } = options;
  if (!customText) {
    console.log(chalk.yellow(`\n⚠ X 平台需要自定义文案，跳过`));
    return { success: false, platform: config.name, message: '未提供自定义文案' };
  }
  const len = tweetLength(customText);
  if (len > 280) {
    console.log(chalk.yellow(`\n⚠ X 文案超过 280 加权字符限制（当前 ${len}）`));
    return { success: false, platform: config.name, message: `文案超长: ${len}/280` };
  }

  console.log(chalk.blue(`\n📝 正在发布到 ${config.name}...`));

  return withPage(config.url, async (page) => {
    await ensureLoggedIn(page, config);

    // Click compose tweet area
    let filledContent = false;
    const composeEl = await findElement(page, ['[data-testid="tweetTextarea_0"]', '[role="textbox"][data-testid*="tweet"]', '[role="textbox"]']);
    if (composeEl) {
      await page.click(composeEl.selector);
      await page.waitForTimeout(200);
      await pasteToFocused(page, customText);
      console.log(chalk.green('   ✓ 已粘贴推文内容'));
      filledContent = true;
    } else {
      console.log(chalk.yellow('   ⚠ 未找到发推输入框，请手动粘贴'));
    }

    return {
      success: filledContent,
      platform: config.name,
      message: filledContent ? '内容已填充' : '未能自动填充，请手动操作',
    };
  });
}
