// ============================================
// TwReplyExport Pro — Organized Reader Studio
// Full-page interactive thread reader, search,
// media lightbox, optional Gemini AI synthesis,
// and one-click export to DOCX/MD/ZIP/HTML/PDF/XLSX.
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  const navList = document.getElementById('navList');
  const mainCanvas = document.getElementById('mainCanvas');
  const searchInput = document.getElementById('searchInput');
  const hideNoiseToggle = document.getElementById('hideNoiseToggle');
  const noiseBadge = document.getElementById('noiseBadge');
  const topicsCard = document.getElementById('topicsCard');
  const topicsCloud = document.getElementById('topicsCloud');
  const sentimentCard = document.getElementById('sentimentCard');
  const sentimentBars = document.getElementById('sentimentBars');
  const contributorsCard = document.getElementById('contributorsCard');
  const contributorsList = document.getElementById('contributorsList');
  const toast = document.getElementById('toast');

  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightboxImg');
  const lightboxCaption = document.getElementById('lightboxCaption');
  const lightboxClose = document.getElementById('lightboxClose');

  const aiEnhanceBtn = document.getElementById('aiEnhanceBtn');
  const aiModal = document.getElementById('aiModal');
  const modalApiKey = document.getElementById('modalApiKey');
  const modalModel = document.getElementById('modalModel');
  const modalCancel = document.getElementById('modalCancel');
  const modalRun = document.getElementById('modalRun');
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  const printBtn = document.getElementById('printBtn');
  const moreExportSelect = document.getElementById('moreExportSelect');

  let organized = null;
  let activeTab = 'all';
  let searchQuery = '';

  // --- Load Session from chrome.storage.local ---
  chrome.storage.local.get(['activeReaderSession', 'aiConfig'], (res) => {
    if (res.aiConfig) {
      modalApiKey.value = res.aiConfig.apiKey || '';
      if (res.aiConfig.model) modalModel.value = res.aiConfig.model;
    }

    const session = res.activeReaderSession;
    if (!session || !Array.isArray(session.tweets) || session.tweets.length === 0) {
      mainCanvas.innerHTML = `
        <div class="empty-state">
          <h2>No Thread Loaded Yet</h2>
          <p style="margin-top:8px;">Click the TwReplyExport Pro extension icon on any X/Twitter thread to capture and organize it here.</p>
        </div>`;
      return;
    }

    organized = ThreadIntelligence.organize(session.tweets, {
      sourceUrl: session.url,
      targetTweetId: session.targetTweetId,
      captureMode: session.captureMode || 'full',
      capturedAt: session.capturedAt
    });

    if (session.aiEnhanced) {
      organized.summary.aiEnhanced = session.aiEnhanced;
      if (session.aiEnhanced.smartTitle) organized.meta.title = session.aiEnhanced.smartTitle;
    }

    document.title = `${organized.meta.title} — TwReplyExport Pro`;
    renderSidebar();
    renderCanvas();
  });

  // --- Render Sidebar Navigation & Analytics ---
  function renderSidebar() {
    if (!organized) return;
    const m = organized.meta;
    const c = organized.categories;
    const hasAiArticle = Boolean(organized.summary.aiEnhanced?.cleanedArticle);

    noiseBadge.textContent = m.noiseCount > 0 ? `(${m.noiseCount})` : '';

    const tabs = [
      { id: 'all', label: '📑 Complete View', count: m.threadLength + m.replyCount },
      { id: 'thread', label: '🧵 Author Thread', count: m.threadLength },
      ...(hasAiArticle ? [{ id: 'article', label: '✨ Edited Article (AI)', count: 'AI' }] : []),
      { id: 'qa', label: '💬 Author Q&A', count: organized.qaExchanges.length },
      { id: 'insights', label: '💡 Top Insights', count: c.topInsights.length },
      { id: 'resources', label: '🔗 Links & Resources', count: organized.sharedLinks.length },
      { id: 'questions', label: '❓ Questions', count: c.questions.length },
      { id: 'media', label: '🖼️ Media Gallery', count: organized.mediaGallery.length },
      { id: 'discussion', label: '🗣️ Discussion', count: c.discussion.length + c.mediaReplies.length },
      ...(!hideNoiseToggle.checked && c.shortReactions.length > 0
        ? [{ id: 'noise', label: '💬 Short Reactions', count: c.shortReactions.length }]
        : [])
    ];

    navList.innerHTML = tabs
      .filter((t) => t.id === 'all' || t.id === 'thread' || t.id === 'article' || t.count > 0)
      .map((t) => `
        <button class="nav-item ${activeTab === t.id ? 'active' : ''}" data-tab="${t.id}">
          <span>${t.label}</span>
          <span class="nav-count">${t.count}</span>
        </button>
      `).join('');

    navList.querySelectorAll('.nav-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        renderSidebar();
        renderCanvas();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });

    // Key Topics
    if (organized.topics.keywords.length > 0) {
      topicsCard.style.display = 'block';
      topicsCloud.innerHTML = organized.topics.keywords
        .map((kw) => `<span class="topic-tag" data-kw="${esc(kw)}">#${esc(kw)}</span>`)
        .join('');
      topicsCloud.querySelectorAll('.topic-tag').forEach((el) => {
        el.addEventListener('click', () => {
          searchInput.value = el.dataset.kw;
          searchQuery = el.dataset.kw.toLowerCase();
          renderCanvas();
        });
      });
    }

    // Sentiment Breakdown
    const s = organized.summary.sentimentBreakdown;
    const totalSent = s.positive + s.questioning + s.critical + s.neutral;
    if (totalSent > 0) {
      sentimentCard.style.display = 'block';
      const rows = [
        { lbl: 'Positive', val: s.positive, color: '#10b981' },
        { lbl: 'Questions', val: s.questioning, color: '#38bdf8' },
        { lbl: 'Critical', val: s.critical, color: '#f59e0b' },
        { lbl: 'Neutral', val: s.neutral, color: '#64748b' }
      ];
      sentimentBars.innerHTML = rows.map((r) => `
        <div class="sent-row">
          <span class="sent-label">${r.lbl}</span>
          <div class="sent-track"><div class="sent-fill" style="width:${Math.round((r.val / totalSent) * 100)}%;background:${r.color}"></div></div>
          <span class="sent-num">${r.val}</span>
        </div>`).join('');
    }

    // Top Contributors
    if (organized.topics.topContributors.length > 0) {
      contributorsCard.style.display = 'block';
      contributorsList.innerHTML = organized.topics.topContributors.map((c) => `
        <div class="contrib-row">
          <span class="contrib-handle">${esc(c.handle)}</span>
          <span class="contrib-meta">${c.replies} repl · ❤️ ${formatNum(c.likes)}</span>
        </div>`).join('');
    }
  }

  // --- Render Main Canvas ---
  function renderCanvas() {
    if (!organized) return;
    const m = organized.meta;
    const ai = organized.summary.aiEnhanced;
    const htmlParts = [];

    // Hero Header
    htmlParts.push(`
      <section class="hero-card">
        <h1 class="hero-title">${esc(m.title)}</h1>
        <div class="hero-author-row">
          ${m.authorAvatarUrl ? `<img class="hero-avatar" src="${esc(m.authorAvatarUrl)}" alt="">` : ''}
          <div>
            <div class="hero-author-name">
              ${esc(m.authorName)} ${m.authorVerified ? '<span class="verified-check">✓</span>' : ''}
              <span class="author-handle">${esc(m.authorHandle)}</span>
            </div>
            <div class="hero-author-meta">
              ${esc(formatDate(m.publishedAt))} · ~${m.readingTimeMin} min read (${m.wordCount} words)
              ${m.sourceUrl ? ` · <a href="${esc(m.sourceUrl)}" target="_blank" rel="noopener">View original on X ↗</a>` : ''}
            </div>
          </div>
        </div>
        <div class="stats-strip">
          <div class="stat-tile"><div class="stat-tile-val">${m.threadLength}</div><div class="stat-tile-lbl">Thread Posts</div></div>
          <div class="stat-tile"><div class="stat-tile-val">${m.replyCount}</div><div class="stat-tile-lbl">Replies</div></div>
          <div class="stat-tile"><div class="stat-tile-val">${m.qaCount}</div><div class="stat-tile-lbl">Author Q&amp;A</div></div>
          <div class="stat-tile"><div class="stat-tile-val">${m.imageCount}</div><div class="stat-tile-lbl">Images</div></div>
          <div class="stat-tile"><div class="stat-tile-val">${m.linkCount}</div><div class="stat-tile-lbl">Links</div></div>
        </div>
      </section>
    `);

    // Summary Card (on 'all' and 'thread')
    if (activeTab === 'all' || activeTab === 'thread') {
      const bullets = (ai && ai.keyTakeaways?.length ? ai.keyTakeaways : organized.summary.keyPoints);
      if (bullets.length > 0 || ai?.executiveSummary) {
        htmlParts.push(`
          <section class="summary-card ${ai ? 'ai-styled' : ''}">
            <h2>${ai ? '✨ AI Executive Summary &amp; Key Takeaways' : '💡 Smart Summary &amp; Key Takeaways'}</h2>
            ${ai?.executiveSummary ? `<p>${esc(ai.executiveSummary)}</p>` : ''}
            <ul>${bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
          </section>
        `);
      }
    }

    // Tab-specific Sections
    if (activeTab === 'article' && ai?.cleanedArticle) {
      htmlParts.push(`<h2 class="section-heading">✨ Edited Article View (AI)</h2>`);
      htmlParts.push(`<div class="article-prose">${esc(ai.cleanedArticle)}</div>`);
    }

    if (activeTab === 'all' || activeTab === 'thread') {
      if (organized.ancestors.length > 0) {
        const ancs = filterTweets(organized.ancestors);
        if (ancs.length > 0) {
          htmlParts.push(`<h2 class="section-heading">↩️ Conversation Context</h2>`);
          htmlParts.push(ancs.map((t) => renderTweetCard(t, 'Context')).join(''));
        }
      }

      const threadPosts = filterTweets(organized.authorThread);
      if (threadPosts.length > 0) {
        htmlParts.push(`<h2 class="section-heading">🧵 Complete Author Thread (${threadPosts.length})</h2>`);
        htmlParts.push(threadPosts.map((t) =>
          renderTweetCard(t, organized.authorThread.length > 1 ? `Part ${t.partIndex}/${t.partTotal}` : 'Root Post', true)
        ).join(''));
      }
    }

    if (activeTab === 'all' || activeTab === 'qa') {
      const qas = organized.qaExchanges.filter((qa) =>
        matchesSearch(qa.question) || qa.answers.some(matchesSearch)
      );
      if (qas.length > 0) {
        htmlParts.push(`<h2 class="section-heading">💬 Author Q&amp;A &amp; Follow-Ups (${qas.length})</h2>`);
        htmlParts.push(qas.map((qa) => `
          <div class="qa-block">
            ${renderTweetCard(qa.question, 'Reader Question')}
            <div class="qa-answers">
              ${qa.answers.map((a) => renderTweetCard(a, 'Author Reply', true)).join('')}
            </div>
          </div>`).join(''));
      }
    }

    if (activeTab === 'all' && ai?.replyThemes?.length > 0) {
      htmlParts.push(`<h2 class="section-heading">🧠 Community Themes (AI Synthesis)</h2>`);
      htmlParts.push(ai.replyThemes.map((th) => `
        <div class="summary-card ai-styled" style="margin-bottom:12px;">
          <h2>${esc(th.theme)}</h2>
          <p style="margin-bottom:0;">${esc(th.summary)}</p>
        </div>`).join(''));
    }

    if (activeTab === 'all' || activeTab === 'insights') {
      const list = filterTweets(organized.categories.topInsights);
      if (list.length > 0) {
        htmlParts.push(`<h2 class="section-heading">💡 Top Community Insights (${list.length})</h2>`);
        htmlParts.push(list.map((r) => renderTweetCard(r, `Score ${r.qualityScore}`)).join(''));
      }
    }

    if (activeTab === 'all' || activeTab === 'resources') {
      const resourceReplies = filterTweets(organized.categories.resources);
      if (resourceReplies.length > 0) {
        htmlParts.push(`<h2 class="section-heading">🔗 Replies Sharing Resources (${resourceReplies.length})</h2>`);
        htmlParts.push(resourceReplies.map((r) => renderTweetCard(r, 'Resource')).join(''));
      }
      if (organized.sharedLinks.length > 0) {
        const links = organized.sharedLinks.filter((l) =>
          !searchQuery || (l.title + ' ' + l.domain + ' ' + l.url + ' ' + l.sharedByHandle).toLowerCase().includes(searchQuery)
        );
        if (links.length > 0) {
          htmlParts.push(`<h2 class="section-heading">📚 Extracted Links Index (${links.length})</h2>`);
          htmlParts.push(`
            <table class="links-table">
              <thead><tr><th>Resource</th><th>Domain</th><th>Shared By</th></tr></thead>
              <tbody>
                ${links.map((l) => `
                  <tr>
                    <td><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title || l.url)}</a></td>
                    <td>${esc(l.domain)}</td>
                    <td>${esc(l.sharedByHandle || '-')}</td>
                  </tr>`).join('')}
              </tbody>
            </table>`);
        }
      }
    }

    if (activeTab === 'all' || activeTab === 'questions') {
      const list = filterTweets(organized.categories.questions);
      if (list.length > 0) {
        htmlParts.push(`<h2 class="section-heading">❓ Community Questions (${list.length})</h2>`);
        htmlParts.push(list.map((r) => renderTweetCard(r, 'Question')).join(''));
      }
    }

    if (activeTab === 'media' || (activeTab === 'all' && organized.mediaGallery.length > 0)) {
      const gallery = organized.mediaGallery.filter((g) =>
        !searchQuery || (g.context + ' ' + g.alt + ' ' + g.authorHandle).toLowerCase().includes(searchQuery)
      );
      if (gallery.length > 0 && activeTab === 'media') {
        htmlParts.push(`<h2 class="section-heading">🖼️ Complete Media Gallery (${gallery.length})</h2>`);
        htmlParts.push(`
          <div class="gallery-grid">
            ${gallery.map((g) => `
              <figure class="gallery-card">
                <img src="${esc(g.url)}" alt="${esc(g.alt || g.context)}" class="zoomable-img" data-cap="${esc(g.authorHandle + ': ' + (g.alt || g.context))}">
                <figcaption class="gallery-card-body"><strong>${esc(g.authorHandle)}</strong> · ${esc(g.context)}</figcaption>
              </figure>`).join('')}
          </div>`);
      }
    }

    if (activeTab === 'all' || activeTab === 'discussion') {
      const list = filterTweets([...organized.categories.mediaReplies, ...organized.categories.discussion]);
      if (list.length > 0) {
        htmlParts.push(`<h2 class="section-heading">🗣️ Additional Discussion (${list.length})</h2>`);
        htmlParts.push(list.map((r) => renderTweetCard(r, r.images?.length ? 'Visual' : '')).join(''));
      }
    }

    if ((activeTab === 'noise' || (activeTab === 'all' && !hideNoiseToggle.checked)) && organized.categories.shortReactions.length > 0) {
      const list = filterTweets(organized.categories.shortReactions);
      if (list.length > 0) {
        htmlParts.push(`<h2 class="section-heading">💬 Short Reactions (${list.length})</h2>`);
        htmlParts.push(list.map((r) => renderTweetCard(r, 'Short')).join(''));
      }
    }

    mainCanvas.innerHTML = htmlParts.join('');

    // Wire lightbox click handlers
    mainCanvas.querySelectorAll('.zoomable-img').forEach((img) => {
      img.addEventListener('click', () => {
        lightboxImg.src = img.src;
        lightboxCaption.textContent = img.dataset.cap || img.alt || '';
        lightbox.classList.add('open');
      });
    });
  }

  function renderTweetCard(t, badge = '', isThreadPart = false) {
    const imgsHtml = (t.images || []).map((img) => `
      <figure class="media-item">
        <img src="${esc(img.url)}" alt="${esc(img.alt || 'Image')}" class="zoomable-img" data-cap="${esc(img.alt || t.displayName)}">
        ${img.alt ? `<figcaption class="media-cap">${esc(img.alt)}</figcaption>` : ''}
      </figure>`).join('');

    const vidsHtml = (t.videos || []).map((v) => `
      <div style="margin-top:10px;">
        ${v.posterUrl ? `<img src="${esc(v.posterUrl)}" alt="Video preview" style="max-width:100%;border-radius:10px;border:1px solid var(--border);">` : ''}
        <div style="margin-top:4px;"><a href="${esc(t.url || organized.meta.sourceUrl)}" target="_blank" rel="noopener" style="color:var(--accent);font-size:12.5px;font-weight:600;">▶ ${v.type.toUpperCase()} — View on X ↗</a></div>
      </div>`).join('');

    const quoteHtml = t.quotedTweet ? `
      <div class="quote-card">
        <div class="quote-hdr"><strong>${esc(t.quotedTweet.displayName || 'User')}</strong> <span class="author-handle">${esc(t.quotedTweet.handle || '')}</span></div>
        <div class="tweet-text" style="font-size:13.5px;">${linkify(t.quotedTweet.text)}</div>
        ${(t.quotedTweet.images || []).map((qi) => `<img src="${esc(qi.url)}" class="zoomable-img" style="max-width:100%;max-height:260px;border-radius:8px;margin-top:8px;cursor:zoom-in;" alt="">`).join('')}
      </div>` : '';

    const cardHtml = t.card ? `
      <a class="link-card" href="${esc(t.card.url || '#')}" target="_blank" rel="noopener">
        <div class="link-card-domain">${esc(t.card.domain || '')}</div>
        <div class="link-card-title">${esc(t.card.title || t.card.url || '')}</div>
        ${t.card.description ? `<div class="link-card-desc">${esc(t.card.description)}</div>` : ''}
      </a>` : '';

    const pollHtml = t.poll?.options?.length ? `
      <div class="poll-card">
        <div style="font-size:11px;color:var(--muted);font-weight:700;margin-bottom:4px;">POLL</div>
        ${t.poll.options.map((o) => `<div>• ${esc(o)}</div>`).join('')}
      </div>` : '';

    return `
      <article class="tweet-card ${isThreadPart ? 'thread-part' : ''}">
        <div class="tweet-top">
          <div class="tweet-author">
            ${t.avatarUrl ? `<img class="tweet-avatar" src="${esc(t.avatarUrl)}" alt="">` : ''}
            <div>
              <span class="author-name">${esc(t.displayName)}</span>
              ${t.isVerified ? '<span class="verified-check">✓</span>' : ''}
              <span class="author-handle">${esc(t.handle)}</span>
              ${badge ? `<span class="role-pill">${esc(badge)}</span>` : ''}
            </div>
          </div>
          <span class="tweet-time">${esc(formatDate(t.timestamp))}</span>
        </div>
        ${isThreadPart && t.chapterTitle && organized.authorThread.length > 1 ? `<div class="chapter-sub">${esc(t.chapterTitle)}</div>` : ''}
        <div class="tweet-text">${linkify(t.text)}</div>
        ${imgsHtml ? `<div class="media-grid ${t.images.length >= 2 ? 'cols-2' : ''}">${imgsHtml}</div>` : ''}
        ${vidsHtml}
        ${quoteHtml}
        ${cardHtml}
        ${pollHtml}
        <div class="metrics-row">
          ${t.likes ? `<span>❤️ ${formatNum(t.likes)}</span>` : ''}
          ${t.retweets ? `<span>🔁 ${formatNum(t.retweets)}</span>` : ''}
          ${t.replies ? `<span>💬 ${formatNum(t.replies)}</span>` : ''}
          ${t.views ? `<span>👁️ ${formatNum(t.views)}</span>` : ''}
          ${t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noopener">Open post ↗</a>` : ''}
        </div>
      </article>
    `;
  }

  // --- Search & Noise Filter ---
  function matchesSearch(t) {
    if (!searchQuery) return true;
    const hay = `${t.displayName} ${t.handle} ${t.text} ${t.quotedTweet?.text || ''}`.toLowerCase();
    return hay.includes(searchQuery);
  }

  function filterTweets(arr) {
    return (arr || []).filter(matchesSearch);
  }

  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.trim().toLowerCase();
    renderCanvas();
  });

  hideNoiseToggle.addEventListener('change', () => {
    renderSidebar();
    renderCanvas();
  });

  // --- Export Actions ---
  async function handleExport(fmt) {
    if (!organized || !fmt) return;
    showToast(`Preparing ${fmt.toUpperCase()} export...`);
    try {
      const filename = await ExportUtils.exportOrganized(organized, fmt, {
        includeMetrics: true,
        includeNoise: !hideNoiseToggle.checked,
        embedImages: fmt !== 'md',
        onProgress: (done, total) => {
          showToast(`Fetching & embedding images (${done}/${total})...`);
        }
      });
      showToast(`Saved ${filename}!`, 3500);
    } catch (err) {
      showToast(`Export error: ${err.message}`, 4500);
    }
  }

  document.querySelectorAll('[data-export]').forEach((btn) => {
    btn.addEventListener('click', () => handleExport(btn.dataset.export));
  });

  moreExportSelect.addEventListener('change', () => {
    const val = moreExportSelect.value;
    if (val) {
      handleExport(val);
      moreExportSelect.value = '';
    }
  });

  printBtn.addEventListener('click', () => window.print());

  // --- Theme Toggle ---
  themeToggleBtn.addEventListener('click', () => {
    const html = document.documentElement;
    html.setAttribute('data-theme', html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });

  // --- Lightbox ---
  lightboxClose.addEventListener('click', () => lightbox.classList.remove('open'));
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) lightbox.classList.remove('open');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      lightbox.classList.remove('open');
      aiModal.style.display = 'none';
    }
  });

  // --- Optional AI Enhance Modal ---
  aiEnhanceBtn.addEventListener('click', () => {
    aiModal.style.display = 'flex';
  });

  modalCancel.addEventListener('click', () => {
    aiModal.style.display = 'none';
  });

  modalRun.addEventListener('click', async () => {
    const key = modalApiKey.value.trim();
    const model = modalModel.value;
    if (!key) {
      showToast('Please enter a Gemini API key.', 3000);
      return;
    }
    chrome.storage.local.set({ aiConfig: { apiKey: key, model, autoRun: false } });
    aiModal.style.display = 'none';
    aiEnhanceBtn.disabled = true;
    showToast('Running Gemini AI synthesis...');

    try {
      const enhanced = await ThreadIntelligence.enhanceWithAI(organized, { apiKey: key, model });
      // Persist into active session so refresh keeps it
      chrome.storage.local.get(['activeReaderSession'], (res) => {
        if (res.activeReaderSession) {
          res.activeReaderSession.aiEnhanced = enhanced;
          chrome.storage.local.set({ activeReaderSession: res.activeReaderSession });
        }
      });
      renderSidebar();
      renderCanvas();
      showToast('✨ AI Executive Summary, Themes & Edited Article ready!', 4000);
    } catch (err) {
      showToast(`AI Error: ${err.message}`, 5000);
    } finally {
      aiEnhanceBtn.disabled = false;
    }
  });

  // --- Helpers ---
  let toastTimer = null;
  function showToast(msg, duration = 0) {
    toast.textContent = msg;
    toast.style.display = 'block';
    if (toastTimer) clearTimeout(toastTimer);
    if (duration > 0) {
      toastTimer = setTimeout(() => { toast.style.display = 'none'; }, duration);
    }
  }

  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function linkify(str) {
    return esc(str).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  }

  function formatDate(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) +
        ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  }

  function formatNum(n) {
    const num = Number(n) || 0;
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return String(num);
  }
});
