// Service worker. Owns the recording session, watches the recorded tab's title,
// and routes finished MP3 segments to the recorder tab that holds the folder.
//
// tabCapture is only granted per tab after an extension invoke gesture, so all
// starts funnel through start(): popup, shortcuts, page API.

import { createSession, applyTitle, finishSession } from "./session.js";

const OFFSCREEN_PATH = "offscreen.html";
const RECORDER_PAGE = "recorder.html";
let recorderTabId = null;

const getSession = async () =>
  (await chrome.storage.session.get("session")).session ?? null;

const setSession = (session) =>
  session
    ? chrome.storage.session.set({ session })
    : chrome.storage.session.remove("session");

async function offscreen() {
  const [doc] = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  return doc ?? null;
}

async function ensureOffscreen() {
  if (await offscreen()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ["BLOBS", "USER_MEDIA"],
    justification: "Encode captured tab audio to MP3 and keep the blob URLs.",
  });
}

async function openRecorderPage() {
  const existing = await chrome.tabs.query({
    url: chrome.runtime.getURL(`${RECORDER_PAGE}*`),
  });
  if (existing.length) {
    recorderTabId = existing[0].id;
    await chrome.tabs.update(recorderTabId, { active: true });
    return recorderTabId;
  }
  const tab = await chrome.tabs.create({
    url: chrome.runtime.getURL(RECORDER_PAGE),
    active: true,
  });
  recorderTabId = tab.id;
  return tab.id;
}

// ---- recording ----------------------------------------------------------

async function start(tabId, { title, tabUrl } = {}) {
  if (await getSession()) throw new Error("Already recording");

  // The page title is the file name; read it when the caller has none.
  const pageTitle =
    title ?? (await chrome.tabs.get(tabId).catch(() => null))?.title ?? "";
  const streamId = await chrome.tabCapture.getMediaStreamId({
    targetTabId: tabId,
  });
  await ensureOffscreen();

  const session = createSession({ tabId, title: pageTitle, tabUrl });
  const res = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "start",
    streamId,
    baseName: session.segments[0].fileName.replace(/\.mp3$/, ""),
    title: pageTitle,
  });
  if (!res?.ok) throw new Error(res?.error ?? "Recorder did not start");

  await setSession(session);
  chrome.action.setBadgeText({ text: "REC" });
  chrome.action.setBadgeBackgroundColor({ color: "#c00" });
  // Reconciliation only: title changes arrive through tabs.onUpdated. The alarm
  // also keeps the worker from being suspended without a wake-up path.
  chrome.alarms.create("title-watch", { periodInMinutes: 1 });
  await openRecorderPage();
  return session;
}

async function stop() {
  const session = await getSession();
  chrome.alarms.clear("title-watch");
  await chrome.runtime
    .sendMessage({ target: "offscreen", type: "stop" })
    .catch(() => {});
  chrome.action.setBadgeText({ text: "" });
  await setSession(null);

  if (session) {
    const finished = finishSession(session);
    const history = (await chrome.storage.local.get("history")).history ?? [];
    history.unshift({
      title: finished.title,
      files: finished.segments.map((s) => s.fileName),
      startedAt: finished.startedAt,
      tabUrl: finished.tabUrl,
    });
    await chrome.storage.local.set({ history: history.slice(0, 50) });
    return finished;
  }
  return null;
}

// The recorded tab's title is the file name, so a title change rolls the file
// over. activeTab (which the capture needs anyway) grants host permission for
// that tab, which is what makes changeInfo.title available here.
async function checkTitle(tabId, reportedTitle) {
  const session = await getSession();
  if (!session || session.tabId !== tabId) return;

  const title = reportedTitle ?? (await chrome.tabs.get(tabId).catch(() => null))?.title ?? "";
  const { session: next, opened } = applyTitle(session, title);
  if (!opened) return;

  await setSession(next);
  await chrome.runtime
    .sendMessage({
      target: "offscreen",
      type: "rotate",
      baseName: opened.fileName.replace(/\.mp3$/, ""),
      title: opened.title,
    })
    .catch(() => {});
  await tellRecorderPage(next);
}

