// File naming helpers. Dependency-free so they run in the service worker, the
// offscreen document and Node tests.

const MAX_PART = 80;

export function sanitizePart(value, fallback) {
  const clean = String(value ?? "")
    // Characters that are illegal on Windows and reserved on every platform.
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // Windows strips trailing dots and spaces, which would eat the extension.
    .replace(/[. ]+$/, "")
    .slice(0, MAX_PART)
    .trim();
  if (!clean) return fallback;
  // Reserved DOS device names may not be used as a file name.
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(clean)) return `${clean}_`;
  return clean;
}

export function timestamp(now = new Date()) {
  return now
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
}

// The page title is the file name; the timestamp keeps a re-recorded title
// from overwriting an earlier file.
export function buildBaseName(title, now) {
  return `${sanitizePart(title, "untitled")} - ${timestamp(now)}`;
}
