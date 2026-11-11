// Recording session bookkeeping: which page title is being recorded, and the
// segment rotation that a title change triggers. Pure logic, unit testable.

import { buildBaseName } from "./naming.js";

export function createSession({ tabId, title, tabUrl, now }) {
  return {
    tabId,
    tabUrl: tabUrl ?? "",
    title: title ?? "",
    startedAt: Date.now(),
    segments: [
      { title: title ?? "", fileName: `${buildBaseName(title, now)}.mp3`, startedAt: Date.now() },
    ],
  };
}

// Returns the updated session plus the segment that must be closed, or null
// when nothing changed. A title change closes the old file and opens a new one.
export function applyTitle(session, title, now) {
  if (title === session.title) return { session, closed: null, opened: null };

  const last = session.segments[session.segments.length - 1];
  const closed = { ...last, endedAt: Date.now() };
  const opened = {
    title,
    fileName: `${buildBaseName(title, now)}.mp3`,
    startedAt: Date.now(),
  };
  const next = {
    ...session,
    title,
    segments: [...session.segments.slice(0, -1), closed, opened],
  };
  return { session: next, closed, opened };
}

export function finishSession(session) {
  const last = session.segments[session.segments.length - 1];
  return {
    ...session,
    endedAt: Date.now(),
    segments: [...session.segments.slice(0, -1), { ...last, endedAt: Date.now() }],
  };
}
