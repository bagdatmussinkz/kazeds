// Relay server client for KazEDS signing flow

const RELAY_URL = "https://sign.aitu.uz/relay/v1";
const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 65; // 2 minutes + slack for network latency

export async function createSession(origin, operation, data, format) {
  const body = { origin, operation };
  if (data) body.data = data;
  if (format) body.format = format;

  const resp = await fetch(`${RELAY_URL}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.message || `Relay error: ${resp.status}`);
  }
  return resp.json();
}

export async function pollSession(sessionId, signal) {
  const resp = await fetch(`${RELAY_URL}/sessions/${sessionId}/status`, { signal });
  if (!resp.ok) {
    if (resp.status === 404) throw new Error("Session expired");
    throw new Error(`Relay poll error: ${resp.status}`);
  }
  return resp.json();
}

export async function cancelSession(sessionId) {
  try {
    await fetch(`${RELAY_URL}/sessions/${sessionId}`, { method: "DELETE" });
  } catch {}
}

export function getAppURL() {
  return "https://sign.aitu.uz/app";
}

export function buildDeepLink(session, format) {
  const appUrl = getAppURL();
  const fmt = format || "cms";
  // Short URL (~75 chars) — fits in QR version 4 (capacity 78 bytes)
  // Web app fetches full session data from relay via GET /v1/sessions/:id/payload
  // NOTE: no slash before # — "/app/" triggers a 308 redirect that mobile
  // browsers cache permanently (caused a redirect loop in the field).
  return `${appUrl}#/sign?s=${session.session_id}&f=${fmt}`;
}

export { RELAY_URL, POLL_INTERVAL_MS, MAX_POLLS };

// ============ eGov Mobile (egovQR) ============

/**
 * Create an eGov signing session. eGov Mobile will fetch mgovSign (API №1),
 * then documents (API №2 GET), sign, and PUT the signed documents back.
 * @returns {Promise<{session_id, qr_content, deeplink, expires_at}>}
 */
export async function createEgovSession(origin, signMethod, documentsToSign, description) {
  const resp = await fetch(`${RELAY_URL}/egov/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      description: description || `Подписание на ${origin}`,
      organisation: { nameRu: origin, bin: "000000000000" },
      signMethod,
      documentsToSign,
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.message || `Relay egov error: ${resp.status}`);
  }
  return resp.json();
}

export async function pollEgovStatus(sessionId, signal) {
  const resp = await fetch(`${RELAY_URL}/egov/${sessionId}/status`, { signal });
  if (!resp.ok) {
    if (resp.status === 404) throw new Error("Session expired");
    throw new Error(`Relay egov poll error: ${resp.status}`);
  }
  return resp.json();
}

/** Привязать egov-deeplink к основной сессии (PWA покажет кнопку eGov Mobile). */
export async function linkEgovToSession(sessionId, deeplink) {
  try {
    await fetch(`${RELAY_URL}/sessions/${sessionId}/egov`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deeplink }),
    });
  } catch {
    // best-effort
  }
}
