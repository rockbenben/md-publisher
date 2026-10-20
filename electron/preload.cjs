// Minimal, secure preload. The UI talks to the server over HTTP/SSE (same
// origin), so no Node APIs are exposed — except the one thing a web page
// genuinely cannot do for itself: ask the main process to run the update
// check, which needs native dialogs.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mdPublisher', {
  isElectron: true,
  // Runs the check in the main process and resolves with the outcome
  // ('upToDate' | 'available' | 'downloaded' | 'failed' | 'skipped'). The
  // dialogs themselves are shown by the main process, not here.
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
});
