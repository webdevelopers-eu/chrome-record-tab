// Offscreen document: the only extension context that holds the capture stream.
// It encodes the tab to MP3 in self-contained segments, one per page title, and
// hands each finished segment to the service worker as a blob URL.
//
// Segmentation lives here because the MediaStream must stay open across title
// changes; only the encoder is restarted.

const FRAME = 1152; // MPEG-1 Layer III frame size in samples
// ScriptProcessor block size. Stopping disconnects the node, which drops the
// block that is in flight, so the loss at stop is bounded by this: 2048 samples
// is ~46 ms at 44.1 kHz. Smaller would add main-thread wake-ups for no audible
// gain; the capture stream itself is never restarted, so title changes lose 0.
const BLOCK = 2048;

let session = null;

class Segment {
  constructor({ sampleRate, bitRate, baseName, title }) {
    this.baseName = baseName;
    this.title = title;
    this.encoder = new lamejs.Mp3Encoder(2, sampleRate, bitRate);
    this.left = new Int16Array(0);
    this.right = new Int16Array(0);
    this.parts = [];
    this.closed = false;
  }

  push(left, right) {
    if (this.closed) return;
    this.left = join(this.left, left);
    this.right = join(this.right, right);
    while (this.left.length >= FRAME) {
      const l = this.left.subarray(0, FRAME);
      const r = this.right.subarray(0, FRAME);
      const out = this.encoder.encodeBuffer(l, r);
      if (out.length) this.parts.push(new Uint8Array(out));
      this.left = this.left.subarray(FRAME);
      this.right = this.right.subarray(FRAME);
    }
  }

  finish() {
    if (this.closed) return null;
    this.closed = true;
    if (this.left.length) {
      const out = this.encoder.encodeBuffer(this.left, this.right);
      if (out.length) this.parts.push(new Uint8Array(out));
    }
    const tail = this.encoder.flush();
    if (tail.length) this.parts.push(new Uint8Array(tail));
    return {
      title: this.title,
      baseName: this.baseName,
      blob: new Blob(this.parts, { type: "audio/mpeg" }),
    };
  }
}

function join(a, b) {
  if (!a.length) return b;
  if (!b.length) return a;
  const out = new Int16Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function toInt16(f32, length) {
  const out = new Int16Array(length);
  for (let i = 0; i < length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function newSegment(baseName, title) {
  return new Segment({
    sampleRate: session.sampleRate,
    bitRate: session.bitRate,
    baseName,
    title,
  });
}

async function start({ streamId, baseName, title, bitRate = 128 }) {
  if (session) throw new Error("Already recording");

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId },
    },
  });

  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  // tabCapture mutes the tab for the user; this keeps it audible.
  source.connect(context.destination);

  const processor = context.createScriptProcessor(BLOCK, 2, 2);
  session = {
    stream,
    context,
    source,
    processor,
    sampleRate: context.sampleRate,
    bitRate,
    active: null,
    running: true,
  };
  session.active = newSegment(baseName, title);

  processor.onaudioprocess = (event) => {
    if (!session?.active) return;
    const input = event.inputBuffer;
    const length = input.length;
    const left = toInt16(input.getChannelData(0), length);
    const right =
      input.numberOfChannels > 1
        ? toInt16(input.getChannelData(1), length)
        : left;
    session.active.push(left, right);
  };

  source.connect(processor);
  // A ScriptProcessor only runs while it is connected to a destination.
  processor.connect(context.destination);

  return { ok: true, file: baseName };
}

async function rotate(baseName, title) {
  if (!session) return { ok: true };
  const finished = session.active.finish();
  session.active = newSegment(baseName, title);
  if (finished) await deliver(finished);
  return { ok: true, file: baseName };
}

// Stop: let the block currently being rendered arrive before tearing down, so
// the tail is encoded instead of being discarded.
function drain(processor, timeoutMs = 250) {
  return new Promise((resolve) => {
    const original = processor.onaudioprocess;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    // One more block (plus one for scheduling slack) is the whole budget.
    const timer = setTimeout(() => {
      processor.onaudioprocess = original;
      finish();
    }, timeoutMs);
    processor.onaudioprocess = (event) => {
      original?.(event);
      finish();
    };
  });
}

async function stop() {
  if (!session) return { ok: true };
  const closing = session;
  // Keep the session live until the last block is encoded; rotate() and the
  // processor both read session.active.
  await drain(closing.processor);
  session = null;
  closing.processor.onaudioprocess = null;
  const finished = closing.active.finish();
  closing.processor.disconnect();
  closing.source.disconnect();
  closing.stream.getTracks().forEach((track) => track.stop());
  await closing.context.close();
  if (finished) await deliver(finished);
  return { ok: true };
}

// blob URLs are scoped to the extension origin, so the recorder tab can read the
// bytes with fetch() and write them to the chosen directory. The URL is kept
// alive until the worker reports the file as written: a file may wait for the
// user to pick a folder first.
async function deliver(finished) {
  const url = URL.createObjectURL(finished.blob);
  await chrome.runtime
    .sendMessage({
      target: "extension-api",
      type: "save",
      url,
      name: `${finished.baseName}.mp3`,
      title: finished.title,
    })
    .catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== "offscreen") return;

  (async () => {
    try {
      if (msg.type === "start") return sendResponse(await start(msg));
      if (msg.type === "rotate")
        return sendResponse(await rotate(msg.baseName, msg.title));
      if (msg.type === "stop") return sendResponse(await stop());
      if (msg.type === "release") {
        URL.revokeObjectURL(msg.url);
        return sendResponse({ ok: true });
      }
      sendResponse({ ok: false, error: `Unknown type ${msg.type}` });
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message ?? e) });
    }
  })();

  return true;
});
