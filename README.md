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
Because almost every action here is "add a book" or "flip a checked-out
flag," two devices editing the *same* book at the *exact* same moment is
the only real conflict case, and it's resolved by simply keeping whichever
change happened last.

## Using it

- **Scan (center button)**: point the camera at a book's barcode (the
  ISBN-13 barcode on the back cover) to add it. It looks up the title,
  author, cover, and series info automatically where available.
- **Series tab**: books are grouped by series and sorted by position.
  If a series has numbered gaps (e.g. you own #1, #2, #4), the missing
  numbers are flagged. Tap any book and set "Series total" manually to
  improve detection for series where position numbers alone aren't enough.
- **Checkout tab**: tap "Check out a book," type a name, then scan — each
  scan records that book under that name. Scanning the same book again
  (from either the scanner or by tapping it in the Checkout list) checks
  it back in.
- **Settings**: manual add (for damaged/missing barcodes), sync status,
  and library stats.

## Notes & limitations

- Series/position data comes from Open Library, which isn't complete for
  every book — you can always fill it in by hand from a book's detail
  sheet (tap any book card).
- The barcode scanner reads standard EAN-13 book barcodes (the ones under
  the printed ISBN) using your phone's camera — no extra hardware needed.
- All data also lives locally on each device (IndexedDB), so the app keeps
  working offline; it just re-syncs next time you're online.
