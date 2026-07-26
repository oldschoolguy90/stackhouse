// Looks up book metadata for a scanned ISBN.
// If an ISBNdb key is saved, ISBNdb is the top-priority source (paid, best
// coverage). Google Books and Open Library run alongside it for free — Google
// mainly for mainstream titles, Open Library for series info the others lack.
// All three run in parallel; results are merged by priority, so one slow or
// failing source never blocks the others.
const BookAPI = (() => {

  function parseSeriesString(raw) {
    if (!raw) return { seriesName: null, seriesPosition: null };
    let s = String(raw).trim();
    const match = s.match(/^(.*?)(?:[;,\-–—]+|\bbook\b|\bvol(?:ume)?\.?\b|#)\s*(\d+(?:\.\d+)?)\s*$/i);
    if (match) {
      return { seriesName: match[1].replace(/[;,\-–—\s]+$/, "").trim(), seriesPosition: parseFloat(match[2]) };
    }
    return { seriesName: s, seriesPosition: null };
  }

  async function fromISBNdb(isbn, key) {
    // Basic-plan base URL. Auth is the raw key in the Authorization header.
    let res;
    try {
      res = await fetch(`https://api2.isbndb.com/book/${isbn}`, {
        headers: { "Authorization": key },
      });
    } catch (e) {
      // The fetch itself failed — almost always a CORS block or no network.
      // This is a HARD failure: ISBNdb couldn't be reached at all.
      const err = new Error("ISBNdb unreachable"); err.hard = true; err.kind = "unreachable"; throw err;
    }
    if (res.status === 404) return null;                 // reached ISBNdb; book just isn't in it
    if (res.status === 401 || res.status === 403) {
      const err = new Error("ISBNdb auth"); err.hard = true; err.kind = "auth"; throw err;
    }
    if (res.status === 429) {
      const err = new Error("ISBNdb rate limit"); err.hard = true; err.kind = "rate"; throw err;
    }
    if (!res.ok) {
      const err = new Error("ISBNdb error"); err.hard = true; err.kind = "error"; throw err;
    }
    const data = await res.json();
    const b = data && data.book;
    if (!b) return null;
    let cover = b.image || null;
    if (cover) cover = cover.replace(/^http:/, "https:");
    return {
      isbn,
      title: b.title_long || b.title || null,
      author: (b.authors && b.authors.length) ? b.authors.join(", ") : null,
      seriesName: null,          // ISBNdb has no clean series field
      seriesPosition: null,
      coverUrl: cover,
    };
  }

  async function fromGoogleBooks(isbn) {
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
    if (!res.ok) return null;
    const data = await res.json();
    const item = data.items && data.items[0];
    if (!item) return null;
    const info = item.volumeInfo || {};
    let coverUrl = null;
    if (info.imageLinks) {
      coverUrl = info.imageLinks.thumbnail || info.imageLinks.smallThumbnail || null;
      if (coverUrl) coverUrl = coverUrl.replace(/^http:/, "https:");
    }
    let seriesName = null, seriesPosition = null;
    const seriesMatch = (info.title || "").match(/\(([^,)]+),?\s*#?(\d+(?:\.\d+)?)\)/);
    if (seriesMatch) {
      seriesName = seriesMatch[1].trim();
      seriesPosition = parseFloat(seriesMatch[2]);
    }
    return {
      isbn,
      title: info.title || null,
      author: (info.authors && info.authors.join(", ")) || null,
      seriesName,
      seriesPosition,
      coverUrl,
    };
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
        if (aRes.ok) authorName = (await aRes.json()).name || null;
      }
    } catch (_) {}
    let seriesName = null, seriesPosition = null;
    if (edition.series && edition.series.length) {
      const parsed = parseSeriesString(edition.series[0]);
      seriesName = parsed.seriesName;
      seriesPosition = parsed.seriesPosition;
    }
    return {
      isbn,
      title: edition.title || null,
      author: authorName,
      seriesName,
      seriesPosition,
      coverUrl: `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`,
    };
  }

  const safe = (p) => p.then((v) => v).catch(() => null);

  return {
    async lookup(isbn) {
      isbn = isbn.replace(/[^0-9Xx]/g, "");
      let key = null;
      try { key = await DB.getMeta("isbndbKey"); } catch (_) {}

      // ISBNdb runs alongside the free sources but keeps its error, so the app
      // can alert the user when a paid lookup genuinely fails (vs. book-not-found).
      const isbndbTask = key
        ? fromISBNdb(isbn, key).then((r) => ({ result: r, error: null }))
            .catch((e) => ({ result: null, error: e && e.hard ? (e.kind || "error") : null }))
        : Promise.resolve({ result: null, error: null });

      const [isbndbWrap, google, ol] = await Promise.all([
        isbndbTask,
        safe(fromGoogleBooks(isbn)),
        safe(fromOpenLibrary(isbn)),
      ]);
      const isbndb = isbndbWrap.result;
      const isbndbError = isbndbWrap.error;   // null | 'unreachable' | 'auth' | 'rate' | 'error'

      if (!isbndb && !google && !ol) {
        return { isbn, title: null, author: null, seriesName: null, seriesPosition: null,
                 coverUrl: `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`, found: false, isbndbError };
      }

      // priority for core fields: ISBNdb -> Google -> Open Library
      const pick = (f) => (isbndb && isbndb[f]) || (google && google[f]) || (ol && ol[f]) || null;
      const seriesName = (google && google.seriesName) || (ol && ol.seriesName) || null;
      const seriesPosition = (google && google.seriesPosition) || (ol && ol.seriesPosition) || null;

      return {
        isbn,
        title: pick("title"),
        author: pick("author"),
        seriesName,
        seriesPosition,
        coverUrl: pick("coverUrl") || `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`,
        found: true,
        source: isbndb ? "ISBNdb" : (google ? "Google Books" : "Open Library"),
        isbndbError,
      };
    },
  };
})();
