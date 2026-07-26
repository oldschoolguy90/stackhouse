// ---------------------------------------------------------------
// Stackhouse — main app logic
// ---------------------------------------------------------------
let books = [];
let currentSort = "title";
let currentSearch = "";
let scanMode = null;              // 'add' | 'checkout' | 'bulk' | null
let checkoutBorrower = null;
let editingId = null;
let syncTimer = null;
let isbndbWarnedThisSession = false;
let lastIsbndbError = null;
let reviewFilter = false;         // library shows only books needing attention
let bulkCount = 0;
let currentScreen = "library";

const $ = (id) => document.getElementById(id);

// ---------- back-button handling ----------
// Standard installable-app behaviour: the Back button closes whatever overlay
// is open (scanner or a sheet); if nothing's open, it returns to the Library
// tab; only from an idle Library does it actually leave the app. Implemented by
// seeding one buffer history entry and, on each Back, closing the topmost thing
// and restoring the buffer so we don't fall out of the app mid-task.
const Nav = (() => {
  function closeTopOverlay() {
    if ($("isbndb-alert-backdrop").classList.contains("active")) {
      $("isbndb-alert-backdrop").classList.remove("active");
      return true;
    }
    if ($("scanner-view").classList.contains("active")) {
      closeScanner();
      return true;
    }
    const openSheets = Array.from(document.querySelectorAll(".sheet-backdrop.active"));
    if (openSheets.length) {
      openSheets[openSheets.length - 1].classList.remove("active");
      return true;
    }
    return false;
  }

  function handlePop() {
    if (closeTopOverlay()) {
      history.pushState({ app: "stackhouse" }, "");   // restore buffer, stay in app
      return;
    }
    if (currentScreen !== "library") {
      switchScreen("library");
      history.pushState({ app: "stackhouse" }, "");
      return;
    }
    // idle on Library — allow the app to actually close
    history.back();
  }

  function seed() {
    history.pushState({ app: "stackhouse" }, "");
    window.addEventListener("popstate", handlePop);
  }
  return { seed };
})();

// a book "needs attention" if it's unreviewed (from bulk) or flagged as a duplicate
const needsAttention = (b) => !!(b.needsReview || b.possibleDuplicate);

// ---------- boot ----------
window.addEventListener("DOMContentLoaded", init);

async function init() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  wireNav();
  wireLibraryScreen();
  wireCheckoutScreen();
  wireCheckoutNameSheet();
  wireCheckoutPicker();
  wireSettingsScreen();
  wireIsbndbSettings();
  wireIsbndbAlert();
  wireScanner();
  wireBookSheet();
  wireManualAdd();
  wireDropboxSetup();

  try {
    const redirected = await DropboxSync.handleRedirectIfPresent();
    if (redirected) toast("Dropbox connected");
  } catch (err) {
    toast(err.message);
  }

  await loadBooks();
  renderAll();
  await refreshSettingsScreen();

  if (await DropboxSync.isConnected()) {
    doSync(true);
    syncTimer = setInterval(() => doSync(true), 60000);
  }
  window.addEventListener("online", () => doSync(true));
  Nav.seed();
}

async function loadBooks() {
  books = await DB.getAllBooks();
}

function renderAll() {
  renderLibrary();
  renderSeries();
  renderCheckout();
}

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2600);
}

// ---------- navigation ----------
function wireNav() {
  document.querySelectorAll(".navbtn").forEach((btn) => {
    btn.addEventListener("click", () => switchScreen(btn.dataset.screen));
  });
  $("scan-fab").addEventListener("click", () => openScanner("add"));
}

const titles = { library: "Library", series: "Series", checkout: "Checkout", settings: "Settings" };

function switchScreen(name) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.querySelectorAll(".navbtn").forEach((b) => b.classList.toggle("active", b.dataset.screen === name));
  $(`screen-${name}`).classList.add("active");
  $("screen-title").firstChild.textContent = titles[name];
  currentScreen = name;
  if (name === "settings") refreshSettingsScreen();
}

// ---------- LIBRARY ----------
function wireLibraryScreen() {
  $("library-search").addEventListener("input", (e) => {
    currentSearch = e.target.value.toLowerCase();
    renderLibrary();
  });
  document.querySelectorAll("#sort-row .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll("#sort-row .chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      currentSort = chip.dataset.sort;
      renderLibrary();
    });
  });
  $("bulk-add-btn").addEventListener("click", () => openScanner("bulk"));
  $("review-banner").addEventListener("click", () => {
    reviewFilter = !reviewFilter;
    renderLibrary();
  });
}

