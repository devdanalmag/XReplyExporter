// ============================================
// TwReplyExport Pro — Background Service Worker
// Orchestrates tab management, content script
// injection, state recovery, reader tab launch,
// and reliable CORS-free image fetching.
// ============================================

let state = {
  activeTabId: null,
  isExporting: false,
  currentUrl: '',
  captureMode: 'full', // 'full' | 'thread' | 'replies'
  targetTweetId: null,
  status: 'Idle',
  tweets: [],
  pageTitle: '',
  completedAt: null,
  error: null
};

// Map for fast deduplication & enrichment updates
let tweetMap = new Map();

// --- Message Handler ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.action) {
    case 'getState': {
      sendResponse({
        isExporting: state.isExporting,
        currentUrl: state.currentUrl,
        captureMode: state.captureMode,
        targetTweetId: state.targetTweetId,
        status: state.status,
        tweets: state.tweets,
        stats: computeQuickStats(state.tweets),
        completedAt: state.completedAt,
        error: state.error
      });
      return false;
    }

    case 'startExport': {
      startExport(msg.url, msg.mode || 'full');
      sendResponse({ ok: true });
      return false;
    }

    case 'stopExport': {
      stopExport();
      sendResponse({ ok: true });
      return false;
    }

    case 'scrapedBatch': {
      if (Array.isArray(msg.tweets) && msg.tweets.length > 0) {
        mergeTweets(msg.tweets);
      }
      if (msg.status) state.status = msg.status;
      if (msg.pageTitle) state.pageTitle = msg.pageTitle;

      const stats = computeQuickStats(state.tweets);
      broadcastToPopup({
        action: 'progress',
        count: state.tweets.length,
        tweets: state.tweets,
        stats,
        status: msg.status || `Captured ${state.tweets.length} posts (${stats.imageCount} images)...`
      });
      return false;
    }

    case 'scrapingComplete': {
      if (Array.isArray(msg.tweets) && msg.tweets.length > 0) {
        mergeTweets(msg.tweets);
      }
      state.isExporting = false;
      state.completedAt = new Date().toISOString();
      state.status = 'Capture complete!';
      if (msg.pageTitle) state.pageTitle = msg.pageTitle;

      const stats = computeQuickStats(state.tweets);
      const sessionPayload = {
        url: state.currentUrl,
        targetTweetId: state.targetTweetId,
        captureMode: state.captureMode,
        pageTitle: state.pageTitle,
        tweets: state.tweets,
        stats,
        capturedAt: state.completedAt
      };

      chrome.storage.local.set({ activeReaderSession: sessionPayload }).catch(() => { });

      broadcastToPopup({
        action: 'exportComplete',
        tweets: state.tweets,
        count: state.tweets.length,
        stats,
        session: sessionPayload,
        diagnostics: msg.diagnostics || null
      });
      return false;
    }

    case 'scrapingError': {
      state.isExporting = false;
      state.error = msg.error || 'Unknown error occurred';
      state.status = `Error: ${state.error}`;
      broadcastToPopup({
        action: 'exportError',
        error: state.error
      });
      return false;
    }

    case 'openReader': {
      openReaderTab(msg.session || null).then(() => sendResponse({ ok: true }));
      return true;
    }

    case 'fetchImageAsBase64': {
      fetchImageAsBase64(msg.url)
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true;
    }
  }
  return false;
});

// --- Merge & Enrich Captured Tweets ---
function mergeTweets(incoming) {
  for (const t of incoming) {
    if (!t || !t.id) continue;
    const existing = tweetMap.get(t.id);
    if (!existing) {
      tweetMap.set(t.id, t);
    } else {
      // Enrich if the newer capture expanded "Show more", loaded images, or has better metadata
      const merged = {
        ...existing,
        ...t,
        text: (t.text && t.text.length >= (existing.text || '').length) ? t.text : existing.text,
        images: (t.images && t.images.length >= (existing.images || []).length) ? t.images : (existing.images || []),
        videos: (t.videos && t.videos.length >= (existing.videos || []).length) ? t.videos : (existing.videos || []),
        links: (t.links && t.links.length >= (existing.links || []).length) ? t.links : (existing.links || []),
        quotedTweet: t.quotedTweet || existing.quotedTweet || null,
        card: t.card || existing.card || null,
        poll: t.poll || existing.poll || null,
        domOrder: Math.min(existing.domOrder ?? Infinity, t.domOrder ?? Infinity)
      };
      tweetMap.set(t.id, merged);
    }
  }
  state.tweets = Array.from(tweetMap.values());
}

