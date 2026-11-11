// Page-world API. Runs as a MAIN-world content script on matched origins, so
// any JavaScript on the page gets window.tabAudioRecorder with no setup and no
// extension id. It talks to extension/bridge.js (isolated world) over
// window.postMessage.
//
//   await tabAudioRecorder.start();        // title = page title
//   await tabAudioRecorder.state();
//   await tabAudioRecorder.stop();

(() => {
  const CHANNEL = "tab-audio-recorder";
  const pending = new Map();
  let seq = 0;

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (msg?.channel !== CHANNEL || msg.kind !== "reply") return;
    const entry = pending.get(msg.requestId);
    if (!entry) return;
    pending.delete(msg.requestId);
    clearTimeout(entry.timer);
    if (msg.ok) entry.resolve(msg);
    else entry.reject(Object.assign(new Error(msg.error), msg));
  });

  const call = (type, payload) =>
    new Promise((resolve, reject) => {
      const requestId = `req-${Date.now()}-${++seq}`;
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error("Timed out talking to the extension (installed and enabled?)"));
      }, 10_000);
      pending.set(requestId, { resolve, reject, timer });
      window.postMessage({ channel: CHANNEL, kind: "request", requestId, type, payload }, "*");
    });

  window.tabAudioRecorder = {
    capabilities: () => call("capabilities"),
    // The recorded tab is always this one, and the title defaults to the page
    // title, which is also the MP3 name.
    start: (options) => call("start", options ?? {}),
    stop: () => call("stop"),
    state: () => call("state"),
    folder: () => call("folder"),
  };
})();
