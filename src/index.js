// Node.js version check
const [major] = process.versions.node.split('.').map(Number);
if (major < 18) {
  console.error(`\n❌ md-publisher 需要 Node.js 18 或更高版本（当前: ${process.version}）`);
  console.error('   请升级 Node.js: https://nodejs.org/\n');
  process.exit(1);
}

import { checkbox, input, confirm } from '@inquirer/prompts';
import { resolve, basename, extname } from 'path';
import { existsSync, statSync } from 'fs';
import chalk from 'chalk';
import { parseArticle, scanArticleDir, ARTICLE_EXTS, loadProjectConfig } from './parser.js';
import { closeContext, waitForEnter } from './browser.js';
import { PLATFORMS } from './config.js';

// Platform registry — single import for all platforms
import * as platformPublishers from './platforms/index.js';

async function main() {
  console.log(chalk.bold('\n📮 Markdown 批量发布工具\n'));

  // Step 1: Select markdown file(s) — supports single file, directory, or interactive
  const { articles, projectConfig } = await selectArticles();

  if (articles.length === 0) {
    console.log(chalk.yellow('未找到文章，退出。'));
    return;
  }

  console.log(chalk.green(`\n✓ 已加载 ${articles.length} 篇文章:`));
  for (const a of articles) {
    console.log(chalk.gray(`  - ${a.meta.title || basename(a.filePath, extname(a.filePath))}`));
  }
  if (projectConfig) {
    const parts = ['📋 项目配置'];
    if (projectConfig.platforms) parts.push(`平台: ${projectConfig.platforms.map(id => PLATFORMS[id]?.name || id).join(', ')}`);
    if (projectConfig.category) parts.push(`分类: ${projectConfig.category.join(', ')}`);
    if (projectConfig.tag) parts.push(`标签: ${projectConfig.tag.join(', ')}`);
    console.log(chalk.cyan(`   ${parts.join('  ·  ')}`));
  }

  // Step 2: Select platforms (project config overrides defaults)
  const defaultPlatforms = projectConfig?.platforms
    ? new Set(projectConfig.platforms)
    : new Set(['sspai', 'zhihu', 'wechat']);
  const selectedPlatforms = await checkbox({
    message: '选择发布平台:',
    choices: Object.entries(PLATFORMS).filter(([, p]) => !p.hidden).map(([key, p]) => ({
      name: p.name,
      value: key,
      checked: defaultPlatforms.has(key),
    })),
  });

  if (selectedPlatforms.length === 0) {
    console.log(chalk.yellow('未选择任何平台，退出。'));
    return;
  }

  // Step 3: If X is selected, prompt for custom tweet text (project config provides default)
  let customText;
  if (selectedPlatforms.includes('x')) {
    customText = await input({
      message: '请输入 X 发推文案:',
      default: projectConfig?.customText || '',
    });
  }

  // Step 4: Confirm
  const platformNames = selectedPlatforms.map((k) => PLATFORMS[k].name).join(', ');
  const titleList = articles.map(a => a.meta.title || basename(a.filePath, extname(a.filePath))).join('、');
  const confirmed = await confirm({
    message: `将发布「${titleList}」到: ${platformNames}，确认？`,
    default: true,
  });

  if (!confirmed) {
    console.log(chalk.yellow('已取消。'));
    return;
  }

  // Step 5: Process each article × each platform sequentially
  const allResults = [];

  for (let ai = 0; ai < articles.length; ai++) {
    const article = articles[ai];
    const articleTitle = article.meta.title || basename(article.filePath, extname(article.filePath));

    if (articles.length > 1) {
      console.log(chalk.bold(`\n━━━ 文章 ${ai + 1}/${articles.length}: ${articleTitle} ━━━`));
    }

    for (const platformId of selectedPlatforms) {
      const publishFn = platformPublishers[platformId];
      if (!publishFn) continue;
      try {
        const result = await publishFn(article, {
          customText,
          category: projectConfig?.category,
          tag: projectConfig?.tag,
        });
        allResults.push({ ...result, articleTitle });
      } catch (error) {
        const msg = error?.message || String(error);
        console.log(chalk.red(`\n✗ ${PLATFORMS[platformId].name} 发布失败: ${msg}`));
        allResults.push({
          success: false,
          platform: PLATFORMS[platformId].name,
          message: msg,
          articleTitle,
        });
      }
    }
  }

  // Step 6: Print summary
  // CJK-aware string padding: each character with code point ≥ 0x1100 occupies 2 columns
  const displayWidth = (s) => { let w = 0; for (const c of s) w += c.codePointAt(0) >= 0x1100 ? 2 : 1; return w; };
  const padCJK = (s, width) => s + ' '.repeat(Math.max(0, width - displayWidth(s)));

  console.log(chalk.bold('\n📊 发布结果:\n'));
  if (articles.length > 1) {
    console.log('  文章          平台          状态       备注');
    console.log('  ' + '─'.repeat(64));
    for (const r of allResults) {
      const status = r.success ? chalk.green('✓ 成功') : chalk.red('✗ 失败');
      const title = padCJK((r.articleTitle || '').slice(0, 10), 14);
      console.log(`  ${title}${padCJK(r.platform, 14)}${status}     ${r.message}`);
    }
  } else {
    console.log('  平台          状态       备注');
    console.log('  ' + '─'.repeat(50));
    for (const r of allResults) {
      const status = r.success ? chalk.green('✓ 成功') : chalk.red('✗ 失败');
      console.log(`  ${padCJK(r.platform, 14)}${status}     ${r.message}`);
    }
  }

  // Step 7: Keep browser open for review
  await waitForEnter('\n✅ 所有平台已处理完毕，请在浏览器中检查各标签页内容。\n   检查完毕后按 Enter 关闭浏览器...');
  await closeContext();
}

