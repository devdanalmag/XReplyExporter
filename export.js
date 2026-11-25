// ============================================
// TwReplyExport Pro — Unified Export Engine
// Supports:
//   - DOCX (.docx) with natively embedded images
//   - Markdown Bundle (.zip: organized thread.md + images/)
//   - Standalone Markdown (.md)
//   - Self-Contained Offline HTML Reader (.html w/ base64 images)
//   - Structured JSON (.json)
//   - Enhanced CSV (.csv)
//   - Multi-Sheet Excel (.xlsx)
// ============================================

    (function (root) {
      const imageCache = new Map(); // normalizedUrl -> { bytes: Uint8Array, mimeType, dataUrl, ext }

      const ExportUtils = {
        /**
         * Fetch and cache all images referenced by an organized thread.
         * Ensures Word-safe formats (converts WebP to PNG when running in browser).
         */
        async fetchAllImages(organized, options = {}) {
          const onProgress = options.onProgress || (() => { });
          const forDocx = Boolean(options.forDocx);
          const urls = collectAllImageUrls(organized, options.includeNoise);
          const total = urls.length;
          const results = new Map();

          if (total === 0) return results;

          let completed = 0;
          const CONCURRENCY = 4;
          let cursor = 0;

          const worker = async () => {
            while (cursor < urls.length) {
              const url = urls[cursor++];
              try {
                const asset = await fetchSingleImage(url, forDocx);
                if (asset) {
                  results.set(url, asset);
                }
              } catch (err) {
                console.warn('TwReplyExport Pro: Failed to fetch image', url, err.message);
              } finally {
                completed++;
                onProgress(completed, total);
              }
            }
          };

              const workers = [];
              for (let i = 0; i < Math.min(CONCURRENCY, urls.length); i++) {
                workers.push(worker());
              }
            await Promise.all(workers);
            return results;
          },

    /**
     * Build a Microsoft Word (.docx) binary with embedded images & rich organization.
     */
    async toDOCX(organized, options = {}) {
            const { DocxBuilder } = root.ZipDocx;
            const includeMetrics = options.includeMetrics !== false;
            const includeNoise = Boolean(options.includeNoise);
            const embedImages = options.embedImages !== false;

          const imageMap = embedImages
            ? await this.fetchAllImages(organized, {
              forDocx: true,
              includeNoise,
              onProgress: options.onProgress
            })
            : new Map();

            const m = organized.meta;
            const doc = new DocxBuilder(m);

            // Header
            doc.addTitle(m.title);
            const authorLine = `By ${m.authorName} (${m.authorHandle})${m.authorVerified ? ' ✓' : ''}  •  ${formatDate(m.publishedAt)}  •  ${m.readingTimeMin} min read`;
            doc.addParagraph(authorLine, { color: '475569', size: 20, spaceBefore: 0, spaceAfter: 80 });
            if (m.sourceUrl) {
              doc.addLinkParagraph('Original Thread', m.sourceUrl);
            }

                // Overview Stats Table
                const statsHeaders = ['Author Posts', 'Community Replies', 'Author Q&A', 'Images', 'Shared Links', 'Words'];
                const statsRow = [
                  String(m.threadLength),
                  String(m.replyCount),
                  String(m.qaCount),
                  String(m.imageCount),
                  String(m.linkCount),
                  String(m.wordCount)
                ];
                doc.addTable(statsHeaders, [statsRow]);

                if(includeMetrics && (m.totalLikes || m.totalRetweets || m.totalViews)) {
                  doc.addParagraph(
                    `Thread Engagement:  ${formatNumber(m.totalLikes)} Likes  •  ${formatNumber(m.totalRetweets)} Reposts  •  ${formatNumber(m.totalViews)} Views`,
                    { color: '64748B', size: 18, spaceBefore: 0, spaceAfter: 120 }
                  );
      }

      // Executive Summary & Key Takeaways
      const ai = organized.summary.aiEnhanced;
      if (ai && ai.executiveSummary) {
        doc.addHeading('Executive Summary (AI-Enhanced)', 1);
        doc.addCalloutBox('Overview', ai.executiveSummary, '7C3AED', 'F5F3FF');
        if (ai.keyTakeaways.length > 0) {
          doc.addHeading('Key Takeaways', 2);
          for (const kp of ai.keyTakeaways) doc.addBullet(kp);
        }
      } else if (organized.summary.keyPoints.length > 0) {
        doc.addHeading('Executive Summary & Key Takeaways', 1);
        for (const kp of organized.summary.keyPoints) doc.addBullet(kp);
      }

      if (organized.topics.keywords.length > 0) {
        doc.addParagraph(`Key Topics: ${organized.topics.keywords.join('  •  ')}`, {
          color: '475569',
          italic: true,
          size: 19,
          spaceBefore: 60,
          spaceAfter: 120
        });
      }

      // Helper to render a tweet block into DOCX
      const appendTweetToDoc = (t, headingLabel = null, indentLeft = 0) => {
        if (headingLabel) {
          doc.addHeading(headingLabel, 2);
        } else {
          const headerText = `${t.displayName} (${t.handle})${t.isVerified ? ' ✓' : ''}  •  ${formatDate(t.timestamp)}`;
          doc.addParagraph(headerText, { bold: true, color: '0F172A', size: 20, indentLeft, spaceBefore: 120, spaceAfter: 40 });
        }

        if (t.text) {
          doc.addParagraph(t.text, { size: 21, color: '1E293B', indentLeft, spaceBefore: 20, spaceAfter: 80 });
        }

        // Embedded Images
        for (const img of t.images || []) {
          const asset = imageMap.get(img.url);
          if (asset && asset.bytes) {
            doc.addImage(asset.bytes, asset.mimeType, img.alt || '', img.width, img.height);
          } else {
            doc.addLinkParagraph(img.alt ? `Image (${img.alt})` : 'Image', img.url);
          }
        }

        // Video thumbnails
        for (const vid of t.videos || []) {
          if (vid.posterUrl && imageMap.has(vid.posterUrl)) {
            const asset = imageMap.get(vid.posterUrl);
            doc.addImage(asset.bytes, asset.mimeType, `[${vid.type.toUpperCase()} preview — view original post to play]`);
          } else {
            doc.addParagraph(`[Attached ${vid.type.toUpperCase()} — view on X: ${t.url || m.sourceUrl}]`, {
              italic: true, color: '64748B', size: 18, indentLeft
            });
          }
        }

        // Quoted Tweet Callout
        if (t.quotedTweet) {
          const qt = t.quotedTweet;
          const qTitle = `Quoted Post — ${qt.displayName || 'User'} (${qt.handle || ''})`;
          doc.addCalloutBox(qTitle, qt.text || '(media post)', '94A3B8', 'F8FAFC');
          for (const qImg of qt.images || []) {
            const asset = imageMap.get(qImg.url);
            if (asset && asset.bytes) {
              doc.addImage(asset.bytes, asset.mimeType, qImg.alt || 'Quoted image', qImg.width, qImg.height);
            }
          }
        }

        // Link Card
        if (t.card && (t.card.title || t.card.url)) {
          const cardBody = [t.card.description, t.card.url].filter(Boolean).join('\n');
          doc.addCalloutBox(`Link Card: ${t.card.title || t.card.domain}`, cardBody, '0EA5E9', 'F0F9FF');
        }

        // Poll
        if (t.poll && t.poll.options?.length > 0) {
          doc.addCalloutBox('Poll', t.poll.options.map((o, i) => `${i + 1}. ${o}`).join('\n'), 'F59E0B', 'FFFBEB');
        }

        if (includeMetrics) {
          const metricBits = [];
          if (t.likes) metricBits.push(`${formatNumber(t.likes)} Likes`);
          if (t.retweets) metricBits.push(`${formatNumber(t.retweets)} Reposts`);
          if (t.replies) metricBits.push(`${formatNumber(t.replies)} Replies`);
          if (t.views) metricBits.push(`${formatNumber(t.views)} Views`);
          if (metricBits.length > 0) {
            doc.addParagraph(metricBits.join('  ·  '), { color: '64748B', size: 17, indentLeft, spaceBefore: 0, spaceAfter: 80 });
          }
        }
      };

        // Ancestor context if any
        if (organized.ancestors.length > 0) {
          doc.addHeading('Conversation Context (Parent Posts)', 1);
          for (const anc of organized.ancestors) {
            appendTweetToDoc(anc, null, 200);
          }
        }

          // Author Thread
          if (organized.authorThread.length > 0) {
            doc.addHeading(`Complete Author Thread (${organized.authorThread.length} ${organized.authorThread.length === 1 ? 'Post' : 'Posts'})`, 1);
            for (const t of organized.authorThread) {
              const label = organized.authorThread.length > 1
                ? `Part ${t.partIndex}/${t.partTotal}: ${t.chapterTitle}`
                : null;
              appendTweetToDoc(t, label, 0);
              doc.addDivider();
            }
          }

        // Author Q&A Exchanges
        if (organized.qaExchanges.length > 0) {
          doc.addHeading(`Author Q&A & Follow-Ups (${organized.qaExchanges.length})`, 1);
          for (const qa of organized.qaExchanges) {
            appendTweetToDoc(qa.question, null, 0);
            for (const ans of qa.answers) {
              doc.addParagraph(`↳ Author Reply (${ans.handle})`, { bold: true, color: '1D4ED8', size: 19, indentLeft: 360, spaceBefore: 40, spaceAfter: 20 });
              appendTweetToDoc(ans, null, 360);
            }
            doc.addDivider();
          }
        }

      // AI Reply Themes if available
      if (ai && ai.replyThemes?.length > 0) {
        doc.addHeading('Community Discussion Themes (AI Synthesis)', 1);
        for (const th of ai.replyThemes) {
          doc.addCalloutBox(th.theme, th.summary, '10B981', 'ECFDF5');
        }
      }

        // Top Insights
        if (organized.categories.topInsights.length > 0) {
          doc.addHeading(`Top Community Insights (${organized.categories.topInsights.length})`, 1);
          for (const r of organized.categories.topInsights) {
            appendTweetToDoc(r, null, 0);
            doc.addDivider();
          }
        }

        // Replies with Shared Resources
        if (organized.categories.resources.length > 0) {
          doc.addHeading(`Community Shared Resources (${organized.categories.resources.length})`, 1);
          for (const r of organized.categories.resources) {
            appendTweetToDoc(r, null, 0);
            doc.addDivider();
          }
        }

        // Community Questions
        if (organized.categories.questions.length > 0) {
          doc.addHeading(`Community Questions (${organized.categories.questions.length})`, 1);
          for (const r of organized.categories.questions) {
            appendTweetToDoc(r, null, 0);
          }
        }

            // Media Replies
            if(organized.categories.mediaReplies.length > 0) {
              doc.addHeading(`Visual Replies (${organized.categories.mediaReplies.length})`, 1);
    for (const r of organized.categories.mediaReplies) {
      appendTweetToDoc(r, null, 0);
      doc.addDivider();
    }
  }

      // Remaining Discussion
      if(organized.categories.discussion.length > 0) {
    doc.addHeading(`Additional Discussion (${organized.categories.discussion.length})`, 1);
for (const r of organized.categories.discussion) {
  appendTweetToDoc(r, null, 0);
}
      }

// Optional Short Reactions
if (includeNoise && organized.categories.shortReactions.length > 0) {
  doc.addHeading(`Short Reactions (${organized.categories.shortReactions.length})`, 1);
  for (const r of organized.categories.shortReactions) {
    doc.addParagraph(`${r.displayName} (${r.handle}): ${r.text}`, { size: 19, color: '64748B', spaceBefore: 20, spaceAfter: 40 });
  }
}

// Shared Links Reference Table
if (organized.sharedLinks.length > 0) {
  doc.addHeading(`Shared Links & Resources Index (${organized.sharedLinks.length})`, 1);
  const rows = organized.sharedLinks.map((l) => [
    l.title || l.domain,
    l.sharedByHandle || '-',
    l.url
  ]);
  doc.addTable(['Resource', 'Shared By', 'URL'], rows);
}

return doc.build();
    },

/**
 * Build Organized Markdown string (uses either remote image URLs or local ./images/ mapping).
 */
toMarkdown(organized, options = {}) {
  const includeMetrics = options.includeMetrics !== false;
  const includeNoise = Boolean(options.includeNoise);
  const localImagePaths = options.localImagePaths || null; // Map(remoteUrl -> './images/img_001.jpg')
  const m = organized.meta;
  const ai = organized.summary.aiEnhanced;

  const resolveImg = (url) => (localImagePaths && localImagePaths.has(url) ? localImagePaths.get(url) : url);

  const lines = [];

  // YAML Frontmatter (Obsidian / Notion / Hugo / Jekyll ready)
  lines.push('---');
  lines.push(`title: "${escapeYaml(m.title)}"`);
  lines.push(`author: "${escapeYaml(m.authorName)}"`);
  lines.push(`handle: "${escapeYaml(m.authorHandle)}"`);
  lines.push(`source: "${escapeYaml(m.sourceUrl)}"`);
  lines.push(`published: "${m.publishedAt || ''}"`);
  lines.push(`saved_at: "${m.capturedAt}"`);
  lines.push(`reading_time: "${m.readingTimeMin} min"`);
  lines.push(`thread_posts: ${m.threadLength}`);
  lines.push(`replies: ${m.replyCount}`);
  lines.push(`images: ${m.imageCount}`);
  if (organized.topics.keywords.length > 0) {
    lines.push(`tags: [${organized.topics.keywords.map((k) => `"${escapeYaml(k)}"`).join(', ')}]`);
  }
  lines.push('---');
  lines.push('');

  // Title & Metadata Banner
  lines.push(`# ${m.title}`);
  lines.push('');
  lines.push(`> **Author:** ${m.authorName} ([${m.authorHandle}](${m.authorProfileUrl || m.sourceUrl}))${m.authorVerified ? ' ✓' : ''}  `);
  lines.push(`> **Date:** ${formatDate(m.publishedAt)} · **Reading Time:** ~${m.readingTimeMin} min · **Posts:** ${m.threadLength} thread / ${m.replyCount} replies · **Images:** ${m.imageCount}  `);
  if (m.sourceUrl) {
    lines.push(`> **Original Link:** ${m.sourceUrl}`);
  }
  lines.push('');

  // Table of Contents
  lines.push('## Table of Contents');
  lines.push('');
  lines.push('- [Executive Summary & Key Takeaways](#executive-summary--key-takeaways)');
  if (organized.authorThread.length > 0) {
    lines.push(`- [Complete Author Thread (${organized.authorThread.length})](#complete-author-thread)`);
  }
  if (organized.qaExchanges.length > 0) {
    lines.push(`- [Author Q&A & Follow-Ups (${organized.qaExchanges.length})](#author-qa--follow-ups)`);
  }
  if (organized.categories.topInsights.length > 0) {
    lines.push(`- [Top Community Insights (${organized.categories.topInsights.length})](#top-community-insights)`);
  }
  if (organized.categories.resources.length > 0) {
    lines.push(`- [Shared Resources & Links (${organized.categories.resources.length})](#shared-resources--links)`);
  }
  if (organized.categories.questions.length > 0) {
    lines.push(`- [Community Questions (${organized.categories.questions.length})](#community-questions)`);
  }
  if (organized.categories.mediaReplies.length > 0) {
    lines.push(`- [Visual Replies (${organized.categories.mediaReplies.length})](#visual-replies)`);
  }
  if (organized.sharedLinks.length > 0) {
    lines.push(`- [All Extracted Links (${organized.sharedLinks.length})](#all-extracted-links)`);
  }
  lines.push('');

  // Summary
  lines.push('## Executive Summary & Key Takeaways');
  lines.push('');
  if (ai && ai.executiveSummary) {
    lines.push(ai.executiveSummary);
    lines.push('');
    for (const kp of ai.keyTakeaways || []) lines.push(`- ${kp}`);
  } else {
    for (const kp of organized.summary.keyPoints) lines.push(`- ${kp}`);
  }
  if (organized.topics.keywords.length > 0) {
    lines.push('');
    lines.push(`**Topics:** ${organized.topics.keywords.map((k) => `\`${k}\``).join(' ')}`);
  }
  lines.push('');

  // Optional AI Cleaned Article
  if (ai && ai.cleanedArticle) {
    lines.push('## Edited Article View (AI)');
    lines.push('');
    lines.push(ai.cleanedArticle);
    lines.push('');
  }

  // Helper to render one tweet in Markdown
  const renderTweetMd = (t, heading = null, prefix = '') => {
    if (heading) {
      lines.push(`### ${heading}`);
      lines.push('');
    } else {
      const authorHdr = `**${t.displayName}** (${t.handle})${t.isVerified ? ' ✓' : ''} · *${formatDate(t.timestamp)}*${t.url ? ` · [link](${t.url})` : ''}`;
      lines.push(`${prefix}${authorHdr}`);
      lines.push(`${prefix}`);
    }

    if (t.text) {
      for (const line of t.text.split('\n')) {
        lines.push(`${prefix}${line}`);
      }
      lines.push('');
    }

    // Images
    for (const img of t.images || []) {
      const alt = (img.alt || 'Tweet Image').replace(/[\[\]]/g, '');
      lines.push(`${prefix}![${alt}](${resolveImg(img.url)})`);
      if (img.alt) lines.push(`${prefix}*Caption: ${img.alt}*`);
      lines.push('');
    }

    // Videos
    for (const vid of t.videos || []) {
      if (vid.posterUrl) {
        lines.push(`${prefix}![${vid.type.toUpperCase()} preview](${resolveImg(vid.posterUrl)})`);
      }
      lines.push(`${prefix}*[${vid.type.toUpperCase()} attached — view original post](${t.url || m.sourceUrl})*`);
      lines.push('');
    }

    // Quoted Tweet
    if (t.quotedTweet) {
      const qt = t.quotedTweet;
      lines.push(`${prefix}> **Quoted — ${qt.displayName || 'User'} (${qt.handle || ''}):**`);
      for (const qLine of (qt.text || '').split('\n')) {
        lines.push(`${prefix}> ${qLine}`);
      }
      for (const qImg of qt.images || []) {
        lines.push(`${prefix}> ![${(qImg.alt || 'Quoted image').replace(/[\[\]]/g, '')}](${resolveImg(qImg.url)})`);
      }
      lines.push('');
    }

    // Link Card
    if (t.card && (t.card.title || t.card.url)) {
      lines.push(`${prefix}> 🔗 **${t.card.title || t.card.domain}** — ${t.card.url}`);
      if (t.card.description) lines.push(`${prefix}> ${t.card.description}`);
      lines.push('');
    }

    // Poll
    if (t.poll && t.poll.options?.length > 0) {
      lines.push(`${prefix}**Poll:**`);
      for (const opt of t.poll.options) lines.push(`${prefix}- ${opt}`);
      lines.push('');
    }

    if (includeMetrics) {
      const bits = [];
      if (t.likes) bits.push(`❤️ ${formatNumber(t.likes)}`);
      if (t.retweets) bits.push(`🔁 ${formatNumber(t.retweets)}`);
      if (t.replies) bits.push(`💬 ${formatNumber(t.replies)}`);
      if (t.views) bits.push(`👁️ ${formatNumber(t.views)}`);
      if (bits.length > 0) {
        lines.push(`${prefix}*${bits.join(' · ')}*`);
        lines.push('');
      }
    }
  };

    // Ancestors
    if (organized.ancestors.length > 0) {
      lines.push('## Conversation Context');
      lines.push('');
      for (const anc of organized.ancestors) {
        renderTweetMd(anc, null, '> ');
      }
    }

      // Author Thread
      if (organized.authorThread.length > 0) {
        lines.push('## Complete Author Thread');
        lines.push('');
        for (const t of organized.authorThread) {
          const heading = organized.authorThread.length > 1
            ? `${t.partIndex}/${t.partTotal} — ${t.chapterTitle}`
            : null;
          renderTweetMd(t, heading);
          lines.push('---');
          lines.push('');
        }
      }

      // Q&A Exchanges
      if (organized.qaExchanges.length > 0) {
        lines.push('## Author Q&A & Follow-Ups');
        lines.push('');
        for (const qa of organized.qaExchanges) {
          renderTweetMd(qa.question);
          for (const ans of qa.answers) {
            renderTweetMd(ans, null, '> ');
          }
          lines.push('---');
          lines.push('');
        }
      }

      // Top Community Insights
      if (organized.categories.topInsights.length > 0) {
        lines.push('## Top Community Insights');
        lines.push('');
        for (const r of organized.categories.topInsights) {
          renderTweetMd(r);
          lines.push('---');
          lines.push('');
        }
      }

      // Shared Resources Replies
      if (organized.categories.resources.length > 0) {
        lines.push('## Shared Resources & Links');
        lines.push('');
        for (const r of organized.categories.resources) {
          renderTweetMd(r);
          lines.push('---');
          lines.push('');
        }
      }

      // Community Questions
      if (organized.categories.questions.length > 0) {
        lines.push('## Community Questions');
        lines.push('');
        for (const r of organized.categories.questions) {
          renderTweetMd(r);
        }
      }

      // Visual Replies
      if (organized.categories.mediaReplies.length > 0) {
        lines.push('## Visual Replies');
        lines.push('');
        for (const r of organized.categories.mediaReplies) {
          renderTweetMd(r);
          lines.push('---');
          lines.push('');
        }
      }

      // Additional Discussion
      if (organized.categories.discussion.length > 0) {
        lines.push('## Additional Discussion');
        lines.push('');
        for (const r of organized.categories.discussion) {
          renderTweetMd(r);
        }
      }

      // Optional Short Reactions
      if (includeNoise && organized.categories.shortReactions.length > 0) {
        lines.push('## Short Reactions');
        lines.push('');
        for (const r of organized.categories.shortReactions) {
          lines.push(`- **${r.displayName}** (${r.handle}): ${r.text.replace(/\n/g, ' ')}`);
        }
        lines.push('');
      }

      // Extracted Links Table
      if (organized.sharedLinks.length > 0) {
        lines.push('## All Extracted Links');
        lines.push('');
        lines.push('| Resource | Shared By | URL |');
        lines.push('|---|---|---|');
        for (const l of organized.sharedLinks) {
          const safeTitle = (l.title || l.domain || 'Link').replace(/\|/g, '\\|');
          lines.push(`| ${safeTitle} | ${l.sharedByHandle || '-'} | ${l.url} |`);
        }
        lines.push('');
      }

      return lines.join('\n');
    },

    /**
     * Build Offline Markdown + Images .zip Bundle (thread.md + images/img_001.jpg + data.json)
     */
    async toMarkdownZip(organized, options = {}) {
      const { MiniZip } = root.ZipDocx;
      const includeNoise = Boolean(options.includeNoise);
      const imageMap = await this.fetchAllImages(organized, {
        forDocx: false,
        includeNoise,
        onProgress: options.onProgress
      });

      const zip = new MiniZip();
      const localImagePaths = new Map();
      let idx = 1;

      for (const [url, asset] of imageMap.entries()) {
        const ext = asset.ext || 'jpg';
        const filename = `images/img_${String(idx++).padStart(3, '0')}.${ext}`;
        localImagePaths.set(url, `./${filename}`);
        zip.addFile(filename, asset.bytes);
      }

      const mdContent = this.toMarkdown(organized, { ...options, localImagePaths });
      zip.addFile('thread.md', mdContent);
      zip.addFile('thread_data.json', JSON.stringify(organized, null, 2));

      return zip.generateUint8Array();
    },

    /**
     * Build Self-Contained Single-File Offline HTML Reader with Base64 Embedded Images,
     * Dark/Light Theme Toggle, Search, Category Filter, Image Lightbox & Print-to-PDF!
     */
    async toOfflineHTML(organized, options = {}) {
      const includeMetrics = options.includeMetrics !== false;
      const includeNoise = Boolean(options.includeNoise);
      const embedImages = options.embedImages !== false;

      const imageMap = embedImages
        ? await this.fetchAllImages(organized, {
          forDocx: false,
          includeNoise,
          onProgress: options.onProgress
        })
        : new Map();

      const resolveImg = (url) => {
        const asset = imageMap.get(url);
        return asset && asset.dataUrl ? asset.dataUrl : url;
      };

      const m = organized.meta;
      const ai = organized.summary.aiEnhanced;

      const renderTweetCard = (t, badge = '') => {
        const imgsHtml = (t.images || []).map((img) => `
          <figure class="media-figure">
            <img src="${escHtml(resolveImg(img.url))}" alt="${escHtml(img.alt || 'Tweet image')}" loading="lazy" onclick="openLightbox(this.src, this.alt)">
            ${img.alt ? `<figcaption>${escHtml(img.alt)}</figcaption>` : ''}
          </figure>`).join('');

        const vidsHtml = (t.videos || []).map((v) => `
          <div class="video-placeholder">
            ${v.posterUrl ? `<img src="${escHtml(resolveImg(v.posterUrl))}" alt="Video preview">` : ''}
            <a class="video-badge" href="${escHtml(t.url || m.sourceUrl)}" target="_blank" rel="noopener">▶ ${v.type.toUpperCase()} — View on X</a>
          </div>`).join('');

        const quoteHtml = t.quotedTweet ? `
          <div class="quote-box">
            <div class="quote-author"><strong>${escHtml(t.quotedTweet.displayName || 'User')}</strong> <span>${escHtml(t.quotedTweet.handle || '')}</span></div>
            <div class="quote-text">${formatBodyHtml(t.quotedTweet.text)}</div>
            ${(t.quotedTweet.images || []).map((qi) => `<img class="quote-img" src="${escHtml(resolveImg(qi.url))}" alt="${escHtml(qi.alt || '')}" onclick="openLightbox(this.src, this.alt)">`).join('')}
          </div>` : '';

        const cardHtml = t.card ? `
          <a class="link-card" href="${escHtml(t.card.url || '#')}" target="_blank" rel="noopener">
            <div class="link-card-domain">${escHtml(t.card.domain || '')}</div>
            <div class="link-card-title">${escHtml(t.card.title || t.card.url || '')}</div>
            ${t.card.description ? `<div class="link-card-desc">${escHtml(t.card.description)}</div>` : ''}
          </a>` : '';

        const pollHtml = t.poll && t.poll.options?.length ? `
          <div class="poll-box">
            <div class="poll-label">Poll</div>
            ${t.poll.options.map((o) => `<div class="poll-opt">${escHtml(o)}</div>`).join('')}
          </div>` : '';

        const metricsHtml = includeMetrics ? `
          <div class="metrics-bar">
            ${t.likes ? `<span>❤️ ${formatNumber(t.likes)}</span>` : ''}
            ${t.retweets ? `<span>🔁 ${formatNumber(t.retweets)}</span>` : ''}
            ${t.replies ? `<span>💬 ${formatNumber(t.replies)}</span>` : ''}
            ${t.views ? `<span>👁️ ${formatNumber(t.views)}</span>` : ''}
            ${t.url ? `<a href="${escHtml(t.url)}" target="_blank" rel="noopener" class="permalink">View post ↗</a>` : ''}
          </div>` : '';

        return `
        <article class="tweet-card" data-search="${escHtml((t.displayName + ' ' + t.handle + ' ' + t.text).toLowerCase())}">
          <div class="tweet-header">
            <div class="tweet-author">
              <strong>${escHtml(t.displayName)}</strong>${t.isVerified ? ' <span class="verified">✓</span>' : ''}
              <span class="handle">${escHtml(t.handle)}</span>
              ${badge ? `<span class="badge">${escHtml(badge)}</span>` : ''}
            </div>
            <time class="timestamp">${escHtml(formatDate(t.timestamp))}</time>
          </div>
          <div class="tweet-body">${formatBodyHtml(t.text)}</div>
          ${imgsHtml ? `<div class="media-grid count-${Math.min(4, t.images.length)}">${imgsHtml}</div>` : ''}
          ${vidsHtml}
          ${quoteHtml}
          ${cardHtml}
          ${pollHtml}
          ${metricsHtml}
        </article>`;
      };

      const threadHtml = organized.authorThread.map((t) =>
        renderTweetCard(t, organized.authorThread.length > 1 ? `Part ${t.partIndex}/${t.partTotal}` : 'Root Post')
      ).join('');

      const qaHtml = organized.qaExchanges.map((qa) => `
        <div class="qa-pair">
          ${renderTweetCard(qa.question, 'Question')}
          <div class="qa-answers">
            ${qa.answers.map((a) => renderTweetCard(a, 'Author Reply')).join('')}
          </div>
        </div>`).join('');

      const insightsHtml = organized.categories.topInsights.map((r) => renderTweetCard(r, 'Top Insight')).join('');
      const resourcesHtml = organized.categories.resources.map((r) => renderTweetCard(r, 'Resource')).join('');
      const questionsHtml = organized.categories.questions.map((r) => renderTweetCard(r, 'Question')).join('');
      const mediaRepliesHtml = organized.categories.mediaReplies.map((r) => renderTweetCard(r, 'Visual')).join('');
      const discussionHtml = organized.categories.discussion.map((r) => renderTweetCard(r)).join('');

      const linksTableHtml = organized.sharedLinks.map((l) => `
        <tr>
          <td><a href="${escHtml(l.url)}" target="_blank" rel="noopener">${escHtml(l.title || l.domain)}</a></td>
          <td>${escHtml(l.domain)}</td>
          <td>${escHtml(l.sharedByHandle || '-')}</td>
        </tr>`).join('');

      const galleryHtml = organized.mediaGallery.map((g) => `
        <figure class="gallery-tile">
          <img src="${escHtml(resolveImg(g.url))}" alt="${escHtml(g.alt || g.context)}" loading="lazy" onclick="openLightbox(this.src, this.alt)">
          <figcaption><strong>${escHtml(g.authorHandle)}</strong> · ${escHtml(g.context)}</figcaption>
        </figure>`).join('');

      const summaryBullets = (ai && ai.keyTakeaways?.length ? ai.keyTakeaways : organized.summary.keyPoints)
        .map((p) => `<li>${escHtml(p)}</li>`).join('');

      return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(m.title)}</title>
<style>
  :root {
    --bg: #f8fafc; --surface: #ffffff; --surface-2: #f1f5f9;
    --text: #0f172a; --muted: #64748b; --border: #e2e8f0;
    --accent: #1d9bf0; --accent-soft: rgba(29,155,240,0.1);
  }
  [data-theme="dark"] {
    --bg: #0f172a; --surface: #1e293b; --surface-2: #273549;
    --text: #f1f5f9; --muted: #94a3b8; --border: #334155;
    --accent: #38bdf8; --accent-soft: rgba(56,189,248,0.15);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); line-height: 1.65; }
  .topbar { position: sticky; top: 0; z-index: 50; background: var(--surface); border-bottom: 1px solid var(--border); padding: 12px 24px; display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
  .topbar-title { font-weight: 700; font-size: 14px; color: var(--accent); }
  .topbar-controls { display: flex; gap: 8px; align-items: center; }
  .search-input { padding: 7px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); color: var(--text); font-size: 13px; width: 220px; }
  .tool-btn { padding: 7px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface-2); color: var(--text); cursor: pointer; font-size: 12px; font-weight: 600; }
  .tool-btn:hover { border-color: var(--accent); color: var(--accent); }
  .container { max-width: 860px; margin: 28px auto; padding: 0 20px 60px; }
  .hero { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 28px; margin-bottom: 24px; }
  .hero h1 { font-size: 26px; line-height: 1.3; margin-bottom: 12px; }
  .hero-meta { color: var(--muted); font-size: 13px; display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
  .hero-meta a { color: var(--accent); text-decoration: none; }
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 10px; margin-top: 16px; }
  .stat-card { background: var(--surface-2); border-radius: 10px; padding: 10px 12px; text-align: center; }
  .stat-val { font-size: 18px; font-weight: 700; color: var(--accent); }
  .stat-lbl { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.4px; }
  .summary-box { background: var(--surface); border: 1px solid var(--border); border-left: 4px solid var(--accent); border-radius: 12px; padding: 20px 24px; margin-bottom: 24px; }
  .summary-box h2 { font-size: 16px; margin-bottom: 10px; }
  .summary-box ul { padding-left: 20px; }
  .summary-box li { margin-bottom: 6px; font-size: 14px; }
  .tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px; }
  .tag { background: var(--accent-soft); color: var(--accent); padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; }
  .section-title { font-size: 19px; margin: 28px 0 14px; padding-bottom: 8px; border-bottom: 2px solid var(--border); }
  .tweet-card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 18px 20px; margin-bottom: 14px; }
  .tweet-header { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
  .handle, .timestamp { color: var(--muted); font-size: 13px; }
  .verified { color: var(--accent); font-weight: 700; }
  .badge { background: var(--accent-soft); color: var(--accent); font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 12px; margin-left: 6px; }
  .tweet-body { font-size: 15px; white-space: pre-wrap; word-break: break-word; }
  .media-grid { display: grid; gap: 10px; margin-top: 14px; }
  .media-grid.count-2, .media-grid.count-4 { grid-template-columns: repeat(2, 1fr); }
  .media-figure img { width: 100%; max-height: 520px; object-fit: contain; border-radius: 10px; border: 1px solid var(--border); cursor: zoom-in; background: var(--surface-2); }
  .media-figure figcaption { font-size: 12px; color: var(--muted); margin-top: 4px; text-align: center; }
  .quote-box { margin-top: 12px; padding: 12px 14px; border: 1px solid var(--border); border-left: 3px solid var(--muted); border-radius: 10px; background: var(--surface-2); font-size: 14px; }
  .quote-img { max-width: 100%; max-height: 260px; border-radius: 8px; margin-top: 8px; cursor: zoom-in; }
  .link-card { display: block; margin-top: 12px; padding: 12px 14px; border: 1px solid var(--border); border-radius: 10px; text-decoration: none; color: inherit; background: var(--surface-2); }
  .link-card-domain { font-size: 11px; color: var(--muted); }
  .link-card-title { font-weight: 600; color: var(--accent); }
  .link-card-desc { font-size: 13px; color: var(--muted); margin-top: 4px; }
  .poll-box { margin-top: 12px; padding: 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-2); }
  .poll-label { font-size: 11px; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; font-weight: 700; }
  .poll-opt { padding: 4px 0; font-size: 13px; }
  .metrics-bar { display: flex; gap: 14px; align-items: center; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border); font-size: 12px; color: var(--muted); }
  .permalink { margin-left: auto; color: var(--accent); text-decoration: none; }
  .qa-answers { margin-left: 28px; border-left: 3px solid var(--accent); padding-left: 14px; }
  .gallery-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
  .gallery-tile { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
  .gallery-tile img { width: 100%; height: 180px; object-fit: cover; cursor: zoom-in; display: block; }
  .gallery-tile figcaption { padding: 8px 10px; font-size: 12px; color: var(--muted); }
  table { width: 100%; border-collapse: collapse; background: var(--surface); border-radius: 12px; overflow: hidden; border: 1px solid var(--border); font-size: 13px; }
  th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--border); }
  th { background: var(--surface-2); font-weight: 600; }
  td a { color: var(--accent); text-decoration: none; word-break: break-all; }
  .lightbox { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.88); z-index: 100; align-items: center; justify-content: center; flex-direction: column; padding: 24px; }
  .lightbox.open { display: flex; }
  .lightbox img { max-width: 92vw; max-height: 85vh; border-radius: 10px; }
  .lightbox-cap { color: #e2e8f0; margin-top: 10px; font-size: 13px; }
  .video-placeholder { margin-top: 12px; position: relative; }
  .video-placeholder img { max-width: 100%; border-radius: 10px; }
  .video-badge { display: inline-block; margin-top: 6px; color: var(--accent); font-size: 13px; font-weight: 600; text-decoration: none; }
  @media print { .topbar, .lightbox { display: none !important; } body { background: #fff; color: #000; } .tweet-card { break-inside: avoid; } }
</style>
</head>
<body>
  <div class="topbar">
    <div class="topbar-title">TwReplyExport Pro — Offline Thread Archive</div>
    <div class="topbar-controls">
      <input class="search-input" type="search" id="searchBox" placeholder="Search thread & replies...">
      <button class="tool-btn" onclick="toggleTheme()">🌗 Theme</button>
      <button class="tool-btn" onclick="window.print()">🖨️ Print / PDF</button>
    </div>
  </div>
  <main class="container">
    <header class="hero">
      <h1>${escHtml(m.title)}</h1>
      <div class="hero-meta">
        <span><strong>${escHtml(m.authorName)}</strong> (${escHtml(m.authorHandle)})</span>
        <span>• ${escHtml(formatDate(m.publishedAt))}</span>
        <span>• ~${m.readingTimeMin} min read</span>
        ${m.sourceUrl ? `<a href="${escHtml(m.sourceUrl)}" target="_blank" rel="noopener">Original on X ↗</a>` : ''}
      </div>
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-val">${m.threadLength}</div><div class="stat-lbl">Thread Posts</div></div>
        <div class="stat-card"><div class="stat-val">${m.replyCount}</div><div class="stat-lbl">Replies</div></div>
        <div class="stat-card"><div class="stat-val">${m.qaCount}</div><div class="stat-lbl">Author Q&A</div></div>
        <div class="stat-card"><div class="stat-val">${m.imageCount}</div><div class="stat-lbl">Images</div></div>
        <div class="stat-card"><div class="stat-val">${m.linkCount}</div><div class="stat-lbl">Links</div></div>
      </div>
    </header>

    ${summaryBullets ? `
    <section class="summary-box">
      <h2>${ai ? '✨ Executive Summary (AI-Enhanced)' : '💡 Key Takeaways'}</h2>
      ${ai && ai.executiveSummary ? `<p style="margin-bottom:10px;">${escHtml(ai.executiveSummary)}</p>` : ''}
      <ul>${summaryBullets}</ul>
      ${organized.topics.keywords.length ? `<div class="tags">${organized.topics.keywords.map((k) => `<span class="tag">#${escHtml(k)}</span>`).join('')}</div>` : ''}
    </section>` : ''}

    ${threadHtml ? `<h2 class="section-title">🧵 Complete Author Thread (${organized.authorThread.length})</h2>${threadHtml}` : ''}
    ${qaHtml ? `<h2 class="section-title">💬 Author Q&A (${organized.qaExchanges.length})</h2>${qaHtml}` : ''}
    ${insightsHtml ? `<h2 class="section-title">💡 Top Community Insights (${organized.categories.topInsights.length})</h2>${insightsHtml}` : ''}
    ${resourcesHtml ? `<h2 class="section-title">🔗 Replies with Resources (${organized.categories.resources.length})</h2>${resourcesHtml}` : ''}
    ${questionsHtml ? `<h2 class="section-title">❓ Community Questions (${organized.categories.questions.length})</h2>${questionsHtml}` : ''}
    ${mediaRepliesHtml ? `<h2 class="section-title">🖼️ Visual Replies (${organized.categories.mediaReplies.length})</h2>${mediaRepliesHtml}` : ''}
    ${discussionHtml ? `<h2 class="section-title">🗣️ Additional Discussion (${organized.categories.discussion.length})</h2>${discussionHtml}` : ''}
    ${galleryHtml ? `<h2 class="section-title">🖼️ Media Gallery (${organized.mediaGallery.length})</h2><div class="gallery-grid">${galleryHtml}</div>` : ''}
    ${linksTableHtml ? `<h2 class="section-title">📚 Extracted Links (${organized.sharedLinks.length})</h2><table><thead><tr><th>Title</th><th>Domain</th><th>Shared By</th></tr></thead><tbody>${linksTableHtml}</tbody></table>` : ''}
  </main>

  <div class="lightbox" id="lightbox" onclick="this.classList.remove('open')">
    <img id="lbImg" src="" alt="">
    <div class="lightbox-cap" id="lbCap"></div>
  </div>
<script>
  function toggleTheme() {
    const html = document.documentElement;
    html.setAttribute('data-theme', html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  }
  function openLightbox(src, cap) {
    document.getElementById('lbImg').src = src;
    document.getElementById('lbCap').textContent = cap || '';
    document.getElementById('lightbox').classList.add('open');
  }
  document.getElementById('searchBox').addEventListener('input', function(e) {
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll('.tweet-card').forEach(function(card) {
      const hay = card.getAttribute('data-search') || '';
      card.style.display = (!q || hay.includes(q)) ? '' : 'none';
    });
  });
</script>
</body>
</html>`;
    },

  /**
   * Structured JSON Export
   */
  toJSON(organized) {
    return JSON.stringify(organized, null, 2);
  },

    /**
     * Enhanced CSV Export (Thread + Q&A + Categorized Replies)
     */
    toCSV(organized, options = {}) {
      const includeMetrics = options.includeMetrics !== false;
      const includeNoise = Boolean(options.includeNoise);
      const rows = flattenRowsForTabular(organized, includeNoise);
      if (rows.length === 0) return '';

    const columns = [
      { key: 'section', label: 'Section' },
      { key: 'displayName', label: 'Display Name' },
      { key: 'handle', label: 'Handle' },
      { key: 'text', label: 'Text' },
      { key: 'timestamp', label: 'Timestamp' },
      { key: 'url', label: 'Post URL' },
      { key: 'images', label: 'Image URLs' },
      { key: 'links', label: 'Shared Links' },
      { key: 'category', label: 'Category' },
      { key: 'qualityScore', label: 'Quality Score' }
    ];

      if (includeMetrics) {
        columns.push(
          { key: 'likes', label: 'Likes' },
          { key: 'retweets', label: 'Reposts' },
          { key: 'replies', label: 'Replies' },
          { key: 'views', label: 'Views' }
        );
      }

          const escape = (val) => {
            if (val === null || val === undefined) return '';
            const str = String(val);
            if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
              return '"' + str.replace(/"/g, '""') + '"';
            }
            return str;
          };

          const header = columns.map((c) => escape(c.label)).join(',');
          const body = rows.map((r) => columns.map((c) => escape(r[c.key])).join(','));
          return '\uFEFF' + header + '\n' + body.join('\n');
        },

          /**
           * Multi-Sheet Excel (.xlsx) Export via SheetJS
           */
          toXLSX(organized, options = {}) {
            if (typeof XLSX === 'undefined') {
              console.error('SheetJS library not loaded');
              return null;
            }
          const includeNoise = Boolean(options.includeNoise);
          const wb = XLSX.utils.book_new();

          // Sheet 1: Overview
          const m = organized.meta;
          const overviewRows = [
            { Field: 'Title', Value: m.title },
            { Field: 'Author', Value: `${m.authorName} (${m.authorHandle})` },
            { Field: 'Source URL', Value: m.sourceUrl },
            { Field: 'Published At', Value: m.publishedAt },
            { Field: 'Thread Posts', Value: m.threadLength },
            { Field: 'Community Replies', Value: m.replyCount },
            { Field: 'Author Q&A', Value: m.qaCount },
            { Field: 'Total Images', Value: m.imageCount },
            { Field: 'Shared Links', Value: m.linkCount },
            { Field: 'Key Topics', Value: organized.topics.keywords.join(', ') }
          ];
          XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(overviewRows), 'Overview');

          // Sheet 2: Author Thread
          const threadRows = organized.authorThread.map((t) => ({
            Part: `${t.partIndex}/${t.partTotal}`,
            Chapter: t.chapterTitle,
            Author: t.handle,
            Text: t.text,
            Timestamp: t.timestamp,
            Images: (t.images || []).map((i) => i.url).join(' | '),
            Likes: t.likes,
            Reposts: t.retweets,
            Views: t.views,
            URL: t.url
          }));
          if (threadRows.length > 0) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(threadRows), 'Author Thread');
          }

            // Sheet 3: Community Replies & Q&A
            const replyRows = flattenRowsForTabular(organized, includeNoise)
              .filter((r) => r.section !== 'Author Thread')
              .map((r) => ({
                Section: r.section,
                Category: r.category,
                QualityScore: r.qualityScore,
                DisplayName: r.displayName,
                Handle: r.handle,
                Text: r.text,
                Images: r.images,
                Links: r.links,
                Likes: r.likes,
                Reposts: r.retweets,
                Timestamp: r.timestamp,
                URL: r.url
              }));
            if (replyRows.length > 0) {
              XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(replyRows), 'Replies & QA');
            }

            // Sheet 4: Shared Links
            if (organized.sharedLinks.length > 0) {
              const linkRows = organized.sharedLinks.map((l) => ({
                Title: l.title,
                Domain: l.domain,
                URL: l.url,
                SharedBy: l.sharedByHandle,
                Source: l.sourceType
              }));
              XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linkRows), 'Shared Links');
            }

            return XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
          },

          /**
           * Trigger browser file download
           */
          downloadFile(content, filename, mimeType) {
            let blob;
            if (content instanceof ArrayBuffer || content instanceof Uint8Array) {
              blob = new Blob([content], { type: mimeType });
            } else {
              blob = new Blob([content], { type: mimeType + ';charset=utf-8' });
            }
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1500);
          },

    /**
     * High-level Export Dispatcher
     */
    async exportOrganized(organized, format, options = {}) {
            const slug = slugify(organized.meta.title || organized.meta.authorHandle || 'x_thread');
            const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            const baseName = `${slug}_${dateStamp}`;

            switch (format) {
              case 'docx': {
                const bytes = await this.toDOCX(organized, options);
                this.downloadFile(
                  bytes,
                  `${baseName}.docx`,
                  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                );
                return `${baseName}.docx`;
              }
              case 'md-zip': {
                const bytes = await this.toMarkdownZip(organized, options);
                this.downloadFile(bytes, `${baseName}_markdown_bundle.zip`, 'application/zip');
                return `${baseName}_markdown_bundle.zip`;
              }
              case 'md': {
                if (options.embedImages) {
                  const bytes = await this.toMarkdownZip(organized, options);
                  this.downloadFile(bytes, `${baseName}_markdown_with_images.zip`, 'application/zip');
                  return `${baseName}_markdown_with_images.zip`;
                }
                const md = this.toMarkdown(organized, options);
                this.downloadFile(md, `${baseName}.md`, 'text/markdown');
                return `${baseName}.md`;
              }
              case 'html': {
                const html = await this.toOfflineHTML(organized, options);
                this.downloadFile(html, `${baseName}.html`, 'text/html');
                return `${baseName}.html`;
              }
              case 'json': {
                const json = this.toJSON(organized);
                this.downloadFile(json, `${baseName}.json`, 'application/json');
                return `${baseName}.json`;
              }
              case 'csv': {
                const csv = this.toCSV(organized, options);
                this.downloadFile(csv, `${baseName}.csv`, 'text/csv');
                return `${baseName}.csv`;
              }
              case 'xlsx': {
                const xlsxData = this.toXLSX(organized, options);
                if (xlsxData) {
                  this.downloadFile(
                    xlsxData,
                    `${baseName}.xlsx`,
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                  );
                }
                return `${baseName}.xlsx`;
              }
              default:
                throw new Error(`Unsupported export format: ${format}`);
            }
          }
    };

    // --- Image Fetching & WebP->PNG Safety Helpers ---

    function collectAllImageUrls(organized, includeNoise) {
      const set = new Set();
      const addTweet = (t) => {
        if (!t) return;
        for (const img of t.images || []) {
          if (img.url) set.add(img.url);
        }
        for (const v of t.videos || []) {
          if (v.posterUrl) set.add(v.posterUrl);
        }
        if (t.quotedTweet) {
          for (const img of t.quotedTweet.images || []) {
            if (img.url) set.add(img.url);
          }
        }
      };

      for (const t of organized.ancestors || []) addTweet(t);
      for (const t of organized.authorThread || []) addTweet(t);
      for (const qa of organized.qaExchanges || []) {
        addTweet(qa.question);
        for (const a of qa.answers || []) addTweet(a);
      }
      for (const r of organized.allCommunityReplies || []) {
        if (!includeNoise && r.isNoise) continue;
        addTweet(r);
      }
      return Array.from(set);
    }

    async function fetchSingleImage(url, ensureDocxSafe) {
      const cacheKey = `${url}::${ensureDocxSafe ? 'docx' : 'raw'}`;
      if (imageCache.has(cacheKey)) return imageCache.get(cacheKey);

      let fetchUrl = url;
      try {
        const u = new URL(url);
        if (u.hostname.includes('pbs.twimg.com') && u.pathname.includes('/media/')) {
          if (ensureDocxSafe && u.searchParams.get('format') === 'webp') {
            u.searchParams.set('format', 'jpg');
          }
          fetchUrl = u.toString();
        }
      } catch { }

      let blob;
      try {
        const resp = await fetch(fetchUrl, { credentials: 'omit' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        blob = await resp.blob();
      } catch (directErr) {
        // Fallback via background service worker if available
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          const bgResp = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: 'fetchImageAsBase64', url: fetchUrl }, resolve);
          });
          if (!bgResp || !bgResp.ok) throw directErr;
          const binResp = await fetch(bgResp.dataUrl);
          blob = await binResp.blob();
        } else {
          throw directErr;
        }
      }

      let mimeType = blob.type || 'image/jpeg';
      if (ensureDocxSafe && (mimeType.includes('webp') || mimeType.includes('avif'))) {
        blob = await convertBlobToPng(blob);
        mimeType = 'image/png';
      }

      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const dataUrl = uint8ToDataUrl(bytes, mimeType);
      const ext = mimeType.includes('png') ? 'png' : mimeType.includes('gif') ? 'gif' : mimeType.includes('webp') ? 'webp' : 'jpg';

      const asset = { bytes, mimeType, dataUrl, ext };
      imageCache.set(cacheKey, asset);
      return asset;
    }

    async function convertBlobToPng(blob) {
      if (typeof createImageBitmap === 'undefined' || typeof document === 'undefined') {
        return blob;
      }
      try {
        const bmp = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bmp, 0, 0);
        return await new Promise((resolve) => canvas.toBlob((b) => resolve(b || blob), 'image/png'));
      } catch {
        return blob;
      }
    }

    function uint8ToDataUrl(bytes, mimeType) {
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      }
      return `data:${mimeType};base64,${btoa(binary)}`;
    }

    // --- Formatting Helpers ---

    function flattenRowsForTabular(organized, includeNoise) {
      const rows = [];
      const push = (t, section, category = '') => {
        rows.push({
          section,
          displayName: t.displayName || '',
          handle: t.handle || '',
          text: t.text || '',
          timestamp: t.timestamp || '',
          url: t.url || '',
          images: (t.images || []).map((i) => i.url).join(' | '),
          links: (t.links || []).map((l) => l.url).join(' | '),
          category: category || t.category || section,
          qualityScore: t.qualityScore || 0,
          likes: t.likes || 0,
          retweets: t.retweets || 0,
          replies: t.replies || 0,
          views: t.views || 0
        });
      };

      for (const t of organized.authorThread) push(t, 'Author Thread', `Part ${t.partIndex}/${t.partTotal}`);
      for (const qa of organized.qaExchanges) {
        push(qa.question, 'Author Q&A', 'Question');
        for (const a of qa.answers) push(a, 'Author Q&A', 'Author Answer');
      }
      for (const r of organized.allCommunityReplies) {
        if (!includeNoise && r.isNoise) continue;
        push(r, 'Community Reply', r.category);
      }
      return rows;
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

    function formatNumber(n) {
      const num = Number(n) || 0;
      if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
      if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
      return String(num);
    }

    function slugify(str) {
      return String(str || 'x_thread')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 48) || 'x_thread';
    }

    function escapeYaml(str) {
      return String(str || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
    }

    function escHtml(str) {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function formatBodyHtml(str) {
      if (!str) return '';
      const escaped = escHtml(str);
      return escaped.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" style="color:var(--accent)">$1</a>');
    }

    if (typeof module !== 'undefined' && module.exports) {
      module.exports = ExportUtils;
    } else {
      root.ExportUtils = ExportUtils;
    }
  }) (typeof globalThis !== 'undefined' ? globalThis : this);
