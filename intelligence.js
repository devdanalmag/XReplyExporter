// ============================================
// TwReplyExport Pro — Intelligence & Organization Engine
// 100% local smart thread reconstruction, Q&A pairing,
// noise filtering, topic/link extraction, scoring,
// extractive summaries, + optional BYOK Gemini AI enhancer.
// ============================================

(function (root) {
  const STOP_WORDS = new Set([
    'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i', 'it', 'for', 'not', 'on',
    'with', 'he', 'as', 'you', 'do', 'at', 'this', 'but', 'his', 'by', 'from', 'they', 'we',
    'say', 'her', 'she', 'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their',
    'what', 'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me', 'when',
    'make', 'can', 'like', 'time', 'no', 'just', 'him', 'know', 'take', 'into', 'year',
    'your', 'good', 'some', 'could', 'them', 'see', 'other', 'than', 'then', 'now', 'look',
    'only', 'come', 'its', 'over', 'think', 'also', 'back', 'after', 'use', 'two', 'how',
    'our', 'work', 'first', 'well', 'way', 'even', 'new', 'want', 'because', 'any', 'these',
    'give', 'day', 'most', 'us', 'is', 'are', 'was', 'were', 'been', 'has', 'had', 'did',
    'does', 'more', 'very', 'much', 'really', 'still', 'here', 'where', 'why', 'being',
    'don', 'doesn', 'didn', 'won', 'can', 't', 's', 'm', 're', 've', 'll', 'd', 'https',
    'http', 'www', 'com', 'org', 'net', 'amp', 'via', 'thread', 'tweet', 'post', 'just',
    'going', 'people', 'things', 'thing', 'actually', 'using', 'used', 'need', 'should',
    'every', 'many', 'best', 'great', 'right', 'same', 'too', 'got', 'let', 'still', 'always'
  ]);

  const NOISE_PATTERNS = [
    /^[@\s]*(threadreaderapp|readwise|save|unroll|pingthread|rattibha|grok)\b/i,
    /^(gm|gn|nice|cool|wow|fire|facts|true|agreed|agree|this|same|yes|no|yep|nope|lol|lmao|haha|thanks|thank you|thx|ty|great|awesome|amazing|love this|bookmarking|bookmarked|saved|following|interesting|brilliant|gold|real|based|goat|w|l|100%|fr|facts!?)[\s!.🙏🔥💯👏❤️🚀👍🙌✨]*$/i
  ];

  const POSITIVE_WORDS = ['great', 'awesome', 'love', 'amazing', 'helpful', 'brilliant', 'thanks', 'thank', 'insightful', 'excellent', 'agree', 'exactly', 'fantastic', 'valuable', 'clear', 'best', 'solid', 'smart', 'genius', 'appreciated'];
  const CRITICAL_WORDS = ['wrong', 'disagree', 'false', 'bad', 'terrible', 'horrible', 'nonsense', 'bs', 'myth', 'misleading', 'actually no', 'problem', 'flaw', 'issue', 'broken', 'fail', 'scam', 'fake', 'overrated', 'worse'];

  const ThreadIntelligence = {
    /**
     * Organize raw scraped tweets into a richly structured, intelligent document model.
     */
    organize(rawTweets, options = {}) {
      const tweets = Array.isArray(rawTweets) ? rawTweets.map(normalizeTweet) : [];
      const sourceUrl = options.sourceUrl || '';
      const targetTweetId = options.targetTweetId || extractStatusId(sourceUrl);
      const captureMode = options.captureMode || 'full';

      if (tweets.length === 0) {
        return createEmptyOrganization(sourceUrl, captureMode);
      }

      // 1. Identify focused / root tweet and main author
      const focusedIndex = findFocusedIndex(tweets, targetTweetId);
      const focusedTweet = tweets[focusedIndex] || tweets[0];
      const authorHandleLower = (focusedTweet.handle || '').toLowerCase();

      // 2. Partition into: ancestors, authorThread, and rawCommunity
      const ancestors = [];
      const authorThread = [];
      const postFocusedTweets = [];

      // Walk tweets before focusedIndex: same author => part of main thread; different author => ancestor context
      for (let i = 0; i < focusedIndex; i++) {
        const t = tweets[i];
        if (authorHandleLower && t.handle.toLowerCase() === authorHandleLower) {
          authorThread.push(t);
        } else {
          ancestors.push(t);
        }
      }

      // Add focused tweet to authorThread
      authorThread.push(focusedTweet);

      // Walk tweets after focusedIndex
      let stillInMainAuthorChain = true;
      for (let i = focusedIndex + 1; i < tweets.length; i++) {
        const t = tweets[i];
        const isAuthor = authorHandleLower && t.handle.toLowerCase() === authorHandleLower;

        if (stillInMainAuthorChain && isAuthor) {
          // Check if the author is explicitly replying to a third-party user instead of continuing self-thread
          const replyingToOthers = (t.replyingTo || []).filter(
            (h) => h.toLowerCase() !== authorHandleLower
          );
          if (replyingToOthers.length === 0 || t.hasConnectorAbove) {
            authorThread.push(t);
            continue;
          } else {
            stillInMainAuthorChain = false;
          }
        } else if (!isAuthor) {
          stillInMainAuthorChain = false;
        }

        postFocusedTweets.push(t);
      }

      // Annotate authorThread with part numbers & auto-detected chapter titles
      const annotatedThread = authorThread.map((t, idx) => {
        const cleanedText = cleanThreadNumbering(t.text);
        const chapterTitle = detectChapterTitle(t.text, idx, authorThread.length);
        return {
          ...t,
          role: idx === 0 ? 'root' : 'thread',
          partIndex: idx + 1,
          partTotal: authorThread.length,
          chapterTitle,
          cleanedText
        };
      });

      // 3. Pair Author Q&A Exchanges inside community replies
      const qaExchanges = [];
      const consumedIds = new Set();

      for (let i = 0; i < postFocusedTweets.length; i++) {
        const curr = postFocusedTweets[i];
        if (consumedIds.has(curr.id)) continue;

        const isCurrAuthor = authorHandleLower && curr.handle.toLowerCase() === authorHandleLower;
        if (!isCurrAuthor) {
          // Check if immediately followed by one or more replies from the OP answering this user
          const answers = [];
          let j = i + 1;
          while (j < postFocusedTweets.length) {
            const next = postFocusedTweets[j];
            const isNextAuthor = authorHandleLower && next.handle.toLowerCase() === authorHandleLower;
            if (!isNextAuthor) break;

            const targetsCurr =
              (next.replyingTo || []).some((h) => h.toLowerCase() === curr.handle.toLowerCase()) ||
              next.hasConnectorAbove;

            if (targetsCurr || j === i + 1) {
              answers.push({ ...next, role: 'author_reply' });
              consumedIds.add(next.id);
              j++;
            } else {
              break;
            }
          }

          if (answers.length > 0) {
            qaExchanges.push({
              question: { ...curr, role: 'qa_prompt' },
              answers
            });
            consumedIds.add(curr.id);
          }
        }
      }

      // Remaining community replies (excluding consumed Q&A items, and excluding standalone OP follow-ups if any)
      const remainingReplies = postFocusedTweets.filter((t) => !consumedIds.has(t.id));

      // 4. Score, classify, and categorize community replies
      const categories = {
        topInsights: [],
        questions: [],
        resources: [],
        mediaReplies: [],
        discussion: [],
        shortReactions: []
      };

      const sentimentCounts = { positive: 0, questioning: 0, critical: 0, neutral: 0 };

      const scoredReplies = remainingReplies.map((t) => {
        const isNoise = detectNoise(t);
        const qualityScore = computeQualityScore(t, isNoise);
        const sentiment = detectSentiment(t.text);
        sentimentCounts[sentiment]++;

        const hasExternalLinks = getExternalLinks(t).length > 0;
        const hasMedia = (t.images?.length || 0) > 0 || (t.videos?.length || 0) > 0;
        const isQuestion = detectQuestion(t.text);

        let category = 'discussion';
        if (isNoise) {
          category = 'shortReactions';
        } else if (hasExternalLinks) {
          category = 'resources';
        } else if (isQuestion && qualityScore < 65) {
          category = 'questions';
        } else if (hasMedia && t.text.length < 85 && qualityScore < 45) {
          category = 'mediaReplies';
        } else if (qualityScore >= 32 || (t.likes >= 5 && t.text.length >= 60)) {
          category = 'topInsights';
        }

        return {
          ...t,
          role: 'reply',
          isNoise,
          qualityScore,
          sentiment,
          category
        };
      });

      // Populate buckets
      for (const r of scoredReplies) {
        categories[r.category].push(r);
      }

      // Sort high-value buckets by qualityScore desc, likes desc
      const byQuality = (a, b) => (b.qualityScore - a.qualityScore) || (b.likes - a.likes);
      categories.topInsights.sort(byQuality);
      categories.resources.sort(byQuality);
      categories.questions.sort(byQuality);
      categories.mediaReplies.sort(byQuality);
      categories.discussion.sort(byQuality);

      // Promote top discussion items into topInsights if topInsights is sparse and discussion has substantive entries
      if (categories.topInsights.length < 3 && categories.discussion.length > 0) {
        const promote = categories.discussion.filter((r) => r.text.length >= 70).slice(0, 3 - categories.topInsights.length);
        const promoteIds = new Set(promote.map((p) => p.id));
        categories.topInsights.push(...promote.map((p) => ({ ...p, category: 'topInsights' })));
        categories.discussion = categories.discussion.filter((r) => !promoteIds.has(r.id));
      }

      // 5. Build Media Gallery & Deduplicated Shared Links Catalog
      const mediaGallery = buildMediaGallery(annotatedThread, qaExchanges, scoredReplies);
      const sharedLinks = buildSharedLinks(annotatedThread, qaExchanges, scoredReplies);

      // 6. Extract Topics, Hashtags, Mentions, Top Contributors
      const topics = extractTopics(annotatedThread, qaExchanges, scoredReplies, authorHandleLower);

      // 7. Compute Meta & Reading Stats
      const rootTweet = annotatedThread[0] || focusedTweet;
      const smartTitle = generateSmartTitle(rootTweet, topics.keywords);

      const allIncludedPosts = [
        ...ancestors,
        ...annotatedThread,
        ...qaExchanges.flatMap((q) => [q.question, ...q.answers]),
        ...scoredReplies
      ];

      const totalWords = allIncludedPosts.reduce(
        (sum, t) => sum + countWords(t.text) + countWords(t.quotedTweet?.text || ''),
        0
      );
      const threadWords = annotatedThread.reduce(
        (sum, t) => sum + countWords(t.text),
        0
      );
      const readingTimeMin = Math.max(1, Math.ceil(totalWords / 210));

      let totalLikes = 0;
      let totalRetweets = 0;
      let totalViews = 0;
      let videoCount = 0;
      for (const t of annotatedThread) {
        totalLikes += t.likes || 0;
        totalRetweets += t.retweets || 0;
        totalViews = Math.max(totalViews, t.views || 0);
      }
      for (const t of allIncludedPosts) {
        videoCount += (t.videos?.length || 0);
      }

      const meta = {
        title: smartTitle,
        authorName: rootTweet.displayName || 'Unknown Author',
        authorHandle: rootTweet.handle || '',
        authorProfileUrl: rootTweet.profileUrl || '',
        authorAvatarUrl: rootTweet.avatarUrl || '',
        authorVerified: Boolean(rootTweet.isVerified),
        sourceUrl: sourceUrl || rootTweet.url || '',
        rootTweetId: rootTweet.statusId || targetTweetId || '',
        publishedAt: rootTweet.timestamp || '',
        capturedAt: options.capturedAt || new Date().toISOString(),
        readingTimeMin,
        wordCount: totalWords,
        threadWordCount: threadWords,
        totalPosts: allIncludedPosts.length,
        threadLength: annotatedThread.length,
        replyCount: scoredReplies.length - categories.shortReactions.length + qaExchanges.length,
        noiseCount: categories.shortReactions.length,
        qaCount: qaExchanges.length,
        imageCount: mediaGallery.length,
        videoCount,
        linkCount: sharedLinks.length,
        totalLikes,
        totalRetweets,
        totalViews,
        captureMode
      };

      // 8. Extractive Executive Summary & Key Takeaways
      const summary = buildExtractiveSummary(annotatedThread, qaExchanges, categories, sharedLinks, sentimentCounts);

      return {
        meta,
        ancestors,
        authorThread: annotatedThread,
        qaExchanges,
        categories,
        allCommunityReplies: scoredReplies,
        mediaGallery,
        sharedLinks,
        topics,
        summary
      };
    },

    /**
     * Optional BYOK AI Enhancement using Google Gemini API (or compatible endpoint).
     * Never required — enhances the local intelligence with an AI executive summary,
     * thematic reply synthesis, and an edited article view.
     */
    async enhanceWithAI(organized, config = {}) {
      const apiKey = (config.apiKey || '').trim();
      if (!apiKey) {
        throw new Error('Please enter a Gemini API key in AI Settings.');
      }
      const model = (config.model || 'gemini-2.5-flash').trim();

      // Build compact context prompt within token budget
      const threadText = organized.authorThread
        .map((t) => `[Part ${t.partIndex}] ${t.text}`)
        .join('\n\n')
        .slice(0, 22000);

      const qaText = organized.qaExchanges
        .slice(0, 15)
        .map((qa) => `Q (${qa.question.handle}): ${qa.question.text}\nA (${organized.meta.authorHandle}): ${qa.answers.map((a) => a.text).join(' ')}`)
        .join('\n\n')
        .slice(0, 8000);

      const topRepliesText = [
        ...organized.categories.topInsights,
        ...organized.categories.resources,
        ...organized.categories.questions
      ]
        .slice(0, 25)
        .map((r) => `${r.handle} (${r.likes} likes): ${r.text}`)
        .join('\n')
        .slice(0, 8000);

      const prompt = `You are an expert editor and knowledge synthesizer. Analyze this X/Twitter thread and community discussion, and return a JSON object with this exact schema:
{
  "smartTitle": "Crisp, clear, engaging title (max 85 chars)",
  "executiveSummary": "2-4 sentence clear overview of what this thread teaches or argues",
  "keyTakeaways": ["4 to 6 concise, high-signal bullet takeaways"],
  "replyThemes": [
    { "theme": "Short theme name", "summary": "What the community added, debated, or asked about this theme" }
  ],
  "cleanedArticle": "A well-structured Markdown article weaving the author's thread points into clean prose with subheadings (do not invent facts not in the thread)"
}

AUTHOR: ${organized.meta.authorName} (${organized.meta.authorHandle})

=== AUTHOR THREAD ===
${threadText}

=== AUTHOR Q&A ===
${qaText || '(none)'}

=== TOP COMMUNITY REPLIES ===
${topRepliesText || '(none)'}`;

      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            responseMimeType: 'application/json'
          }
        })
      });

      if (!resp.ok) {
        const errBody = await resp.text().catch(() => '');
        throw new Error(`Gemini API error (${resp.status}): ${errBody.slice(0, 180)}`);
      }

      const data = await resp.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) {
        throw new Error('Empty response from Gemini API.');
      }

      let parsed;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        // Attempt to extract JSON block if wrapped in markdown fences
        const match = rawText.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('Could not parse AI JSON response.');
        parsed = JSON.parse(match[0]);
      }

      const aiEnhanced = {
        model,
        generatedAt: new Date().toISOString(),
        smartTitle: parsed.smartTitle || organized.meta.title,
        executiveSummary: parsed.executiveSummary || '',
        keyTakeaways: Array.isArray(parsed.keyTakeaways) ? parsed.keyTakeaways : [],
        replyThemes: Array.isArray(parsed.replyThemes) ? parsed.replyThemes : [],
        cleanedArticle: parsed.cleanedArticle || ''
      };

      organized.summary.aiEnhanced = aiEnhanced;
      if (aiEnhanced.smartTitle) {
        organized.meta.title = aiEnhanced.smartTitle;
      }

      return aiEnhanced;
    }
  };

  // --- Helpers ---

  function normalizeTweet(t, idx) {
    return {
      id: t.id || `tweet_${idx}`,
      statusId: t.statusId || '',
      url: t.url || '',
      displayName: t.displayName || 'Unknown',
      handle: t.handle || '',
      isVerified: Boolean(t.isVerified),
      profileUrl: t.profileUrl || '',
      avatarUrl: t.avatarUrl || '',
      text: (t.text || '').trim(),
      timestamp: t.timestamp || '',
      displayTime: t.displayTime || '',
      replyingTo: Array.isArray(t.replyingTo) ? t.replyingTo : [],
      images: Array.isArray(t.images) ? t.images : [],
      videos: Array.isArray(t.videos) ? t.videos : [],
      links: Array.isArray(t.links) ? t.links : [],
      hashtags: Array.isArray(t.hashtags) ? t.hashtags : [],
      mentions: Array.isArray(t.mentions) ? t.mentions : [],
      card: t.card || null,
      poll: t.poll || null,
      quotedTweet: t.quotedTweet || null,
      likes: Number(t.likes) || 0,
      retweets: Number(t.retweets) || 0,
      replies: Number(t.replies) || 0,
      bookmarks: Number(t.bookmarks) || 0,
      views: Number(t.views) || 0,
      isFocused: Boolean(t.isFocused),
      hasConnectorAbove: Boolean(t.hasConnectorAbove),
      hasConnectorBelow: Boolean(t.hasConnectorBelow),
      domOrder: t.domOrder ?? idx
    };
  }

  function findFocusedIndex(tweets, targetTweetId) {
    if (targetTweetId) {
      const idx = tweets.findIndex((t) => t.statusId === targetTweetId || t.id === targetTweetId);
      if (idx !== -1) return idx;
    }
    const focusedIdx = tweets.findIndex((t) => t.isFocused);
    return focusedIdx !== -1 ? focusedIdx : 0;
  }

  function cleanThreadNumbering(text) {
    if (!text) return '';
    return text
      .replace(/^\s*(?:\d+\s*\/\s*\d*|\(\d+\/\d+\)|\[\d+\/\d+\])\s*[:.)-]*\s*/, '')
      .replace(/\s*(?:🧵|👇|⬇️)+\s*$/, '')
      .trim();
  }

  function detectChapterTitle(text, index, total) {
    if (!text) return index === 0 ? 'Opening Post' : `Part ${index + 1}`;
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return index === 0 ? 'Opening Post' : `Part ${index + 1}`;

    const firstLine = cleanThreadNumbering(lines[0])
      .replace(/https?:\/\/\S+/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // If first line is a concise heading or numbered point
    if (lines.length >= 2 && firstLine.length >= 4 && firstLine.length <= 78) {
      return firstLine.replace(/[:\-–—]+$/, '').trim();
    }

    // Extract first sentence if short enough
    const sentenceMatch = firstLine.match(/^(.{10,72}?)(?:[.!?](?:\s|$)|$)/);
    if (sentenceMatch) {
      const candidate = sentenceMatch[1].trim();
      return candidate.length >= 70 ? candidate.slice(0, 67) + '…' : candidate;
    }

    return index === 0 ? 'Opening Post' : `Part ${index + 1} of ${total}`;
  }

  function generateSmartTitle(rootTweet, keywords) {
    const raw = (rootTweet?.text || '').trim();
    if (!raw) {
      return rootTweet?.handle
        ? `Thread by ${rootTweet.displayName} (${rootTweet.handle})`
        : 'Saved X Thread';
    }

    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    let candidate = cleanThreadNumbering(lines[0] || raw)
      .replace(/https?:\/\/\S+/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (candidate.length < 15 && lines.length > 1) {
      candidate = `${candidate} — ${cleanThreadNumbering(lines[1]).replace(/https?:\/\/\S+/g, '').trim()}`;
    }

    if (candidate.length > 92) {
      const sentence = candidate.match(/^(.{20,90}?)[.!?](?:\s|$)/);
      candidate = sentence ? sentence[1] : candidate.slice(0, 88).replace(/\s+\S*$/, '') + '…';
    }

    if (!candidate && keywords.length > 0) {
      return `Thread on ${keywords.slice(0, 3).join(', ')}`;
    }
    return candidate || `Thread by ${rootTweet.displayName}`;
  }

  function detectNoise(t) {
    const text = (t.text || '').trim();
    const hasMedia = (t.images?.length || 0) > 0 || (t.videos?.length || 0) > 0;
    const hasLinks = getExternalLinks(t).length > 0;
    const hasQuote = Boolean(t.quotedTweet);
    if (hasMedia || hasLinks || hasQuote) return false;
    if (t.likes >= 5 || t.replies >= 2) return false;

    for (const pattern of NOISE_PATTERNS) {
      if (pattern.test(text)) return true;
    }

    // Pure emoji / punctuation or ultra-short text with zero engagement
    const stripped = text.replace(/[@#]\w+/g, '').replace(/[^\p{L}\p{N}]/gu, '');
    if (stripped.length <= 12 && t.likes < 3) return true;

    return false;
  }

  function computeQualityScore(t, isNoise) {
    if (isNoise) return 1;
    let score = 0;

    // Text richness (sweet spot 80 - 600 chars)
    const len = (t.text || '').length;
    if (len >= 40) score += 10;
    if (len >= 120) score += 14;
    if (len >= 260) score += 10;

    // Engagement signal (log-scaled so viral replies stand out without crushing good niche ones)
    score += Math.min(35, Math.round(Math.log10((t.likes || 0) + 1) * 14));
    score += Math.min(12, Math.round(Math.log10((t.retweets || 0) + 1) * 8));
    score += Math.min(10, Math.round(Math.log10((t.replies || 0) + 1) * 7));

    // Media, Links, Quoted context
    if ((t.images?.length || 0) > 0) score += 12;
    if (getExternalLinks(t).length > 0) score += 14;
    if (t.quotedTweet) score += 8;

    return Math.round(score);
  }

  function detectQuestion(text) {
    if (!text) return false;
    if (text.includes('?')) return true;
    return /\b(how do|how can|what is|what are|why does|could you|can you|anyone know|does anyone|is there a|where can i)\b/i.test(text);
  }

  function detectSentiment(text) {
    if (!text) return 'neutral';
    const lower = text.toLowerCase();
    if (detectQuestion(lower)) return 'questioning';

    let pos = 0;
    let neg = 0;
    for (const w of POSITIVE_WORDS) {
      if (lower.includes(w)) pos++;
    }
    for (const w of CRITICAL_WORDS) {
      if (lower.includes(w)) neg++;
    }
    if (neg > pos && neg > 0) return 'critical';
    if (pos > neg && pos > 0) return 'positive';
    return 'neutral';
  }

  function getExternalLinks(t) {
    const out = [];
    const seen = new Set();
    const candidates = [...(t.links || [])];
    if (t.card && t.card.url) {
      candidates.push({ url: t.card.url, display: t.card.title || t.card.domain || t.card.url });
    }
    for (const l of candidates) {
      if (!l || !l.url) continue;
      if (/^https?:\/\/(x\.com|twitter\.com)\//i.test(l.url)) continue;
      if (seen.has(l.url)) continue;
      seen.add(l.url);
      out.push(l);
    }
    return out;
  }

  function buildMediaGallery(authorThread, qaExchanges, replies) {
    const gallery = [];
    const seen = new Set();
    let idx = 1;

    const pushImg = (img, tweet, sourceType, partIndex = null) => {
      if (!img || !img.url) return;
      const key = img.url.split('?')[0];
      if (seen.has(key)) return;
      seen.add(key);

      gallery.push({
        id: `img_${String(idx++).padStart(3, '0')}`,
        url: img.url,
        origUrl: img.origUrl || img.url,
        alt: img.alt || '',
        width: img.width || 0,
        height: img.height || 0,
        authorName: tweet.displayName || '',
        authorHandle: tweet.handle || '',
        context: truncate(tweet.text || img.alt || '', 110),
        tweetUrl: tweet.url || '',
        sourceType,
        partIndex
      });
    };

    for (const t of authorThread) {
      for (const img of t.images || []) pushImg(img, t, 'thread', t.partIndex);
      if (t.quotedTweet) {
        for (const img of t.quotedTweet.images || []) pushImg(img, t.quotedTweet, 'quote', t.partIndex);
      }
      if (t.card && t.card.imageUrl) {
        pushImg({ url: t.card.imageUrl, alt: t.card.title || '' }, t, 'card', t.partIndex);
      }
    }

    for (const qa of qaExchanges) {
      for (const img of qa.question.images || []) pushImg(img, qa.question, 'qa');
      for (const ans of qa.answers) {
        for (const img of ans.images || []) pushImg(img, ans, 'qa');
      }
    }

    for (const r of replies) {
      for (const img of r.images || []) pushImg(img, r, 'reply');
      if (r.quotedTweet) {
        for (const img of r.quotedTweet.images || []) pushImg(img, r.quotedTweet, 'quote');
      }
    }

    return gallery;
  }

  function buildSharedLinks(authorThread, qaExchanges, replies) {
    const map = new Map();

    const addFromTweet = (t, sourceType) => {
      const links = getExternalLinks(t);
      for (const l of links) {
        if (!map.has(l.url)) {
          let domain = '';
          try {
            domain = new URL(l.url).hostname.replace(/^www\./, '');
          } catch {
            domain = l.display || '';
          }
          map.set(l.url, {
            url: l.url,
            domain,
            title: (t.card && t.card.url === l.url && t.card.title) ? t.card.title : (l.display || l.url),
            sharedByName: t.displayName || '',
            sharedByHandle: t.handle || '',
            context: truncate(t.text || '', 130),
            tweetUrl: t.url || '',
            sourceType
          });
        }
      }
    };

    for (const t of authorThread) addFromTweet(t, 'thread');
    for (const qa of qaExchanges) {
      addFromTweet(qa.question, 'qa');
      for (const ans of qa.answers) addFromTweet(ans, 'qa');
    }
    for (const r of replies) addFromTweet(r, 'reply');

    return Array.from(map.values());
  }

  function extractTopics(authorThread, qaExchanges, replies, authorHandleLower) {
    const wordFreq = new Map();
    const hashtagFreq = new Map();
    const mentionFreq = new Map();
    const contributorScore = new Map();

    const processText = (text, weight = 1) => {
      if (!text) return;
      const cleaned = text.replace(/https?:\/\/\S+/g, ' ').replace(/[@#]\w+/g, ' ');
      const words = cleaned.toLowerCase().match(/[a-z][a-z0-9'-]{2,}/g) || [];
      for (const w of words) {
        const clean = w.replace(/^'+|'+$/g, '');
        if (clean.length < 3 || STOP_WORDS.has(clean)) continue;
        wordFreq.set(clean, (wordFreq.get(clean) || 0) + weight);
      }
    };

    const collectEntities = (t, weight = 1) => {
      processText(t.text, weight);
      for (const h of t.hashtags || []) {
        const key = h.toLowerCase();
        hashtagFreq.set(key, (hashtagFreq.get(key) || 0) + 1);
      }
      for (const m of t.mentions || []) {
        const key = m.toLowerCase();
        if (key !== authorHandleLower) {
          mentionFreq.set(key, (mentionFreq.get(key) || 0) + 1);
        }
      }
    };

    for (const t of authorThread) collectEntities(t, 2.5);
    for (const qa of qaExchanges) {
      collectEntities(qa.question, 1.5);
      for (const ans of qa.answers) collectEntities(ans, 2);
    }
    for (const r of replies) {
      if (!r.isNoise) {
        collectEntities(r, 1);
        if (r.handle) {
          const prev = contributorScore.get(r.handle) || {
            handle: r.handle,
            displayName: r.displayName,
            replies: 0,
            likes: 0,
            score: 0
          };
          prev.replies += 1;
          prev.likes += r.likes || 0;
          prev.score += r.qualityScore || 0;
          contributorScore.set(r.handle, prev);
        }
      }
    }

    const keywords = Array.from(wordFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);

    const hashtags = Array.from(hashtagFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([tag, count]) => ({ tag, count }));

    const mentions = Array.from(mentionFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([handle, count]) => ({ handle, count }));

    const topContributors = Array.from(contributorScore.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    return { keywords, hashtags, mentions, topContributors };
  }

  function buildExtractiveSummary(authorThread, qaExchanges, categories, sharedLinks, sentimentBreakdown) {
    const keyPoints = [];
    const seen = new Set();

    const addPoint = (text) => {
      const cleaned = cleanThreadNumbering(text || '')
        .replace(/https?:\/\/\S+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!cleaned || cleaned.length < 18) return;
      const snippet = cleaned.length > 175 ? cleaned.slice(0, 172).replace(/\s+\S*$/, '') + '…' : cleaned;
      const sig = snippet.slice(0, 40).toLowerCase();
      if (seen.has(sig)) return;
      seen.add(sig);
      keyPoints.push(snippet);
    };

    // Take crisp takeaways from author thread posts (up to 5)
    if (authorThread.length === 1) {
      const sentences = (authorThread[0].text || '').split(/(?<=[.!?])\s+/).filter((s) => s.length > 20);
      for (const s of sentences.slice(0, 3)) addPoint(s);
    } else {
      for (const t of authorThread.slice(0, 6)) {
        const firstParagraph = (t.text || '').split('\n').map((l) => l.trim()).find((l) => l.length > 15);
        addPoint(firstParagraph || t.text);
        if (keyPoints.length >= 5) break;
      }
    }

    // Add notable community insight highlight if available
    if (categories.topInsights.length > 0) {
      const top = categories.topInsights[0];
      addPoint(`Top community reply (${top.handle}): ${top.text}`);
    }

    if (qaExchanges.length > 0) {
      keyPoints.push(`Includes ${qaExchanges.length} direct Q&A exchange${qaExchanges.length > 1 ? 's' : ''} answered by the author.`);
    }

    if (sharedLinks.length > 0) {
      keyPoints.push(`Contains ${sharedLinks.length} unique external link${sharedLinks.length > 1 ? 's' : ''} / resource${sharedLinks.length > 1 ? 's' : ''}.`);
    }

    const headline = authorThread[0]
      ? truncate(cleanThreadNumbering(authorThread[0].text), 220)
      : '';

    return {
      headline,
      keyPoints,
      sentimentBreakdown,
      aiEnhanced: null
    };
  }

  function createEmptyOrganization(sourceUrl, captureMode) {
    return {
      meta: {
        title: 'Empty Export',
        authorName: '',
        authorHandle: '',
        authorProfileUrl: '',
        authorAvatarUrl: '',
        authorVerified: false,
        sourceUrl,
        rootTweetId: '',
        publishedAt: '',
        capturedAt: new Date().toISOString(),
        readingTimeMin: 0,
        wordCount: 0,
        threadWordCount: 0,
        totalPosts: 0,
        threadLength: 0,
        replyCount: 0,
        noiseCount: 0,
        qaCount: 0,
        imageCount: 0,
        videoCount: 0,
        linkCount: 0,
        totalLikes: 0,
        totalRetweets: 0,
        totalViews: 0,
        captureMode
      },
      ancestors: [],
      authorThread: [],
      qaExchanges: [],
      categories: {
        topInsights: [],
        questions: [],
        resources: [],
        mediaReplies: [],
        discussion: [],
        shortReactions: []
      },
      allCommunityReplies: [],
      mediaGallery: [],
      sharedLinks: [],
      topics: { keywords: [], hashtags: [], mentions: [], topContributors: [] },
      summary: {
        headline: '',
        keyPoints: [],
        sentimentBreakdown: { positive: 0, questioning: 0, critical: 0, neutral: 0 },
        aiEnhanced: null
      }
    };
  }

  function countWords(str) {
    if (!str) return 0;
    return str.trim().split(/\s+/).filter(Boolean).length;
  }

  function truncate(str, maxLen) {
    if (!str) return '';
    const clean = str.replace(/\s+/g, ' ').trim();
    return clean.length > maxLen ? clean.slice(0, maxLen - 1) + '…' : clean;
  }

  function extractStatusId(url) {
    if (!url) return null;
    const m = url.match(/status\/(\d+)/);
    return m ? m[1] : null;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ThreadIntelligence;
  } else {
    root.ThreadIntelligence = ThreadIntelligence;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
