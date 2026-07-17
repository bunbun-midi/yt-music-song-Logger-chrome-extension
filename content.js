// content.js — runs on music.youtube.com
// Scans the page for .song-title / .byline pairs and reports newly-seen
// ones to the background service worker, which persists them.

(() => {
  const SCAN_DEBOUNCE_MS = 400;
  const seenThisSession = new Set(); // avoid re-sending the same pair repeatedly

  function cleanText(el) {
    if (!el) return "";
    // Prefer the title="" attribute when present — YouTube Music sets it to
    // the full, untruncated string even when the visible text is clipped
    // with an ellipsis.
    const full = el.getAttribute("title");
    const text = (full && full.trim()) || el.textContent || "";
    return text.replace(/\s+/g, " ").trim();
  }

  function collectPairs() {
    const nodes = document.querySelectorAll(".song-title, .byline");
    const pairs = [];
    let pendingTitle = null;

    nodes.forEach((el) => {
      if (el.classList.contains("song-title")) {
        // If two titles show up back-to-back with no byline in between,
        // keep the most recent one — the earlier node was likely a stale
        // duplicate render.
        pendingTitle = cleanText(el);
      } else if (el.classList.contains("byline")) {
        if (pendingTitle) {
          const artist = cleanText(el);
          if (pendingTitle && artist) {
            pairs.push({ title: pendingTitle, artist });
          }
          pendingTitle = null;
        }
      }
    });

    return pairs;
  }

  function scan() {
    const pairs = collectPairs();
    const fresh = [];

    for (const pair of pairs) {
      const key = `${pair.title}\u0000${pair.artist}`;
      if (!seenThisSession.has(key)) {
        seenThisSession.add(key);
        fresh.push(pair);
      }
    }

    if (fresh.length > 0) {
      chrome.runtime.sendMessage({ type: "TRACKS_FOUND", tracks: fresh }).catch(() => {
        // service worker may be waking up — background handles retries via
        // its own storage read, so a dropped message here is not fatal for
        // future scans (the DOM will still be there on the next mutation).
      });
    }
  }

  let debounceHandle = null;
  function scheduleScan() {
    if (debounceHandle) clearTimeout(debounceHandle);
    debounceHandle = setTimeout(scan, SCAN_DEBOUNCE_MS);
  }

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // Initial pass — YouTube Music is a SPA and the player bar / queue can
  // take a moment to hydrate after navigation.
  window.addEventListener("load", () => setTimeout(scan, 1500));
  scheduleScan();
})();
