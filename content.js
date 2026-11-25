// ============================================
// TwReplyExport Pro v2.1 — Resilient Content Script
// Captures complete X/Twitter threads, ancestors,
// author self-threads, community replies, images,
// videos, quoted tweets, link cards, and polls.
// Includes multi-tier DOM fallbacks & diagnostics.
// ============================================

(() => {
  if (window.__twReplyExportProRegistered) {
    return;
  }
  window.__twReplyExportProRegistered = true;

  let shouldStop = false;
  let isRunning = false;
  let tweetMap = new Map();
  let domSequence = 0;
  let discoverMoreReached = false;
  let diagnostics = createEmptyDiagnostics();

  function createEmptyDiagnostics() {
    return {
      url: '',
      primaryColFound: false,
      cellsFound: 0,
      articlesFound: 0,
      promotedSkipped: 0,
      emptySkipped: 0,
      parseErrors: [],
      discoverMoreTriggered: false,
      scrollSteps: 0
    };
  }

  // --- Message Listener ---
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'startScraping') {
      if (isRunning) {
        shouldStop = true;
        setTimeout(() => runScraper(msg), 350);
      } else {
        runScraper(msg);
      }
      sendResponse({ ok: true });
    } else if (msg.action === 'stopScraping') {
      shouldStop = true;
      sendResponse({ ok: true });
    }
    return false;
  });

  // --- Main Scraping Loop ---
  async function runScraper(config = {}) {
    isRunning = true;
    shouldStop = false;
    tweetMap = new Map();
    domSequence = 0;
    discoverMoreReached = false;
    diagnostics = createEmptyDiagnostics();
    diagnostics.url = window.location.href;

    const mode = config.mode || 'full'; // 'full' | 'thread' | 'replies'
    const targetTweetId = config.targetTweetId || extractStatusIdFromUrl(window.location.href);

    try {
      await waitForTweetContent();

      // Scroll to top first so we capture any ancestor tweets & the root post
      window.scrollTo({ top: 0, behavior: 'instant' });
      await delay(800);

      // Expand any "Show more" buttons on long-form tweets at the top
      expandLongTweets();
      await delay(350);

      let stagnantAtBottomCount = 0;
      let noNewTweetsCount = 0;
      const MAX_NO_NEW_TWEETS = mode === 'thread' ? 6 : 12;
      const MAX_STAGNANT_BOTTOM = 4;
      const MAX_TOTAL_SCROLLS = 180;
      let nonAuthorStreakAfterThread = 0;
      let authorHandle = null;
      let seenFocusedOrRoot = false;

      while (
        !shouldStop &&
        diagnostics.scrollSteps < MAX_TOTAL_SCROLLS &&
        noNewTweetsCount < MAX_NO_NEW_TWEETS &&
        stagnantAtBottomCount < MAX_STAGNANT_BOTTOM &&
        !discoverMoreReached
      ) {
        const expanded = expandLongTweets();
        if (expanded > 0) {
          await delay(350);
        }

        const { changedCount, authorFound, sawNonAuthorAfterFocused } = extractVisibleTweets(
          targetTweetId,
          authorHandle
        );

        if (!authorHandle && authorFound) {
          authorHandle = authorFound;
        }
        if (targetTweetId && tweetMap.has(targetTweetId)) {
          seenFocusedOrRoot = true;
        } else if (tweetMap.size > 0) {
          seenFocusedOrRoot = true;
        }

        if (changedCount > 0) {
          noNewTweetsCount = 0;
          stagnantAtBottomCount = 0;
          const allTweets = getOrderedTweets();
          const imgCount = countImages(allTweets);
          chrome.runtime.sendMessage({
            action: 'scrapedBatch',
            tweets: allTweets,
            pageTitle: document.title,
            status: `Captured ${allTweets.length} posts · ${imgCount} images (scrolling...)`
          }).catch(() => {});
        } else {
          noNewTweetsCount++;
        }

        if (mode === 'thread' && seenFocusedOrRoot && sawNonAuthorAfterFocused) {
          nonAuthorStreakAfterThread++;
          if (nonAuthorStreakAfterThread >= 2) {
            break;
          }
        } else if (mode === 'thread') {
          nonAuthorStreakAfterThread = 0;
        }

        const clickedShowMore = clickShowMoreButtons(mode);
        if (clickedShowMore) {
          await delay(950);
          noNewTweetsCount = Math.max(0, noNewTweetsCount - 2);
          stagnantAtBottomCount = 0;
        }

        const prevY = getScrollTop();
        const maxScrollBefore = getMaxScrollTop();
        await smoothScroll();
        diagnostics.scrollSteps++;
        await delay(950);

        const newY = getScrollTop();
        const moved = Math.abs(newY - prevY) >= 12;
        const atBottom = newY >= Math.max(0, maxScrollBefore - 40);

        if (!moved && atBottom && changedCount === 0 && !clickedShowMore) {
          stagnantAtBottomCount++;
        } else if (moved) {
          stagnantAtBottomCount = 0;
          if (noNewTweetsCount > 0 && tweetMap.size > 0) {
            noNewTweetsCount = Math.min(noNewTweetsCount, MAX_NO_NEW_TWEETS - 3);
          }
        }
      }

      // Final extraction pass
      expandLongTweets();
      await delay(250);
      extractVisibleTweets(targetTweetId, authorHandle);

      const finalTweets = getOrderedTweets();
      isRunning = false;

      if (finalTweets.length === 0) {
        console.warn('TwReplyExport Pro: Finished with 0 posts. Diagnostics:', diagnostics);
      }

      chrome.runtime.sendMessage({
        action: 'scrapingComplete',
        tweets: finalTweets,
        count: finalTweets.length,
        pageTitle: document.title,
        diagnostics
      }).catch(() => {});
    } catch (err) {
      isRunning = false;
      console.error('TwReplyExport Pro: Fatal scraping error:', err);
      chrome.runtime.sendMessage({
        action: 'scrapingError',
        error: err.message || 'Scraping failed',
        diagnostics
      }).catch(() => {});
    }
  }

  // --- Extract all currently visible tweets (with multi-tier DOM fallbacks) ---
  function extractVisibleTweets(targetTweetId, knownAuthorHandle) {
    let changedCount = 0;
    let authorFound = knownAuthorHandle;
    let sawNonAuthorAfterFocused = false;
    let passedFocused = false;

    const primaryColumn = document.querySelector('[data-testid="primaryColumn"]');
    if (primaryColumn) diagnostics.primaryColFound = true;
    const scope = primaryColumn || document;

    const cells = Array.from(scope.querySelectorAll('[data-testid="cellInnerDiv"]'));
    diagnostics.cellsFound = Math.max(diagnostics.cellsFound, cells.length);

    const items = [];
    let seenTweetBeforeDivider = tweetMap.size > 0;

    if (cells.length > 0) {
      for (const cell of cells) {
        const article = findArticleInNode(cell);
        if (article) {
          items.push({ article, cell });
          seenTweetBeforeDivider = true;
          continue;
        }
        if (seenTweetBeforeDivider && isDiscoverMoreDivider(cell)) {
          const rect = cell.getBoundingClientRect();
          if (rect.top >= -200) {
            discoverMoreReached = true;
            diagnostics.discoverMoreTriggered = true;
            break;
          }
        }
      }
    }

    if (items.length === 0) {
      const directArticles = findAllArticles(scope);
      const fallbackArticles = directArticles.length > 0 ? directArticles : findAllArticles(document);
      for (const article of fallbackArticles) {
        const cell = article.closest('[data-testid="cellInnerDiv"]') || article.parentElement;
        items.push({ article, cell });
      }
    }

    diagnostics.articlesFound = Math.max(diagnostics.articlesFound, items.length);

    for (const { article, cell } of items) {
      if (isPromotedTweet(article)) {
        diagnostics.promotedSkipped++;
        continue;
      }

      try {
        const tweet = extractSingleTweet(article, cell, targetTweetId);
        if (!tweet || !tweet.id) {
          diagnostics.emptySkipped++;
          continue;
        }

        if (!authorFound && (tweet.isFocused || tweetMap.size === 0)) {
          authorFound = tweet.handle ? tweet.handle.toLowerCase() : null;
        }

        if (tweet.isFocused) {
          passedFocused = true;
        } else if (passedFocused && authorFound && tweet.handle) {
          if (tweet.handle.toLowerCase() !== authorFound) {
            sawNonAuthorAfterFocused = true;
          }
        }

        const existing = tweetMap.get(tweet.id);
        if (!existing) {
          tweet.domOrder = domSequence++;
          tweetMap.set(tweet.id, tweet);
          changedCount++;
        } else {
          const textImproved = (tweet.text || '').length > (existing.text || '').length;
          const imgsImproved = (tweet.images || []).length > (existing.images || []).length;
          const cardImproved = !existing.card && Boolean(tweet.card);
          const quoteImproved = !existing.quotedTweet && Boolean(tweet.quotedTweet);

          if (textImproved || imgsImproved || cardImproved || quoteImproved) {
            tweetMap.set(tweet.id, {
              ...existing,
              ...tweet,
              text: textImproved ? tweet.text : existing.text,
              images: imgsImproved ? tweet.images : existing.images,
              card: cardImproved ? tweet.card : existing.card,
              quotedTweet: quoteImproved ? tweet.quotedTweet : existing.quotedTweet,
              domOrder: existing.domOrder
            });
            changedCount++;
          }
        }
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        if (diagnostics.parseErrors.length < 5) {
          diagnostics.parseErrors.push(msg);
        }
        console.warn('TwReplyExport Pro: Error parsing tweet:', e);
      }
    }

    return { changedCount, authorFound, sawNonAuthorAfterFocused };
  }

  function findArticleInNode(node) {
    return (
      node.querySelector('article[data-testid="tweet"]') ||
      node.querySelector('article[role="article"]') ||
      node.querySelector('article') ||
      node.querySelector('[data-testid="tweet"]')
    );
  }

  function findAllArticles(root) {
    let list = Array.from(root.querySelectorAll('article[data-testid="tweet"]'));
    if (list.length === 0) list = Array.from(root.querySelectorAll('[data-testid="tweet"]'));
    if (list.length === 0) list = Array.from(root.querySelectorAll('article'));
    if (list.length === 0) list = Array.from(root.querySelectorAll('[role="article"]'));
    return list;
  }

  // --- Extract Complete Structured Data from One Tweet Article ---
  function extractSingleTweet(article, cell, targetTweetId) {
    const quotedContainer = safeCall(() => findQuotedContainer(article), null);

    const isMainElement = (el) => {
      if (!el) return false;
      if (!quotedContainer) return true;
      return !quotedContainer.contains(el);
    };

    // --- Author Info ---
    let displayName = '';
    let handle = '';
    let profileUrl = '';
    let isVerified = false;
    let avatarUrl = '';

    const allUserNameBlocks = Array.from(article.querySelectorAll('[data-testid="User-Name"]'));
    const mainUserNameEl = allUserNameBlocks.find(isMainElement) || allUserNameBlocks[0];

    if (mainUserNameEl) {
      const parsedUser = safeCall(() => parseUserNameBlock(mainUserNameEl), {});
      displayName = parsedUser.displayName || '';
      handle = parsedUser.handle || '';
      profileUrl = parsedUser.profileUrl || '';
      isVerified = Boolean(parsedUser.isVerified);
    }

    if (!handle) {
      const fallbackUser = safeCall(() => parseAuthorFallback(article, isMainElement), {});
      if (!displayName) displayName = fallbackUser.displayName || '';
      if (!handle) handle = fallbackUser.handle || '';
      if (!profileUrl) profileUrl = fallbackUser.profileUrl || '';
    }

    const avatarImgs = Array.from(article.querySelectorAll('img[src*="profile_images"]'));
    const mainAvatar = avatarImgs.find(isMainElement);
    if (mainAvatar) {
      avatarUrl = mainAvatar.src;
    }

    // --- Exact Status ID, Permalink & Timestamp ---
    let statusId = null;
    let url = '';
    let timestamp = '';
    let displayTime = '';

    const timeEls = Array.from(article.querySelectorAll('time')).filter(isMainElement);
    const mainTimeEl = timeEls[0];
    if (mainTimeEl) {
      timestamp = mainTimeEl.getAttribute('datetime') || '';
      displayTime = mainTimeEl.textContent.trim();
      const parentLink = mainTimeEl.closest('a[href*="/status/"]');
      if (parentLink) {
        const href = parentLink.getAttribute('href') || '';
        statusId = extractStatusIdFromUrl(href);
        url = href.startsWith('http') ? href.split('?')[0] : `https://x.com${href.split('?')[0]}`;
      }
    }

    if (!statusId) {
      const statusLinks = Array.from(article.querySelectorAll('a[href*="/status/"]')).filter(isMainElement);
      for (const a of statusLinks) {
        const href = a.getAttribute('href') || '';
        const id = extractStatusIdFromUrl(href);
        if (id) {
          statusId = id;
          const cleanMatch = href.match(/^(\/[^/]+\/status\/\d+)/);
          url = cleanMatch ? `https://x.com${cleanMatch[1]}` : `https://x.com${href.split('?')[0]}`;
          if (!href.includes('/photo/') && !href.includes('/video/') && !href.includes('/analytics')) {
            break;
          }
        }
      }
    }

    // --- Main Tweet Text ---
    let tweetTextEls = Array.from(article.querySelectorAll('[data-testid="tweetText"]')).filter(isMainElement);
    if (tweetTextEls.length === 0) {
      tweetTextEls = Array.from(article.querySelectorAll('div[lang], span[lang]')).filter(
        (el) => isMainElement(el) && !el.closest('[data-testid="User-Name"]')
      );
    }

    let text = '';
    const links = [];
    const hashtags = [];
    const mentions = [];

    for (const textEl of tweetTextEls) {
      const extracted = safeCall(() => extractRichText(textEl), { text: '', links: [], hashtags: [], mentions: [] });
      if (extracted.text) {
        text = text ? `${text}\n\n${extracted.text}` : extracted.text;
      }
      links.push(...extracted.links);
      hashtags.push(...extracted.hashtags);
      mentions.push(...extracted.mentions);
    }

    const articleTitleEl = article.querySelector('[data-testid="twitter-article-title"]');
    if (articleTitleEl && isMainElement(articleTitleEl)) {
      const articleTitle = articleTitleEl.textContent.trim();
      if (articleTitle && !text.includes(articleTitle)) {
        text = text ? `**${articleTitle}**\n\n${text}` : `**${articleTitle}**`;
      }
    }

    const replyingTo = safeCall(() => extractReplyingTo(article, isMainElement), []);
    const images = safeCall(() => extractImages(article, isMainElement), []);
    const videos = safeCall(() => extractVideos(article, isMainElement), []);
    const card = safeCall(() => extractCard(article, isMainElement), null);
    if (card && card.url && !links.some((l) => l.url === card.url)) {
      links.push({ url: card.url, display: card.title || card.domain || card.url });
    }
    const poll = safeCall(() => extractPoll(article, isMainElement), null);
    const quotedTweet = quotedContainer ? safeCall(() => extractQuotedTweet(quotedContainer), null) : null;
    const metrics = safeCall(() => extractMetrics(article, isMainElement), {
      likes: 0, retweets: 0, replies: 0, bookmarks: 0, views: 0
    });

    let isFocused = Boolean(targetTweetId && statusId && statusId === targetTweetId);
    if (!isFocused && tweetTextEls[0]) {
      const fontSize = parseFloat(window.getComputedStyle(tweetTextEls[0]).fontSize || '15');
      if (fontSize >= 19) {
        isFocused = true;
      }
    }

    const hasConnectorAbove = safeCall(() => detectConnectorLine(cell, article, 'above'), false);
    const hasConnectorBelow = safeCall(() => detectConnectorLine(cell, article, 'below'), false);

    if (!text && images.length === 0 && videos.length === 0 && !quotedTweet && !card && !poll) {
      return null;
    }

    const id = statusId || `fallback_${handle}_${timestamp}_${hashCode(text + (images[0]?.url || ''))}`;

    return {
      id,
      statusId: statusId || '',
      url,
      displayName: displayName || handle || 'Unknown',
      handle: handle || '',
      isVerified,
      profileUrl,
      avatarUrl,
      text,
      timestamp,
      displayTime,
      replyingTo,
      images,
      videos,
      links: deduplicateLinks(links),
      hashtags: [...new Set(hashtags)],
      mentions: [...new Set(mentions)],
      card,
      poll,
      quotedTweet,
      likes: metrics.likes,
      retweets: metrics.retweets,
      replies: metrics.replies,
      bookmarks: metrics.bookmarks,
      views: metrics.views,
      isFocused,
      hasConnectorAbove,
      hasConnectorBelow,
      userBio: '',
      userWebsite: '',
      userLocation: '',
      followerCount: 0,
      followingCount: 0
    };
  }

  // --- Safely Find Nested Quoted Tweet Container ---
  function findQuotedContainer(article) {
    const userNameBlocks = Array.from(article.querySelectorAll('[data-testid="User-Name"]'));
    if (userNameBlocks.length < 2) return null;

    const firstUser = userNameBlocks[0];
    const secondUser = userNameBlocks[1];

    const candidates = [
      secondUser.closest('[data-testid="quoteTweet"]'),
      secondUser.closest('div[role="link"]'),
      secondUser.closest('div[tabindex="0"]')
    ];

    for (const cand of candidates) {
      if (cand && cand !== article && article.contains(cand) && !cand.contains(firstUser)) {
        return cand;
      }
    }

    let cur = secondUser.parentElement;
    while (cur && cur !== article && cur.parentElement && !cur.parentElement.contains(firstUser)) {
      cur = cur.parentElement;
    }
    if (cur && cur !== article && article.contains(cur) && !cur.contains(firstUser)) {
      return cur;
    }
    return null;
  }

  function extractQuotedTweet(container) {
    const userEl = container.querySelector('[data-testid="User-Name"]');
    const user = userEl ? parseUserNameBlock(userEl) : { displayName: '', handle: '', profileUrl: '', isVerified: false };

    const textEl = container.querySelector('[data-testid="tweetText"]') || container.querySelector('div[lang]');
    const extracted = textEl ? extractRichText(textEl) : { text: '', links: [], hashtags: [], mentions: [] };

    const timeEl = container.querySelector('time');
    const timestamp = timeEl ? (timeEl.getAttribute('datetime') || timeEl.textContent.trim()) : '';

    let url = '';
    const linkEl = container.querySelector('a[href*="/status/"]');
    if (linkEl) {
      const href = linkEl.getAttribute('href') || '';
      url = href.startsWith('http') ? href.split('?')[0] : `https://x.com${href.split('?')[0]}`;
    }

    const images = extractImages(container, () => true);

    if (!user.displayName && !user.handle && !extracted.text && images.length === 0) {
      return null;
    }

    return {
      displayName: user.displayName,
      handle: user.handle,
      isVerified: user.isVerified,
      text: extracted.text,
      timestamp,
      url,
      images
    };
  }

  // --- Parse User-Name Block ---
  function parseUserNameBlock(nameEl) {
    let displayName = '';
    let handle = '';
    let profileUrl = '';
    let isVerified = false;

    if (nameEl.querySelector('svg[data-testid="icon-verified"], svg[aria-label*="Verified"]')) {
      isVerified = true;
    }

    const links = Array.from(nameEl.querySelectorAll('a[href]'));
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      const txt = link.textContent.trim();
      if (txt.startsWith('@')) {
        handle = txt;
        if (href.startsWith('/') && !href.includes('/status/')) {
          profileUrl = `https://x.com${href}`;
        }
        break;
      }
    }

    if (!handle) {
      const spans = Array.from(nameEl.querySelectorAll('span'));
      for (const s of spans) {
        const txt = s.textContent.trim();
        if (/^@[A-Za-z0-9_]{1,30}$/.test(txt)) {
          handle = txt;
          profileUrl = `https://x.com/${txt.slice(1)}`;
          break;
        }
      }
    }

    const firstLink = links.find((a) => {
      const href = a.getAttribute('href') || '';
      return href.startsWith('/') && !href.includes('/status/') && !a.textContent.trim().startsWith('@');
    });
    if (firstLink) {
      displayName = extractTextWithEmojis(firstLink).trim();
    }

    if (!displayName) {
      const spans = Array.from(nameEl.querySelectorAll('span'));
      for (const span of spans) {
        if (span.closest('time') || span.closest('[datetime]')) continue;
        const txt = extractTextWithEmojis(span).trim();
        if (txt && !txt.startsWith('@') && txt !== '·' && txt !== '•') {
          displayName = txt;
          break;
        }
      }
    }

    return { displayName, handle, profileUrl, isVerified };
  }

  function parseAuthorFallback(article, filterFn) {
    const links = Array.from(article.querySelectorAll('a[href^="/"]')).filter(filterFn);
    let handle = '';
    let profileUrl = '';
    let displayName = '';
    for (const a of links) {
      const href = a.getAttribute('href') || '';
      const txt = a.textContent.trim();
      if (/^@[A-Za-z0-9_]{1,30}$/.test(txt)) {
        handle = txt;
        profileUrl = `https://x.com/${txt.slice(1)}`;
        break;
      }
      if (!displayName && /^\/[A-Za-z0-9_]{1,30}$/.test(href) && txt && !txt.startsWith('@')) {
        displayName = txt;
        handle = `@${href.slice(1)}`;
        profileUrl = `https://x.com${href}`;
      }
    }
    return { displayName, handle, profileUrl };
  }

  // --- Rich Text Extraction ---
  function extractRichText(root) {
    const links = [];
    const hashtags = [];
    const mentions = [];

    function walk(node) {
      if (!node) return '';
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
      if (node.nodeType !== Node.ELEMENT_NODE) return '';

      const tag = node.tagName.toUpperCase();
      if (tag === 'BR') return '\n';
      if (tag === 'IMG') return node.getAttribute('alt') || '';

      if (tag === 'A') {
        const href = node.getAttribute('href') || '';
        const innerText = Array.from(node.childNodes).map(walk).join('').trim();

        if (innerText.startsWith('#')) {
          hashtags.push(innerText);
          return innerText;
        }
        if (innerText.startsWith('@')) {
          mentions.push(innerText);
          return innerText;
        }
        if (href.startsWith('http://') || href.startsWith('https://')) {
          const cleanDisplay = innerText.replace(/…$/, '');
          let resolvedUrl = href;
          if (/^https?:\/\//i.test(innerText) && !innerText.endsWith('…')) {
            resolvedUrl = innerText;
          }
          links.push({ url: resolvedUrl, display: cleanDisplay || resolvedUrl });
          return innerText || resolvedUrl;
        }
        return innerText;
      }

      let out = '';
      for (const child of node.childNodes) {
        out += walk(child);
      }
      if (tag === 'P' || tag === 'DIV') {
        return out ? `${out}\n` : '';
      }
      return out;
    }

    const raw = walk(root);
    const cleaned = raw
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return { text: cleaned, links, hashtags, mentions };
  }

  function extractTextWithEmojis(node) {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    if (node.tagName === 'IMG') return node.getAttribute('alt') || '';
    let s = '';
    for (const child of node.childNodes) {
      s += extractTextWithEmojis(child);
    }
    return s;
  }

  // --- Extract High-Res Images ---
  function extractImages(scope, filterFn) {
    const images = [];
    const seen = new Set();

    const photoImgs = Array.from(
      scope.querySelectorAll('[data-testid="tweetPhoto"] img, img[src*="pbs.twimg.com/media/"]')
    ).filter(filterFn);

    for (const img of photoImgs) {
      const rawSrc = img.getAttribute('src') || img.src || '';
      if (!rawSrc) continue;
      if (rawSrc.includes('profile_images') || rawSrc.includes('/emoji/') || rawSrc.includes('twemoji')) continue;

      const highResUrl = upgradeTwitterImageUrl(rawSrc, 'large');
      const origUrl = upgradeTwitterImageUrl(rawSrc, 'orig');
      const baseKey = rawSrc.split('?')[0];
      if (seen.has(baseKey)) continue;
      seen.add(baseKey);

      const altRaw = (img.getAttribute('alt') || '').trim();
      const alt = altRaw && altRaw.toLowerCase() !== 'image' ? altRaw : '';

      images.push({
        url: highResUrl,
        origUrl,
        thumbUrl: rawSrc,
        alt,
        width: img.naturalWidth || 0,
        height: img.naturalHeight || 0
      });
    }

    return images;
  }

  function upgradeTwitterImageUrl(url, sizeName = 'large') {
    try {
      const u = new URL(url);
      if (u.hostname.includes('pbs.twimg.com') && u.pathname.includes('/media/')) {
        u.searchParams.set('name', sizeName);
        if (!u.searchParams.get('format')) {
          u.searchParams.set('format', 'jpg');
        }
        return u.toString();
      }
      return url;
    } catch {
      return url;
    }
  }

  // --- Extract Videos / GIFs ---
  function extractVideos(scope, filterFn) {
    const videos = [];
    const seen = new Set();

    const players = Array.from(
      scope.querySelectorAll('[data-testid="videoPlayer"], [data-testid="videoComponent"]')
    ).filter(filterFn);

    for (const player of players) {
      const videoEl = player.querySelector('video');
      const poster = videoEl?.getAttribute('poster') || player.querySelector('img[src*="twimg.com"]')?.src || '';
      const isGif = Boolean(
        player.textContent.toUpperCase().includes('GIF') ||
        (poster && poster.includes('tweet_video_thumb'))
      );

      const key = poster || `video_${videos.length}`;
      if (seen.has(key)) continue;
      seen.add(key);

      videos.push({
        type: isGif ? 'gif' : 'video',
        posterUrl: poster
      });
    }

    return videos;
  }

  // --- Extract Link Card ---
  function extractCard(article, filterFn) {
    const cardEl = Array.from(article.querySelectorAll('[data-testid="card.wrapper"]')).find(filterFn);
    if (!cardEl || cardEl.querySelector('[data-testid="cardPoll"]')) return null;

    const anchor = cardEl.querySelector('a[href]');
    const url = anchor ? anchor.getAttribute('href') : '';
    const imgEl = cardEl.querySelector('img[src*="twimg.com"]');
    const imageUrl = imgEl ? imgEl.src : '';

    const detailEl =
      cardEl.querySelector('[data-testid="card.layoutSmall.detail"], [data-testid="card.layoutLarge.detail"]') || cardEl;
    const textLines = Array.from(detailEl.querySelectorAll('span, div'))
      .filter((el) => el.children.length === 0 && el.textContent.trim().length > 0)
      .map((el) => el.textContent.trim());
    const uniqueLines = [...new Set(textLines)];

    const domain = uniqueLines[0] || '';
    const title = uniqueLines[1] || uniqueLines[0] || '';
    const description = uniqueLines.length > 2 ? uniqueLines.slice(2).join(' ') : '';

    if (!url && !title) return null;
    return { url, domain, title, description, imageUrl };
  }

  // --- Extract Poll ---
  function extractPoll(article, filterFn) {
    const pollEl = Array.from(article.querySelectorAll('[data-testid="cardPoll"]')).find(filterFn);
    if (!pollEl) return null;

    const options = [];
    const rows = pollEl.querySelectorAll('[role="radio"], [role="listitem"], li');
    rows.forEach((row) => {
      const txt = row.textContent.trim();
      if (txt) options.push(txt);
    });

    if (options.length === 0) {
      const text = pollEl.textContent.trim();
      if (text) options.push(text);
    }

    return options.length > 0 ? { options } : null;
  }

  // --- Extract "Replying to @user" Targets ---
  function extractReplyingTo(article, filterFn) {
    const targets = [];
    const divs = Array.from(article.querySelectorAll('div')).filter(filterFn);
    for (const div of divs) {
      if (div.children.length > 8) continue;
      const txt = div.textContent.trim();
      if (txt.startsWith('Replying to @') && txt.length < 200) {
        const matches = txt.match(/@[A-Za-z0-9_]+/g);
        if (matches) {
          targets.push(...matches);
          break;
        }
      }
    }
    return [...new Set(targets)];
  }

  // --- Extract Engagement Metrics ---
  function extractMetrics(article, filterFn) {
    const getCount = (selector) => {
      const els = Array.from(article.querySelectorAll(selector)).filter(filterFn);
      for (const el of els) {
        const aria = el.getAttribute('aria-label') || '';
        const numFromText = parseMetric(el.textContent);
        if (numFromText > 0) return numFromText;
        const m = aria.match(/([\d,.]+)\s*([KkMmBb])?/);
        if (m) return parseMetric(m[0]);
      }
      return 0;
    };

    return {
      likes: getCount('[data-testid="like"], [data-testid="unlike"]'),
      retweets: getCount('[data-testid="retweet"], [data-testid="unretweet"]'),
      replies: getCount('[data-testid="reply"]'),
      bookmarks: getCount('[data-testid="bookmark"], [data-testid="removeBookmark"]'),
      views: getCount('a[href*="/analytics"]')
    };
  }

  // --- Detect Vertical Thread Connector Line ---
  function detectConnectorLine(cell, article, position) {
    const articleRect = article.getBoundingClientRect();
    if (articleRect.height === 0) return false;
    const divs = article.querySelectorAll('div');
    for (const d of divs) {
      const rect = d.getBoundingClientRect();
      if (rect.width >= 1 && rect.width <= 4 && rect.height >= 12) {
        const style = window.getComputedStyle(d);
        if (style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent') {
          if (position === 'above' && rect.top <= articleRect.top + 25) return true;
          if (position === 'below' && rect.bottom >= articleRect.bottom - 25) return true;
        }
      }
    }
    return false;
  }

  // --- Detect "Discover more" Divider ---
  function isDiscoverMoreDivider(cell) {
    if (findArticleInNode(cell)) return false;
    const text = (cell.textContent || '').trim().toLowerCase();
    return (
      text === 'discover more' ||
      text.startsWith('discover more\n') ||
      text === 'more replies from x' ||
      text.includes('sourced from across x')
    );
  }

  // --- Detect Promoted Ads ---
  function isPromotedTweet(article) {
    if (article.querySelector('[data-testid="placementTracking"]')) return true;
    const spans = article.querySelectorAll('span');
    for (const s of spans) {
      if (s.children.length > 0) continue;
      const t = s.textContent.trim();
      if (t === 'Ad' || t === 'Promoted') {
        if (!s.closest('[data-testid="tweetText"]') && !s.closest('[data-testid="User-Name"]')) {
          return true;
        }
      }
    }
    return false;
  }

  // --- Expand Truncated Long-Form Tweets ("Show more") ---
  function expandLongTweets() {
    let clicked = 0;
    const btns = document.querySelectorAll('[data-testid="tweet-text-show-more-link"]');
    btns.forEach((btn) => {
      if (btn.tagName.toUpperCase() === 'A') {
        const href = btn.getAttribute('href') || '';
        if (href && href !== '#' && !href.startsWith('javascript:')) return;
      }
      try {
        btn.click();
        clicked++;
      } catch {}
    });
    return clicked;
  }

  // --- Click "Show more replies" / "Show probable spam" ---
  function clickShowMoreButtons(mode) {
    let clicked = false;
    const primaryColumn = document.querySelector('[data-testid="primaryColumn"]') || document;
    const buttons = primaryColumn.querySelectorAll('button, [role="button"]');

    buttons.forEach((btn) => {
      if (btn.closest('article') || btn.closest('[data-testid="tweet"]')) return;
      const text = (btn.textContent || '').toLowerCase().trim();
      const shouldClick =
        text.includes('show more replies') ||
        text.includes('show replies') ||
        text.includes('show additional replies') ||
        text.includes('show this thread') ||
        (mode !== 'thread' && (
          text.includes('show probable spam') ||
          text.includes('probable spam') ||
          text === 'show'
        ));

      if (shouldClick) {
        try {
          btn.click();
          clicked = true;
        } catch {}
      }
    });

    return clicked;
  }

  // --- Scroll Helpers ---
  function getScrollTop() {
    return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
  }

  function getMaxScrollTop() {
    const docEl = document.documentElement;
    return Math.max(0, (docEl.scrollHeight || document.body.scrollHeight || 0) - window.innerHeight);
  }

  async function smoothScroll() {
    const scrollAmount = Math.max(500, Math.round(window.innerHeight * 0.78));
    window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
    await delay(450);
  }

  async function waitForTweetContent() {
    let attempts = 0;
    while (attempts < 25) {
      if (findAllArticles(document).length > 0) return;
      await delay(400);
      attempts++;
    }
  }

  // --- Utilities ---
  function safeCall(fn, fallback) {
    try {
      return fn();
    } catch (e) {
      if (diagnostics.parseErrors.length < 5) {
        diagnostics.parseErrors.push(e && e.message ? e.message : String(e));
      }
      return fallback;
    }
  }

  function getOrderedTweets() {
    return Array.from(tweetMap.values()).sort((a, b) => (a.domOrder ?? 0) - (b.domOrder ?? 0));
  }

  function countImages(tweets) {
    let n = 0;
    for (const t of tweets) {
      n += (t.images?.length || 0) + (t.quotedTweet?.images?.length || 0);
    }
    return n;
  }

  function deduplicateLinks(links) {
    const map = new Map();
    for (const l of links) {
      if (!l || !l.url) continue;
      if (!map.has(l.url)) map.set(l.url, l);
    }
    return Array.from(map.values());
  }

  function extractStatusIdFromUrl(url) {
    if (!url) return null;
    const m = url.match(/status\/(\d+)/);
    return m ? m[1] : null;
  }

  function parseMetric(text) {
    if (!text) return 0;
    const cleaned = String(text).trim().replace(/,/g, '');
    const match = cleaned.match(/([\d.]+)\s*([KkMmBb])?/);
    if (!match) return 0;
    let num = parseFloat(match[1]);
    if (Number.isNaN(num)) return 0;
    const suffix = (match[2] || '').toUpperCase();
    if (suffix === 'K') num *= 1000;
    else if (suffix === 'M') num *= 1000000;
    else if (suffix === 'B') num *= 1000000000;
    return Math.round(num);
  }

  function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return hash.toString(36);
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
