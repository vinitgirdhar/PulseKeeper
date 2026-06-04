'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Cache the latest nav state so injected toolbar code can read it synchronously
let _lastState = { canGoBack: false, canGoForward: false, title: '', url: '' };
ipcRenderer.on('digestNav:state', (_, s) => { _lastState = s; });

contextBridge.exposeInMainWorld('digestNav', {
  back:         ()    => ipcRenderer.invoke('digestNav:back'),
  forward:      ()    => ipcRenderer.invoke('digestNav:forward'),
  reload:       ()    => ipcRenderer.invoke('digestNav:reload'),
  home:         ()    => ipcRenderer.invoke('digestNav:home'),
  openExternal: (url) => ipcRenderer.invoke('digestNav:openExternal', url),
  // Allow multiple listeners (injected toolbar + digest page both subscribe)
  onNavState:   (cb)  => ipcRenderer.on('digestNav:state', (_, s) => cb(s)),
  get canGoBack()    { return _lastState.canGoBack; },
  get canGoForward() { return _lastState.canGoForward; }
});
