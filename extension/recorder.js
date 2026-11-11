// Recorder page. Two jobs the service worker cannot do:
//   * hold a FileSystemDirectoryHandle from showDirectoryPicker (a popup would
//     be destroyed the moment the picker opens),
//   * write the finished MP3 blobs into that directory.
// The handle is persisted in IndexedDB so it survives reloads.

const $ = (id) => document.getElementById(id);
const DB_NAME = "tab-audio-recorder";
const STORE = "handles";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

let directory = null;

// Reuse the stored handle only while the permission is still granted; asking
// for permission needs a gesture, so a revoked handle means "pick again".
async function restoreDirectory() {
  const handle = await idbGet("directory").catch(() => null);
  if (!handle) return null;
  const permission = await handle.queryPermission({ mode: "readwrite" });
  return permission === "granted" ? handle : null;
}

async function pickDirectory() {
  const handle = await window.showDirectoryPicker({
    id: "tab-audio",
    mode: "readwrite",
    startIn: "music",
  });
  directory = handle;
  await idbSet("directory", handle);
  await chrome.runtime.sendMessage({
    target: "recorder",
    type: "folder",
    name: handle.name,
  });
  renderFolder(handle.name);
  return handle;
}

function renderFolder(name) {
  $("folderName").textContent = name
    ? `Writing to “${name}”.`
    : "No folder chosen yet.";
}

async function writeFile(id) {
  const entry = await chrome.runtime.sendMessage({
    target: "recorder",
    type: "take",
    id,
  });
  if (!entry?.ok) throw new Error(entry?.error ?? "Nothing to save");

  const response = await fetch(entry.url);
  const bytes = await response.blob();

  const fileHandle = await directory.getFileHandle(entry.name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(bytes);
  await writable.close();

  await chrome.runtime.sendMessage({ target: "recorder", type: "saved", id });
  return { name: entry.name, folder: directory.name };
}

// ---- UI ----------------------------------------------------------------

let session = null;

function renderSession(next) {
  session = next;
  const active = !!session;
  $("dot").hidden = !active;
  $("sessionCard").hidden = !active;
  if (!active) {
    $("status").textContent = directory
      ? "Idle. Start recording from the toolbar icon."
      : "Idle. Choose a folder first.";
    $("files").innerHTML = "";
    return;
  }
  const current = session.segments[session.segments.length - 1];
  $("status").textContent = `Recording “${current.title || "untitled"}”.`;
  $("sessionInfo").textContent =
    `Tab title is the file name. Renaming the page closes the current MP3 and ` +
    `starts a new one (${session.segments.length} file(s) so far).`;
  $("files").innerHTML = session.segments
    .map(
      (seg) =>
        `<li><b>${escapeHtml(seg.fileName)}</b>${seg.endedAt ? "" : " — recording"}</li>`
    )
    .join("");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

async function refresh() {
  const state = await chrome.runtime.sendMessage({
    target: "recorder",
    type: "ready",
  });
  renderSession(state?.session ?? null);
  renderFolder(state?.folder ?? directory?.name ?? null);
}

$("pick").onclick = async () => {
  $("hint").textContent = "";
  try {
    await pickDirectory();
    await refresh();
  } catch (e) {
    if (e.name !== "AbortError") $("hint").textContent = e.message;
  }
};

const OWN_MESSAGES = new Set(["pick-folder", "save", "session"]);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Extension-internal traffic (background ↔ offscreen) shares this channel.
  if (!OWN_MESSAGES.has(msg?.type)) return;
  (async () => {
    try {
      if (msg.type === "pick-folder") {
        await pickDirectory();
        return sendResponse({ ok: true });
      }
      if (msg.type === "save") {
        if (!directory) {
          return sendResponse({
            ok: false,
            error: "Choose a save folder first (the button on this page).",
          });
        }
        const written = await writeFile(msg.id);
        await refresh();
        return sendResponse({ ok: true, ...written });
      }
      if (msg.type === "session") {
        renderSession(msg.session);
        return sendResponse({ ok: true });
      }
      sendResponse({ ok: false, error: `Unknown type ${msg.type}` });
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message ?? e) });
    }
  })();
  return true;
});

// A reloaded page must recover the folder handle before any file arrives.
async function main() {
  directory = await restoreDirectory();
  if (directory) {
    await chrome.runtime
      .sendMessage({ target: "recorder", type: "folder", name: directory.name })
      .catch(() => {});
  }
  await refresh();
}

main();
