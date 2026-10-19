// Minimal, secure preload. The UI talks to the server over HTTP/SSE (same
// origin), so no Node APIs are exposed yet. Reserved for future IPC.
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('mdPublisher', { isElectron: true });
