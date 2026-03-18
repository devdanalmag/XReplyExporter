// ============================================
// TwReplyExport — Content Script
// Injected into X/Twitter tweet pages to scrape
// reply data from the DOM with auto-scrolling
// ============================================

(() => {
  // Prevent double-injection
  if (window.__twReplyExportActive) return;
  window.__twReplyExportActive = true;

  let shouldStop = false;
  let seenIds = new Set();
  let allReplies = [];

  // --- Message Listener ---
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'startScraping') {
      startScraping();
    }
    if (msg.action === 'stopScraping') {
      shouldStop = true;
    }
  });

  // --- Main Scraping Loop ---
  async function startScraping() {
    shouldStop = false;
    seenIds = new Set();
    allReplies = [];

    // Wait for page to be ready
    await waitForTweetContent();

    // Skip the original tweet (first article) and start from replies
    let noNewRepliesCount = 0;
    const MAX_EMPTY_SCROLLS = 8;
    let lastReplyCount = 0;

    while (!shouldStop && noNewRepliesCount < MAX_EMPTY_SCROLLS) {
      // Extract visible replies
      const newReplies = extractReplies();

      if (newReplies.length > 0) {
        allReplies.push(...newReplies);
        noNewRepliesCount = 0;

        // Send progress update
        chrome.runtime.sendMessage({
          action: 'scrapedReplies',
          replies: allReplies,
          count: allReplies.length
        }).catch(() => {});
      } else {
        noNewRepliesCount++;
      }

      // Click "Show more replies" / "Show" buttons if present
      clickShowMoreButtons();

      // Scroll down
      await smoothScroll();

      // Small delay to let content load
      await delay(1200);

      // Check if we've reached the end
      if (allReplies.length === lastReplyCount) {
        noNewRepliesCount++;
      }
      lastReplyCount = allReplies.length;
    }

    // Final extraction pass
    extractReplies();

    // Signal completion
    window.__twReplyExportActive = false;
    chrome.runtime.sendMessage({
      action: 'scrapingComplete',
      replies: allReplies,
      count: allReplies.length
    }).catch(() => {});
  }

  // --- Extract Replies from DOM ---
  function extractReplies() {
    const newReplies = [];

    // Get all tweet articles on the page
    const articles = document.querySelectorAll('article[data-testid="tweet"]');

    // Skip the first one if it's the original tweet (it's usually in a different section)
    let isFirstTweet = true;

    articles.forEach((article) => {
      try {
        // Generate a unique ID for this reply based on content
        const replyId = generateReplyId(article);

        if (seenIds.has(replyId)) return;

        // Check if this is the original tweet (usually the first one)
        // The original tweet is typically inside the main content area before replies
        if (isFirstTweet) {
          const isOriginal = isOriginalTweet(article);
          if (isOriginal) {
            isFirstTweet = false;
            return; // Skip the original tweet
          }
        }
        isFirstTweet = false;

        const reply = extractSingleReply(article);
        if (reply && reply.text) {
          reply.id = replyId;
          seenIds.add(replyId);
          newReplies.push(reply);
        }
      } catch (e) {
        // Skip malformed articles
        console.log('TwReplyExport: Error parsing article', e);
      }
    });

    return newReplies;
  }

  // --- Extract Single Reply ---
  function extractSingleReply(article) {
    const reply = {
      displayName: '',
      handle: '',
      text: '',
      timestamp: '',
      likes: 0,
      retweets: 0,
      replies: 0,
      views: 0,
      profileUrl: '',
      avatarUrl: '',
      userBio: '',
      userWebsite: '',
      userLocation: '',
      followerCount: 0,
      followingCount: 0
    };

    // --- Display Name ---
    const nameEl = article.querySelector('[data-testid="User-Name"]');
    if (nameEl) {
      // The display name is usually in the first link/span
      const nameSpans = nameEl.querySelectorAll('span');
      for (const span of nameSpans) {
        const text = span.textContent.trim();
        if (text && !text.startsWith('@') && !text.includes('·') && text.length > 0) {
          // Check it's not inside a time element or other metadata
          if (!span.closest('time') && !span.closest('[datetime]')) {
            reply.displayName = text;
            break;
          }
        }
      }

      // --- Handle ---
      const handleLinks = nameEl.querySelectorAll('a[href*="/"]');
      for (const link of handleLinks) {
        const href = link.getAttribute('href');
        if (href && href.startsWith('/') && !href.includes('/status/')) {
          const handleText = link.textContent.trim();
          if (handleText.startsWith('@')) {
            reply.handle = handleText;
            reply.profileUrl = `https://x.com${href}`;
            break;
          }
        }
      }
    }

    // --- Reply Text ---
    const tweetTextEl = article.querySelector('[data-testid="tweetText"]');
    if (tweetTextEl) {
      reply.text = tweetTextEl.textContent.trim();
    }

    // --- Timestamp ---
    const timeEl = article.querySelector('time');
    if (timeEl) {
      reply.timestamp = timeEl.getAttribute('datetime') || timeEl.textContent.trim();
    }

    // --- Engagement Metrics ---
    // Likes
    const likeBtn = article.querySelector('[data-testid="like"] span, [data-testid="unlike"] span');
    if (likeBtn) {
      reply.likes = parseMetric(likeBtn.textContent);
    }

    // Retweets
    const retweetBtn = article.querySelector('[data-testid="retweet"] span, [data-testid="unretweet"] span');
    if (retweetBtn) {
      reply.retweets = parseMetric(retweetBtn.textContent);
    }

    // Replies
    const replyBtn = article.querySelector('[data-testid="reply"] span');
    if (replyBtn) {
      reply.replies = parseMetric(replyBtn.textContent);
    }

    // Views
    const viewsEl = article.querySelector('a[href*="/analytics"] span');
    if (viewsEl) {
      reply.views = parseMetric(viewsEl.textContent);
    }

    // --- Avatar ---
    const avatarImg = article.querySelector('img[src*="profile_images"]');
    if (avatarImg) {
      reply.avatarUrl = avatarImg.src;
    }

    return reply;
  }

  // --- Check if article is the original tweet ---
  function isOriginalTweet(article) {
    // The original tweet is often in a different cell structure
    // and may have more prominent styling
    const parent = article.closest('[data-testid="cellInnerDiv"]');
    if (!parent) return false;

    // The original tweet is usually the first cell
    const allCells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
    if (allCells.length > 0 && allCells[0] === parent) {
      return true;
    }

    // Also check if it has the "focused" tweet marker (larger text)
    const tweetText = article.querySelector('[data-testid="tweetText"]');
    if (tweetText) {
      const fontSize = window.getComputedStyle(tweetText).fontSize;
      if (parseInt(fontSize) > 20) {
        return true;
      }
    }

    return false;
  }

  // --- Generate Reply ID ---
  function generateReplyId(article) {
    const text = article.querySelector('[data-testid="tweetText"]')?.textContent || '';
    const handle = article.querySelector('a[href*="/"]')?.getAttribute('href') || '';
    const time = article.querySelector('time')?.getAttribute('datetime') || '';
    return `${handle}_${time}_${hashCode(text)}`;
  }

  // --- Simple hash code ---
  function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0; // Convert to 32bit integer
    }
    return hash.toString(36);
  }

  // --- Parse engagement metrics (e.g., "1.2K" → 1200) ---
  function parseMetric(text) {
    if (!text) return 0;
    text = text.trim().replace(/,/g, '');
    if (!text || text === '') return 0;

    const match = text.match(/^([\d.]+)\s*([KkMm])?$/);
    if (!match) return 0;

    let num = parseFloat(match[1]);
    const suffix = match[2];

    if (suffix === 'K' || suffix === 'k') num *= 1000;
    if (suffix === 'M' || suffix === 'm') num *= 1000000;

    return Math.round(num);
  }

  // --- Click "Show more replies" buttons ---
  function clickShowMoreButtons() {
    // Twitter uses various button texts for loading more
    const buttons = document.querySelectorAll('[role="button"]');
    buttons.forEach(btn => {
      const text = btn.textContent.toLowerCase().trim();
      if (
        text.includes('show more replies') ||
        text.includes('show replies') ||
        text.includes('show more') ||
        text.includes('more replies') ||
        text.includes('show probable spam') ||
        text.includes('probable spam') ||
        text.includes('show additional replies') ||
        text === 'show'
      ) {
        btn.click();
      }
    });

    // Also look for "Show additional replies" links
    const links = document.querySelectorAll('a');
    links.forEach(link => {
      const text = link.textContent.toLowerCase().trim();
      if (text.includes('show additional replies') || text.includes('more replies')) {
        link.click();
      }
    });
  }

  // --- Smooth scroll to load more content ---
  async function smoothScroll() {
    const scrollAmount = window.innerHeight * 0.8;
    window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
    await delay(600);
  }

  // --- Wait for tweet content to be loaded ---
  async function waitForTweetContent() {
    let attempts = 0;
    while (attempts < 20) {
      const tweet = document.querySelector('article[data-testid="tweet"]');
      if (tweet) return;
      await delay(500);
      attempts++;
    }
  }

  // --- Delay helper ---
  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
})();
