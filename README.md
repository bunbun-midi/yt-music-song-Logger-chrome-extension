# YT Music Track Logger

A Chrome extension that watches YouTube Music (`music.youtube.com`) and logs
every track title + artist pair it sees, deduplicated, with play counts and
timestamps. Export to CSV or JSON any time.

## Why `chrome.storage.local`

You asked for whatever database is most natively supported across platforms.
For a Chrome extension, that's **`chrome.storage.local`**:

- It ships with the extension platform itself — no external DB, server, or
  library to install, and it works identically on Windows, macOS, Linux,
  ChromeOS, and Chromebox.
- It's async, simple key/value storage, purpose-built for exactly this kind
  of "keep accumulating small structured records" use case.
- With the `unlimitedStorage` permission (already in the manifest) it isn't
  capped at the default 10MB, so it'll comfortably hold years of listening
  history as plain JSON.
- `chrome.storage.sync` was the other native option, but it caps out around
  100KB total and ~8KB per item — too small once your library grows past a
  few hundred tracks — so `local` is the right call here.

If you ever want this data in a "real" database (Postgres, SQLite, etc.) for
querying or cross-device analytics, the CSV/JSON export in the popup is the
easiest bridge — import either into whatever you like.

## Install (unpacked, for now)

1. Open `chrome://extensions`
2. Toggle **Developer mode** on (top right)
3. Click **Load unpacked** and select this folder
4. Open YouTube Music and play something — the extension logs it in the
   background automatically

## How it works

- `content.js` runs on `music.youtube.com`, watches the DOM with a
  `MutationObserver`, and pairs up `.song-title` / `.byline` elements in the
  order they appear (title, then its matching artist byline).
- Newly-seen pairs are sent to `background.js` (the service worker), which
  is the single writer to storage.
- `popup.html` / `popup.js` read from `chrome.storage.local` to show the
  current session, let you page between sessions, filter, and export.

## Sessions

Data is grouped into **listening sessions** instead of one flat, alphabetized
list:

- A session starts the first time a track is detected after a **30+ minute**
  gap since the last one (see `SESSION_GAP_MS` in `background.js` — change
  that constant if you want a shorter or longer gap).
- Within a session, tracks are stored in an **array, in the order they first
  appear on the page** — never re-sorted. A repeat of the same track just
  bumps its play count in place rather than moving it or duplicating the row.
- Each session is stored under its own key (`session:<id>`), with a small
  separate `sessionIndex` listing just the start/end time and track count for
  every session. The popup only ever loads the index plus whichever single
  session you're looking at — so it stays fast no matter how many months of
  history you accumulate, instead of rendering every track ever logged at
  once.
- The popup shows one session at a time, with a **delimiter row** at the top
  ("Session started Jul 17, 2026, 9:14 AM · 12 tracks") plus ‹ prev / next ›
  buttons and a dropdown to jump straight to any past session.
- "Export session" exports just what's on screen; "Export all sessions"
  produces one CSV with a `# Session started …` delimiter line before each
  session's rows.

**Known limitation:** if the same single track loops for a long time with no
new tracks entering the queue/DOM, no new detections fire, so a session can't
tell that you stepped away and came back — it'll stay one continuous session
until something new plays. This only matters for on-repeat listening; normal
listening through a queue naturally produces new detections that keep session
boundaries accurate.

## Notes / things you may want to tune

- **Pairing assumption**: the pairing logic assumes `.song-title` and
  `.byline` alternate in strict document order, which matches what you
  described. If YouTube Music ever renders extra `.byline`-classed elements
  elsewhere on the page (e.g. album bylines in a sidebar), you may see a few
  false pairs — tell me if that happens and I'll tighten the scoping (e.g.
  restrict the selector to a specific container like the queue list or the
  now-playing bar).
- **Title attribute preference**: YouTube Music often truncates long titles
  with an ellipsis but stores the full string in a `title="…"` HTML
  attribute. The scraper prefers that when present, so you get untruncated
  data.
- YouTube Music changes its DOM/class names periodically. If logging stops
  working after a YT Music update, the class names in `content.js`
  (`.song-title`, `.byline`) are the first thing to check.
