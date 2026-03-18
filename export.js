// ============================================
// TwReplyExport — Export Utilities
// CSV, JSON, XLSX export + file download
// ============================================

const ExportUtils = {
  /**
   * Convert array of reply objects to CSV string
   */
  toCSV(data, options = {}) {
    if (!data || data.length === 0) return "";

    const includeMetrics = options.includeMetrics !== false;
    const includeUserInfo = options.includeUserInfo !== false;

    // Define columns
    let columns = [
      { key: "displayName", label: "Display Name" },
      { key: "handle", label: "Handle" },
      { key: "text", label: "Reply Text" },
      { key: "timestamp", label: "Timestamp" },
    ];

    if (includeMetrics) {
      columns.push(
        { key: "likes", label: "Likes" },
        { key: "retweets", label: "Retweets" },
        { key: "replies", label: "Replies" },
        { key: "views", label: "Views" },
      );
    }

    if (includeUserInfo) {
      columns.push(
        { key: "profileUrl", label: "Profile URL" },
        { key: "userBio", label: "User Bio" },
        { key: "userWebsite", label: "Website" },
        { key: "userLocation", label: "Location" },
        { key: "followerCount", label: "Followers" },
        { key: "followingCount", label: "Following" },
      );
    }

    // CSV escape function
    const escape = (val) => {
      if (val === null || val === undefined) return "";
      const str = String(val);
      if (
        str.includes(",") ||
        str.includes('"') ||
        str.includes("\n") ||
        str.includes("\r")
      ) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    // Build CSV
    const header = columns.map((c) => escape(c.label)).join(",");
    const rows = data.map((row) =>
      columns.map((c) => escape(row[c.key])).join(","),
    );

    return "\uFEFF" + header + "\n" + rows.join("\n"); // BOM for Excel UTF-8
  },

  /**
   * Convert array of reply objects to pretty-printed JSON
   */
  toJSON(data, options = {}) {
    if (!data || data.length === 0) return "[]";

    const includeMetrics = options.includeMetrics !== false;
    const includeUserInfo = options.includeUserInfo !== false;

    const filtered = data.map((item) => {
      const obj = {
        displayName: item.displayName || "",
        handle: item.handle || "",
        text: item.text || "",
        timestamp: item.timestamp || "",
      };

      if (includeMetrics) {
        obj.likes = item.likes || 0;
        obj.retweets = item.retweets || 0;
        obj.replies = item.replies || 0;
        obj.views = item.views || 0;
      }

      if (includeUserInfo) {
        obj.profileUrl = item.profileUrl || "";
        obj.userBio = item.userBio || "";
        obj.userWebsite = item.userWebsite || "";
        obj.userLocation = item.userLocation || "";
        obj.followerCount = item.followerCount || 0;
        obj.followingCount = item.followingCount || 0;
      }

      return obj;
    });

    return JSON.stringify(filtered, null, 2);
  },

  /**
   * Convert array of reply objects to XLSX using SheetJS
   */
  toXLSX(data, options = {}) {
    if (typeof XLSX === "undefined") {
      console.error("SheetJS library not loaded");
      return null;
    }

    if (!data || data.length === 0) return null;

    const includeMetrics = options.includeMetrics !== false;
    const includeUserInfo = options.includeUserInfo !== false;

    const rows = data.map((item) => {
      const row = {
        "Display Name": item.displayName || "",
        Handle: item.handle || "",
        "Reply Text": item.text || "",
        Timestamp: item.timestamp || "",
      };

      if (includeMetrics) {
        row["Likes"] = item.likes || 0;
        row["Retweets"] = item.retweets || 0;
        row["Replies"] = item.replies || 0;
        row["Views"] = item.views || 0;
      }

      if (includeUserInfo) {
        row["Profile URL"] = item.profileUrl || "";
        row["User Bio"] = item.userBio || "";
        row["Website"] = item.userWebsite || "";
        row["Location"] = item.userLocation || "";
        row["Followers"] = item.followerCount || 0;
        row["Following"] = item.followingCount || 0;
      }

      return row;
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Replies");
    return XLSX.write(wb, { bookType: "xlsx", type: "array" });
  },

  /**
   * Trigger a file download in the browser
   */
  downloadFile(content, filename, mimeType) {
    let blob;
    if (content instanceof ArrayBuffer || content instanceof Uint8Array) {
      blob = new Blob([content], { type: mimeType });
    } else {
      blob = new Blob([content], { type: mimeType + ";charset=utf-8" });
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  /**
   * Export data in the specified format and trigger download
   */
  exportData(data, format, tweetUrl, options = {}) {
    const timestamp = new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/[:-]/g, "");
    const urlParts = tweetUrl.match(/status\/(\d+)/);
    const tweetId = urlParts ? urlParts[1] : "export";
    const baseFilename = `tw_replies_${tweetId}_${timestamp}`;

    switch (format) {
      case "csv": {
        const csv = this.toCSV(data, options);
        this.downloadFile(csv, `${baseFilename}.csv`, "text/csv");
        break;
      }
      case "json": {
        const json = this.toJSON(data, options);
        this.downloadFile(json, `${baseFilename}.json`, "application/json");
        break;
      }
      case "xlsx": {
        const xlsxData = this.toXLSX(data, options);
        if (xlsxData) {
          this.downloadFile(
            xlsxData,
            `${baseFilename}.xlsx`,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          );
        }
        break;
      }
    }
  },
};