function filteredBooks() {
  let list = books.slice();
  if (reviewFilter) list = list.filter(needsAttention);
  if (currentSearch) {
    list = list.filter((b) =>
      (b.title || "").toLowerCase().includes(currentSearch) ||
      (b.author || "").toLowerCase().includes(currentSearch) ||
      (b.seriesName || "").toLowerCase().includes(currentSearch)
    );
  }
  return list;
}

function sortBooks(list) {
  const arr = list.slice();
  if (currentSort === "title") arr.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  else if (currentSort === "author") arr.sort((a, b) => (a.author || "").localeCompare(b.author || ""));
  else if (currentSort === "series") arr.sort((a, b) => (a.seriesName || "zzzz").localeCompare(b.seriesName || "zzzz") || ((a.seriesPosition || 0) - (b.seriesPosition || 0)));
  else if (currentSort === "recent") arr.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  return arr;
}

function renderReviewBanner() {
  const count = books.filter(needsAttention).length;
  const banner = $("review-banner");
  if (count === 0) { banner.style.display = "none"; reviewFilter = false; return; }
  banner.style.display = "block";
  banner.classList.toggle("active-filter", reviewFilter);
  banner.textContent = reviewFilter
    ? `Showing ${count} to review · tap to show all books`
    : `${count} book${count === 1 ? "" : "s"} need review · tap to review`;
}

function renderLibrary() {
  renderReviewBanner();
  const list = sortBooks(filteredBooks());
  $("header-count").textContent = `${books.length} book${books.length === 1 ? "" : "s"}`;
  const container = $("library-list");
  if (!list.length) {
    container.innerHTML = reviewFilter
      ? emptyState("Nothing to review", "All caught up — tap the banner to see everything.")
      : emptyState("No books yet", "Tap the scan button below to add your first one.");
    return;
  }
  container.innerHTML = list.map(bookCardHTML).join("");
  container.querySelectorAll(".book-card").forEach((el) => {
    el.addEventListener("click", () => openBookSheet(el.dataset.id));
  });
}

function tagsHTML(b) {
  const tags = [];
  if (b.needsReview) tags.push(`<span class="book-tag review">needs review</span>`);
  if (b.possibleDuplicate) tags.push(`<span class="book-tag dup">possible duplicate</span>`);
  return tags.length ? `<div class="book-tags">${tags.join("")}</div>` : "";
}

function bookCardHTML(b) {
  const statusHTML = b.checkedOutTo
    ? `<div class="book-status">Out to ${escapeHTML(b.checkedOutTo)}</div>`
    : "";
  const seriesMeta = b.seriesName
    ? `<div class="book-meta">${escapeHTML(b.seriesName)}${b.seriesPosition ? " #" + b.seriesPosition : ""}</div>`
    : "";
  const cls = ["book-card"];
  if (b.checkedOutTo) cls.push("checked-out");
  if (needsAttention(b)) cls.push("review-flag");
  return `
    <div class="${cls.join(" ")}" data-id="${b.id}">
      <img class="book-cover" src="${b.coverUrl || ""}" onerror="this.style.visibility='hidden'" />
      <div class="book-info">
        <p class="book-title">${escapeHTML(b.title || "(no title yet)")}</p>
        <p class="book-author">${escapeHTML(b.author || "—")}</p>
        ${seriesMeta}
        ${statusHTML}
        ${tagsHTML(b)}
      </div>
    </div>`;
}

