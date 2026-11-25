// ============================================
// TwReplyExport Pro — Popup Controller
// Manages capture modes, live state recovery,
// intelligent organization preview, optional AI
// settings, reader launch, and rich exports.
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  const tweetUrlInput = document.getElementById('tweetUrl');
  const pasteBtn = document.getElementById('pasteBtn');
  const urlError = document.getElementById('urlError');
  const startBtn = document.getElementById('startBtn');
  const progressSection = document.getElementById('progressSection');
  const statusText = document.getElementById('statusText');
  const replyCount = document.getElementById('replyCount');
  const progressBar = document.getElementById('progressBar');
  const stopBtn = document.getElementById('stopBtn');
  const quickReaderBtn = document.getElementById('quickReaderBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const resultsSection = document.getElementById('resultsSection');
  const resultsTitle = document.getElementById('resultsTitle');
  const totalCount = document.getElementById('totalCount');
  const resultsStats = document.getElementById('resultsStats');
  const resultsPreview = document.getElementById('resultsPreview');
  const openReaderBtn = document.getElementById('openReaderBtn');
  const downloadResultsBtn = document.getElementById('downloadResultsBtn');
  const downloadFmtLabel = document.getElementById('downloadFmtLabel');
  const exportProgressText = document.getElementById('exportProgressText');
  const openLastReaderBtn = document.getElementById('openLastReaderBtn');

  const modeBtns = document.querySelectorAll('.mode-btn');
  const formatBtns = document.querySelectorAll('.format-btn');
  const embedImages = document.getElementById('embedImages');
  const filterNoise = document.getElementById('filterNoise');
  const includeMetrics = document.getElementById('includeMetrics');

  const aiToggle = document.getElementById('aiToggle');
  const aiPanel = document.getElementById('aiPanel');
  const geminiApiKey = document.getElementById('geminiApiKey');
  const geminiModel = document.getElementById('geminiModel');
  const autoAiEnhance = document.getElementById('autoAiEnhance');

  const historyToggle = document.getElementById('historyToggle');
  const historyList = document.getElementById('historyList');

  // --- State ---
  let captureMode = 'full';
  let currentFormat = 'docx';
  let currentTweetUrl = '';
  let capturedTweets = [];
  let organizedData = null;
  let isExporting = false;

  // --- Load Saved Preferences & AI Settings ---
  chrome.storage.local.get(['prefs', 'aiConfig', 'activeReaderSession'], (res) => {
    if (res.prefs) {
      if (res.prefs.format) selectFormat(res.prefs.format);
      if (res.prefs.mode) selectMode(res.prefs.mode);
      if (typeof res.prefs.embedImages === 'boolean') embedImages.checked = res.prefs.embedImages;
      if (typeof res.prefs.filterNoise === 'boolean') filterNoise.checked = res.prefs.filterNoise;
      if (typeof res.prefs.includeMetrics === 'boolean') includeMetrics.checked = res.prefs.includeMetrics;
    }
    if (res.aiConfig) {
      geminiApiKey.value = res.aiConfig.apiKey || '';
      if (res.aiConfig.model) geminiModel.value = res.aiConfig.model;
      autoAiEnhance.checked = Boolean(res.aiConfig.autoRun);
    }
    if (res.activeReaderSession && res.activeReaderSession.tweets?.length > 0) {
      openLastReaderBtn.style.display = 'inline-block';
    }
  });

  function savePrefs() {
    chrome.storage.local.set({
      prefs: {
        format: currentFormat,
        mode: captureMode,
        embedImages: embedImages.checked,
        filterNoise: filterNoise.checked,
        includeMetrics: includeMetrics.checked
      }
    });
  }

  function saveAiConfig() {
    chrome.storage.local.set({
      aiConfig: {
        apiKey: geminiApiKey.value.trim(),
        model: geminiModel.value,
        autoRun: autoAiEnhance.checked
      }
    });
  }

  // --- URL Validation (handles x.com, twitter.com, mobile, /i/web/status/, query params) ---
  function isValidTweetUrl(url) {
    return /^https?:\/\/((mobile\.)?(x|twitter)\.com)\/.+\/status\/\d+/i.test((url || '').trim());
  }

  // --- Mode & Format Selection ---
  function selectMode(mode) {
    captureMode = mode;
    modeBtns.forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  }

  function selectFormat(fmt) {
    currentFormat = fmt;
    formatBtns.forEach((b) => b.classList.toggle('active', b.dataset.format === fmt));
    const labels = {
      docx: 'DOCX',
      'md-zip': 'MD ZIP',
      md: 'MD',
      html: 'HTML',
      xlsx: 'XLSX',
      json: 'JSON',
      csv: 'CSV'
    };
    downloadFmtLabel.textContent = labels[fmt] || fmt.toUpperCase();
  }

  modeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectMode(btn.dataset.mode);
      savePrefs();
    });
  });

  formatBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      selectFormat(btn.dataset.format);
      savePrefs();
    });
  });

  [embedImages, filterNoise, includeMetrics].forEach((el) => {
    el.addEventListener('change', savePrefs);
  });

  [geminiApiKey, geminiModel, autoAiEnhance].forEach((el) => {
    el.addEventListener('change', saveAiConfig);
  });

  // --- Drawers ---
  aiToggle.addEventListener('click', () => {
    const open = aiPanel.style.display === 'none';
    aiPanel.style.display = open ? 'flex' : 'none';
    aiToggle.querySelector('.chevron').classList.toggle('open', open);
  });

  historyToggle.addEventListener('click', () => {
    const open = historyList.style.display === 'none';
    historyList.style.display = open ? 'flex' : 'none';
    historyToggle.querySelector('.chevron').classList.toggle('open', open);
    if (open) loadHistory();
  });

  // --- Paste Button ---
  pasteBtn.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      tweetUrlInput.value = text.trim();
      urlError.style.display = 'none';
    } catch { }
  });

  tweetUrlInput.addEventListener('input', () => {
    urlError.style.display = 'none';
  });

  // --- Restore Live State from Background (survives popup close/reopen!) ---
  chrome.runtime.sendMessage({ action: 'getState' }, (bgState) => {
    if (chrome.runtime.lastError || !bgState) return;
    if (bgState.isExporting) {
      isExporting = true;
      currentTweetUrl = bgState.currentUrl || '';
      if (currentTweetUrl) tweetUrlInput.value = currentTweetUrl;
      capturedTweets = bgState.tweets || [];
      showRunningUI(bgState.status || 'Capturing...', capturedTweets.length, bgState.stats);
    } else if (bgState.tweets && bgState.tweets.length > 0) {
      currentTweetUrl = bgState.currentUrl || '';
      capturedTweets = bgState.tweets;
      buildAndShowResults(capturedTweets, currentTweetUrl, false);
    }
  });

  // --- Auto-detect active tab URL ---
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.url && isValidTweetUrl(tabs[0].url) && !isExporting) {
      tweetUrlInput.value = tabs[0].url;
    }
  });

  // --- Start Capture ---
  startBtn.addEventListener('click', () => {
    const url = tweetUrlInput.value.trim();
    if (!isValidTweetUrl(url)) {
      urlError.style.display = 'block';
      return;
    }

    currentTweetUrl = url;
    capturedTweets = [];
    organizedData = null;
    isExporting = true;

    showRunningUI('Opening X thread...', 0, null);

    chrome.runtime.sendMessage({
      action: 'startExport',
      url,
      mode: captureMode
    });
  });

  function showRunningUI(statusMsg, count, stats) {
    startBtn.disabled = true;
    startBtn.innerHTML = '<span class="spinner"></span> Capturing Thread...';
    progressSection.style.display = 'block';
    resultsSection.style.display = 'none';
    statusText.textContent = statusMsg;
    statusText.style.color = '';
    statusText.className = 'status-text scraping';
    const imgBit = stats && stats.imageCount ? ` · ${stats.imageCount} img` : '';
    replyCount.textContent = `${count} posts${imgBit}`;
    progressBar.classList.add('indeterminate');
    stopBtn.style.display = 'inline-flex';
    quickReaderBtn.style.display = 'none';
    downloadBtn.style.display = 'none';
  }

  // --- Stop Capture ---
  stopBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'stopExport' });
    finishCapture('Stopped by user');
  });

  // --- Listen for Background Progress / Completion ---
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'progress') {
      capturedTweets = msg.tweets || capturedTweets;
      const imgBit = msg.stats?.imageCount ? ` · ${msg.stats.imageCount} img` : '';
      replyCount.textContent = `${msg.count || capturedTweets.length} posts${imgBit}`;
      statusText.textContent = msg.status || 'Capturing thread...';
      statusText.className = 'status-text scraping';
      if ((msg.count || 0) > 0) {
        progressBar.classList.remove('indeterminate');
        progressBar.style.width = Math.min(92, 12 + msg.count * 2) + '%';
      }
    }

    if (msg.action === 'exportComplete') {
      capturedTweets = msg.tweets || capturedTweets;
      const imgBit = msg.stats?.imageCount ? ` · ${msg.stats.imageCount} img` : '';
      replyCount.textContent = `${capturedTweets.length} posts${imgBit}`;
      if (capturedTweets.length === 0 && msg.diagnostics) {
        const d = msg.diagnostics;
        const errBit = d.parseErrors?.length ? ` · err: ${d.parseErrors[0]}` : '';
        finishCapture(`0 posts found (cells:${d.cellsFound}, articles:${d.articlesFound}, promoted:${d.promotedSkipped}${errBit}). Reload the X tab & try again.`);
      } else {
        finishCapture('Capture complete!');
      }
    }

    if (msg.action === 'exportError') {
      isExporting = false;
      progressBar.classList.remove('indeterminate');
      statusText.textContent = `Error: ${msg.error}`;
      statusText.style.color = 'var(--danger)';
      stopBtn.style.display = 'none';
      resetStartButton();
    }
  });

  async function finishCapture(statusMsg) {
    isExporting = false;
    progressBar.classList.remove('indeterminate');
    progressBar.style.width = '100%';
    statusText.textContent = statusMsg;
    statusText.className = 'status-text';
    stopBtn.style.display = 'none';
    resetStartButton();

    if (capturedTweets.length > 0) {
      quickReaderBtn.style.display = 'inline-flex';
      downloadBtn.style.display = 'inline-flex';
      openLastReaderBtn.style.display = 'inline-block';
      await buildAndShowResults(capturedTweets, currentTweetUrl, true);
    }
  }

  async function buildAndShowResults(tweets, url, saveHistoryFlag) {
    organizedData = ThreadIntelligence.organize(tweets, {
      sourceUrl: url,
      captureMode
    });

    // Optional Auto AI Enhancement
    if (autoAiEnhance.checked && geminiApiKey.value.trim()) {
      statusText.textContent = 'Running Gemini AI synthesis...';
      try {
        await ThreadIntelligence.enhanceWithAI(organizedData, {
          apiKey: geminiApiKey.value.trim(),
          model: geminiModel.value
        });
        statusText.textContent = 'Capture + AI synthesis complete!';
      } catch (err) {
        statusText.textContent = `Captured (AI skipped: ${err.message})`;
      }
    }

    const m = organizedData.meta;
    resultsSection.style.display = 'block';
    resultsTitle.textContent = m.title;
    totalCount.textContent = `~${m.readingTimeMin} min read`;

    resultsStats.innerHTML = `
      <div class="mini-stat"><div class="mini-stat-val">${m.threadLength}</div><div class="mini-stat-lbl">Thread</div></div>
      <div class="mini-stat"><div class="mini-stat-val">${m.replyCount}</div><div class="mini-stat-lbl">Replies</div></div>
      <div class="mini-stat"><div class="mini-stat-val">${m.imageCount}</div><div class="mini-stat-lbl">Images</div></div>
      <div class="mini-stat"><div class="mini-stat-val">${m.linkCount}</div><div class="mini-stat-lbl">Links</div></div>
    `;

    const previewItems = [
      ...organizedData.authorThread.slice(0, 3),
      ...organizedData.categories.topInsights.slice(0, 2)
    ].slice(0, 5);

    resultsPreview.innerHTML = previewItems.map((item) => {
      const badge = item.role === 'root' || item.role === 'thread'
        ? `Part ${item.partIndex}/${item.partTotal}`
        : 'Top Reply';
      const imgBadge = (item.images?.length || 0) > 0 ? ` · 🖼 ${item.images.length}` : '';
      return `
        <div class="preview-item">
          <img class="preview-avatar" src="${escapeHtml(item.avatarUrl || '')}" alt="">
          <div class="preview-content">
            <span class="preview-name">${escapeHtml(item.displayName)}</span>
            <span class="preview-badge">${badge}${imgBadge}</span>
            <div class="preview-text">${escapeHtml(item.text || '(Media post)')}</div>
          </div>
        </div>
      `;
    }).join('');

    if (saveHistoryFlag) {
      saveToHistory(organizedData, tweets, url);
    }
  }

  function resetStartButton() {
    startBtn.disabled = false;
    startBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="5 3 19 12 5 21 5 3"/>
      </svg>
      Capture &amp; Organize Thread
    `;
  }

  // --- Open Full-Page Organized Reader ---
  function openReader(customSession = null) {
    const payload = customSession || {
      url: currentTweetUrl,
      captureMode,
      tweets: capturedTweets,
      aiEnhanced: organizedData?.summary?.aiEnhanced || null,
      capturedAt: new Date().toISOString()
    };
    chrome.runtime.sendMessage({ action: 'openReader', session: payload });
  }

  openReaderBtn.addEventListener('click', () => openReader());
  quickReaderBtn.addEventListener('click', () => openReader());
  openLastReaderBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'openReader' });
  });

  // --- Download Handler ---
  async function runDownload(targetOrganized = organizedData, fmt = currentFormat) {
    if (!targetOrganized) return;
    downloadResultsBtn.disabled = true;
    downloadBtn.disabled = true;
    exportProgressText.style.display = 'block';
    exportProgressText.textContent = 'Preparing document...';

    try {
      const filename = await ExportUtils.exportOrganized(targetOrganized, fmt, {
        includeMetrics: includeMetrics.checked,
        includeNoise: !filterNoise.checked,
        embedImages: embedImages.checked,
        onProgress: (done, total) => {
          exportProgressText.textContent = `Fetching & embedding images (${done}/${total})...`;
        }
      });
      exportProgressText.textContent = `Saved: ${filename}`;
    } catch (err) {
      exportProgressText.textContent = `Export failed: ${err.message}`;
    } finally {
      downloadResultsBtn.disabled = false;
      downloadBtn.disabled = false;
    }
  }

  downloadBtn.addEventListener('click', () => runDownload());
  downloadResultsBtn.addEventListener('click', () => runDownload());

  // --- History ---
  function saveToHistory(org, tweets, url) {
    chrome.storage.local.get(['exportHistory'], (res) => {
      const history = res.exportHistory || [];
      // Remove duplicate URL entry if re-scraped
      const filtered = history.filter((h) => h.url !== url);
      filtered.unshift({
        url,
        title: org.meta.title,
        authorHandle: org.meta.authorHandle,
        threadLength: org.meta.threadLength,
        replyCount: org.meta.replyCount,
        imageCount: org.meta.imageCount,
        format: currentFormat,
        captureMode,
        date: new Date().toISOString(),
        tweets
      });
      if (filtered.length > 20) filtered.length = 20;
      chrome.storage.local.set({ exportHistory: filtered });
    });
  }

  function loadHistory() {
    chrome.storage.local.get(['exportHistory'], (res) => {
      const history = res.exportHistory || [];
      if (history.length === 0) {
        historyList.innerHTML = '<div class="history-empty">No saved threads yet</div>';
        return;
      }

      historyList.innerHTML = history.map((item, i) => {
        const d = new Date(item.date);
        const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const title = item.title || item.url.replace(/https?:\/\/(x\.com|twitter\.com)\//, '@');
        const postInfo = item.tweets
          ? `${item.threadLength || 1} thread · ${item.replyCount ?? item.tweets.length} replies · ${item.imageCount || 0} img`
          : `${item.count || 0} replies`;

        return `
          <div class="history-item">
            <div class="history-meta">
              <div class="history-url" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
              <div class="history-info">
                <span>${postInfo}</span>
                <span>${dateStr}</span>
              </div>
            </div>
            <div class="history-actions">
              <button class="history-btn open-reader" data-index="${i}" title="Open in Organized Reader">📖</button>
              <button class="history-btn re-download" data-index="${i}" title="Download in selected format">↓</button>
              <button class="history-btn delete" data-index="${i}" title="Delete">✕</button>
            </div>
          </div>
        `;
      }).join('');

      historyList.querySelectorAll('.open-reader').forEach((btn) => {
        btn.addEventListener('click', () => {
          const item = history[parseInt(btn.dataset.index, 10)];
          const rawTweets = item.tweets || item.replies || [];
          openReader({
            url: item.url,
            captureMode: item.captureMode || 'full',
            tweets: rawTweets,
            capturedAt: item.date
          });
        });
      });

      historyList.querySelectorAll('.re-download').forEach((btn) => {
        btn.addEventListener('click', () => {
          const item = history[parseInt(btn.dataset.index, 10)];
          const rawTweets = item.tweets || item.replies || [];
          const org = ThreadIntelligence.organize(rawTweets, {
            sourceUrl: item.url,
            captureMode: item.captureMode || 'full',
            capturedAt: item.date
          });
          runDownload(org, currentFormat);
        });
      });

      historyList.querySelectorAll('.delete').forEach((btn) => {
        btn.addEventListener('click', () => {
          history.splice(parseInt(btn.dataset.index, 10), 1);
          chrome.storage.local.set({ exportHistory: history }, loadHistory);
        });
      });
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
});
