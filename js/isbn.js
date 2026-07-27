// ISBN validation + extraction helpers (shared by scanner, OCR, manual entry).
const ISBN = (() => {

  function isValidIsbn13(s) {
    if (!/^\d{13}$/.test(s)) return false;
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += parseInt(s[i], 10) * (i % 2 === 0 ? 1 : 3);
    return (10 - (sum % 10)) % 10 === parseInt(s[12], 10);
  }

  function isValidIsbn10(s) {
    if (!/^\d{9}[\dXx]$/.test(s)) return false;
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += parseInt(s[i], 10) * (10 - i);
    const last = s[9].toUpperCase() === "X" ? 10 : parseInt(s[9], 10);
    sum += last;
    return sum % 11 === 0;
  }

  // Convert a valid ISBN-10 to ISBN-13 (978 prefix). Lookups all accept 13.
  function isbn10to13(s) {
    const core = "978" + s.slice(0, 9);
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += parseInt(core[i], 10) * (i % 2 === 0 ? 1 : 3);
    const check = (10 - (sum % 10)) % 10;
    return core + check;
  }

  // Normalise any user/OCR input to a canonical ISBN-13 if possible.
  // Returns { isbn13, valid, kind } — kind: '13' | '10' | null
  function normalize(raw) {
    const cleaned = (raw || "").replace(/[^0-9Xx]/g, "").toUpperCase();
    if (isValidIsbn13(cleaned)) return { isbn13: cleaned, valid: true, kind: "13" };
    if (isValidIsbn10(cleaned)) return { isbn13: isbn10to13(cleaned), valid: true, kind: "10" };
    return { isbn13: cleaned, valid: false, kind: null };
  }

  // Pull the most likely ISBN out of a blob of OCR text.
  // Looks for 13- or 10-digit runs (allowing separators) and returns the first
  // that passes checksum; if none validate, returns the longest digit run so the
  // user can correct it by hand.
  function extractFromText(text) {
    const compact = (text || "").replace(/[^0-9Xx\s\-]/g, " ");
    // candidate sequences of digits/X with optional dashes/spaces between
    const candidates = compact.match(/[\dXx][\dXx\s\-]{8,16}[\dXx]/g) || [];
    let longest = "";
    for (const c of candidates) {
      const digits = c.replace(/[^0-9Xx]/g, "");
      if (digits.length === 13 && isValidIsbn13(digits)) return { isbn: digits, valid: true };
      if (digits.length === 10 && isValidIsbn10(digits)) return { isbn: digits, valid: true };
      if (digits.length > longest.length) longest = digits;
    }
    // also try any 13/10 digit run directly
    const run13 = (compact.replace(/[^0-9Xx]/g, "").match(/\d{13}/) || [])[0];
    if (run13 && isValidIsbn13(run13)) return { isbn: run13, valid: true };
    return { isbn: longest.slice(0, 13), valid: false };
  }

  return { isValidIsbn13, isValidIsbn10, isbn10to13, normalize, extractFromText };
})();
