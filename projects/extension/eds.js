/**
 * KazEDS — NCALayer WebSocket Emulator
 * Compatible with ncalayer-js-client, eGov, banks, damubala.kz
 * Protocol: NCALayer 1.4 (basics + commonUtils modules)
 */

(function () {
  "use strict";

  if (window.__KAZEDS_LOADED__) return;
  window.__KAZEDS_LOADED__ = true;

  const RELAY_URL = "https://relay-sign.aitu.uz/v1";
  const APP_URL = "https://app-sign.aitu.uz";
  const POLLING_INTERVAL = 2000;
  const NCALAYER_PATTERN = /127\.0\.0\.1:13579/;
  const HEARTBEAT_MSG = "--heartbeat--";

  console.log("[KazEDS] Loaded, relay:", RELAY_URL);

  // ============ Helpers ============

  function wrapPEM(base64, label) {
    const lines = [];
    for (let i = 0; i < base64.length; i += 76) {
      lines.push(base64.slice(i, i + 76));
    }
    return "-----BEGIN " + label + "-----\n" + lines.join("\n") + "\n-----END " + label + "-----";
  }

  // NCALayer response formatters (match Doodocs/real NCALayer exactly)
  function successBasics(result) {
    return { status: true, body: { result } };
  }

  function errorBasics(code, message, details) {
    return { status: false, code: String(code), message: message || "", details: details || "", body: {} };
  }

  function successCommon(responseObject) {
    return { code: "200", responseObject };
  }

  function errorCommon(message) {
    return { code: "500", message: message || "Internal error" };
  }

  // Signal presence
  window.__KAZEDS_INSTALLED__ = true;
  window.dispatchEvent(new CustomEvent("kazeds:installed"));

  // ============ Relay Client ============

  async function createSession(origin, operation, data) {
    console.log("[KazEDS] Creating session:", { origin, operation });
    const res = await fetch(`${RELAY_URL}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ origin, operation, data }),
    });
    if (!res.ok) throw new Error("Relay unavailable: " + res.status);
    const session = await res.json();
    console.log("[KazEDS] Session created:", session.session_id);
    return session;
  }

  async function pollSession(sessionId) {
    const res = await fetch(`${RELAY_URL}/sessions/${sessionId}/status`);
    if (!res.ok) return null;
    return res.json();
  }

  async function cancelSession(sessionId) {
    try { await fetch(`${RELAY_URL}/sessions/${sessionId}`, { method: "DELETE" }); } catch {}
  }

  // ============ Session Flow ============

  async function handleSignRequest(origin, operation, data) {
    let session;
    try {
      session = await createSession(origin, operation, data);
    } catch (err) {
      return { error: { code: -32001, message: err.message } };
    }

    showQROverlay(session, operation);

    for (let i = 0; i < 150; i++) {
      await new Promise((r) => setTimeout(r, POLLING_INTERVAL));
      try {
        const status = await pollSession(session.session_id);
        if (!status) continue;
        if (i % 5 === 0) console.log("[KazEDS] Poll #" + i + ":", status.status);

        if (status.status === "completed" && status.result) {
          hideQROverlay();
          window.__KAZEDS_LAST_CERT__ = status.result.certificate || null;
          window.__KAZEDS_LAST_RESULT__ = status.result;
          return { result: status.result };
        }
        if (status.status === "rejected") { hideQROverlay(); return { error: { code: -32000, message: "Отменено пользователем" } }; }
        if (status.status === "expired") { hideQROverlay(); return { error: { code: -32000, message: "Время ожидания истекло" } }; }
        if (status.status === "error") { hideQROverlay(); return { error: { code: -32000, message: "Ошибка подписания" } }; }
      } catch {}
    }
    hideQROverlay();
    return { error: { code: -32000, message: "Время ожидания истекло" } };
  }

  // Get CMS PEM from signature (auto-detect format)
  function toCmsPem(sig) {
    if (!sig) return sig;
    if (sig.startsWith("-----BEGIN")) return sig; // already PEM
    if (sig.startsWith("MII")) return wrapPEM(sig, "CMS"); // CMS DER base64
    return sig; // raw signature
  }

  // ============ NCALayer Module Handlers ============

  let cachedCertificate = null;

  // --- kz.gov.pki.knca.basics ---
  async function handleBasics(method, args) {
    const origin = window.location.origin;

    if (method === "sign") {
      const data = args?.data;
      const format = args?.format || "cms";
      const dataItems = Array.isArray(data) ? data : [typeof data === "string" ? data : ""];

      const results = [];
      for (const item of dataItems) {
        const r = await handleSignRequest(origin, "sign", item);
        if (r.error) return errorBasics(r.error.code, r.error.message);

        if (format === "raw") {
          results.push(r.result.signature);
        } else {
          // CMS or XML — wrap in PEM
          results.push(toCmsPem(r.result.signature));
        }
      }

      if (format === "raw") {
        const response = { signatures: results };
        if (results.length > 0 && cachedCertificate) {
          response.certificate = wrapPEM(cachedCertificate.certificate || "", "CERTIFICATE");
        }
        return successBasics(response);
      }

      return successBasics(results);
    }

    return errorBasics("-32601", "Method not found: " + method);
  }

  // --- kz.gov.pki.knca.commonUtils ---
  async function handleCommonUtils(method, args) {
    const origin = window.location.origin;
    const params = Array.isArray(args) ? args : [];

    if (method === "getActiveTokens") return successCommon(["PKCS12"]);

    if (method === "changeLocale") return null; // fire-and-forget

    if (method === "getKeyInfo") {
      if (cachedCertificate) return successCommon(cachedCertificate);
      const r = await handleSignRequest(origin, "auth");
      if (r.error) return errorCommon(r.error.message);
      cachedCertificate = r.result;
      return successCommon(r.result);
    }

    if (method === "createCAdESFromBase64" || method === "createCMSSignatureFromBase64" || method === "createCAdESFromBase64Hash") {
      const data = params[2];
      const r = await handleSignRequest(origin, "sign", data);
      if (r.error) return errorCommon(r.error.message);
      return successCommon(toCmsPem(r.result.signature));
    }

    if (method === "signXml") {
      const xml = params[2];
      // Pass raw XML — relay/web-app will handle encoding
      const r = await handleSignRequest(origin, "sign", btoa(unescape(encodeURIComponent(xml))));
      if (r.error) return errorCommon(r.error.message);
      return successCommon(r.result.signature);
    }

    if (method === "signXmls") {
      const xmls = params[2];
      if (!Array.isArray(xmls)) return successCommon([]); // fallback empty
      const results = [];
      for (const xml of xmls) {
        const r = await handleSignRequest(origin, "sign", btoa(unescape(encodeURIComponent(xml))));
        if (r.error) return errorCommon(r.error.message);
        results.push(r.result.signature);
      }
      return successCommon(results);
    }

    return errorCommon("Method not found: " + method);
  }

  // ============ WebSocket Emulation ============

  const OriginalWebSocket = window.WebSocket;

  window.WebSocket = function (url, protocols) {
    if (!NCALAYER_PATTERN.test(url)) {
      return new OriginalWebSocket(url, protocols);
    }

    console.log("[KazEDS] Intercepting WebSocket:", url);

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
        const text = typeof data === "string" ? data : String(data);

        console.log("[KazEDS] WS.send raw:", text.slice(0, 200));

        // Heartbeat handling (matches real NCALayer)
        if (text === HEARTBEAT_MSG) {
          this.dispatchEvent(new MessageEvent("message", { data: HEARTBEAT_MSG }));
          return;
        }
        if (text.trim() === "{}") return; // silent keepalive

        let parsed;
        try { parsed = JSON.parse(text); } catch { console.log("[KazEDS] WS.send: not JSON"); return; }

        // Validate: must have module + (method or command or type)
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) { console.log("[KazEDS] WS.send: invalid object"); return; }
        if (!parsed.module || (!parsed.method && !parsed.command && !parsed.type)) { console.log("[KazEDS] WS.send: no module/method, dropping:", JSON.stringify(parsed).slice(0, 100)); return; }

        const module = parsed.module;
        const method = parsed.method || parsed.command || parsed.type;
        const args = parsed.args || parsed.params;

        console.log("[KazEDS] Request:", module, method);

        // Route to handler
        let responsePromise;
        if (module === "kz.gov.pki.knca.basics") {
          responsePromise = handleBasics(method, args);
        } else if (module === "kz.gov.pki.knca.commonUtils") {
          responsePromise = handleCommonUtils(method, args);
        } else if (module === "kz.digiflow.mobile.extensions") {
          responsePromise = Promise.resolve({ result: { version: "1.4" } });
        } else {
          responsePromise = Promise.resolve(errorCommon("Unknown module: " + module));
        }

        responsePromise
          .then((response) => {
            // null = fire-and-forget (changeLocale)
            if (response === null) return;

            console.log("[KazEDS] Response:", module, method, response?.status !== false ? "OK" : "ERROR");
            fake.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(response) }));
          })
          .catch((err) => {
            console.error("[KazEDS] Error:", err);
            let errResponse;
            if (module === "kz.gov.pki.knca.basics") {
              errResponse = errorBasics("-32603", err.message);
            } else {
              errResponse = errorCommon(err.message);
            }
            fake.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(errResponse) }));
          });
      },

      close(code, reason) {
        this.readyState = 3;
        this.dispatchEvent(new CloseEvent("close", { code: code || 1000, reason: reason || "", wasClean: true }));
      },
    };

    // Open + NCALayer handshake (version 1.4)
    setTimeout(() => {
      fake.readyState = 1;
      fake.dispatchEvent(new Event("open"));

      setTimeout(() => {
        // NCALayer sends version immediately — no jsonrpc wrapper!
        fake.dispatchEvent(new MessageEvent("message", {
          data: JSON.stringify({ result: { version: "1.4" } }),
        }));
        console.log("[KazEDS] Handshake: version 1.4");
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

    console.log("[KazEDS] QR link:", deepLink);

    const overlay = document.createElement("div");
    overlay.id = "kazeds-qr-overlay";
    overlay.innerHTML = `
      <style>
        #kazeds-qr-overlay { position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;animation:kf 0.2s ease; }
        @keyframes kf{from{opacity:0}to{opacity:1}}
        .kc{background:#fff;border-radius:20px;padding:32px;box-shadow:0 25px 60px rgba(0,0,0,0.3);text-align:center;max-width:360px;width:90%;}
        .kt{font-size:18px;font-weight:700;color:#1e293b;margin:0 0 4px;} .ks{font-size:13px;color:#94a3b8;margin:0 0 20px;}
        .kq{position:relative;display:inline-block;margin-bottom:20px;} .ki{border-radius:12px;display:block;}
        .kp{width:100%;height:4px;background:#e2e8f0;border-radius:2px;margin-bottom:16px;overflow:hidden;} .kf{height:100%;background:#1F4E79;border-radius:2px;transition:width 1s linear;}
        .km{font-size:13px;color:#64748b;margin:0 0 16px;} .km strong{color:#1e293b;font-variant-numeric:tabular-nums;}
        .kst{display:flex;align-items:center;justify-content:center;gap:8px;font-size:13px;color:#64748b;margin:0 0 16px;}
        .ksp{width:16px;height:16px;border:2px solid #e2e8f0;border-top-color:#1F4E79;border-radius:50%;animation:ks 0.8s linear infinite;}
        @keyframes ks{to{transform:rotate(360deg)}}
        .kb{display:inline-block;padding:8px 24px;border-radius:10px;border:1px solid #e2e8f0;background:#fff;color:#64748b;font-size:13px;cursor:pointer;transition:all 0.15s;} .kb:hover{background:#f8fafc;border-color:#cbd5e1;}
        .kbg{display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:600;margin-bottom:16px;}
        .kba{background:#eff6ff;color:#1d4ed8;} .kbs{background:#fef3c7;color:#92400e;}
      </style>
      <div class="kc">
        <div class="kbg ${operation === "auth" ? "kba" : "kbs"}">${operation === "auth" ? "&#128274; Аутентификация" : "&#9998; Подписание"}</div>
        <p class="kt">Отсканируйте QR-код</p>
        <p class="ks">Откройте KazEDS на телефоне и наведите камеру</p>
        <div class="kq"><img class="ki" src="${qrImageUrl}" width="200" height="200" alt="QR" /></div>
        <div class="kp"><div class="kf" id="kazeds-bar" style="width:100%"></div></div>
        <div class="km">Осталось <strong id="kazeds-countdown">${Math.floor(totalMs / 1000)}</strong> сек</div>
        <div class="kst"><div class="ksp"></div><span>Ожидание сканирования...</span></div>
        <button class="kb" id="kazeds-cancel-btn">Отмена</button>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById("kazeds-cancel-btn").addEventListener("click", () => { cancelSession(sessionId); hideQROverlay(); });
    overlay.addEventListener("click", (e) => { if (e.target === overlay) { cancelSession(sessionId); hideQROverlay(); } });

    const bar = document.getElementById("kazeds-bar");
    const countdown = document.getElementById("kazeds-countdown");
    const startTime = Date.now();
    progressTimer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, totalMs - elapsed);
      if (bar) bar.style.width = Math.max(0, (1 - elapsed / totalMs) * 100) + "%";
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
