// Content-script bridge: lets page JavaScript drive the extension without
// knowing its id. It only controls the tab it runs in, because the background
// resolves the target from sender.tab.

const CHANNEL = "tab-audio-recorder";

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  // Replies also travel over this channel; only requests are forwarded.
  if (msg?.channel !== CHANNEL || msg.kind !== "request" || !msg.requestId) return;

  const reply = (payload) =>
    window.postMessage(
      { channel: CHANNEL, kind: "reply", requestId: msg.requestId, ...payload },
      "*"
    );

  chrome.runtime.sendMessage(
    { target: "automation", type: msg.type, payload: msg.payload },
    (res) => {
      if (chrome.runtime.lastError)
        return reply({ ok: false, error: chrome.runtime.lastError.message });
      reply(res ?? { ok: false, error: "No response from the extension" });
    }
  );
});
