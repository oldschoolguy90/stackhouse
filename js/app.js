// ---------------------------------------------------------------
// Stackhouse — main app logic
// ---------------------------------------------------------------
let books = [];
let currentSort = "title";
let currentSearch = "";
let scanMode = null;          // 'add' | 'checkout' | null
let checkoutBorrower = null;
let editingIsbn = null;
let syncTimer = null;

const $ = (id) => document.getElementById(id);

// ---------- boot ----------
window.addEventListener("DOMContentLoaded", init);

async function init() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  wireNav();
  wireLibraryScreen();
  wireSeriesScreen();
  wireCheckoutScreen();
  wireCheckoutNameSheet();
  wireSettingsScreen();
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
}

function filteredBooks() {
  if (!currentSearch) return books.slice();
  return books.filter((b) =>
    (b.title || "").toLowerCase().includes(currentSearch) ||
    (b.author || "").toLowerCase().includes(currentSearch) ||
    (b.seriesName || "").toLowerCase().includes(currentSearch)
  );
}

function sortBooks(list) {
  const arr = list.slice();
  if (currentSort === "title") arr.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  else if (currentSort === "author") arr.sort((a, b) => (a.author || "").localeCompare(b.author || ""));
  else if (currentSort === "series") arr.sort((a, b) => (a.seriesName || "zzzz").localeCompare(b.seriesName || "zzzz") || ((a.seriesPosition || 0) - (b.seriesPosition || 0)));
  else if (currentSort === "recent") arr.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  return arr;
}

function renderLibrary() {
  const list = sortBooks(filteredBooks());
  $("header-count").textContent = `${books.length} book${books.length === 1 ? "" : "s"}`;
  const container = $("library-list");
  if (!list.length) {
    container.innerHTML = emptyState("No books yet", "Tap the scan button below to add your first one.");
    return;
  }
  container.innerHTML = list.map(bookCardHTML).join("");
  container.querySelectorAll(".book-card").forEach((el) => {
    el.addEventListener("click", () => openBookSheet(el.dataset.isbn));
  });
}

function bookCardHTML(b) {
  const statusHTML = b.checkedOutTo
    ? `<div class="book-status">Out to ${escapeHTML(b.checkedOutTo)}</div>`
    : "";
  const seriesMeta = b.seriesName
    ? `<div class="book-meta">${escapeHTML(b.seriesName)}${b.seriesPosition ? " #" + b.seriesPosition : ""}</div>`
    : "";
  return `
    <div class="book-card ${b.checkedOutTo ? "checked-out" : ""}" data-isbn="${b.isbn}">
      <img class="book-cover" src="${b.coverUrl || ""}" onerror="this.style.visibility='hidden'" />
      <div class="book-info">
        <p class="book-title">${escapeHTML(b.title)}</p>
        <p class="book-author">${escapeHTML(b.author)}</p>
        ${seriesMeta}
        ${statusHTML}
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
function wireSeriesScreen() {}

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
    if (b.seriesName) {
      (groups[b.seriesName] = groups[b.seriesName] || []).push(b);
    } else {
      standalone.push(b);
    }
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
      ${standalone.slice().sort((a, b) => a.title.localeCompare(b.title)).map(bookCardHTML).join("")}
    </div>`;
  }
  container.innerHTML = html;
  container.querySelectorAll(".book-card").forEach((el) => {
    el.addEventListener("click", () => openBookSheet(el.dataset.isbn));
  });
}

// ---------- CHECKOUT ----------
function wireCheckoutScreen() {
  $("new-checkout-btn").addEventListener("click", () => {
    $("checkout-name-input").value = "";
    $("checkout-name-backdrop").classList.add("active");
    setTimeout(() => $("checkout-name-input").focus(), 50);
  });
}

