'use strict';

// PulseKeeper content script — injected into all pages
// Responds to messages from the extension popup and background worker

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg.type === 'getSelection') {
    respond({ selection: window.getSelection()?.toString()?.trim() || '' });
    return true;
  }

  if (msg.type === 'getPageInfo') {
    const article = document.querySelector(
      'article, [role="main"], main, .post-content, .article-body, .content, #content, #main'
    );
    const content = (article || document.body)?.innerText?.trim()?.slice(0, 2000) || '';
    const ogImage = document.querySelector('meta[property="og:image"]')?.content;
    const description = document.querySelector('meta[name="description"]')?.content
      || document.querySelector('meta[property="og:description"]')?.content
      || '';

    respond({
      title: document.title,
      url: location.href,
      content,
      description,
      selection: window.getSelection()?.toString()?.trim() || '',
      image: ogImage || null
    });
    return true;
  }
});
