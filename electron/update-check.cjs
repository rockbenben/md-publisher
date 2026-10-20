const { app, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');

/**
 * In-app update check.
 *
 * **Opt-in.** The background check only runs when the user turns it on in
 * Settings; until then the app makes no request at all. A tool that drives
 * other people's websites on the user's behalf has no business phoning home
 * uninvited.
 *
 * **Nothing is downloaded or installed without the user.** electron-updater
 * defaults to autoDownload=true (a new release starts downloading the moment
 * it is spotted) and autoInstallOnAppQuit=true (a downloaded update installs
 * itself when the app quits). Both are turned off: a new release is only
 * *reported*, the download starts after the user accepts it, and
 * quitAndInstall() runs only after a second, separate confirmation.
 *
 * Cost: one request to the release feed. Nothing about the user's
 * manuscripts, files or platform logins is sent.
 */

// The releases page, as the second way out when a download fails. Single
// source of truth: the repository field in package.json.
const RELEASES_URL = (() => {
  try {
    const url = (require('../package.json').repository || {}).url || '';
    const m = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
    return m ? `https://github.com/${m[1]}/${m[2]}/releases/latest` : '';
  } catch {
    return '';
  }
})();

/**
 * autoUpdater is a process-wide singleton, and the events hang off it.
 *
 * The 'error' event **must** have a listener: an EventEmitter with no
 * listener for 'error' throws, and a packaged app has no console to print
 * the stack — the throw would take the whole app down.
 */
let errorListenerAttached = false;
function attachErrorListener() {
  if (errorListenerAttached) return;
  errorListenerAttached = true;
  autoUpdater.on('error', (err) => {
    // Log only. A failed check (offline, rate limited) is not worth an
    // error box the user cannot act on.
    console.warn(`[update] check failed: ${err && err.message ? err.message : err}`);
  });
}

/** A box with a single "OK" button. Parented to the window when there is one. */
async function say(getWindow, message, detail) {
  const win = getWindow();
  const options = { type: 'info', message, detail, buttons: ['好'], defaultId: 0 };
  if (win && !win.isDestroyed()) await dialog.showMessageBox(win, options);
  else await dialog.showMessageBox(options);
}

/** A yes/no box. Returns true when the first button was pressed. */
async function ask(getWindow, message, detail, yes, no) {
  const win = getWindow();
  const options = {
    type: 'info',
    message,
    detail,
    buttons: [yes, no],
    defaultId: 0,
    cancelId: 1,
  };
  const result = win && !win.isDestroyed()
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options);
  return result.response === 0;
}

/**
 * Check for a new release.
 *
 * manual=true (the user asked for it, from the tray or the settings page)
 * **always** reports an outcome — "already up to date", the failure, or the
 * new version. A click that says nothing is read as "already up to date".
 * manual=false (the background check) stays silent unless there is news.
 *
 * @returns {Promise<string>} upToDate | available | downloaded | failed | skipped
 */
async function checkForUpdates({ getWindow, manual }) {
  attachErrorListener();
  // A development run has no version to compare against the feed with.
  if (!app.isPackaged) {
    if (manual) await say(getWindow, '开发运行不检查更新', '只有打包后的应用才有更新可查。');
    return 'skipped';
  }
  // Report only; the download waits for the user.
  autoUpdater.autoDownload = false;
  // A downloaded update must not install itself on quit — that would be an
  // install the user never confirmed.
  autoUpdater.autoInstallOnAppQuit = false;

  let result;
  try {
    result = await autoUpdater.checkForUpdates();
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    console.warn(`[update] check failed: ${message}`);
    if (manual) await say(getWindow, '检查更新失败', `没能连上发布服务器：${message}`);
    return 'failed';
  }
  if (!result || !result.isUpdateAvailable) {
    if (manual) await say(getWindow, '已是最新版本', '当前运行的就是最新发布版。');
    return 'upToDate';
  }

  const version = result.updateInfo.version;
  const wants = await ask(
    getWindow,
    `发现新版本 v${version}`,
    '要现在下载吗？下载完成后还会再问一次是否安装。',
    '下载',
    '稍后',
  );
  // "Later" means nothing happens at all — not even half a download.
  if (!wants) return 'available';

  try {
    await autoUpdater.downloadUpdate();
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    console.warn(`[update] download failed: ${message}`);
    await say(
      getWindow,
      '下载更新失败',
      RELEASES_URL ? `${message}\n\n也可以到发布页手动下载：${RELEASES_URL}` : message,
    );
    return 'failed';
  }

  const install = await ask(
    getWindow,
    `新版本 v${version} 已下载`,
    '现在退出并安装吗？安装会重启应用。',
    '现在安装',
    '稍后',
  );
  // Whether to install is the user's call; the downloaded package stays cached.
  if (!install) return 'downloaded';
  autoUpdater.quitAndInstall();
  return 'downloaded';
}

module.exports = { checkForUpdates };