/**
 * Select articles: handles directory, single file, or interactive selection.
 * Also loads .md-publisher.yml project config from the resolved directory.
 * @returns {{ articles: Array, projectConfig: object|null }}
 */
async function selectArticles() {
  const arg = process.argv[2];
  const result = (articles, dir) => ({
    articles,
    projectConfig: dir ? loadProjectConfig(dir) : null,
  });

  // CLI argument provided
  if (arg) {
    const absPath = resolve(arg);

    // Directory mode: scan for all article files
    if (existsSync(absPath) && statSync(absPath).isDirectory()) {
      const articles = scanArticleDir(absPath, { recursive: true });
      if (articles.length === 0) {
        console.log(chalk.yellow(`目录 ${absPath} 下没有找到文章文件`));
        return result([], null);
      }

      // Let user pick which articles to publish
      if (articles.length === 1) return result(articles, absPath);

      const selected = await checkbox({
        message: `找到 ${articles.length} 篇文章，选择要发布的:`,
        choices: articles.map((a, i) => ({
          name: `${a.meta.title || basename(a.filePath, extname(a.filePath))} (${basename(a.filePath)})`,
          value: i,
          checked: true,
        })),
      });

      return result(selected.map(i => articles[i]), absPath);
    }

    // Single file mode
    if (existsSync(absPath) && statSync(absPath).isFile()) {
      try {
        return result([parseArticle(absPath)], resolve(absPath, '..'));
      } catch (err) {
        console.log(chalk.red(`文件解析失败: ${err.message}`));
        return result([], null);
      }
    }

    console.log(chalk.red(`路径不存在: ${absPath}`));
    return result([], null);
  }

  // No argument: scan current directory recursively for all supported article types
  const cwd = process.cwd();
  const articles = scanArticleDir(cwd, { recursive: true });

  if (articles.length === 0) {
    const filePath = await input({ message: '请输入 Markdown 文件或目录路径:' });
    const abs = resolve(filePath);
    if (existsSync(abs) && statSync(abs).isDirectory()) {
      const found = scanArticleDir(abs, { recursive: true });
      if (found.length > 1) {
        const selected = await checkbox({
          message: `找到 ${found.length} 篇文章，选择要发布的:`,
          choices: found.map((a, i) => ({
            name: `${a.meta.title || basename(a.filePath, extname(a.filePath))} (${basename(a.filePath)})`,
            value: i,
            checked: true,
          })),
        });
        return result(selected.map(i => found[i]), abs);
      }
      return result(found, abs);
    }
    try {
      return result([parseArticle(abs)], resolve(abs, '..'));
    } catch (err) {
      console.log(chalk.red(`文件解析失败: ${err.message}`));
      return result([], null);
    }
  }

  if (articles.length === 1) {
    return result(articles, cwd);
  }

  // Multiple files found — let user pick
  const selected = await checkbox({
    message: '选择要发布的文章:',
    choices: articles.map((a, i) => ({
      name: `${basename(a.filePath, extname(a.filePath))} - ${a.meta.title || '(无标题)'}`,
      value: i,
    })),
  });

  return result(selected.map(i => articles[i]), cwd);
}

// Graceful cleanup on Ctrl+C / kill — close browser before exit
let _shuttingDown = false;
function gracefulShutdown() {
  if (_shuttingDown) return;
  _shuttingDown = true;
  console.log(chalk.gray('\n   正在关闭浏览器...'));
  closeContext().catch(() => {}).finally(() => process.exit(0));
}
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
process.on('unhandledRejection', (reason) => {
  console.error(chalk.red(`\n未处理的异步错误: ${reason}`));
  gracefulShutdown();
});

main().catch((error) => {
  console.error(chalk.red(`\n错误: ${error.message}`));
  closeContext().catch(() => {}).finally(() => process.exit(1));
});
