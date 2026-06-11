// WebSocket interceptor for NCALayer
// Injected into page context (world: MAIN) to monkey-patch WebSocket
// Intercepts connections to localhost NCALayer endpoint on port 13579.
// Architecture: from Doodocs Sign, verified on real KZ sites.

(function () {
  "use strict";

  const KAZEDS_VERSION = "2.0.20"; // kept in sync by the version bump sed
  const INSTALL_FLAG = "__kazeds_ws_installed";
  if (window[INSTALL_FLAG]) return;
  window[INSTALL_FLAG] = true;

  const NCALAYER_HOSTS = new Set(["127.0.0.1", "localhost"]);
  const NCALAYER_PORT = "13579";
  const MSG_PREFIX = "kazeds-ext-";
  const HEARTBEAT_MSG = "--heartbeat--";
  const HEARTBEAT_JSON = "{}";

  const OriginalWebSocket = window.WebSocket;

  function isNCALayerURL(urlValue) {
    let parsed;
    try {
      parsed = new URL(String(urlValue), window.location.href);
    } catch (_) {
      return false;
    }
    const isWsProtocol = parsed.protocol === "ws:" || parsed.protocol === "wss:";
    return isWsProtocol && NCALAYER_HOSTS.has(parsed.hostname) && parsed.port === NCALAYER_PORT;
  }

  // FakeWebSocket extends EventTarget (proper spec compliance)
  class FakeWebSocket extends EventTarget {
    constructor(url, protocols) {
      super();
      this.url = String(url);
      this.protocol = protocols ? (Array.isArray(protocols) ? protocols[0] : protocols) : "";
      this.extensions = "";
      this.binaryType = "blob";
      this.bufferedAmount = 0;
      this.readyState = FakeWebSocket.CONNECTING;
      this._seq = 0;

      this._id = MSG_PREFIX + Math.random().toString(36).slice(2);
      this._setupMessageListener();

      // Simulate connection open after microtask
      Promise.resolve().then(() => {
        if (this.readyState !== FakeWebSocket.CONNECTING) return;
        this.readyState = FakeWebSocket.OPEN;
        const ev = new Event("open");
        this.dispatchEvent(ev);
        if (typeof this.onopen === "function") this.onopen(ev);

        // NCALayer sends version message right after connect
        Promise.resolve().then(() => {
          if (this.readyState !== FakeWebSocket.OPEN) return;
          const versionMsg = { result: { version: "1.4" } };
          console.log(`%c[KAZEDS TRACE][ws-intercept] SENDING VERSION MESSAGE:`, 'color: #ff00ff;', versionMsg);
          this._emitMessage(JSON.stringify(versionMsg));
        });
      });
    }

    _emitMessage(data) {
      const ev = new MessageEvent("message", { data });
      this.dispatchEvent(ev);
      if (typeof this.onmessage === "function") this.onmessage(ev);
    }

    _setupMessageListener() {
      this._listener = (event) => {
        if (event.origin !== window.location.origin) return;
        if (
          event.source !== window ||
          !event.data ||
          event.data.type !== "kazeds-ext-response" ||
          event.data.id !== this._id
        ) {
          return;
        }
        console.log(`%c[KAZEDS TRACE][ws-intercept] RESPONSE RECEIVED`, 'color: #00cc00; font-weight: bold;');
        try { console.log(`%c[KAZEDS TRACE][ws-intercept] FULL RESPONSE:`, 'color: #00cc00;', JSON.parse(JSON.stringify(event.data.payload))); } catch(e) {}
        const responseStr = JSON.stringify(event.data.payload);
        console.log(`%c[KAZEDS TRACE][ws-intercept] RESPONSE STRING (first 500):`, 'color: #00cc00;', responseStr.substring(0, 500));
        // Always ship NCALayer-level failures to the relay trace buffer
        // (page context, best-effort) — captures "signature rejected by site" cases.
        try {
          const p = event.data.payload;
          if (p && (p.status === false || p.error || (p.body && p.body.error))) {
            fetch("https://sign.aitu.uz/relay/v1/trace", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                source: "extension-page",
                level: "error",
                msg: "NCALayer response error on " + window.location.host,
                data: { url: window.location.href, response: p },
                ts: new Date().toISOString(),
              }),
            }).catch(() => {});
          }
        } catch (_) {}
        this._emitMessage(responseStr);
      };
      window.addEventListener("message", this._listener);
    }

    send(data) {
      if (this.readyState !== FakeWebSocket.OPEN) {
        throw new DOMException("WebSocket is not open", "InvalidStateError");
      }

      const text = typeof data === "string" ? data : String(data);

      // Heartbeat
      if (text === HEARTBEAT_MSG) {
        console.log(`%c[KAZEDS TRACE][ws-intercept] HEARTBEAT (--heartbeat--)`, 'color: #999;');
        this._emitMessage(HEARTBEAT_MSG);
        return;
      }

      // Keepalive
      if (text.trim() === HEARTBEAT_JSON) {
        console.log(`%c[KAZEDS TRACE][ws-intercept] KEEPALIVE ({})`, 'color: #999;');
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (_) {
        return;
      }

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return;
      }

      // Must have module + (method or command or type)
      // NURSign uses `type`, KNP uses `command`, others use `method`
      if (!parsed.module || (!parsed.method && !parsed.command && !parsed.type)) {
        return;
      }

      this._seq += 1;
      const requestId = `${this._id}:${this._seq}`;

      console.log(`%c[KAZEDS TRACE][ws-intercept] PAGE SEND (seq=${this._seq})`, 'color: #ff6600; font-weight: bold;');
      console.log(`%c[KAZEDS TRACE][ws-intercept] module=${parsed.module} method=${parsed.method || parsed.command || parsed.type || 'N/A'}`, 'color: #ff6600;');
      try { console.log(`%c[KAZEDS TRACE][ws-intercept] FULL PAYLOAD:`, 'color: #ff6600;', JSON.parse(JSON.stringify(parsed))); } catch(e) {}

      window.postMessage(
        {
          type: "kazeds-ext-request",
          id: this._id,
          requestId,
          payload: parsed,
        },
        window.location.origin
      );
    }

    close(code, reason) {
      if (this.readyState === FakeWebSocket.CLOSING || this.readyState === FakeWebSocket.CLOSED) {
        return;
      }
      this.readyState = FakeWebSocket.CLOSING;
      window.removeEventListener("message", this._listener);

      Promise.resolve().then(() => {
        this.readyState = FakeWebSocket.CLOSED;
        const ev = new CloseEvent("close", {
          code: code || 1000,
          reason: reason || "",
          wasClean: true,
        });
        this.dispatchEvent(ev);
        if (typeof this.onclose === "function") this.onclose(ev);
      });
    }

    get onopen() { return this._onopen || null; }
    set onopen(fn) { this._onopen = fn; }
    get onmessage() { return this._onmessage || null; }
    set onmessage(fn) { this._onmessage = fn; }
    get onerror() { return this._onerror || null; }
    set onerror(fn) { this._onerror = fn; }
    get onclose() { return this._onclose || null; }
    set onclose(fn) { this._onclose = fn; }
  }

  FakeWebSocket.CONNECTING = 0;
  FakeWebSocket.OPEN = 1;
  FakeWebSocket.CLOSING = 2;
  FakeWebSocket.CLOSED = 3;

  window.WebSocket = function (url, protocols) {
    if (isNCALayerURL(url)) {
      console.log(`%c[KAZEDS TRACE][ws-intercept v${KAZEDS_VERSION}] INTERCEPTING WebSocket to ${url}`, 'color: #ff00ff; font-weight: bold;');
      return new FakeWebSocket(url, protocols);
    }
    if (protocols !== undefined) {
      return new OriginalWebSocket(url, protocols);
    }
    return new OriginalWebSocket(url);
  };

  window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
  window.WebSocket.OPEN = OriginalWebSocket.OPEN;
  window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
  window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;
  window.WebSocket.prototype = OriginalWebSocket.prototype;

  Object.defineProperty(window.WebSocket, Symbol.hasInstance, {
    value: (instance) => instance instanceof OriginalWebSocket || instance instanceof FakeWebSocket,
  });

  // Signal presence for sites that check for NCALayer/KazEDS
  window.__KAZEDS_INSTALLED__ = true;
  window.dispatchEvent(new CustomEvent("kazeds:installed"));

  console.debug("[KazEDS] WebSocket interceptor installed");
})();