// --- Quick Stats for Live Progress ---
function computeQuickStats(tweets) {
  let imageCount = 0;
  let linkCount = 0;
  let videoCount = 0;
  const linkSet = new Set();

  for (const t of tweets) {
    if (Array.isArray(t.images)) imageCount += t.images.length;
    if (t.quotedTweet && Array.isArray(t.quotedTweet.images)) {
      imageCount += t.quotedTweet.images.length;
    }
    if (Array.isArray(t.videos)) videoCount += t.videos.length;
    if (Array.isArray(t.links)) {
      for (const l of t.links) {
        if (l.url) linkSet.add(l.url);
      }
    }
    if (t.card && t.card.url) linkSet.add(t.card.url);
  }
  linkCount = linkSet.size;
  return {
    total: tweets.length,
    imageCount,
    videoCount,
    linkCount
  };
}

// --- Start Export Flow ---
async function startExport(url, mode = 'full') {
  state.isExporting = true;
  state.currentUrl = url;
  state.captureMode = mode;
  state.targetTweetId = extractTweetId(url);
  state.status = 'Opening tweet page...';
  state.tweets = [];
  state.completedAt = null;
  state.error = null;
  tweetMap = new Map();

  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (activeTab && activeTab.url && isSameTweet(activeTab.url, url)) {
      state.activeTabId = activeTab.id;
      await injectAndStart(state.activeTabId);
    } else if (activeTab && activeTab.url && isTweetDomain(activeTab.url)) {
      state.activeTabId = activeTab.id;
      await chrome.tabs.update(state.activeTabId, { url });
      waitForTabAndInject(state.activeTabId);
    } else {
      const tab = await chrome.tabs.create({ url, active: true });
      state.activeTabId = tab.id;
      waitForTabAndInject(state.activeTabId);
    }
  } catch (err) {
    state.isExporting = false;
    state.error = `Failed to start: ${err.message}`;
    broadcastToPopup({
      action: 'exportError',
      error: state.error
    });
  }
}

function waitForTabAndInject(targetTabId) {
  const listener = (tabId, info) => {
    if (tabId === targetTabId && info.status === 'complete') {
      chrome.tabs.onUpdated.removeListener(listener);
      setTimeout(() => injectAndStart(targetTabId), 2200);
    }
  };
  chrome.tabs.onUpdated.addListener(listener);
}

// --- Inject Content Script ---
async function injectAndStart(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });

    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, {
        action: 'startScraping',
        mode: state.captureMode,
        targetTweetId: state.targetTweetId,
        targetUrl: state.currentUrl
      }).catch((err) => {
        state.isExporting = false;
        broadcastToPopup({
          action: 'exportError',
          error: `Could not communicate with X page: ${err.message}`
        });
      });
    }, 450);
  } catch (err) {
    state.isExporting = false;
    broadcastToPopup({
      action: 'exportError',
      error: `Script injection failed: ${err.message}. Make sure you're viewing an X/Twitter page.`
    });
  }
}

// --- Stop Export ---
function stopExport() {
  state.isExporting = false;
  state.status = 'Stopped by user';
  if (state.activeTabId) {
    chrome.tabs.sendMessage(state.activeTabId, { action: 'stopScraping' }).catch(() => { });
  }
  const stats = computeQuickStats(state.tweets);
  const sessionPayload = {
    url: state.currentUrl,
    targetTweetId: state.targetTweetId,
    captureMode: state.captureMode,
    pageTitle: state.pageTitle,
    tweets: state.tweets,
    stats,
    capturedAt: new Date().toISOString()
  };
  if (state.tweets.length > 0) {
    chrome.storage.local.set({ activeReaderSession: sessionPayload }).catch(() => { });
  }
}

// --- Open Full-Page Organized Reader ---
async function openReaderTab(customSession) {
  if (customSession) {
    await chrome.storage.local.set({ activeReaderSession: customSession });
  }
  const readerUrl = chrome.runtime.getURL('reader.html');
  await chrome.tabs.create({ url: readerUrl, active: true });
}

// --- Reliable Image Fetcher (for offline embedding) ---
async function fetchImageAsBase64(url) {
  const resp = await fetch(url, { credentials: 'omit' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const blob = await resp.blob();
  const mimeType = blob.type || 'image/jpeg';
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  const base64 = btoa(binary);
  return {
    ok: true,
    mimeType,
    dataUrl: `data:${mimeType};base64,${base64}`,
    size: bytes.length
  };
}

// --- Broadcast to popup ---
function broadcastToPopup(message) {
  chrome.runtime.sendMessage(message).catch(() => { });
}

// --- Helpers ---
function isSameTweet(url1, url2) {
  const id1 = extractTweetId(url1);
  const id2 = extractTweetId(url2);
  return Boolean(id1 && id2 && id1 === id2);
}

function isTweetDomain(url) {
  return /^https?:\/\/(x\.com|twitter\.com|mobile\.x\.com|mobile\.twitter\.com)/.test(url);
}

function extractTweetId(url) {
  if (!url) return null;
  const match = url.match(/status\/(\d+)/);
  return match ? match[1] : null;
}
