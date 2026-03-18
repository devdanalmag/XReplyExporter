// ============================================
// TwReplyExport — Background Service Worker
// Orchestrates tab management, script injection,
// and message relay between popup ↔ content script
// ============================================

let activeTabId = null;
let isExporting = false;
let collectedReplies = [];

// --- Message Handler ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.action) {

    case 'startExport':
      startExport(msg.url);
      break;

    case 'stopExport':
      stopExport();
      break;

    case 'scrapedReplies':
      // Received batch of replies from content script
      if (msg.replies && msg.replies.length > 0) {
        // Merge and deduplicate
        const existingIds = new Set(collectedReplies.map(r => r.id));
        const newReplies = msg.replies.filter(r => !existingIds.has(r.id));
        collectedReplies.push(...newReplies);

        // Forward progress to popup
        broadcastToPopup({
          action: 'progress',
          count: collectedReplies.length,
          replies: collectedReplies,
          status: `Scraped ${collectedReplies.length} replies... (scrolling for more)`
        });
      }
      break;

    case 'scrapingComplete':
      // Content script finished
      if (msg.replies) {
        const existingIds = new Set(collectedReplies.map(r => r.id));
        const newReplies = msg.replies.filter(r => !existingIds.has(r.id));
        collectedReplies.push(...newReplies);
      }

      isExporting = false;
      broadcastToPopup({
        action: 'exportComplete',
        replies: collectedReplies,
        count: collectedReplies.length
      });
      break;

    case 'scrapingError':
      isExporting = false;
      broadcastToPopup({
        action: 'exportError',
        error: msg.error || 'Unknown error occurred'
      });
      break;
  }
});

// --- Start Export Flow ---
async function startExport(url) {
  isExporting = true;
  collectedReplies = [];

  try {
    // Check if we're already on the tweet page
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (activeTab && activeTab.url && isSameTweet(activeTab.url, url)) {
      // Already on the tweet page — just inject the script
      activeTabId = activeTab.id;
      await injectContentScript(activeTabId);
    } else if (activeTab && activeTab.url && isTweetDomain(activeTab.url)) {
      // On X/Twitter but different page — navigate to tweet
      activeTabId = activeTab.id;
      await chrome.tabs.update(activeTabId, { url: url });
      // Wait for page load then inject
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId === activeTabId && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(() => injectContentScript(activeTabId), 2000);
        }
      });
    } else {
      // Not on X/Twitter — open a new tab
      const tab = await chrome.tabs.create({ url: url, active: true });
      activeTabId = tab.id;
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId === activeTabId && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          setTimeout(() => injectContentScript(activeTabId), 2000);
        }
      });
    }
  } catch (err) {
    broadcastToPopup({
      action: 'exportError',
      error: `Failed to start: ${err.message}`
    });
  }
}

// --- Inject Content Script ---
async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    });

    // Tell content script to start scraping
    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, { action: 'startScraping' });
    }, 500);

  } catch (err) {
    broadcastToPopup({
      action: 'exportError',
      error: `Script injection failed: ${err.message}. Make sure you're logged into X/Twitter.`
    });
  }
}

// --- Stop Export ---
function stopExport() {
  isExporting = false;
  if (activeTabId) {
    chrome.tabs.sendMessage(activeTabId, { action: 'stopScraping' }).catch(() => {});
  }
}

// --- Broadcast to popup ---
function broadcastToPopup(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Popup might be closed, that's ok
  });
}

// --- Helpers ---
function isSameTweet(url1, url2) {
  const id1 = extractTweetId(url1);
  const id2 = extractTweetId(url2);
  return id1 && id2 && id1 === id2;
}

function isTweetDomain(url) {
  return /^https?:\/\/(x\.com|twitter\.com)/.test(url);
}

function extractTweetId(url) {
  const match = url.match(/status\/(\d+)/);
  return match ? match[1] : null;
}
