# Stackhouse — a scan-in library for two (or more) phones

A installable web app (PWA) for cataloging your book collection by barcode,
tracking series gaps, and running a simple checkout system between family
members. Data lives on each device and syncs through your own Dropbox.

## 1. Deploy it (so it's a real, installable app)

Pick one — both are free and take about 5 minutes.

### Option A: GitHub Pages
1. Create a new **public** repo on GitHub (e.g. `stackhouse`).
2. Upload every file in this folder, keeping the folder structure
   (`index.html`, `manifest.json`, `sw.js`, `css/`, `js/`, `icons/`).
3. Repo → Settings → Pages → Deploy from branch → `main` / root → Save.
4. Your app will be live at `https://<your-username>.github.io/stackhouse/`.

### Option B: Netlify
1. Go to app.netlify.com → "Add new site" → "Deploy manually".
2. Drag this whole folder onto the upload area.
3. Netlify gives you a URL like `https://stackhouse-yourname.netlify.app/`.

Once deployed, open that URL on each phone in Chrome, tap the browser menu,
and choose **"Add to Home screen"** (or Chrome will offer an install banner).
It'll behave like a real app icon from then on.

## 2. Connect Dropbox (do this once, then repeat step 3 on each phone)

1. Go to **dropbox.com/developers/apps** → **Create app**.
2. Choose **Scoped access** → **App folder** (this keeps it to a single,
   isolated folder in your Dropbox, not your whole account) → name it
   anything, e.g. "Stackhouse".
3. In the app's **Permissions** tab, enable `files.content.write` and
   `files.content.read`, then click **Submit**.
4. In the **Settings** tab, under **OAuth 2 → Redirect URIs**, paste your
   deployed app URL exactly (e.g. `https://<your-username>.github.io/stackhouse/`).
5. Copy the **App key** from the Settings tab.

## 3. Connect each phone

Open the app → **Settings** → **Set up Dropbox** → paste the App key →
**Connect**. You'll be sent to Dropbox to approve access, then dropped back
into the app, connected. Do this on every device — they'll all read and
write the same `library.json` file in your Dropbox app folder.

## How syncing works

There's no live push between devices — each device pulls the latest data on
open, merges in anything scanned locally, and pushes the merged result back,
automatically after every scan and every 60 seconds while the app is open.
Alongside the `library.json` data file, the app also writes a **`library.csv`**
to the same Dropbox app folder on every sync — open it in Excel or Google
Sheets for a plain list view of your whole library (title, author, series,
ISBN, who has it checked out, duplicate/review flags, date added). It's
export-only: edit it for your own reference, but changes there aren't read
back into the app.

## Using it

- **Scan (center button)**: point the camera at a book's barcode to add it.
  Every scan opens an editable form pre-filled with whatever was found —
  correct anything, then save. If you scan a book you already own, it's still
  saved but flagged as a **possible duplicate** for later review.
- **Bulk scan** (button at the top of the Library tab): scan a whole shelf
  back-to-back without stopping to confirm each one. Every book is saved and
  marked "needs review." Tap ✕ when done and you're dropped into a review list
  (tap any book to fill in or fix its details; saving clears the flag).
- **Duplicates & review**: a banner at the top of the Library tab shows how
  many books need attention (unreviewed bulk scans or possible duplicates).
  Tap it to filter to just those. In a book's detail sheet, "Not a duplicate"
  clears the duplicate flag if you meant to keep multiple copies.
- **Series tab**: books grouped by series and sorted by position, with missing
  numbered volumes flagged. Set a "series total" on any book to improve
  detection.
- **Checkout tab**: tap "Check out a book," pick or add a person, then either
  scan books or pick them from a list. Multiple copies of the same title are
  handled — checking out grabs an available copy.
- **Settings**: Dropbox sync, optional ISBNdb key, manual add, and stats.

## Notes & limitations

- **Book data sources.** By default the app looks books up using Google Books
  and Open Library (both free, no key). If you add an **ISBNdb** API key under
  Settings, ISBNdb is checked first on every scan and used as the primary
  source for title/author/cover, with the free sources filling in series info
  and acting as a fallback. ISBNdb is a paid service (~$15/mo); it's entirely
  optional and the app works fully without it.
  - Heads-up on ISBNdb from a browser: ISBNdb's API may not permit direct
    calls from a web page (a browser CORS restriction). If that turns out to
    be the case, scans will simply fall back to the free sources with no error,
    and getting ISBNdb working would need a tiny proxy in between. Try it and
    see — if the scan result says "Found via ISBNdb," it's working.
- Series/position data comes from Google Books and Open Library, which aren't
  complete for every book — you can always fill it in by hand from a book's
  detail sheet (tap any book card).
- The barcode scanner reads standard EAN-13 book barcodes (the ones under
  the printed ISBN) using your phone's camera — no extra hardware needed.
- All data also lives locally on each device (IndexedDB), so the app keeps
  working offline; it just re-syncs next time you're online.