async function tellRecorderPage(session) {
  if (recorderTabId == null) return;
  await chrome.tabs
    .sendMessage(recorderTabId, { type: "session", session })
    .catch(() => {});
}

// ---- folder and saving --------------------------------------------------

async function pickFolder() {
  const tabId = await openRecorderPage();
  await chrome.tabs.sendMessage(tabId, { type: "pick-folder" }).catch(() => {});
  return tabId;
}

// The recorder tab writes the file; the worker parks the blob URL until it has
// been collected, because a service worker cannot use the File System API.
// Files that arrive before a folder is chosen stay parked and are flushed when
// the folder is picked.
async function save({ url, name, title }) {
  const id = crypto.randomUUID();
  await chrome.storage.session.set({ [`pending-${id}`]: { url, name, title } });
  await flushPending();
  return { ok: true, id };
}

async function pendingEntries() {
  const all = await chrome.storage.session.get(null);
  return Object.entries(all).filter(([key]) => key.startsWith("pending-"));
}

async function flushPending() {
  const entries = await pendingEntries();
  if (!entries.length) return { written: 0, waiting: 0 };
  await ensureRecorderTab();
  if (recorderTabId == null) return { written: 0, waiting: entries.length };

  let written = 0;
  for (const [key, entry] of entries) {
    const res = await chrome.tabs
      .sendMessage(recorderTabId, { type: "save", id: key.slice("pending-".length) })
      .catch(() => null);
    // Stop at the first refusal: no folder yet, so the rest would fail too.
    if (!res?.ok) break;
    written++;
    await release(entry.url);
    const saved = (await chrome.storage.local.get("saved")).saved ?? [];
    saved.unshift({ name: entry.name, title: entry.title, folder: res.folder ?? "" });
    await chrome.storage.local.set({ saved: saved.slice(0, 200) });
  }
  return { written, waiting: entries.length - written };
}

// The recorder tab is the only context that can hold a directory handle, and
// it may have been closed; open it before handing files over.
async function ensureRecorderTab() {
  if (recorderTabId != null) {
    const tab = await chrome.tabs.get(recorderTabId).catch(() => null);
    if (tab) return recorderTabId;
    recorderTabId = null;
  }
  const [existing] = await chrome.tabs.query({
    url: chrome.runtime.getURL(`${RECORDER_PAGE}*`),
  });
  recorderTabId = existing?.id ?? null;
  return recorderTabId;
}

// The recorder has the bytes; let the offscreen document drop its blob.
async function release(url) {
  await chrome.runtime
    .sendMessage({ target: "offscreen", type: "release", url })
    .catch(() => {});
}

async function takePending(id) {
  const key = `pending-${id}`;
  const { [key]: entry } = await chrome.storage.session.get(key);
  await chrome.storage.session.remove(key);
  return entry ?? null;
}

// ---- messages ----------------------------------------------------------

// Recorder page: reports what it did.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== "recorder") return;
  if (sender?.tab?.id != null) recorderTabId = sender.tab.id;

  (async () => {
    try {
      if (msg.type === "ready") {
        return sendResponse({
          ok: true,
          session: await getSession(),
          folder: (await chrome.storage.local.get("folderName")).folderName ?? null,
        });
      }
      if (msg.type === "take") {
        return sendResponse({ ok: true, ...(await takePending(msg.id)) });
      }
      if (msg.type === "saved") {
        const entry = await takePending(msg.id);
        if (entry) await release(entry.url);
        return sendResponse({ ok: true });
      }
      if (msg.type === "folder") {
        await chrome.storage.local.set({ folderName: msg.name });
        // Files recorded before the folder was chosen are written now.
        return sendResponse({ ok: true, ...(await flushPending()) });
      }
      if (msg.type === "pick") {
        await pickFolder();
        return sendResponse({ ok: true });
      }
      sendResponse({ ok: false, error: `Unknown type ${msg.type}` });
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message ?? e) });
    }
  })();
  return true;
});

