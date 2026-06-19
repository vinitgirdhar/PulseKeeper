'use strict';

// PulseKeeper Extension — Service Worker (Manifest V3)
// Communicates with the PulseKeeper desktop app via http://localhost:7828

const PK_URL = 'http://localhost:7828';

// ─── Context menus ────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'pk-send-page',
    title: '💓 Send page to PulseKeeper',
    contexts: ['page', 'frame']
  });

  chrome.contextMenus.create({
    id: 'pk-send-selection',
    title: '💓 Send selection to PulseKeeper',
    contexts: ['selection']
  });

  chrome.contextMenus.create({
    id: 'pk-send-link',
    title: '💓 Send link to PulseKeeper',
    contexts: ['link']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'pk-send-page') {
    await captureAndSend(tab, 'page', null);
  } else if (info.menuItemId === 'pk-send-selection') {
    await captureAndSend(tab, 'selection', info.selectionText);
  } else if (info.menuItemId === 'pk-send-link') {
    await sendToPK({ url: info.linkUrl, title: info.linkUrl, type: 'link' });
  }
});

// ─── Capture helpers ──────────────────────────────────────────────────────────
async function captureAndSend(tab, type, selectionText) {
  let content = selectionText;

  if (!content && type === 'page') {
    try {
      // Ask the content script for the page's readable text
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const article = document.querySelector('article, main, [role="main"], .content, #content, .post-content');
          return (article || document.body)?.innerText?.slice(0, 2000) || '';
        }
      });
      content = results?.[0]?.result || '';
    } catch {}
  }

  await sendToPK({ url: tab.url, title: tab.title, content, selection: selectionText, type });
}

async function sendToPK(data) {
  try {
    const res = await fetch(`${PK_URL}/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (res.ok) {
      setBadge('✓', '#107c10');
      showNotification('Saved to PulseKeeper', `"${(data.title || data.url).slice(0, 60)}" added to your captures.`);
    } else {
      setBadge('!', '#d13438');
    }
  } catch (e) {
    setBadge('!', '#d13438');
    showNotification('PulseKeeper not running', 'Make sure PulseKeeper is open on your desktop.');
  }
}

function setBadge(text, color) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 3000);
}

function showNotification(title, message) {
  chrome.notifications?.create('pk-capture', {
    type: 'basic',
    iconUrl: 'icons/icon128.svg',
    title,
    message
  });
}

// ─── Messages from popup ───────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg.type === 'send') {
    sendToPK(msg.data)
      .then(() => respond({ ok: true }))
      .catch(e => respond({ ok: false, error: e.message }));
    return true; // async response
  }

  if (msg.type === 'check') {
    fetch(`${PK_URL}/status`)
      .then(r => r.json())
      .then(d => respond({ ok: true, ...d }))
      .catch(() => respond({ ok: false }));
    return true;
  }
});
