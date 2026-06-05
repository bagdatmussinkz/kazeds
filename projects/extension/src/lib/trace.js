// Distributed tracing emitter for the extension service worker.
// Disabled by default; enable from any page console of an extension-injected tab:
//   chrome.storage.local.set({ kazeds_trace: true })
// or via the extension action (future). Events (with full payloads) are
// batched and POSTed to the relay: GET /v1/trace to read them back.

import { RELAY_URL } from "./relay-client.js";

let enabled = false;
let queue = [];
let flushTimer = null;

chrome.storage.local.get("kazeds_trace").then((v) => {
  enabled = !!v.kazeds_trace;
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "kazeds_trace" in changes) {
    enabled = !!changes.kazeds_trace.newValue;
  }
});

export function isTraceEnabled() {
  return enabled;
}

/**
 * Queue a trace event. info-level events require tracing to be enabled;
 * warn/error events are ALWAYS shipped so failures on real sites are
 * captured without any manual setup.
 * @param {string|undefined} sessionId
 * @param {"info"|"warn"|"error"} level
 * @param {string} msg
 * @param {unknown} [data] full payload — included verbatim
 */
export function trace(sessionId, level, msg, data) {
  if (!enabled && level === "info") return;
  queue.push({
    session_id: sessionId,
    source: "extension-sw",
    level,
    msg,
    data,
    ts: new Date().toISOString(),
  });
  if (!flushTimer) flushTimer = setTimeout(flush, 1000);
}

async function flush() {
  flushTimer = null;
  if (queue.length === 0) return;
  const batch = queue.splice(0, 100);
  try {
    await fetch(`${RELAY_URL}/trace`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batch),
    });
  } catch {
    // tracing is best-effort; drop on failure
  }
  if (queue.length > 0) flushTimer = setTimeout(flush, 1000);
}
