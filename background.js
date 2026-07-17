// background.js — service worker
//
// Storage shape (two-tier, so the popup never has to load the entire
// history just to render something):
//
//   sessionIndex: [ { id, startedAt, endedAt, trackCount }, ... ]   (small, always loaded)
//   "session:<id>": { id, startedAt, entries: [ {title, artist, firstSeenAt, lastSeenAt, playCount} ] }
//
// A "session" is a run of listening with no gap longer than SESSION_GAP_MS
// between detections. Entries within a session are appended in the order
// they're first seen (i.e. page order) and never reordered — a repeat just
// bumps that entry's playCount in place.

const SESSION_GAP_MS = 30 * 60 * 1000; // 30 minutes of inactivity = new session

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === "TRACKS_FOUND") {
    handleTracks(message.tracks)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // keep the message channel open for the async response
  }
  return false;
});

async function handleTracks(tracks) {
  if (!tracks || tracks.length === 0) return;

  const now = Date.now();
  const { sessionIndex = [] } = await chrome.storage.local.get("sessionIndex");
  let current = sessionIndex[sessionIndex.length - 1];
  let sessionData;

  const startingNewSession = !current || now - current.endedAt > SESSION_GAP_MS;

  if (startingNewSession) {
    const id = String(now);
    current = { id, startedAt: now, endedAt: now, trackCount: 0 };
    sessionIndex.push(current);
    sessionData = { id, startedAt: now, entries: [] };
  } else {
    const sessionKey = `session:${current.id}`;
    const stored = await chrome.storage.local.get(sessionKey);
    sessionData = stored[sessionKey] || { id: current.id, startedAt: current.startedAt, entries: [] };
  }

  // Preserve page order: append newly-seen tracks in the order they arrived;
  // repeats update in place rather than moving to the end.
  for (const { title, artist } of tracks) {
    const existing = sessionData.entries.find((e) => e.title === title && e.artist === artist);
    if (existing) {
      existing.playCount += 1;
      existing.lastSeenAt = now;
    } else {
      sessionData.entries.push({ title, artist, firstSeenAt: now, lastSeenAt: now, playCount: 1 });
    }
  }

  current.endedAt = now;
  current.trackCount = sessionData.entries.length;

  await chrome.storage.local.set({
    sessionIndex,
    [`session:${sessionData.id}`]: sessionData,
  });
}
