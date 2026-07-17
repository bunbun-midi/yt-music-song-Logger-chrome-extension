// popup.js — session-aware viewer.
// Loads only the small sessionIndex plus whichever single session is
// currently being viewed, so the popup stays fast no matter how much
// history has accumulated. Track order within a session is never
// re-sorted — it's rendered exactly as stored (i.e. the order tracks
// first appeared on the page).

let sessionIndex = [];   // [{id, startedAt, endedAt, trackCount}]
let currentPos = -1;     // index into sessionIndex currently displayed
let currentEntries = []; // entries of the currently displayed session

function fmtDateTime(ms) {
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function totalTrackCount() {
  return sessionIndex.reduce((sum, s) => sum + (s.trackCount || 0), 0);
}

function renderSessionSelect() {
  const select = document.getElementById("sessionSelect");
  select.innerHTML = sessionIndex
    .map((s, i) => `<option value="${i}">${escapeHtml(fmtDateTime(s.startedAt))} · ${s.trackCount}×</option>`)
    .join("");
  select.value = String(currentPos);
}

function renderDelimiter(session) {
  const el = document.getElementById("delimiter");
  if (!session) {
    el.style.display = "none";
    return;
  }
  el.style.display = "flex";
  document.getElementById("delimiterDate").textContent = `Session started ${fmtDateTime(session.startedAt)}`;
  document.getElementById("delimiterCount").textContent = `${session.trackCount} track${session.trackCount === 1 ? "" : "s"}`;
}

function renderList(filterText) {
  const list = document.getElementById("list");
  const filtered = filterText
    ? currentEntries.filter(
        (t) => t.title.toLowerCase().includes(filterText) || t.artist.toLowerCase().includes(filterText)
      )
    : currentEntries;

  if (sessionIndex.length === 0) {
    list.innerHTML = `<div class="empty">No tracks logged yet. Play something on YouTube Music and it'll show up here.</div>`;
    return;
  }

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty">No matches in this session.</div>`;
    return;
  }

  list.innerHTML = filtered
    .map(
      (t) => `
      <div class="row">
        <div class="row-text">
          <div class="track-title">${escapeHtml(t.title)}</div>
          <div class="track-artist">${escapeHtml(t.artist)}</div>
        </div>
        <div class="play-count">${t.playCount}×</div>
      </div>`
    )
    .join("");
}

function updateNavButtons() {
  document.getElementById("prevSession").disabled = currentPos <= 0;
  document.getElementById("nextSession").disabled = currentPos >= sessionIndex.length - 1 || currentPos === -1;
}

async function loadSessionIndex() {
  const { sessionIndex: idx = [] } = await chrome.storage.local.get("sessionIndex");
  sessionIndex = idx;
  document.getElementById("trackCount").textContent = totalTrackCount();
}

async function loadSession(pos) {
  if (pos < 0 || pos >= sessionIndex.length) {
    currentPos = -1;
    currentEntries = [];
    renderDelimiter(null);
    renderList("");
    renderSessionSelect();
    updateNavButtons();
    return;
  }

  currentPos = pos;
  const session = sessionIndex[pos];
  const key = `session:${session.id}`;
  const stored = await chrome.storage.local.get(key);
  const data = stored[key] || { entries: [] };
  currentEntries = data.entries || [];

  renderDelimiter(session);
  renderSessionSelect();
  updateNavButtons();
  renderList(document.getElementById("search").value.trim().toLowerCase());
}

async function init() {
  await loadSessionIndex();
  // default to the most recent session
  await loadSession(sessionIndex.length - 1);
}

document.getElementById("prevSession").addEventListener("click", () => loadSession(currentPos - 1));
document.getElementById("nextSession").addEventListener("click", () => loadSession(currentPos + 1));
document.getElementById("sessionSelect").addEventListener("change", (e) => loadSession(Number(e.target.value)));

document.getElementById("search").addEventListener("input", (e) => {
  renderList(e.target.value.trim().toLowerCase());
});

function toCsvRows(entries) {
  return entries.map((t) =>
    [
      t.title,
      t.artist,
      t.playCount,
      new Date(t.firstSeenAt).toISOString(),
      new Date(t.lastSeenAt).toISOString(),
    ]
      .map((field) => `"${String(field).replace(/"/g, '""')}"`)
      .join(",")
  );
}

function download(filename, mimeType, content) {
  const dataUrl = `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;
  chrome.downloads.download({ url: dataUrl, filename, saveAs: true });
}

document.getElementById("exportCsv").addEventListener("click", () => {
  if (currentPos < 0) return;
  const header = "title,artist,play_count,first_seen,last_seen";
  const csv = [header, ...toCsvRows(currentEntries)].join("\r\n");
  const label = fmtDateTime(sessionIndex[currentPos].startedAt).replace(/[/,:]/g, "-");
  download(`yt-music-session_${label}.csv`, "text/csv", csv);
});

document.getElementById("exportJson").addEventListener("click", () => {
  if (currentPos < 0) return;
  download(
    `yt-music-session_${sessionIndex[currentPos].id}.json`,
    "application/json",
    JSON.stringify({ session: sessionIndex[currentPos], entries: currentEntries }, null, 2)
  );
});

document.getElementById("exportAll").addEventListener("click", async () => {
  const all = await chrome.storage.local.get(null);
  const idx = all.sessionIndex || [];
  const lines = [];
  for (const s of idx) {
    const data = all[`session:${s.id}`] || { entries: [] };
    lines.push(`# Session started ${fmtDateTime(s.startedAt)} (${data.entries.length} tracks)`);
    lines.push("title,artist,play_count,first_seen,last_seen");
    lines.push(...toCsvRows(data.entries));
    lines.push("");
  }
  download("yt-music-all-sessions.csv", "text/csv", lines.join("\r\n"));
});

document.getElementById("clearSession").addEventListener("click", async () => {
  if (currentPos < 0) return;
  if (!confirm("Delete this session's tracks? This can't be undone.")) return;
  const session = sessionIndex[currentPos];
  await chrome.storage.local.remove(`session:${session.id}`);
  sessionIndex.splice(currentPos, 1);
  await chrome.storage.local.set({ sessionIndex });
  await loadSession(Math.min(currentPos, sessionIndex.length - 1));
  document.getElementById("trackCount").textContent = totalTrackCount();
});

document.getElementById("clearAll").addEventListener("click", async () => {
  if (!confirm("Delete ALL logged tracks across every session? This can't be undone.")) return;
  const all = await chrome.storage.local.get(null);
  const sessionKeys = Object.keys(all).filter((k) => k.startsWith("session:"));
  await chrome.storage.local.remove([...sessionKeys, "sessionIndex"]);
  sessionIndex = [];
  await loadSession(-1);
  document.getElementById("trackCount").textContent = 0;
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;

  if (changes.sessionIndex) {
    const wasAtLatest = currentPos === sessionIndex.length - 1;
    await loadSessionIndex();
    // Stay pinned to "latest" if that's where the user was, otherwise
    // keep viewing the same session by id if it still exists.
    if (wasAtLatest || currentPos === -1) {
      await loadSession(sessionIndex.length - 1);
      return;
    }
    renderSessionSelect();
    updateNavButtons();
  }

  // If new tracks landed in the session currently being viewed, refresh it
  // in place so counts/rows stay live.
  const viewedSession = sessionIndex[currentPos];
  if (viewedSession && changes[`session:${viewedSession.id}`]) {
    await loadSession(currentPos);
  }
});

init();
