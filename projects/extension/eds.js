/**
 * KazEDS Widget — встраиваемая эмуляция NCALayer
 * Для отладки без Chrome Extension
 *
 * Делает всё что Extension:
 * 1. Перехватывает WebSocket wss://127.0.0.1:13579
 * 2. Создаёт сессию на Relay
 * 3. Показывает QR overlay с прогрессом
 * 4. Поллит Relay
 * 5. Возвращает результат через fake WebSocket
 */

(function () {
  "use strict";

  // Guard: prevent double initialization
  if (window.__KAZEDS_LOADED__) return;
  window.__KAZEDS_LOADED__ = true;

  const RELAY_URL = "https://relay-sign.aitu.uz/v1";
  const APP_URL = "https://app-sign.aitu.uz";
  const POLLING_INTERVAL = 2000;
  const NCALAYER_PATTERN = /127\.0\.0\.1:13579/;

  console.log("[KazEDS Widget] Loaded, relay:", RELAY_URL);

  function wrapPEM(base64, label) {
    const lines = [];
    for (let i = 0; i < base64.length; i += 76) {
      lines.push(base64.slice(i, i + 76));
    }
    return "-----BEGIN " + label + "-----\n" + lines.join("\n") + "\n-----END " + label + "-----";
  }

  // Signal presence
  window.__KAZEDS_INSTALLED__ = true;
  window.dispatchEvent(new CustomEvent("kazeds:installed"));

  // ============ Relay Client ============

  async function createSession(origin, operation, data) {
    console.log("[KazEDS Widget] Creating session:", { origin, operation });
    const res = await fetch(`${RELAY_URL}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ origin, operation, data }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error("[KazEDS Widget] Create failed:", res.status, err);
      throw new Error("Relay unavailable: " + res.status);
    }
    const session = await res.json();
    console.log("[KazEDS Widget] Session created:", session.session_id);
    return session;
  }

  async function pollSession(sessionId) {
    const res = await fetch(`${RELAY_URL}/sessions/${sessionId}/status`);
    if (!res.ok) return null;
    return res.json();
  }

  async function cancelSession(sessionId) {
    try {
      await fetch(`${RELAY_URL}/sessions/${sessionId}`, { method: "DELETE" });
    } catch { /* ignore */ }
  }

  // ============ Session Flow ============

  async function handleSignRequest(origin, operation, data) {
    let session;
    try {
      session = await createSession(origin, operation, data);
    } catch (err) {
      return { error: { code: -32001, message: "Сервис временно недоступен: " + err.message } };
    }

    showQROverlay(session, operation);

    // Poll
    const maxAttempts = 150;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, POLLING_INTERVAL));
      try {
        const status = await pollSession(session.session_id);
        if (!status) continue;

        if (i % 5 === 0) console.log("[KazEDS Widget] Poll #" + i + ":", status.status);

        if (status.status === "completed" && status.result) {
          console.log("[KazEDS Widget] Completed!");
          hideQROverlay();
          // Save certificate for verification
          window.__KAZEDS_LAST_CERT__ = status.result.certificate || null;
          window.__KAZEDS_LAST_RESULT__ = status.result;
          return { result: status.result };
        }
        if (status.status === "rejected") {
          hideQROverlay();
          return { error: { code: -32000, message: "Отменено пользователем" } };
        }
        if (status.status === "expired") {
          hideQROverlay();
          return { error: { code: -32000, message: "Время ожидания истекло" } };
        }
        if (status.status === "error") {
          hideQROverlay();
          return { error: { code: -32000, message: "Ошибка подписания" } };
        }
      } catch (err) {
        console.warn("[KazEDS Widget] Poll error:", err.message);
      }
    }

    hideQROverlay();
    return { error: { code: -32000, message: "Время ожидания истекло" } };
  }

  // ============ NCALayer Method Handler ============

  let cachedCertificate = null;

  async function handleNCALayerRequest(module, method, args) {
    const origin = window.location.origin;

    // Map module+method to operation
    if (module === "kz.gov.pki.knca.basics") {
      if (method === "sign") {
        const data = args?.data;
        const dataStr = typeof data === "string" ? data : undefined;
        const result = await handleSignRequest(origin, "sign", dataStr);
        if (result.error) return result;
        return { result: result.result.signature };
      }
      if (method === "authenticate") {
        const result = await handleSignRequest(origin, "auth");
        if (result.error) return result;
        return { result: result.result.signature };
      }
    }

    if (module === "kz.digiflow.mobile.extensions") {
      if (method === "getVersion") {
        return { result: { version: "KazEDS/Widget" } };
      }
    }

    // commonUtils module (legacy NCALayer API — most KZ sites use this)
    if (module === "kz.gov.pki.knca.commonUtils") {
      const params = args || [];

      if (method === "getActiveTokens") return { result: ["PKCS12"] };
      if (method === "changeLocale") return { result: null };

      if (method === "getKeyInfo") {
        if (cachedCertificate) return { result: cachedCertificate };
        const r = await handleSignRequest(origin, "auth");
        if (r.error) return r;
        cachedCertificate = r.result;
        return { result: r.result.certificate };
      }

      if (method === "createCAdESFromBase64" || method === "createCMSSignatureFromBase64" || method === "createCAdESFromBase64Hash") {
        // params: [storageType, keyType, dataBase64, attached?]
        const data = params[2];
        const r = await handleSignRequest(origin, "sign", data);
        if (r.error) return r;
        return { result: wrapPEM(r.result.signature, "CMS") };
      }

      if (method === "signXml") {
        // params: [storageType, keyType, xmlString, tbsXPath, sigParentXPath]
        const xml = params[2];
        const r = await handleSignRequest(origin, "sign", btoa(xml));
        if (r.error) return r;
        return { result: r.result.signature };
      }

      if (method === "signXmls") {
        // params: [storageType, keyType, xmlArray, tbsXPath, sigParentXPath]
        const xmls = params[2];
        if (!Array.isArray(xmls)) return { error: { code: -32602, message: "xmls must be an array" } };
        const results = [];
        for (const xml of xmls) {
          const r = await handleSignRequest(origin, "sign", btoa(xml));
          if (r.error) return r;
          results.push(r.result.signature);
        }
        return { result: results };
      }

      return { error: { code: -32601, message: "Method not found: " + method } };
    }

    // Legacy NCALayer methods
    if (method === "browseKeyStore") return { result: "KazEDS://mobile-key" };
    if (method === "getKeys") {
      if (cachedCertificate) return { result: cachedCertificate.certificate };
      const result = await handleSignRequest(origin, "auth");
      if (result.error) return result;
      cachedCertificate = result.result;
      return { result: result.result.certificate };
    }
    if (method === "signPlainData" || method === "createCMSSignature" || method === "basicsSign") {
      const data = args?.data || args?.dataToSign;
      const result = await handleSignRequest(origin, "sign", data);
      if (result.error) return result;
      return { result: result.result.signature };
    }
    if (method === "basicsAuthenticate") {
      const result = await handleSignRequest(origin, "auth");
      if (result.error) return result;
      return { result: result.result.signature };
    }
    if (method === "setLocale") return { result: true };
    if (method === "getSubjectDN") return cachedCertificate ? { result: cachedCertificate.subjectDN || "" } : { error: { code: -32000, message: "No certificate" } };
    if (method === "getNotBefore") return cachedCertificate ? { result: cachedCertificate.notBefore || "" } : { error: { code: -32000, message: "No certificate" } };
    if (method === "getNotAfter") return cachedCertificate ? { result: cachedCertificate.notAfter || "" } : { error: { code: -32000, message: "No certificate" } };

    console.warn("[KazEDS Widget] Unknown method:", module, method);
    return { error: { code: -32601, message: `Method not found: ${method}` } };
  }

  // ============ WebSocket Emulation ============

  const OriginalWebSocket = window.WebSocket;

  window.WebSocket = function (url, protocols) {
    if (!NCALAYER_PATTERN.test(url)) {
      return new OriginalWebSocket(url, protocols);
    }

    console.log("[KazEDS Widget] Intercepting WebSocket:", url);
    let currentSession = null;

    const fake = {
      url,
      readyState: 0,
      CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3,
      bufferedAmount: 0, extensions: "", protocol: "", binaryType: "blob",
      onopen: null, onclose: null, onmessage: null, onerror: null,
      _listeners: { open: [], close: [], message: [], error: [] },

      addEventListener(type, fn) {
        if (this._listeners[type]) this._listeners[type].push(fn);
      },
      removeEventListener(type, fn) {
        if (this._listeners[type]) this._listeners[type] = this._listeners[type].filter((f) => f !== fn);
      },
      dispatchEvent(event) {
        const handler = this["on" + event.type];
        if (handler) handler.call(this, event);
        if (this._listeners[event.type]) this._listeners[event.type].forEach((fn) => fn.call(this, event));
      },

      send(data) {
        if (this.readyState !== 1) return;
        let parsed;
        try { parsed = JSON.parse(data); } catch { return; }

        console.log("[KazEDS Widget] WS request:", parsed.module, parsed.method);

        // Handle async
        handleNCALayerRequest(parsed.module, parsed.method, parsed.args || parsed.params)
          .then((response) => {
            console.log("[KazEDS Widget] WS response:", parsed.module, parsed.method, response.error ? "ERROR" : "OK");

            let wireResponse;

            if (parsed.module === "kz.gov.pki.knca.basics") {
              // NCALayer basics format: {status, body, code, message}
              if (response.error) {
                wireResponse = { status: false, code: String(response.error.code), message: response.error.message };
              } else {
                wireResponse = { status: true, body: { result: response.result } };
              }
            } else if (parsed.module === "kz.gov.pki.knca.commonUtils") {
              // NCALayer commonUtils format: {code, responseObject}
              if (response.error) {
                wireResponse = { code: String(response.error.code), message: response.error.message };
              } else {
                wireResponse = { code: "200", responseObject: response.result };
              }
            } else {
              // JSON-RPC fallback
              wireResponse = { jsonrpc: "2.0", id: parsed.id };
              if (response.error) {
                wireResponse.error = response.error;
              } else {
                wireResponse.result = response.result ?? null;
              }
            }

            console.log("[KazEDS Widget] Wire response:", JSON.stringify(wireResponse).slice(0, 200));
            fake.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(wireResponse) }));
          })
          .catch((err) => {
            console.error("[KazEDS Widget] Handler error:", err);
            const errResponse = parsed.module === "kz.gov.pki.knca.basics"
              ? { status: false, code: "-32603", message: err.message }
              : { jsonrpc: "2.0", id: parsed.id, error: { code: -32603, message: err.message } };
            fake.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(errResponse) }));
          });
      },

      close(code, reason) {
        this.readyState = 3;
        if (currentSession) cancelSession(currentSession);
        this.dispatchEvent(new CloseEvent("close", { code: code || 1000, reason: reason || "", wasClean: true }));
      },
    };

    // Open + handshake
    setTimeout(() => {
      fake.readyState = 1;
      fake.dispatchEvent(new Event("open"));
      console.log("[KazEDS Widget] WS opened");

      setTimeout(() => {
        const versionMsg = new MessageEvent("message", {
          data: JSON.stringify({ jsonrpc: "2.0", result: { version: "KazEDS/Widget", name: "KazEDS Widget" } }),
        });
        fake.dispatchEvent(versionMsg);
        console.log("[KazEDS Widget] Version handshake sent");
      }, 30);
    }, 50);

    return fake;
  };

  window.WebSocket.CONNECTING = 0;
  window.WebSocket.OPEN = 1;
  window.WebSocket.CLOSING = 2;
  window.WebSocket.CLOSED = 3;
  window.WebSocket.prototype = OriginalWebSocket.prototype;

  // ============ QR Overlay ============

  let progressTimer = null;

  function showQROverlay(session, operation) {
    hideQROverlay();

    const sessionId = session.session_id;
    const payload = session.qr_payload;
    const deepLink = `${APP_URL}/#/sign?session=${sessionId}&challenge=${encodeURIComponent(payload.challenge || "")}&origin=${encodeURIComponent(payload.origin || window.location.origin)}&callback=${encodeURIComponent(payload.callback_url || "")}&data=${encodeURIComponent(payload.data_b64 || "")}&op=${operation}`;
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(deepLink)}`;

    const expiresMs = new Date(session.expires_at).getTime() - Date.now();
    const totalMs = expiresMs > 0 ? expiresMs : 300000;

    console.log("[KazEDS Widget] QR link:", deepLink);

    const overlay = document.createElement("div");
    overlay.id = "kazeds-qr-overlay";
    overlay.innerHTML = `
      <style>
        #kazeds-qr-overlay {
          position: fixed; inset: 0; z-index: 2147483647;
          background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);
          display: flex; align-items: center; justify-content: center;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          animation: kazeds-fadein 0.2s ease;
        }
        @keyframes kazeds-fadein { from { opacity: 0 } to { opacity: 1 } }
        .kazeds-card {
          background: #fff; border-radius: 20px; padding: 32px;
          box-shadow: 0 25px 60px rgba(0,0,0,0.3);
          text-align: center; max-width: 360px; width: 90%;
        }
        .kazeds-title { font-size: 18px; font-weight: 700; color: #1e293b; margin: 0 0 4px; }
        .kazeds-subtitle { font-size: 13px; color: #94a3b8; margin: 0 0 20px; }
        .kazeds-qr-wrap { position: relative; display: inline-block; margin-bottom: 20px; }
        .kazeds-qr-img { border-radius: 12px; display: block; }
        .kazeds-progress-track { width: 100%; height: 4px; background: #e2e8f0; border-radius: 2px; margin-bottom: 16px; overflow: hidden; }
        .kazeds-progress-fill { height: 100%; background: #1F4E79; border-radius: 2px; transition: width 1s linear; }
        .kazeds-timer { font-size: 13px; color: #64748b; margin: 0 0 16px; }
        .kazeds-timer strong { color: #1e293b; font-variant-numeric: tabular-nums; }
        .kazeds-status { display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 13px; color: #64748b; margin: 0 0 16px; }
        .kazeds-spinner { width: 16px; height: 16px; border: 2px solid #e2e8f0; border-top-color: #1F4E79; border-radius: 50%; animation: kazeds-spin 0.8s linear infinite; }
        @keyframes kazeds-spin { to { transform: rotate(360deg) } }
        .kazeds-cancel { display: inline-block; padding: 8px 24px; border-radius: 10px; border: 1px solid #e2e8f0; background: #fff; color: #64748b; font-size: 13px; cursor: pointer; transition: all 0.15s; }
        .kazeds-cancel:hover { background: #f8fafc; border-color: #cbd5e1; }
        .kazeds-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; margin-bottom: 16px; }
        .kazeds-badge-auth { background: #eff6ff; color: #1d4ed8; }
        .kazeds-badge-sign { background: #fef3c7; color: #92400e; }
      </style>
      <div class="kazeds-card">
        <div class="kazeds-badge kazeds-badge-${operation}">
          ${operation === "auth" ? "&#128274; Аутентификация" : "&#9998; Подписание"}
        </div>
        <p class="kazeds-title">Отсканируйте QR-код</p>
        <p class="kazeds-subtitle">Откройте KazEDS на телефоне и наведите камеру</p>
        <div class="kazeds-qr-wrap">
          <img class="kazeds-qr-img" src="${qrImageUrl}" width="200" height="200" alt="QR" />
        </div>
        <div class="kazeds-progress-track"><div class="kazeds-progress-fill" id="kazeds-bar" style="width:100%"></div></div>
        <div class="kazeds-timer">Осталось <strong id="kazeds-countdown">${Math.floor(totalMs / 1000)}</strong> сек</div>
        <div class="kazeds-status">
          <div class="kazeds-spinner"></div>
          <span>Ожидание сканирования...</span>
        </div>
        <button class="kazeds-cancel" id="kazeds-cancel-btn">Отмена</button>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById("kazeds-cancel-btn").addEventListener("click", () => {
      cancelSession(sessionId);
      hideQROverlay();
    });
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) { cancelSession(sessionId); hideQROverlay(); }
    });

    const bar = document.getElementById("kazeds-bar");
    const countdown = document.getElementById("kazeds-countdown");
    const startTime = Date.now();

    progressTimer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, totalMs - elapsed);
      const pct = Math.max(0, (1 - elapsed / totalMs) * 100);
      if (bar) bar.style.width = pct + "%";
      if (countdown) countdown.textContent = String(Math.ceil(remaining / 1000));
      if (remaining <= 0) { clearInterval(progressTimer); progressTimer = null; }
    }, 1000);
  }

  function hideQROverlay() {
    if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
    const overlay = document.getElementById("kazeds-qr-overlay");
    if (overlay) overlay.remove();
  }
})();
