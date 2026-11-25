// ============================================
// TwReplyExport Pro — Zero-Dependency ZIP & DOCX Engine
// Builds valid PKZIP archives (.zip bundles) and full
// OOXML Microsoft Word (.docx) documents with natively
// embedded JPEG/PNG images, tables, callouts & headings.
// ============================================

(function (root) {
  const encoder = new TextEncoder();

  // --- Precomputed CRC-32 Lookup Table ---
  const CRC_TABLE = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    CRC_TABLE[i] = c >>> 0;
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  // ============================================
  // 1. MiniZip — Standard PKZIP Archive Builder
  // ============================================
  class MiniZip {
    constructor() {
      this.files = [];
    }

    addFile(name, data) {
      const cleanName = name.replace(/^\/+/, '').replace(/\\/g, '/');
      let bytes;
      if (typeof data === 'string') {
        bytes = encoder.encode(data);
      } else if (data instanceof Uint8Array) {
        bytes = data;
      } else if (data instanceof ArrayBuffer) {
        bytes = new Uint8Array(data);
      } else {
        throw new Error('MiniZip: unsupported data type for ' + cleanName);
      }
      this.files.push({
        name: cleanName,
        nameBytes: encoder.encode(cleanName),
        data: bytes,
        crc: crc32(bytes)
      });
    }

    generateUint8Array() {
      const now = new Date();
      const dosTime =
        ((now.getHours() & 0x1f) << 11) |
        ((now.getMinutes() & 0x3f) << 5) |
        ((now.getSeconds() >> 1) & 0x1f);
      const dosDate =
        (((Math.max(1980, now.getFullYear()) - 1980) & 0x7f) << 9) |
        (((now.getMonth() + 1) & 0x0f) << 5) |
        (now.getDate() & 0x1f);

      const localParts = [];
      const centralParts = [];
      let offset = 0;

      for (const f of this.files) {
        // Local File Header (30 bytes + name)
        const lh = new Uint8Array(30 + f.nameBytes.length);
        const lv = new DataView(lh.buffer);
        lv.setUint32(0, 0x04034b50, true); // Local file header signature
        lv.setUint16(4, 20, true);         // Version needed (2.0)
        lv.setUint16(6, 0x0800, true);     // General purpose bit flag (UTF-8)
        lv.setUint16(8, 0, true);          // Compression method: 0 (STORE)
        lv.setUint16(10, dosTime, true);
        lv.setUint16(12, dosDate, true);
        lv.setUint32(14, f.crc, true);
        lv.setUint32(18, f.data.length, true);
        lv.setUint32(22, f.data.length, true);
        lv.setUint16(26, f.nameBytes.length, true);
        lv.setUint16(28, 0, true);         // Extra field length
        lh.set(f.nameBytes, 30);

        localParts.push(lh, f.data);

        // Central Directory Header (46 bytes + name)
        const ch = new Uint8Array(46 + f.nameBytes.length);
        const cv = new DataView(ch.buffer);
        cv.setUint32(0, 0x02014b50, true); // Central directory signature
        cv.setUint16(4, 20, true);         // Version made by
        cv.setUint16(6, 20, true);         // Version needed
        cv.setUint16(8, 0x0800, true);     // UTF-8 flag
        cv.setUint16(10, 0, true);         // Compression: STORE
        cv.setUint16(12, dosTime, true);
        cv.setUint16(14, dosDate, true);
        cv.setUint32(16, f.crc, true);
        cv.setUint32(20, f.data.length, true);
        cv.setUint32(24, f.data.length, true);
        cv.setUint16(28, f.nameBytes.length, true);
        cv.setUint16(30, 0, true);
        cv.setUint16(32, 0, true);
        cv.setUint16(34, 0, true);
        cv.setUint16(36, 0, true);
        cv.setUint32(38, 0, true);
        cv.setUint32(42, offset, true);    // Relative offset of local header
        ch.set(f.nameBytes, 46);

        centralParts.push(ch);
        offset += lh.length + f.data.length;
      }

      const centralSize = centralParts.reduce((s, p) => s + p.length, 0);

      // End of Central Directory Record (22 bytes)
      const eocd = new Uint8Array(22);
      const ev = new DataView(eocd.buffer);
      ev.setUint32(0, 0x06054b50, true);
      ev.setUint16(4, 0, true);
      ev.setUint16(6, 0, true);
      ev.setUint16(8, this.files.length, true);
      ev.setUint16(10, this.files.length, true);
      ev.setUint32(12, centralSize, true);
      ev.setUint32(16, offset, true);
      ev.setUint16(20, 0, true);

      const totalSize = offset + centralSize + eocd.length;
      const result = new Uint8Array(totalSize);
      let pos = 0;
      for (const p of localParts) {
        result.set(p, pos);
        pos += p.length;
      }
      for (const p of centralParts) {
        result.set(p, pos);
        pos += p.length;
      }
      result.set(eocd, pos);
      return result;
    }
  }

  // ============================================
  // 2. Binary Image Dimension Reader (PNG / JPEG / GIF)
  // ============================================
  function getImageDimensions(bytes) {
    if (!bytes || bytes.length < 24) return { width: 800, height: 500 };

    // PNG: 89 50 4E 47 0D 0A 1A 0A -> IHDR width at 16, height at 20
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const width = view.getUint32(16, false);
      const height = view.getUint32(20, false);
      if (width > 0 && height > 0) return { width, height };
    }

    // GIF: 47 49 46 38 -> width at 6 (LE), height at 8 (LE)
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const width = view.getUint16(6, true);
      const height = view.getUint16(8, true);
      if (width > 0 && height > 0) return { width, height };
    }

    // JPEG: FF D8 -> scan SOF markers (C0, C1, C2, C3, C5..C7, C9..CB, CD..CF)
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      let i = 2;
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) {
          i++;
          continue;
        }
        while (i < bytes.length && bytes[i] === 0xff) i++;
        if (i >= bytes.length) break;
        const marker = bytes[i++];
        if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          continue;
        }
        if (i + 2 > bytes.length) break;
        const segLen = (bytes[i] << 8) | bytes[i + 1];
        const isSOF =
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf);
        if (isSOF && i + 7 < bytes.length) {
          const height = (bytes[i + 3] << 8) | bytes[i + 4];
          const width = (bytes[i + 5] << 8) | bytes[i + 6];
          if (width > 0 && height > 0) return { width, height };
        }
        if (segLen < 2) break;
        i += segLen;
      }
    }

    return { width: 800, height: 500 };
  }

  // ============================================
  // 3. DocxBuilder — Clean OOXML Word Generator
  // ============================================
  function xmlEscape(str) {
    return String(str || '')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Strip illegal XML 1.0 control chars
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  class DocxBuilder {
    constructor(meta = {}) {
      this.meta = meta;
      this.bodyBlocks = [];
      this.mediaFiles = []; // { filename, rId, bytes, ext, contentType }
      this.links = [];      // { rId, url }
      this.nextRelId = 10;  // rId1 reserved for styles.xml
      this.nextDocPrId = 1;
    }

    addHyperlinkRel(url) {
      const rId = `rId${this.nextRelId++}`;
      this.links.push({ rId, url });
      return rId;
    }

    addImage(bytes, mimeType = 'image/jpeg', caption = '', fallbackWidth = 0, fallbackHeight = 0) {
      if (!bytes || bytes.length === 0) return;

      let ext = 'jpg';
      if (mimeType.includes('png')) ext = 'png';
      else if (mimeType.includes('gif')) ext = 'gif';

      const rId = `rId${this.nextRelId++}`;
      const filename = `image${this.mediaFiles.length + 1}.${ext}`;
      this.mediaFiles.push({ filename, rId, bytes, ext, mimeType });

      const dims = getImageDimensions(bytes);
      const pxW = dims.width || fallbackWidth || 800;
      const pxH = dims.height || fallbackHeight || 500;

      // Max box: 6.1 inches wide x 4.6 inches tall (1 inch = 914400 EMU)
      const MAX_W_EMU = 5577840;
      const MAX_H_EMU = 4206240;
      const EMU_PER_PX = 9525; // 96 DPI

      let cx = pxW * EMU_PER_PX;
      let cy = pxH * EMU_PER_PX;

      if (cx > MAX_W_EMU) {
        const scale = MAX_W_EMU / cx;
        cx = Math.round(cx * scale);
        cy = Math.round(cy * scale);
      }
      if (cy > MAX_H_EMU) {
        const scale = MAX_H_EMU / cy;
        cx = Math.round(cx * scale);
        cy = Math.round(cy * scale);
      }

      const docPrId = this.nextDocPrId++;
      const nameEsc = xmlEscape(filename);
      const descEsc = xmlEscape(caption || filename);

      this.bodyBlocks.push(`
      <w:p>
        <w:pPr>
          <w:spacing w:before="80" w:after="${caption ? '40' : '140'}"/>
          <w:jc w:val="center"/>
        </w:pPr>
        <w:r>
          <w:drawing>
            <wp:inline distT="0" distB="0" distL="0" distR="0"
              xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
              <wp:extent cx="${cx}" cy="${cy}"/>
              <wp:effectExtent l="0" t="0" r="0" b="0"/>
              <wp:docPr id="${docPrId}" name="${nameEsc}" descr="${descEsc}"/>
              <wp:cNvGraphicFramePr>
                <a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/>
              </wp:cNvGraphicFramePr>
              <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                  <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
                    <pic:nvPicPr>
                      <pic:cNvPr id="${docPrId}" name="${nameEsc}"/>
                      <pic:cNvPicPr/>
                    </pic:nvPicPr>
                    <pic:blipFill>
                      <a:blip r:embed="${rId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>
                      <a:stretch><a:fillRect/></a:stretch>
                    </pic:blipFill>
                    <pic:spPr>
                      <a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>
                      <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                    </pic:spPr>
                  </pic:pic>
                </a:graphicData>
              </a:graphic>
            </wp:inline>
          </w:drawing>
        </w:r>
      </w:p>`);

      if (caption) {
        this.addParagraph(caption, { italic: true, color: '5B6B7C', size: 18, align: 'center', spaceBefore: 0, spaceAfter: 140 });
      }
    }

    addTitle(text) {
      this.bodyBlocks.push(`
      <w:p>
        <w:pPr>
          <w:pStyle w:val="Title"/>
          <w:spacing w:before="0" w:after="100"/>
        </w:pPr>
        <w:r>
          <w:rPr><w:b/><w:sz w:val="44"/><w:szCs w:val="44"/><w:color w:val="0F1419"/></w:rPr>
          <w:t xml:space="preserve">${xmlEscape(text)}</w:t>
        </w:r>
      </w:p>`);
    }

    addHeading(text, level = 1) {
      const style = level === 1 ? 'Heading1' : level === 2 ? 'Heading2' : 'Heading3';
      const sz = level === 1 ? '32' : level === 2 ? '26' : '22';
      const color = level === 1 ? '1D4ED8' : level === 2 ? '0F172A' : '334155';
      const before = level === 1 ? '280' : level === 2 ? '200' : '140';
      const bottomBorder = level === 1
        ? `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="CBD5E1"/></w:pBdr>`
        : '';

      this.bodyBlocks.push(`
      <w:p>
        <w:pPr>
          <w:pStyle w:val="${style}"/>
          <w:keepNext/>
          <w:spacing w:before="${before}" w:after="100"/>
          ${bottomBorder}
        </w:pPr>
        <w:r>
          <w:rPr><w:b/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/><w:color w:val="${color}"/></w:rPr>
          <w:t xml:space="preserve">${xmlEscape(text)}</w:t>
        </w:r>
      </w:p>`);
    }

    addParagraph(text, opts = {}) {
      if (text === null || text === undefined) return;
      const lines = String(text).split('\n');
      const sz = opts.size || 21; // half-points (21 = 10.5pt)
      const color = opts.color || '1E293B';
      const spaceBefore = opts.spaceBefore ?? 40;
      const spaceAfter = opts.spaceAfter ?? 100;
      const alignXml = opts.align ? `<w:jc w:val="${opts.align}"/>` : '';
      const indentXml = opts.indentLeft ? `<w:ind w:left="${opts.indentLeft}"/>` : '';
      const borderXml = opts.leftBorderColor
        ? `<w:pBdr><w:left w:val="single" w:sz="18" w:space="10" w:color="${opts.leftBorderColor}"/></w:pBdr>`
        : '';
      const shadingXml = opts.shading
        ? `<w:shd w:val="clear" w:color="auto" w:fill="${opts.shading}"/>`
        : '';

      const rPr = [
        opts.bold ? '<w:b/>' : '',
        opts.italic ? '<w:i/>' : '',
        `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>`,
        `<w:color w:val="${color}"/>`
      ].join('');

      const runs = lines.map((line, i) => {
        const br = i > 0 ? '<w:br/>' : '';
        return `<w:r><w:rPr>${rPr}</w:rPr>${br}<w:t xml:space="preserve">${xmlEscape(line)}</w:t></w:r>`;
      }).join('');

      this.bodyBlocks.push(`
      <w:p>
        <w:pPr>
          <w:spacing w:before="${spaceBefore}" w:after="${spaceAfter}" w:line="276" w:lineRule="auto"/>
          ${alignXml}${indentXml}${borderXml}${shadingXml}
        </w:pPr>
        ${runs}
      </w:p>`);
    }

    addBullet(text, opts = {}) {
      this.addParagraph(`•  ${text}`, {
        size: opts.size || 20,
        color: opts.color || '1E293B',
        indentLeft: 320,
        spaceBefore: 30,
        spaceAfter: 60,
        ...opts
      });
    }

    addLinkParagraph(label, url) {
      if (!url) return;
      const rId = this.addHyperlinkRel(url);
      this.bodyBlocks.push(`
      <w:p>
        <w:pPr><w:spacing w:before="30" w:after="80"/></w:pPr>
        <w:r>
          <w:rPr><w:b/><w:sz w:val="19"/><w:color w:val="475569"/></w:rPr>
          <w:t xml:space="preserve">${xmlEscape(label)}: </w:t>
        </w:r>
        <w:hyperlink r:id="${rId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <w:r>
            <w:rPr><w:color w:val="1D4ED8"/><w:u w:val="single"/><w:sz w:val="19"/></w:rPr>
            <w:t xml:space="preserve">${xmlEscape(url)}</w:t>
          </w:r>
        </w:hyperlink>
      </w:p>`);
    }

    addDivider() {
      this.bodyBlocks.push(`
      <w:p>
        <w:pPr>
          <w:spacing w:before="80" w:after="120"/>
          <w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="E2E8F0"/></w:pBdr>
        </w:pPr>
      </w:p>`);
    }

    addCalloutBox(title, bodyText, borderColor = '1D9BF0', bgColor = 'F1F5F9') {
      const safeTitle = title ? `
        <w:p>
          <w:pPr><w:spacing w:before="40" w:after="60"/></w:pPr>
          <w:r><w:rPr><w:b/><w:sz w:val="20"/><w:color w:val="0F172A"/></w:rPr>
          <w:t xml:space="preserve">${xmlEscape(title)}</w:t></w:r>
        </w:p>` : '';

      const lines = String(bodyText || '').split('\n');
      const bodyParas = lines.map((line) => `
        <w:p>
          <w:pPr><w:spacing w:before="20" w:after="50" w:line="260" w:lineRule="auto"/></w:pPr>
          <w:r><w:rPr><w:sz w:val="19"/><w:color w:val="334155"/></w:rPr>
          <w:t xml:space="preserve">${xmlEscape(line)}</w:t></w:r>
        </w:p>`).join('');

      this.bodyBlocks.push(`
      <w:tbl>
        <w:tblPr>
          <w:tblW w:w="9000" w:type="dxa"/>
          <w:tblBorders>
            <w:top w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>
            <w:bottom w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>
            <w:right w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>
            <w:left w:val="single" w:sz="24" w:space="0" w:color="${borderColor}"/>
          </w:tblBorders>
          <w:tblCellMar>
            <w:top w:w="100" w:type="dxa"/>
            <w:bottom w:w="100" w:type="dxa"/>
            <w:left w:w="180" w:type="dxa"/>
            <w:right w:w="140" w:type="dxa"/>
          </w:tblCellMar>
        </w:tblPr>
        <w:tr>
          <w:tc>
            <w:tcPr>
              <w:tcW w:w="9000" w:type="dxa"/>
              <w:shd w:val="clear" w:color="auto" w:fill="${bgColor}"/>
            </w:tcPr>
            ${safeTitle}${bodyParas}
          </w:tc>
        </w:tr>
      </w:tbl>
      <w:p><w:pPr><w:spacing w:before="0" w:after="80"/></w:pPr></w:p>`);
    }

    addTable(headers, rows) {
      const colCount = headers.length;
      const colWidth = Math.floor(9000 / Math.max(1, colCount));

      const headerRow = `<w:tr>${headers.map((h) => `
        <w:tc>
          <w:tcPr>
            <w:tcW w:w="${colWidth}" w:type="dxa"/>
            <w:shd w:val="clear" w:color="auto" w:fill="E2E8F0"/>
          </w:tcPr>
          <w:p>
            <w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr>
            <w:r><w:rPr><w:b/><w:sz w:val="18"/><w:color w:val="0F172A"/></w:rPr>
            <w:t xml:space="preserve">${xmlEscape(h)}</w:t></w:r>
          </w:p>
        </w:tc>`).join('')}</w:tr>`;

      const dataRows = rows.map((row) => `<w:tr>${row.map((cell) => `
        <w:tc>
          <w:tcPr><w:tcW w:w="${colWidth}" w:type="dxa"/></w:tcPr>
          <w:p>
            <w:pPr><w:spacing w:before="30" w:after="30"/></w:pPr>
            <w:r><w:rPr><w:sz w:val="18"/><w:color w:val="334155"/></w:rPr>
            <w:t xml:space="preserve">${xmlEscape(cell)}</w:t></w:r>
          </w:p>
        </w:tc>`).join('')}</w:tr>`).join('');

      this.bodyBlocks.push(`
      <w:tbl>
        <w:tblPr>
          <w:tblW w:w="9000" w:type="dxa"/>
          <w:tblBorders>
            <w:top w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/>
            <w:bottom w:val="single" w:sz="6" w:space="0" w:color="CBD5E1"/>
            <w:left w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>
            <w:right w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>
            <w:insideH w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>
            <w:insideV w:val="single" w:sz="4" w:space="0" w:color="E2E8F0"/>
          </w:tblBorders>
          <w:tblCellMar>
            <w:top w:w="70" w:type="dxa"/>
            <w:bottom w:w="70" w:type="dxa"/>
            <w:left w:w="110" w:type="dxa"/>
            <w:right w:w="110" w:type="dxa"/>
          </w:tblCellMar>
        </w:tblPr>
        ${headerRow}${dataRows}
      </w:tbl>
      <w:p><w:pPr><w:spacing w:before="0" w:after="100"/></w:pPr></w:p>`);
    }

    build() {
      const zip = new MiniZip();

      // 1. [Content_Types].xml
      const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="jpg" ContentType="image/jpeg"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Default Extension="gif" ContentType="image/gif"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;
      zip.addFile('[Content_Types].xml', contentTypes);

      // 2. _rels/.rels
      const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;
      zip.addFile('_rels/.rels', rootRels);

      // 3. docProps/core.xml
      const createdIso = new Date().toISOString();
      const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${xmlEscape(this.meta.title || 'Saved X Thread')}</dc:title>
  <dc:creator>${xmlEscape(this.meta.authorName || 'TwReplyExport Pro')}</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">${createdIso}</dcterms:created>
</cp:coreProperties>`;
      zip.addFile('docProps/core.xml', coreXml);

      // 4. word/styles.xml
      const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>
        <w:sz w:val="21"/><w:szCs w:val="21"/>
        <w:color w:val="1E293B"/>
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:rPr><w:b/><w:sz w:val="44"/><w:color w:val="0F1419"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:outlineLvl w:val="0"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="1D4ED8"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:outlineLvl w:val="1"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="26"/><w:color w:val="0F172A"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:outlineLvl w:val="2"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="22"/><w:color w:val="334155"/></w:rPr>
  </w:style>
</w:styles>`;
      zip.addFile('word/styles.xml', stylesXml);

      // 5. word/_rels/document.xml.rels
      const relEntries = [
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
      ];
      for (const m of this.mediaFiles) {
        relEntries.push(
          `<Relationship Id="${m.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.filename}"/>`
        );
      }
      for (const l of this.links) {
        relEntries.push(
          `<Relationship Id="${l.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlEscape(l.url)}" TargetMode="External"/>`
        );
      }
      const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${relEntries.join('\n  ')}
</Relationships>`;
      zip.addFile('word/_rels/document.xml.rels', docRels);

      // 6. word/media/*
      for (const m of this.mediaFiles) {
        zip.addFile(`word/media/${m.filename}`, m.bytes);
      }

      // 7. word/document.xml
      const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    ${this.bodyBlocks.join('\n')}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;
      zip.addFile('word/document.xml', documentXml);

      return zip.generateUint8Array();
    }
  }

  const ZipDocx = { MiniZip, DocxBuilder, getImageDimensions, crc32 };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ZipDocx;
  } else {
    root.ZipDocx = ZipDocx;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
