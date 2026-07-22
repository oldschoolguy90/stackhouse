// Looks up book metadata for a scanned ISBN.
// Primary source: Open Library (free, no key). Fallback: Google Books.
const BookAPI = (() => {

  function parseSeriesString(raw) {
    // Open Library series strings look like "Mistborn ; 1" or "The Wheel of Time -- Book 3"
    // or just "Mistborn". Try to pull a trailing/positional number.
    if (!raw) return { seriesName: null, seriesPosition: null };
    let s = raw.trim();
    const match = s.match(/^(.*?)(?:[;,\-–—]+|\bbook\b|\bvol(?:ume)?\.?\b|#)\s*(\d+(?:\.\d+)?)\s*$/i);
    if (match) {
      return { seriesName: match[1].replace(/[;,\-–—\s]+$/, "").trim(), seriesPosition: parseFloat(match[2]) };
    }
    return { seriesName: s, seriesPosition: null };
  }

  async function fromOpenLibrary(isbn) {
    const editionRes = await fetch(`https://openlibrary.org/isbn/${isbn}.json`);
    if (!editionRes.ok) return null;
    const edition = await editionRes.json();

    let authorName = null;
    try {
      const authorKey = (edition.authors && edition.authors[0] && edition.authors[0].key) || null;
      if (authorKey) {
        const aRes = await fetch(`https://openlibrary.org${authorKey}.json`);
        if (aRes.ok) {
          const aData = await aRes.json();
          authorName = aData.name || null;
        }
      }
    } catch (_) { /* ignore, author optional */ }

    let seriesName = null, seriesPosition = null;
    if (edition.series && edition.series.length) {
      const parsed = parseSeriesString(edition.series[0]);
      seriesName = parsed.seriesName;
      seriesPosition = parsed.seriesPosition;
    }

    return {
      isbn,
      title: edition.title || "Untitled",
      author: authorName || "Unknown author",
      seriesName,
      seriesPosition,
      coverUrl: `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`,
    };
  }

  async function fromGoogleBooks(isbn) {
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
    if (!res.ok) return null;
    const data = await res.json();
    const item = data.items && data.items[0];
    if (!item) return null;
    const info = item.volumeInfo || {};
    return {
      isbn,
      title: info.title || "Untitled",
      author: (info.authors && info.authors.join(", ")) || "Unknown author",
      seriesName: null,
      seriesPosition: null,
      coverUrl: (info.imageLinks && (info.imageLinks.thumbnail || info.imageLinks.smallThumbnail)) || `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`,
    };
  }

  return {
    async lookup(isbn) {
      isbn = isbn.replace(/[^0-9Xx]/g, "");
      let result = null;
      try { result = await fromOpenLibrary(isbn); } catch (_) { /* fall through */ }
      if (!result || result.title === "Untitled" && result.author === "Unknown author") {
        try {
          const g = await fromGoogleBooks(isbn);
          if (g) result = result ? { ...g, seriesName: result.seriesName, seriesPosition: result.seriesPosition } : g;
        } catch (_) { /* fall through */ }
      }
      return result;
    },
  };
})();
