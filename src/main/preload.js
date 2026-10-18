'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Expose a secure, typed API to renderer processes
contextBridge.exposeInMainWorld('pcbAPI', {
  // Sources
  sources: {
    list:         () => ipcRenderer.invoke('sources:list'),
    add:          (source) => ipcRenderer.invoke('sources:add', source),
    update:       (id, updates) => ipcRenderer.invoke('sources:update', id, updates),
    delete:       (id) => ipcRenderer.invoke('sources:delete', id),
    toggle:       (id, enabled) => ipcRenderer.invoke('sources:toggle', id, enabled),
    types:        () => ipcRenderer.invoke('sources:types'),
    collectOne:   (id) => ipcRenderer.invoke('sources:collectOne', id),
    collectAll:   () => ipcRenderer.invoke('sources:collectAll'),
    isRunning:    (id) => ipcRenderer.invoke('sources:isRunning', id),
    getHealth:    () => ipcRenderer.invoke('sources:getHealth'),
    discoverFeed: (url) => ipcRenderer.invoke('sources:discoverFeed', url),
    importOPML:   () => ipcRenderer.invoke('sources:importOPML')
  },

  // Content
  content: {
    getAll:      () => ipcRenderer.invoke('content:getAll'),
    getBySource: (id) => ipcRenderer.invoke('content:getBySource', id),
    query:       (q) => ipcRenderer.invoke('content:query', q),
    channels:    () => ipcRenderer.invoke('content:channels'),
    getReadIds:  () => ipcRenderer.invoke('content:getReadIds'),
    markRead:    (ids) => ipcRenderer.invoke('content:markRead', ids),
    markUnread:  (ids) => ipcRenderer.invoke('content:markUnread', ids),
    setSaved:    (id, saved) => ipcRenderer.invoke('content:setSaved', id, saved),
    markAllRead: (filter) => ipcRenderer.invoke('content:markAllRead', filter)
  },

  // Settings
  settings: {
    get:          () => ipcRenderer.invoke('settings:get'),
    save:         (s) => ipcRenderer.invoke('settings:save', s),
    getProviders: () => ipcRenderer.invoke('settings:getProviders'),
    exportBackup: () => ipcRenderer.invoke('settings:exportBackup'),
    importBackup: () => ipcRenderer.invoke('settings:importBackup')
  },

  // Output / Digest
  output: {
    openDigest:     () => ipcRenderer.invoke('output:openDigest'),
    exportPDF:      () => ipcRenderer.invoke('output:exportPDF'),
    exportMarkdown: () => ipcRenderer.invoke('output:exportMarkdown'),
    exportAgentPack:(scriptOnly) => ipcRenderer.invoke('output:exportAgentPack', scriptOnly)
  },

  // Digest history
  digest: {
    getHistory: () => ipcRenderer.invoke('digest:getHistory'),
    openHistory:(filePath) => ipcRenderer.invoke('digest:openHistory', filePath)
  },

  // LLM
  llm: {
    generateDigest:    () => ipcRenderer.invoke('llm:generateDigest'),
    generateDigestNow: () => ipcRenderer.invoke('llm:generateDigestNow'),
    getDigestStatus:   () => ipcRenderer.invoke('llm:getDigestStatus'),
    test:              (config) => ipcRenderer.invoke('llm:test', config),
    listModels:        (config) => ipcRenderer.invoke('llm:listModels', config),
    getSummary:        (id) => ipcRenderer.invoke('llm:getSummary', id),
    summarize:         (id, force) => ipcRenderer.invoke('llm:summarize', id, force)
  },

  // UI
  ui: {
    openSettings:      (tab) => ipcRenderer.invoke('ui:openSettings', tab),
    openDigest:        () => ipcRenderer.invoke('ui:openDigest'),
    openDataDir:       () => ipcRenderer.invoke('ui:openDataDir'),
    openOutputDir:     () => ipcRenderer.invoke('ui:openOutputDir'),
    openExtensionDir:  () => ipcRenderer.invoke('ui:openExtensionDir'),
    openExternal:      (url) => ipcRenderer.invoke('ui:openExternal', url),
    exportAgentPlatform:() => ipcRenderer.invoke('ui:exportAgentPlatform')
  },

  // Popup
  popup: {
    close:     () => ipcRenderer.invoke('popup:close'),
    getLatest: () => ipcRenderer.invoke('popup:getLatest')
  },

  // Events (main → renderer) — removeAllListeners prevents accumulation
  on: {
    collectStart:    (fn) => { ipcRenderer.removeAllListeners('collect:start');    ipcRenderer.on('collect:start',    (_, d) => fn(d)); },
    collectComplete: (fn) => { ipcRenderer.removeAllListeners('collect:complete'); ipcRenderer.on('collect:complete', (_, d) => fn(d)); },
    collectProgress: (fn) => { ipcRenderer.removeAllListeners('collect:progress'); ipcRenderer.on('collect:progress', (_, d) => fn(d)); },
    collectError:    (fn) => { ipcRenderer.removeAllListeners('collect:sourceError'); ipcRenderer.on('collect:sourceError', (_, d) => fn(d)); },
    navigate:        (fn) => { ipcRenderer.removeAllListeners('navigate');         ipcRenderer.on('navigate',         (_, tab) => fn(tab)); },
    backupImported:  (fn) => { ipcRenderer.removeAllListeners('backup:imported');  ipcRenderer.on('backup:imported',  (_, d) => fn(d)); },
    sourcesUpdated:  (fn) => { ipcRenderer.removeAllListeners('sources:updated');  ipcRenderer.on('sources:updated',  (_, d) => fn(d)); },
    themeOsSync:     (fn) => { ipcRenderer.removeAllListeners('theme:osSync');     ipcRenderer.on('theme:osSync',     (_, d) => fn(d)); },
    digestGenerating:(fn) => { ipcRenderer.removeAllListeners('digest:generating'); ipcRenderer.on('digest:generating', (_, d) => fn(d)); },
    digestProgress:  (fn) => { ipcRenderer.removeAllListeners('digest:progress');   ipcRenderer.on('digest:progress',   (_, d) => fn(d)); },
    summaryProgress: (fn) => { ipcRenderer.removeAllListeners('summary:progress'); ipcRenderer.on('summary:progress', (_, d) => fn(d)); },
    digestGenerated: (fn) => { ipcRenderer.removeAllListeners('digest:generated');  ipcRenderer.on('digest:generated',  (_, d) => fn(d)); },
    digestError:     (fn) => { ipcRenderer.removeAllListeners('digest:error');      ipcRenderer.on('digest:error',      (_, d) => fn(d)); }
  }
});
