const { Tray, Menu, nativeImage } = require('electron');
const path = require('node:path');

function buildTray({ onShow, onReload, onRestartServer, onCloseBrowser, onOpenLog, onCheckUpdate, onQuit }) {
  // Bundled inside the app (electron/**) so it exists at runtime in the packaged
  // build — build/icon.png is a buildResource and is NOT shipped. Tray icons are
  // small (16px, 32px @2x); Electron auto-loads the @2x variant for HiDPI.
  const iconPath = path.join(__dirname, 'tray-icon.png');
  const img = nativeImage.createFromPath(iconPath);
  const tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip('md-publisher');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主界面', click: onShow },
    { label: '重新加载界面', click: onReload },
    { label: '重启服务', click: onRestartServer },
    { label: '关闭浏览器', click: onCloseBrowser },
    { label: '打开日志文件', click: onOpenLog },
    { label: '检查更新', click: onCheckUpdate },
    { type: 'separator' },
    { label: '退出', click: onQuit },
  ]));
  tray.on('click', onShow);
  return tray;
}

module.exports = { buildTray };
