// Popup. Starts and stops a recording; the file name comes from the page title
// and the save folder is chosen on the recorder page, so there is no form here.

const $ = (id) => document.getElementById(id);

async function state() {
  const res = await chrome.runtime.sendMessage({
    target: "extension-api",
    type: "state",
  });
  return res?.session ?? null;
}

async function render() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const session = await state();
  $("hint").textContent = "";
  $("hint").className = "hint";

  if (session) {
    const current = session.segments[session.segments.length - 1];
    $("status").textContent = `Recording “${current.title || "untitled"}” — ${session.segments.length} file(s).`;
    $("start").hidden = true;
    $("stop").hidden = false;
    return;
  }

  const capturable = !/^(chrome|edge|about|devtools|chrome-extension):/.test(
    tab?.url ?? ""
  );
  $("status").textContent = capturable
    ? "The page title becomes the MP3 name. It rolls over when the title changes."
    : "This page cannot be recorded.";
  $("start").hidden = !capturable;
  $("stop").hidden = true;
  $("start").dataset.tabId = tab?.id ?? "";
  $("start").dataset.tabUrl = tab?.url ?? "";
  $("start").dataset.title = tab?.title ?? "";
}

$("start").onclick = async () => {
  $("hint").textContent = "Starting…";
  const res = await chrome.runtime.sendMessage({
    target: "popup",
    type: "start",
    tabId: Number($("start").dataset.tabId),
    tabUrl: $("start").dataset.tabUrl,
    title: $("start").dataset.title,
  });
  if (!res?.ok) {
    $("hint").className = "hint err";
    $("hint").textContent = res?.error ?? "Could not start";
    return;
  }
  setTimeout(render, 300);
};

$("stop").onclick = async () => {
  $("hint").textContent = "Saving…";
  const res = await chrome.runtime.sendMessage({
    target: "extension-api",
    type: "stop",
  });
  $("hint").textContent = res?.ok ? "Saved." : res?.error ?? "Failed";
  setTimeout(render, 500);
};

$("folder").onclick = async () => {
  // Picking must happen on the recorder page: the popup would close as soon as
  // the folder dialog takes focus. Send the message first, then close.
  await chrome.runtime.sendMessage({ target: "recorder", type: "pick" });
  window.close();
};

render();
