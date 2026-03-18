// ============================================
// TwReplyExport — Popup Controller
// Manages UI state, user interactions, and
// communication with background service worker
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  // --- Element References ---
  const tweetUrlInput = document.getElementById('tweetUrl');
  const pasteBtn = document.getElementById('pasteBtn');
  const urlError = document.getElementById('urlError');
  const startBtn = document.getElementById('startBtn');
  const progressSection = document.getElementById('progressSection');
  const statusText = document.getElementById('statusText');
  const replyCount = document.getElementById('replyCount');
  const progressBar = document.getElementById('progressBar');
  const stopBtn = document.getElementById('stopBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const resultsSection = document.getElementById('resultsSection');
  const totalCount = document.getElementById('totalCount');
  const resultsPreview = document.getElementById('resultsPreview');
  const downloadResultsBtn = document.getElementById('downloadResultsBtn');
  const historyToggle = document.getElementById('historyToggle');
  const historyList = document.getElementById('historyList');
  const formatBtns = document.querySelectorAll('.format-btn');
  const includeMetrics = document.getElementById('includeMetrics');
  const includeUserInfo = document.getElementById('includeUserInfo');

  // --- State ---
  let currentFormat = 'csv';
  let collectedReplies = [];
  let isExporting = false;
  let currentTweetUrl = '';

  // --- URL Validation ---
  function isValidTweetUrl(url) {
    return /^https?:\/\/(x\.com|twitter\.com)\/\w+\/status\/\d+/.test(url.trim());
  }

  // --- Format Selector ---
  formatBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      formatBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFormat = btn.dataset.format;
    });
  });

  // --- Paste Button ---
  pasteBtn.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      tweetUrlInput.value = text;
      tweetUrlInput.focus();
      urlError.style.display = 'none';
    } catch (err) {
      console.log('Clipboard access denied');
    }
  });

  // --- Input validation on type ---
  tweetUrlInput.addEventListener('input', () => {
    urlError.style.display = 'none';
  });

  // --- Start Export ---
  startBtn.addEventListener('click', () => {
    const url = tweetUrlInput.value.trim();

    if (!isValidTweetUrl(url)) {
      urlError.style.display = 'block';
      return;
    }

    currentTweetUrl = url;
    collectedReplies = [];
    isExporting = true;

    // Update UI
    startBtn.disabled = true;
    startBtn.innerHTML = '<span class="spinner"></span> Exporting...';
    progressSection.style.display = 'block';
    resultsSection.style.display = 'none';
    statusText.textContent = 'Opening tweet page...';
    statusText.className = 'status-text active';
    replyCount.textContent = '0 replies';
    progressBar.style.width = '0%';
    progressBar.classList.add('indeterminate');
    stopBtn.style.display = 'inline-flex';
    downloadBtn.style.display = 'none';

    // Send message to background
    chrome.runtime.sendMessage({
      action: 'startExport',
      url: url
    });
  });

  // --- Stop Export ---
  stopBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'stopExport' });
    finishExport('Stopped by user');
  });

  // --- Listen for progress updates from background ---
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'progress') {
      collectedReplies = msg.replies || collectedReplies;
      replyCount.textContent = `${msg.count || collectedReplies.length} replies`;
      statusText.textContent = msg.status || 'Scraping replies...';
      statusText.className = 'status-text scraping';

      if (msg.count > 0) {
        progressBar.classList.remove('indeterminate');
        // We don't know the total, so show activity
        progressBar.style.width = Math.min(90, msg.count * 2) + '%';
      }
    }

    if (msg.action === 'exportComplete') {
      collectedReplies = msg.replies || collectedReplies;
      finishExport('Export complete!');
    }

    if (msg.action === 'exportError') {
      statusText.textContent = `Error: ${msg.error}`;
      statusText.className = 'status-text';
      statusText.style.color = 'var(--danger)';
      resetStartButton();
    }
  });

  // --- Finish Export ---
  function finishExport(statusMsg) {
    isExporting = false;
    progressBar.classList.remove('indeterminate');
    progressBar.style.width = '100%';
    statusText.textContent = statusMsg;
    statusText.className = 'status-text';
    stopBtn.style.display = 'none';
    downloadBtn.style.display = 'inline-flex';
    resetStartButton();

    if (collectedReplies.length > 0) {
      showResults();
      saveToHistory();
    }
  }

  function resetStartButton() {
    startBtn.disabled = false;
    startBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="5 3 19 12 5 21 5 3"/>
      </svg>
      Start Export
    `;
  }

  // --- Show Results Preview ---
  function showResults() {
    resultsSection.style.display = 'block';
    totalCount.textContent = `${collectedReplies.length} replies`;

    // Show first 5 replies as preview
    const preview = collectedReplies.slice(0, 5);
    resultsPreview.innerHTML = preview.map(reply => `
      <div class="preview-item">
        <img class="preview-avatar" src="${reply.avatarUrl || ''}" 
             onerror="this.style.background='var(--bg-tertiary)';this.src=''"
             alt="">
        <div class="preview-content">
          <span class="preview-name">${escapeHtml(reply.displayName || 'Unknown')}</span>
          <span class="preview-handle">${escapeHtml(reply.handle || '')}</span>
          <div class="preview-text">${escapeHtml(reply.text || '')}</div>
        </div>
      </div>
    `).join('');

    if (collectedReplies.length > 5) {
      resultsPreview.innerHTML += `
        <div style="text-align:center;padding:8px;color:var(--text-muted);font-size:11px;">
          ...and ${collectedReplies.length - 5} more replies
        </div>
      `;
    }
  }

  // --- Download handlers ---
  downloadBtn.addEventListener('click', () => doDownload());
  downloadResultsBtn.addEventListener('click', () => doDownload());

  function doDownload() {
    const options = {
      includeMetrics: includeMetrics.checked,
      includeUserInfo: includeUserInfo.checked
    };
    ExportUtils.exportData(collectedReplies, currentFormat, currentTweetUrl, options);
  }

  // --- History ---
  historyToggle.addEventListener('click', () => {
    const isVisible = historyList.style.display !== 'none';
    historyList.style.display = isVisible ? 'none' : 'block';
    historyToggle.querySelector('.chevron').classList.toggle('open', !isVisible);

    if (!isVisible) {
      loadHistory();
    }
  });

  function saveToHistory() {
    chrome.storage.local.get(['exportHistory'], (result) => {
      const history = result.exportHistory || [];
      history.unshift({
        url: currentTweetUrl,
        count: collectedReplies.length,
        format: currentFormat,
        date: new Date().toISOString(),
        replies: collectedReplies
      });
      // Keep only last 20
      if (history.length > 20) history.length = 20;
      chrome.storage.local.set({ exportHistory: history });
    });
  }

  function loadHistory() {
    chrome.storage.local.get(['exportHistory'], (result) => {
      const history = result.exportHistory || [];

      if (history.length === 0) {
        historyList.innerHTML = '<div class="history-empty">No export history yet</div>';
        return;
      }

      historyList.innerHTML = history.map((item, i) => {
        const date = new Date(item.date);
        const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const urlDisplay = item.url.replace(/https?:\/\/(x\.com|twitter\.com)\//, '@');

        return `
          <div class="history-item" data-index="${i}">
            <div class="history-meta">
              <div class="history-url">${escapeHtml(urlDisplay)}</div>
              <div class="history-info">
                <span>${item.count} replies</span>
                <span>${item.format.toUpperCase()}</span>
                <span>${dateStr}</span>
              </div>
            </div>
            <div class="history-actions">
              <button class="history-btn re-download" data-index="${i}" title="Download again">↓</button>
              <button class="history-btn delete" data-index="${i}" title="Delete">✕</button>
            </div>
          </div>
        `;
      }).join('');

      // Attach event listeners
      historyList.querySelectorAll('.re-download').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.dataset.index);
          const item = history[idx];
          if (item && item.replies) {
            ExportUtils.exportData(item.replies, item.format, item.url, {
              includeMetrics: includeMetrics.checked,
              includeUserInfo: includeUserInfo.checked
            });
          }
        });
      });

      historyList.querySelectorAll('.delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.dataset.index);
          history.splice(idx, 1);
          chrome.storage.local.set({ exportHistory: history }, () => loadHistory());
        });
      });
    });
  }

  // --- Utility ---
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Auto-detect current tab URL ---
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && tabs[0].url) {
      const tabUrl = tabs[0].url;
      if (isValidTweetUrl(tabUrl)) {
        tweetUrlInput.value = tabUrl;
      }
    }
  });
});