// Page API (content-script bridge): the recorded tab is always sender.tab, so a
// page can only record and stop its own tab.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== "automation") return;
  if (!sender.tab) return sendResponse({ ok: false, error: "Not a page context" });

  (async () => {
    try {
      switch (msg.type) {
        case "capabilities":
          return sendResponse({
            ok: true,
            version: chrome.runtime.getManifest().version,
            session: await getSession(),
          });
        case "start":
          try {
            const session = await start(sender.tab.id, {
              title: msg.payload?.title ?? sender.tab.title,
              tabUrl: sender.tab.url,
            });
            return sendResponse({ ok: true, tabId: sender.tab.id, session });
          } catch (e) {
            const message = String(e?.message ?? e);
            return sendResponse({
              ok: false,
              error: message,
              hint: GESTURE_ERROR.test(message)
                ? "tabCapture needs an extension invoke gesture for this tab: " +
                  "click the toolbar icon or press Alt+Shift+R once."
                : undefined,
            });
          }
        case "stop": {
          const current = await getSession();
          if (current && current.tabId !== sender.tab.id)
            return sendResponse({ ok: false, error: "Another tab is being recorded" });
          return sendResponse({ ok: true, session: await stop() });
        }
        case "state":
          return sendResponse({ ok: true, session: await getSession() });
        case "folder":
          await pickFolder();
          return sendResponse({ ok: true });
        default:
          return sendResponse({ ok: false, error: `Unknown type ${msg.type}` });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message ?? e) });
    }
  })();
  return true;
});

// Offscreen + popup + page API.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== "extension-api") return;

  (async () => {
    try {
      switch (msg.type) {
        case "save":
          return sendResponse(await save(msg));
        case "state":
          return sendResponse({ ok: true, session: await getSession() });
        case "stop":
          return sendResponse({ ok: true, session: await stop() });
        case "start": {
          const tab = msg.tabId
            ? await chrome.tabs.get(msg.tabId)
            : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
          if (!tab) return sendResponse({ ok: false, error: "No target tab" });
          try {
            const session = await start(tab.id, {
              title: msg.title,
              tabUrl: tab.url,
            });
            return sendResponse({ ok: true, tabId: tab.id, session });
          } catch (e) {
            const message = String(e?.message ?? e);
            return sendResponse({
              ok: false,
              error: message,
              hint: GESTURE_ERROR.test(message)
                ? "tabCapture needs an extension invoke gesture for that tab: " +
                  "click the toolbar icon or press Alt+Shift+R."
                : undefined,
            });
          }
        }
        case "folder":
          return sendResponse({
            ok: true,
            folder: (await chrome.storage.local.get("folderName")).folderName ?? null,
          });
        default:
          return sendResponse({ ok: false, error: `Unknown type ${msg.type}` });
      }
    } finally {
      void sender;
    }
  })();
  return true;
});

const GESTURE_ERROR = /has not been invoked|kGrantError|activeTab/i;

// ---- gestures and lifecycle --------------------------------------------

// The popup button is the invoke gesture; the worker only needs the tab.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== "popup") return;
  const tabId = msg.tabId ?? sender.tab?.id;
  if (tabId == null) return sendResponse({ ok: false, error: "No tab" });

  (async () => {
    try {
      const session = await start(tabId, { title: msg.title, tabUrl: msg.tabUrl });
      sendResponse({ ok: true, session });
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message ?? e) });
    }
  })();
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "stop-recording") return stop();
  if (command !== "start-recording") return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  try {
    await start(tab.id, { title: tab.title, tabUrl: tab.url });
  } catch (e) {
    console.error("shortcut capture failed:", e?.message ?? e);
  }
});

// Returning the promise keeps successive title updates (and the tests) in
// order; Chrome ignores listener return values.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.title === undefined) return;
  return checkTitle(tabId, changeInfo.title);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (tabId === recorderTabId) recorderTabId = null;
  const session = await getSession();
  if (session?.tabId === tabId) await stop();
});

// Reconcile a missed title update, e.g. when the tab was renamed while the
// worker was suspended.
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "title-watch") return;
  const session = await getSession();
  if (session) await checkTitle(session.tabId);
});
