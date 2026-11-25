<p align="center">
  <img src="icons/icon128.png" alt="TwReplyExport Pro" width="80" />
</p>

<h1 align="center">TwReplyExport Pro v2.0</h1>
<p align="center">
  <strong>Save complete X/Twitter threads &amp; replies with embedded images, intelligent organization, and readable exports to DOCX, Markdown, HTML, Excel, JSON, or CSV — 100% locally.</strong>
</p>

---

## ✨ What's New in v2.0

| Feature | Description |
|---|---|
| **Complete Thread Capture** | Captures ancestor context, the full Author Thread chain (auto-expanding "Show more" long posts), and community replies — and stops cleanly before `"Discover more"` spam. |
| **Full Media & Rich Content** | Preserves high-resolution images (`name=large`), image alt-text, video/GIF thumbnails, quoted tweets, link cards, polls, emojis, and line breaks. |
| **Readable Offline Exports with Embedded Images** | **Word (`.docx`)** with natively embedded images, **Markdown + Local Images Bundle (`.zip`)** for Obsidian/Notion, **Standalone Markdown (`.md`)**, and **Self-Contained Offline HTML (`.html`)** with base64 images, search, lightbox & Print-to-PDF. |
| **Intelligent Local Organization** | Automatically reconstructs the Author Thread, pairs **Author Q&A** exchanges, ranks **Top Community Insights**, extracts a deduplicated **Shared Links Index**, builds a **Media Gallery**, detects auto-chapters, and filters out low-value noise (`gm`, emojis, `@threadreaderapp` spam). |
| **Full-Page Interactive Reader Studio** | Open any captured thread in a clean full-page Reader (`reader.html`) with live search, topic tags, community tone breakdown, lightbox gallery, and one-click export to any format. |
| **Optional Gemini AI Synthesis** | Works 100% offline with zero API key; optionally add your own Gemini API key (stored locally) to generate an AI Executive Summary, Community Themes, and a cleanly edited article version. |
| **Power-User Data Exports** | Multi-sheet **Excel (`.xlsx`)** (`Overview`, `Author Thread`, `Replies & QA`, `Shared Links`), structured **JSON**, and enhanced **CSV**. |

## 🚀 Installation (Chrome Developer Mode)

1. Open **Chrome** and go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select this folder (`XReplyExporter`)
4. Pin **TwReplyExport Pro** to your toolbar

## 📖 How to Use

1. Open any X/Twitter thread on `x.com` or `twitter.com`
2. Click the **TwReplyExport Pro** icon — the URL auto-fills
3. Choose your capture scope: **Complete Thread**, **Author Only**, or **Replies**
4. Pick your export format: `DOCX` · `MD + Images` · `MD` · `HTML` · `XLSX` · `JSON`
5. Click **Capture & Organize Thread**
6. Click **Open Organized Reader** to explore with images & search, or hit **Download** immediately!

## 📁 Project Structure

```
XReplyExporter/
├── manifest.json          # MV3 manifest (includes pbs.twimg.com image fetch permissions)
├── background.js          # Service worker: tab orchestration, state recovery, reader launcher
├── content.js             # Complete thread, media, quote, card & poll DOM scraper
├── intelligence.js        # Local intelligence engine + optional Gemini AI enhancer
├── zip-docx.js            # Zero-dependency PKZIP & OOXML (.docx) builder with image embedding
├── export.js              # DOCX, MD+Images ZIP, MD, Offline HTML, XLSX, JSON & CSV exporters
├── popup.html / .css / .js    # Extension popup controller
├── reader.html / .css / .js   # Full-page Interactive Thread Reader & Export Studio
├── lib/xlsx.mini.min.js   # SheetJS for multi-sheet Excel export
└── icons/                 # Extension icons
```

## 📄 License

MIT License — see [LICENSE](LICENSE).