function renderCheckout() {
  const out = books.filter((b) => b.checkedOutTo).sort((a, b) => (b.checkedOutAt || 0) - (a.checkedOutAt || 0));
  const container = $("checkout-list");
  if (!out.length) {
    container.innerHTML = emptyState("Nothing checked out", "Everything's on the shelf. Tap above to check a book out to someone.");
    return;
  }
  container.innerHTML = out.map((b) => `
    <div class="book-card checked-out" data-isbn="${b.isbn}">
      <img class="book-cover" src="${b.coverUrl || ""}" onerror="this.style.visibility='hidden'" />
      <div class="book-info">
        <p class="book-title">${escapeHTML(b.title)}</p>
        <p class="book-author">${escapeHTML(b.author)}</p>
        <div class="book-status">Out to ${escapeHTML(b.checkedOutTo)} · tap to check in</div>
      </div>
    </div>`).join("");
  container.querySelectorAll(".book-card").forEach((el) => {
    el.addEventListener("click", async () => {
      const b = books.find((x) => x.isbn === el.dataset.isbn);
      if (!b) return;
      b.checkedOutTo = null;
      b.checkedOutAt = null;
      await DB.putBook(b);
      toast(`Checked in: ${b.title}`);
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

  const outCount = books.filter((b) => b.checkedOutTo).length;
  const seriesCount = new Set(books.filter((b) => b.seriesName).map((b) => b.seriesName)).size;
  const lastSync = await DB.getMeta("lastSyncedAt");
  $("stats-text").textContent = `${books.length} books · ${seriesCount} series tracked · ${outCount} checked out` +
    (lastSync ? ` · last synced ${new Date(lastSync).toLocaleString()}` : "");
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
  $("scan-result-close").addEventListener("click", () => $("scan-result-backdrop").classList.remove("active"));
}

async function openScanner(mode) {
  scanMode = mode;
  $("scanner-title").textContent = mode === "checkout"
    ? `Scanning for ${checkoutBorrower}`
    : "Scan a book's barcode";
  $("scanner-status").textContent = "Point your camera at the barcode";
  $("scanner-view").classList.add("active");
  await Scanner.start("qr-reader", onCodeScanned, () => {
    $("scanner-status").textContent = "Camera unavailable — check permissions in your browser settings.";
  });
}

async function closeScanner() {
  await Scanner.stop();
  $("scanner-view").classList.remove("active");
  scanMode = null;
  checkoutBorrower = null;
}

async function onCodeScanned(code) {
  if (scanMode === "add") {
    $("scanner-status").textContent = `Found ${code} — looking it up…`;
    await handleAddScan(code);
  } else if (scanMode === "checkout") {
    await handleCheckoutScan(code);
  }
}

// ----- add-to-library flow -----
async function handleAddScan(isbn) {
  const existing = await DB.getBook(isbn);
  if (existing && !existing.deleted) {
    $("scanner-status").textContent = `Already in your library: ${existing.title}`;
    toast(`Already have it: ${existing.title}`);
    return;
  }
  let info;
  try {
    info = await BookAPI.lookup(isbn);
  } catch (_) {
    info = null;
  }
  await Scanner.stop();
  $("scanner-view").classList.remove("active");

  if (!info) {
    $("sr-title").textContent = "Couldn't find that book";
    $("sr-author").textContent = isbn;
    $("sr-body").innerHTML = `<p class="sub">No match online. You can add it manually from Settings instead.</p>`;
  } else {
    $("sr-title").textContent = info.title;
    $("sr-author").textContent = info.author;
    $("sr-body").innerHTML = `
      <label>Series name</label>
      <input id="sr-series" value="${escapeHTML(info.seriesName || "")}" placeholder="e.g. Mistborn" />
      <label>Position in series</label>
      <input id="sr-position" type="number" step="0.5" value="${info.seriesPosition || ""}" />
      <button class="btn btn-primary" id="sr-save">Add to library</button>
      <button class="btn btn-outline" id="sr-scan-next">Save &amp; scan next</button>
    `;
    const save = async (scanAgain) => {
      const book = {
        isbn,
        title: info.title,
        author: info.author,
        coverUrl: info.coverUrl,
        seriesName: $("sr-series").value.trim() || null,
        seriesPosition: $("sr-position").value ? parseFloat($("sr-position").value) : null,
        seriesTotal: null,
        checkedOutTo: null,
        checkedOutAt: null,
        addedAt: Date.now(),
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
  }
  $("scan-result-backdrop").classList.add("active");
}

// ----- checkout flow -----
function wireCheckoutNameSheet() {
  $("checkout-name-close").addEventListener("click", () => $("checkout-name-backdrop").classList.remove("active"));
  $("checkout-name-start").addEventListener("click", () => {
    const name = $("checkout-name-input").value.trim();
    if (!name) { toast("Enter a name first"); return; }
    checkoutBorrower = name;
    $("checkout-name-backdrop").classList.remove("active");
    openScanner("checkout");
  });
}

async function handleCheckoutScan(isbn) {
  const book = await DB.getBook(isbn);
  if (!book || book.deleted) {
    $("scanner-status").textContent = "That book isn't in your library yet.";
    toast("Not in your library — add it from the Library tab first.");
    return;
  }
  if (book.checkedOutTo) {
    const who = book.checkedOutTo;
    book.checkedOutTo = null;
    book.checkedOutAt = null;
    await DB.putBook(book);
    $("scanner-status").textContent = `Checked in: ${book.title} (was with ${who})`;
    toast(`Checked in: ${book.title}`);
  } else {
    book.checkedOutTo = checkoutBorrower;
    book.checkedOutAt = Date.now();
    await DB.putBook(book);
    $("scanner-status").textContent = `Checked out to ${checkoutBorrower}: ${book.title}`;
    toast(`Checked out: ${book.title}`);
  }
  await loadBooks();
  renderAll();
  maybeAutoSync();
}

// ---------- BOOK DETAIL SHEET ----------
function wireBookSheet() {
  $("book-sheet-close").addEventListener("click", () => $("book-sheet-backdrop").classList.remove("active"));
  $("bs-save").addEventListener("click", async () => {
    const book = await DB.getBook(editingIsbn);
    if (!book) return;
    book.seriesName = $("bs-series").value.trim() || null;
    book.seriesPosition = $("bs-position").value ? parseFloat($("bs-position").value) : null;
    book.seriesTotal = $("bs-total").value ? parseInt($("bs-total").value, 10) : null;
    await DB.putBook(book);
    await loadBooks();
    renderAll();
    toast("Saved");
    $("book-sheet-backdrop").classList.remove("active");
    maybeAutoSync();
  });
  $("bs-remove").addEventListener("click", async () => {
    if (!confirm("Remove this book from your library?")) return;
    await DB.deleteBook(editingIsbn);
    await loadBooks();
    renderAll();
    toast("Removed");
    $("book-sheet-backdrop").classList.remove("active");
    maybeAutoSync();
  });
}

function openBookSheet(isbn) {
  const book = books.find((b) => b.isbn === isbn);
  if (!book) return;
  editingIsbn = isbn;
  $("bs-title").textContent = book.title;
  $("bs-author").textContent = book.author;
  $("bs-series").value = book.seriesName || "";
  $("bs-position").value = book.seriesPosition || "";
  $("bs-total").value = book.seriesTotal || "";
  $("bs-checkout-info").innerHTML = book.checkedOutTo
    ? `<p class="sub" style="color:var(--rust);">Currently out to ${escapeHTML(book.checkedOutTo)}. Check it in from the Checkout tab.</p>`
    : "";
  $("book-sheet-backdrop").classList.add("active");
}

// ---------- MANUAL ADD ----------
function wireManualAdd() {
  $("manual-add-close").addEventListener("click", () => $("manual-add-backdrop").classList.remove("active"));
  $("ma-save").addEventListener("click", async () => {
    const isbn = $("ma-isbn").value.trim();
    const title = $("ma-title").value.trim();
    if (!isbn || !title) { toast("ISBN and title are required"); return; }
    await DB.putBook({
      isbn,
      title,
      author: $("ma-author").value.trim() || "Unknown author",
      seriesName: $("ma-series").value.trim() || null,
      seriesPosition: $("ma-position").value ? parseFloat($("ma-position").value) : null,
      seriesTotal: null,
      coverUrl: `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`,
      checkedOutTo: null,
      checkedOutAt: null,
      addedAt: Date.now(),
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