function escapeHTML(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function emptyState(title, body) {
  return `<div class="empty-state"><h3>${title}</h3><p>${body}</p></div>`;
}

// ---------- SERIES / MISSING ----------
function analyzeSeries(group) {
  const positions = group.map((b) => b.seriesPosition).filter((p) => Number.isInteger(p) && p > 0);
  const manualTotal = Math.max(0, ...group.map((b) => b.seriesTotal || 0));
  const maxKnown = positions.length ? Math.max(...positions) : 0;
  const total = manualTotal || maxKnown;
  const owned = new Set(positions);
  const missing = [];
  for (let i = 1; i <= total; i++) if (!owned.has(i)) missing.push(i);
  return { missing, total };
}

function renderSeries() {
  const groups = {};
  const standalone = [];
  for (const b of books) {
    if (b.seriesName) (groups[b.seriesName] = groups[b.seriesName] || []).push(b);
    else standalone.push(b);
  }
  const names = Object.keys(groups).sort((a, b) => a.localeCompare(b));
  const container = $("series-list");
  if (!names.length) {
    container.innerHTML = emptyState("No series tracked yet", "Add a series name to any book to start tracking gaps.");
    return;
  }
  let html = "";
  for (const name of names) {
    const group = groups[name].slice().sort((a, b) => (a.seriesPosition || 999) - (b.seriesPosition || 999));
    const { missing, total } = analyzeSeries(group);
    html += `<div class="series-group">
      <div class="series-header">
        <span>${escapeHTML(name)} ${total ? `<span class="series-count">${group.length} of ${total}</span>` : `<span class="series-count">${group.length} owned</span>`}
        ${missing.length ? `<span class="missing-pill">Missing #${missing.join(", #")}</span>` : ""}</span>
      </div>
      ${group.map(bookCardHTML).join("")}
    </div>`;
  }
  if (standalone.length) {
    html += `<div class="series-group">
      <div class="series-header"><span>Standalone</span></div>
      ${standalone.slice().sort((a, b) => (a.title || "").localeCompare(b.title || "")).map(bookCardHTML).join("")}
    </div>`;
  }
  container.innerHTML = html;
  container.querySelectorAll(".book-card").forEach((el) => {
    el.addEventListener("click", () => openBookSheet(el.dataset.id));
  });
}

// ---------- CHECKOUT ----------
function wireCheckoutScreen() {
  $("new-checkout-btn").addEventListener("click", openCheckoutNameSheet);
}

function renderCheckout() {
  const out = books.filter((b) => b.checkedOutTo).sort((a, b) => (b.checkedOutAt || 0) - (a.checkedOutAt || 0));
  const container = $("checkout-list");
  if (!out.length) {
    container.innerHTML = emptyState("Nothing checked out", "Everything's on the shelf. Tap above to check a book out to someone.");
    return;
  }
  container.innerHTML = out.map((b) => `
    <div class="book-card checked-out" data-id="${b.id}">
      <img class="book-cover" src="${b.coverUrl || ""}" onerror="this.style.visibility='hidden'" />
      <div class="book-info">
        <p class="book-title">${escapeHTML(b.title || "(no title)")}</p>
        <p class="book-author">${escapeHTML(b.author || "—")}</p>
        <div class="book-status">Out to ${escapeHTML(b.checkedOutTo)} · tap to check in</div>
      </div>
    </div>`).join("");
  container.querySelectorAll(".book-card").forEach((el) => {
    el.addEventListener("click", async () => {
      const b = await DB.getById(el.dataset.id);
      if (!b) return;
      b.checkedOutTo = null; b.checkedOutAt = null;
      await DB.putBook(b);
      toast(`Checked in: ${b.title || "book"}`);
      await loadBooks();
      renderAll();
      maybeAutoSync();
    });
  });
}

// ---------- SETTINGS ----------
function wireSettingsScreen() {
  $("sync-now-btn").addEventListener("click", () => doSync(false));
  $("disconnect-btn").addEventListener("click", async () => {
    await DropboxSync.disconnect();
    toast("Dropbox disconnected");
    refreshSettingsScreen();
  });
  $("manual-add-btn").addEventListener("click", () => {
    ["ma-isbn", "ma-title", "ma-author", "ma-series", "ma-position"].forEach((id) => ($(id).value = ""));
    $("manual-add-backdrop").classList.add("active");
  });
}

async function refreshSettingsScreen() {
  const connected = await DropboxSync.isConnected();
  $("dropbox-status").textContent = connected ? "Connected — syncing automatically" : "Not connected";
  $("disconnect-btn").style.display = connected ? "block" : "none";
  $("dropbox-setup").innerHTML = connected ? "" : `<button class="btn btn-primary" id="open-dropbox-setup">Set up Dropbox</button>`;
  const btn = $("open-dropbox-setup");
  if (btn) btn.addEventListener("click", async () => {
    $("redirect-uri-display").textContent = location.origin + location.pathname;
    const existingKey = await DropboxSync.getAppKey();
    $("dropbox-app-key-input").value = existingKey || "";
    $("dropbox-setup-backdrop").classList.add("active");
  });

  await refreshIsbndbStatus();

  const outCount = books.filter((b) => b.checkedOutTo).length;
  const seriesCount = new Set(books.filter((b) => b.seriesName).map((b) => b.seriesName)).size;
  const lastSync = await DB.getMeta("lastSyncedAt");
  $("stats-text").textContent = `${books.length} books · ${seriesCount} series tracked · ${outCount} checked out` +
    (lastSync ? ` · last synced ${new Date(lastSync).toLocaleString()}` : "");
}

async function refreshIsbndbStatus() {
  const key = await DB.getMeta("isbndbKey");
  if (key) {
    if (lastIsbndbError) {
      const label = lastIsbndbError === "unreachable" ? "can't be reached from the browser (CORS)"
        : lastIsbndbError === "auth" ? "rejected your key"
        : lastIsbndbError === "rate" ? "hit its rate limit"
        : "returned an error";
      $("isbndb-status").innerHTML = `<span style="color:var(--rust);font-weight:600;">⚠ ISBNdb ${label}. Scans are using the free sources.</span>`;
    } else {
      $("isbndb-status").textContent = "Active — ISBNdb is checked first on every scan.";
    }
    $("isbndb-key-input").value = "••••••••" + key.slice(-4);
    $("isbndb-clear-btn").style.display = "block";
  } else {
    $("isbndb-status").textContent = "Not set — using free sources (Google Books & Open Library).";
    $("isbndb-key-input").value = "";
    $("isbndb-clear-btn").style.display = "none";
  }
}

function wireIsbndbSettings() {
  $("isbndb-save-btn").addEventListener("click", async () => {
    const val = $("isbndb-key-input").value.trim();
    if (!val || val.startsWith("••••")) { toast("Paste a new key first"); return; }
    await DB.setMeta("isbndbKey", val);
    lastIsbndbError = null;
    isbndbWarnedThisSession = false;
    toast("ISBNdb key saved");
    refreshIsbndbStatus();
    maybeAutoSync();
  });
  $("isbndb-clear-btn").addEventListener("click", async () => {
    await DB.setMeta("isbndbKey", null);
    lastIsbndbError = null;
    toast("ISBNdb key removed");
    refreshIsbndbStatus();
    maybeAutoSync();
  });
}

const ISBNDB_MESSAGES = {
  unreachable: "ISBNdb couldn't be reached from the app at all. This is almost certainly the browser CORS restriction we discussed — meaning ISBNdb can't be called directly from a web page, and your subscription isn't doing anything here. Scans are falling back to the free sources. If you don't want to pay for something the app can't use, cancel the ISBNdb subscription — or ask to have a proxy set up, which would make it work.",
  auth: "ISBNdb rejected your API key (it may be wrong, expired, or the subscription lapsed). Until it's fixed, scans are using the free sources. Double-check the key in Settings.",
  rate: "ISBNdb hit its rate limit, so this scan used the free sources instead. This is usually temporary — if it keeps happening, your plan's request limit may be too low.",
  error: "ISBNdb returned an unexpected error, so this scan used the free sources. If it persists, something's off on ISBNdb's end or with the subscription.",
};

function showIsbndbAlert(kind) {
  $("isbndb-alert-title").textContent =
    kind === "rate" ? "ISBNdb rate-limited" :
    kind === "auth" ? "ISBNdb rejected your key" :
    "ISBNdb isn't working";
  $("isbndb-alert-body").textContent = ISBNDB_MESSAGES[kind] || ISBNDB_MESSAGES.error;
  $("isbndb-alert-backdrop").classList.add("active");
}

function wireIsbndbAlert() {
  $("isbndb-alert-close").addEventListener("click", () => $("isbndb-alert-backdrop").classList.remove("active"));
  $("isbndb-alert-dismiss").addEventListener("click", () => $("isbndb-alert-backdrop").classList.remove("active"));
  $("isbndb-alert-settings").addEventListener("click", () => {
    $("isbndb-alert-backdrop").classList.remove("active");
    $("scan-result-backdrop").classList.remove("active");
    switchScreen("settings");
  });
}

function noteIsbndbError(kind, opts) {
  if (!kind) return;
  lastIsbndbError = kind;
  const silent = opts && opts.silent;
  if (!silent && !isbndbWarnedThisSession) {
    isbndbWarnedThisSession = true;
    showIsbndbAlert(kind);
  }
}

// ---------- SYNC ----------
async function doSync(silent) {
  const dot = $("sync-dot");
  if (!(await DropboxSync.isConnected())) {
    if (!silent) toast("Connect Dropbox first, in Settings.");
    return;
  }
  dot.classList.add("syncing");
  try {
    const result = await DropboxSync.sync();
    await loadBooks();
    renderAll();
    if (!silent) toast(`Synced — ${result.count} books`);
  } catch (err) {
    dot.classList.add("offline");
    if (!silent) toast(err.message);
  } finally {
    dot.classList.remove("syncing");
    setTimeout(() => dot.classList.remove("offline"), 4000);
  }
}

function maybeAutoSync() {
  DropboxSync.isConnected().then((c) => { if (c) doSync(true); });
}

// ---------- SCANNER ----------
function wireScanner() {
  $("scanner-close").addEventListener("click", closeScanner);
  $("scanner-manual-btn").addEventListener("click", async () => {
    await Scanner.stop();
    $("scanner-view").classList.remove("active");
    if (scanMode === "checkout") {
      openCheckoutPicker();
    } else {
      openScanResultForm({ isbn: "", title: null, author: null, seriesName: null, seriesPosition: null,
                           coverUrl: "", found: false }, true);
    }
  });
  $("scan-result-close").addEventListener("click", () => $("scan-result-backdrop").classList.remove("active"));
}

async function openScanner(mode) {
  scanMode = mode;
  if (mode === "bulk") bulkCount = 0;
  $("scanner-title").textContent =
    mode === "checkout" ? `Scanning for ${checkoutBorrower}` :
    mode === "bulk" ? "Bulk scan" :
    "Scan a book's barcode";
  $("scanner-status").textContent =
    mode === "bulk" ? "Scan away — each book is saved for review. Tap ✕ when done."
    : "Point your camera at the barcode";
  $("scanner-manual-btn").textContent = mode === "checkout" ? "Pick from a list instead" : "Enter manually instead";
  $("scanner-manual-btn").style.display = mode === "bulk" ? "none" : "block";
  $("scanner-view").classList.add("active");
  await Scanner.start("qr-reader", onCodeScanned, () => {
    $("scanner-status").textContent = "Camera unavailable — check permissions in your browser settings.";
  });
}

async function closeScanner() {
  const wasBulk = scanMode === "bulk";
  const n = bulkCount;
  await Scanner.stop();
  $("scanner-view").classList.remove("active");
  scanMode = null;
  checkoutBorrower = null;
  if (wasBulk) {
    await loadBooks();
    if (n > 0) {
      reviewFilter = true;
      switchScreen("library");
      renderAll();
      toast(`Added ${n} book${n === 1 ? "" : "s"} — review them here`);
      maybeAutoSync();
    }
  }
}

async function onCodeScanned(code, isBook) {
  if (!isBook) {
    // Not a Bookland EAN-13 — likely a price add-on, UPC, or a misread.
    $("scanner-status").textContent = "That's not a book barcode — line up the main barcode (starts 978/979).";
    if (navigator.vibrate) navigator.vibrate(60);
    return;
  }
  if (scanMode === "add") {
    $("scanner-status").textContent = `Found ${code} — looking it up…`;
    await handleAddScan(code);
  } else if (scanMode === "checkout") {
    await handleCheckoutScan(code);
  } else if (scanMode === "bulk") {
    await handleBulkScan(code);
  }
}

// ----- single add flow: always lands on an editable form; dups are saved + flagged -----
async function handleAddScan(isbn) {
  const dupes = await DB.getByIsbn(isbn);
  let info;
  try { info = await BookAPI.lookup(isbn); }
  catch (_) { info = { isbn, title: null, author: null, seriesName: null, seriesPosition: null, coverUrl: "", found: false }; }
  await Scanner.stop();
  $("scanner-view").classList.remove("active");
  if (info.isbndbError) noteIsbndbError(info.isbndbError);
  info._possibleDuplicate = dupes.length > 0;
  openScanResultForm(info, false);
}

function openScanResultForm(info, isManual) {
  const found = info.found !== false && (info.title || info.author);
  $("sr-heading").textContent = found ? "Confirm the details" : "Enter the details";
  $("sr-subtitle").textContent = found
    ? `Found via ${info.source || "online"} — check the fields and edit anything that's off.`
    : (isManual ? "Type the book's details below." : "Couldn't find this one online — fill it in yourself.");

  const warnBanner = info.isbndbError
    ? `<div class="isbndb-warn">⚠ ISBNdb didn't answer (${info.isbndbError}). Used ${info.source || "free sources"} instead — see Settings for details.</div>`
    : "";
  const dupBanner = info._possibleDuplicate
    ? `<div class="isbndb-warn">⚠ You may already own this — it'll be saved and flagged as a possible duplicate so you can review it.</div>`
    : "";

  $("sr-body").innerHTML = `
    ${warnBanner}
    ${dupBanner}
    <label>ISBN / code</label>
    <input id="sr-isbn" value="${escapeHTML(info.isbn || "")}" placeholder="scan code or type one" ${isManual ? "" : "readonly"} />
    <label>Title</label>
    <input id="sr-title" value="${escapeHTML(info.title || "")}" placeholder="Book title" />
    <label>Author</label>
    <input id="sr-author" value="${escapeHTML(info.author || "")}" placeholder="Author name" />
    <label>Series name</label>
    <input id="sr-series" value="${escapeHTML(info.seriesName || "")}" placeholder="e.g. Mistborn" />
    <label>Position in series</label>
    <input id="sr-position" type="number" step="0.5" value="${info.seriesPosition || ""}" />
    <button class="btn btn-primary" id="sr-save">Add to library</button>
    <button class="btn btn-outline" id="sr-scan-next">Save &amp; scan next</button>
    <button class="btn btn-outline" id="sr-cancel">Cancel</button>
  `;

  const save = async (scanAgain) => {
    const isbn = ($("sr-isbn").value.trim()) || "";
    const title = $("sr-title").value.trim();
    if (!title) { toast("A title is required"); return; }
    const book = {
      isbn,
      title,
      author: $("sr-author").value.trim() || "Unknown author",
      coverUrl: info.coverUrl || (isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg` : ""),
      seriesName: $("sr-series").value.trim() || null,
      seriesPosition: $("sr-position").value ? parseFloat($("sr-position").value) : null,
      seriesTotal: null,
      checkedOutTo: null,
      checkedOutAt: null,
      addedAt: Date.now(),
      possibleDuplicate: !!info._possibleDuplicate,
      needsReview: false,
    };
    await DB.putBook(book);
    await loadBooks();
    renderAll();
    toast(`Added: ${book.title}`);
    maybeAutoSync();
    $("scan-result-backdrop").classList.remove("active");
    if (scanAgain) openScanner("add");
  };
  $("sr-save").addEventListener("click", () => save(false));
  $("sr-scan-next").addEventListener("click", () => save(true));
  $("sr-cancel").addEventListener("click", () => $("scan-result-backdrop").classList.remove("active"));
  $("scan-result-backdrop").classList.add("active");
}

// ----- bulk scan: no per-book form; save fast, review later -----
async function handleBulkScan(isbn) {
  const dupes = await DB.getByIsbn(isbn);
  let info;
  try { info = await BookAPI.lookup(isbn); }
  catch (_) { info = { isbn, title: null, author: null, coverUrl: "", found: false }; }
  if (info.isbndbError) noteIsbndbError(info.isbndbError, { silent: true });

  const book = {
    isbn,
    title: info.title || null,
    author: info.author || null,
    coverUrl: info.coverUrl || `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`,
    seriesName: info.seriesName || null,
    seriesPosition: info.seriesPosition || null,
    seriesTotal: null,
    checkedOutTo: null,
    checkedOutAt: null,
    addedAt: Date.now(),
    needsReview: true,
    possibleDuplicate: dupes.length > 0,
    source: info.source || null,
  };
  await DB.putBook(book);
  bulkCount++;
  const label = book.title || `no match (${isbn})`;
  $("scanner-status").textContent = `${bulkCount} scanned · last: ${label}${book.possibleDuplicate ? " · ⚠ dup" : ""}`;
}

// ----- checkout: name picker + saved people -----
function openCheckoutNameSheet() {
  $("checkout-name-input").value = "";
  renderPeopleList();
  $("checkout-name-backdrop").classList.add("active");
}

async function renderPeopleList() {
  const people = await DB.getPeople();
  const container = $("people-list");
  if (!people.length) {
    container.innerHTML = `<p class="people-empty">No one saved yet. Add a person below.</p>`;
    return;
  }
  container.innerHTML = people.map((name) => `
    <div class="person-row" data-name="${escapeHTML(name)}">
      <span class="person-name">${escapeHTML(name)}</span>
      <span class="person-actions">
        <button class="person-action" data-scan="${escapeHTML(name)}">Scan</button>
        <button class="person-action" data-list="${escapeHTML(name)}">From list</button>
        <button class="person-remove" data-remove="${escapeHTML(name)}">✕</button>
      </span>
    </div>`).join("");
  container.querySelectorAll("[data-scan]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      checkoutBorrower = btn.dataset.scan;
      $("checkout-name-backdrop").classList.remove("active");
      openScanner("checkout");
    });
  });
  container.querySelectorAll("[data-list]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      checkoutBorrower = btn.dataset.list;
      $("checkout-name-backdrop").classList.remove("active");
      openCheckoutPicker();
    });
  });
  container.querySelectorAll(".person-remove").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await DB.removePerson(btn.dataset.remove);
      renderPeopleList();
    });
  });
}

function wireCheckoutNameSheet() {
  $("checkout-name-close").addEventListener("click", () => $("checkout-name-backdrop").classList.remove("active"));
  $("add-person-btn").addEventListener("click", async () => {
    const name = $("checkout-name-input").value.trim();
    if (!name) { toast("Enter a name first"); return; }
    await DB.addPerson(name);
    $("checkout-name-input").value = "";
    renderPeopleList();
    maybeAutoSync();
  });
}

// Match a scanned ISBN to a specific copy, handling multiples sensibly.
async function handleCheckoutScan(isbn) {
  const copies = await DB.getByIsbn(isbn);
  if (!copies.length) {
    $("scanner-status").textContent = "That book isn't in your library yet.";
    toast("Not in your library — add it first.");
    return;
  }
  const mineOut = copies.find((c) => c.checkedOutTo === checkoutBorrower);
  const available = copies.find((c) => !c.checkedOutTo);
  if (mineOut) {
    mineOut.checkedOutTo = null; mineOut.checkedOutAt = null;
    await DB.putBook(mineOut);
    $("scanner-status").textContent = `Checked in: ${mineOut.title || "book"}`;
    toast(`Checked in: ${mineOut.title || "book"}`);
  } else if (available) {
    available.checkedOutTo = checkoutBorrower; available.checkedOutAt = Date.now();
    await DB.putBook(available);
    $("scanner-status").textContent = `Checked out to ${checkoutBorrower}: ${available.title || "book"}`;
    toast(`Checked out: ${available.title || "book"}`);
  } else {
    const who = copies.map((c) => c.checkedOutTo).filter(Boolean).join(", ");
    $("scanner-status").textContent = `All copies already out (${who}).`;
    toast(`All copies are out (${who})`);
    return;
  }
  await loadBooks();
  renderAll();
  maybeAutoSync();
}

// ----- pick-from-list checkout -----
let pickerSearch = "";

function openCheckoutPicker() {
  pickerSearch = "";
  $("picker-search").value = "";
  $("picker-heading").textContent = `Check out to ${checkoutBorrower}`;
  $("picker-sub").textContent = "Tap a book to check it out. Tap one that's already out to check it back in.";
  renderPicker();
  $("checkout-picker-backdrop").classList.add("active");
}

function renderPicker() {
  const q = pickerSearch.toLowerCase();
  const list = books
    .filter((b) => !q || (b.title || "").toLowerCase().includes(q) || (b.author || "").toLowerCase().includes(q))
    .sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  const container = $("picker-list");
  if (!list.length) {
    container.innerHTML = `<p class="people-empty">No books match.</p>`;
    return;
  }
  container.innerHTML = list.map((b) => {
    let state = "available"; let note = "Tap to check out";
    if (b.checkedOutTo === checkoutBorrower) { state = "mine"; note = "Out to them · tap to check in"; }
    else if (b.checkedOutTo) { state = "other"; note = `Out to ${escapeHTML(b.checkedOutTo)} · tap to reassign`; }
    return `
      <div class="picker-row ${state}" data-id="${b.id}">
        <img class="book-cover" src="${b.coverUrl || ""}" onerror="this.style.visibility='hidden'" />
        <div class="book-info">
          <p class="book-title">${escapeHTML(b.title || "(no title)")}</p>
          <p class="book-author">${escapeHTML(b.author || "—")}</p>
          <div class="book-status" style="color:${state === "available" ? "var(--sage)" : "var(--rust)"}">${note}</div>
        </div>
      </div>`;
  }).join("");
  container.querySelectorAll(".picker-row").forEach((row) => {
    row.addEventListener("click", () => togglePickerBook(row.dataset.id));
  });
}

async function togglePickerBook(id) {
  const book = await DB.getById(id);
  if (!book) return;
  if (book.checkedOutTo === checkoutBorrower) {
    book.checkedOutTo = null; book.checkedOutAt = null;
    toast(`Checked in: ${book.title || "book"}`);
  } else {
    book.checkedOutTo = checkoutBorrower; book.checkedOutAt = Date.now();
    toast(`Checked out to ${checkoutBorrower}: ${book.title || "book"}`);
  }
  await DB.putBook(book);
  await loadBooks();
  renderPicker();
  renderCheckout();
  maybeAutoSync();
}

function wireCheckoutPicker() {
  $("checkout-picker-close").addEventListener("click", () => $("checkout-picker-backdrop").classList.remove("active"));
  $("picker-done").addEventListener("click", () => {
    $("checkout-picker-backdrop").classList.remove("active");
    switchScreen("checkout");
  });
  $("picker-search").addEventListener("input", (e) => {
    pickerSearch = e.target.value;
    renderPicker();
  });
}

// ---------- BOOK DETAIL SHEET (fully editable; clears review flag on save) ----------
function wireBookSheet() {
  $("book-sheet-close").addEventListener("click", () => $("book-sheet-backdrop").classList.remove("active"));
  $("bs-cancel").addEventListener("click", () => $("book-sheet-backdrop").classList.remove("active"));
  $("bs-save").addEventListener("click", async () => {
    const book = await DB.getById(editingId);
    if (!book) return;
    const title = $("bs-title-input").value.trim();
    if (!title) { toast("A title is required"); return; }
    book.title = title;
    book.author = $("bs-author-input").value.trim() || "Unknown author";
    book.seriesName = $("bs-series").value.trim() || null;
    book.seriesPosition = $("bs-position").value ? parseFloat($("bs-position").value) : null;
    book.seriesTotal = $("bs-total").value ? parseInt($("bs-total").value, 10) : null;
    book.needsReview = false;   // reviewing + saving clears the review flag
    await DB.putBook(book);
    await loadBooks();
    renderAll();
    toast("Saved");
    $("book-sheet-backdrop").classList.remove("active");
    maybeAutoSync();
  });
  $("bs-not-dup").addEventListener("click", async () => {
    const book = await DB.getById(editingId);
    if (!book) return;
    book.possibleDuplicate = false;
    await DB.putBook(book);
    await loadBooks();
    renderAll();
    toast("Duplicate flag cleared");
    $("book-sheet-backdrop").classList.remove("active");
    maybeAutoSync();
  });
  $("bs-remove").addEventListener("click", async () => {
    if (!confirm("Remove this book from your library?")) return;
    await DB.deleteBook(editingId);
    await loadBooks();
    renderAll();
    toast("Removed");
    $("book-sheet-backdrop").classList.remove("active");
    maybeAutoSync();
  });
}

function openBookSheet(id) {
  const book = books.find((b) => b.id === id);
  if (!book) return;
  editingId = id;
  $("bs-title-input").value = book.title || "";
  $("bs-author-input").value = book.author || "";
  $("bs-series").value = book.seriesName || "";
  $("bs-position").value = book.seriesPosition || "";
  $("bs-total").value = book.seriesTotal || "";
  $("bs-dup-info").innerHTML = book.possibleDuplicate
    ? `<p class="sub" style="color:var(--rust);">Flagged as a possible duplicate. Keep it if you own multiple copies, or use "Not a duplicate" to clear the flag.</p>`
    : "";
  $("bs-not-dup").style.display = book.possibleDuplicate ? "block" : "none";
  $("bs-checkout-info").innerHTML = book.checkedOutTo
    ? `<p class="sub" style="color:var(--rust);">Currently out to ${escapeHTML(book.checkedOutTo)}. Check it in from the Checkout tab.</p>`
    : "";
  $("book-sheet-backdrop").classList.add("active");
}

// ---------- MANUAL ADD (from settings) ----------
function wireManualAdd() {
  $("manual-add-close").addEventListener("click", () => $("manual-add-backdrop").classList.remove("active"));
  $("ma-save").addEventListener("click", async () => {
    const isbn = $("ma-isbn").value.trim();
    const title = $("ma-title").value.trim();
    if (!title) { toast("A title is required"); return; }
    const dupes = isbn ? await DB.getByIsbn(isbn) : [];
    await DB.putBook({
      isbn,
      title,
      author: $("ma-author").value.trim() || "Unknown author",
      seriesName: $("ma-series").value.trim() || null,
      seriesPosition: $("ma-position").value ? parseFloat($("ma-position").value) : null,
      seriesTotal: null,
      coverUrl: isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg` : "",
      checkedOutTo: null,
      checkedOutAt: null,
      addedAt: Date.now(),
      possibleDuplicate: dupes.length > 0,
      needsReview: false,
    });
    await loadBooks();
    renderAll();
    toast(`Added: ${title}`);
    $("manual-add-backdrop").classList.remove("active");
    maybeAutoSync();
  });
}

// ---------- DROPBOX SETUP SHEET ----------
function wireDropboxSetup() {
  $("dropbox-setup-close").addEventListener("click", () => $("dropbox-setup-backdrop").classList.remove("active"));
  $("dropbox-connect-btn").addEventListener("click", async () => {
    const key = $("dropbox-app-key-input").value.trim();
    if (!key) { toast("Paste your Dropbox App key first"); return; }
    await DropboxSync.beginAuth(key);
  });
}
