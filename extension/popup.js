'use strict';

// PulseKeeper Extension Popup

let currentTab = null;
let pageInfo = null;

async function init() {
  // Get active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  document.getElementById('pageTitle').textContent = tab.title || tab.url;
  document.getElementById('pageUrl').textContent = new URL(tab.url).hostname;

  // Check PulseKeeper connection
  checkConnection();

  // Get page info from content script
  try {
    pageInfo = await chrome.tabs.sendMessage(tab.id, { type: 'getPageInfo' });
    if (pageInfo?.selection) {
      showSelection(pageInfo.selection);
    }
  } catch {
    // Content script not available on chrome:// pages etc
  }

  document.getElementById('btnSendPage').addEventListener('click', sendPage);
  document.getElementById('btnSendSelection').addEventListener('click', sendSelection);
  document.getElementById('openSettings').addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions' });
  });
}

async function checkConnection() {
  const dot = document.getElementById('statusDot');
  const connStatus = document.getElementById('connectionStatus');

  chrome.runtime.sendMessage({ type: 'check' }, (res) => {
    if (res?.ok) {
      dot.className = 'status-dot ok';
      connStatus.textContent = 'Connected';
      connStatus.className = 'ok';
    } else {
      dot.className = 'status-dot error';
      connStatus.textContent = 'Not running';
      connStatus.className = 'error';
    }
  });
}

function showSelection(text) {
  const row = document.getElementById('selectionRow');
  const el = document.getElementById('selectionText');
  const btn = document.getElementById('btnSendSelection');
  if (text) {
    row.style.display = 'block';
    el.textContent = text;
    btn.disabled = false;
  }
}

async function sendPage() {
  const btn = document.getElementById('btnSendPage');
  btn.disabled = true;
  btn.textContent = '⏳ Sending…';

  const data = {
    url: currentTab.url,
    title: currentTab.title,
    content: pageInfo?.content || '',
    description: pageInfo?.description || '',
    type: 'page'
  };

  chrome.runtime.sendMessage({ type: 'send', data }, (res) => {
    setStatus(res?.ok ? 'Page saved to PulseKeeper ✓' : `Failed: ${res?.error || 'unknown error'}`, res?.ok);
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-icon">📄</span> Send page';
  });
}

async function sendSelection() {
  const sel = document.getElementById('selectionText').textContent;
  if (!sel) return;

  const btn = document.getElementById('btnSendSelection');
  btn.disabled = true;

  const data = {
    url: currentTab.url,
    title: currentTab.title,
    selection: sel,
    type: 'selection'
  };

  chrome.runtime.sendMessage({ type: 'send', data }, (res) => {
    setStatus(res?.ok ? 'Selection saved to PulseKeeper ✓' : `Failed: ${res?.error || 'unknown error'}`, res?.ok);
    btn.disabled = false;
  });
}

function setStatus(msg, ok) {
  const el = document.getElementById('statusMsg');
  el.textContent = msg;
  el.className = `status-msg ${ok ? 'success' : 'error'}`;
}

init();
