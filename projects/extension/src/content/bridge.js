// Bridge script running in ISOLATED world
// Relays messages between the MAIN world (ws-intercept.js) and the service worker

(function () {
  "use strict";

  // Clean up previous instance (handles extension reload)
  if (window.__kazedsBridgeCleanup) {
    try { window.__kazedsBridgeCleanup(); } catch {}
  }

  try {
    console.log(
      `%c[KAZEDS][bridge] KazEDS extension v${chrome.runtime.getManifest().version}`,
      "color: #1F4E79; font-weight: bold;",
    );
  } catch {}

  function protocolErrorForPayload(_payload, message) {
    return { code: "500", message };
  }

  async function onMessage(event) {
    if (event.origin !== window.location.origin) return;
    if (
      event.source !== window ||
      !event.data ||
      event.data.type !== "kazeds-ext-request"
    ) {
      return;
    }

    // If extension context was invalidated (extension reloaded), skip
    if (!chrome.runtime?.id) return;

    const { id, requestId, payload } = event.data;

    console.log(`%c[KAZEDS TRACE][bridge] REQUEST → SW`, 'color: #0088ff; font-weight: bold;');
    console.log(`%c[KAZEDS TRACE][bridge] module=${payload?.module} method=${payload?.method || payload?.command || payload?.type || 'N/A'}`, 'color: #0088ff;');
    try { console.log(`%c[KAZEDS TRACE][bridge] FULL REQUEST PAYLOAD:`, 'color: #0088ff;', JSON.parse(JSON.stringify(payload))); } catch(e) {}

    try {
      const response = await chrome.runtime.sendMessage({
        type: "ncalayer-api",
        id,
        requestId,
        payload,
      });

      if (response === undefined) {
        throw new Error("Service worker unavailable");
      }

      // null = fire-and-forget (e.g. changeLocale)
      if (response === null) {
        console.log(`%c[KAZEDS TRACE][bridge] RESPONSE ← SW: null (fire-and-forget)`, 'color: #0088ff;');
        return;
      }

      console.log(`%c[KAZEDS TRACE][bridge] RESPONSE ← SW`, 'color: #00cc00; font-weight: bold;');
      try { console.log(`%c[KAZEDS TRACE][bridge] FULL RESPONSE:`, 'color: #00cc00;', JSON.parse(JSON.stringify(response))); } catch(e) {}
      try {
        const keys = Object.keys(response);
        const summary = keys.map(k => {
          const v = response[k];
          if (typeof v === 'string' && v.length > 200) return `${k}:[string:${v.length}]`;
          return `${k}:${JSON.stringify(v)}`.substring(0, 150);
        });
        console.log(`%c[KAZEDS TRACE][bridge] RESPONSE SUMMARY:`, 'color: #00cc00;', summary);
      } catch(e) {}

      window.postMessage(
        {
          type: "kazeds-ext-response",
          id,
          requestId: requestId || null,
          payload: response,
        },
        window.location.origin
      );
    } catch (err) {
      console.log(`%c[KAZEDS TRACE][bridge] ERROR:`, 'color: #ff0000; font-weight: bold;', err.message);
      window.postMessage(
        {
          type: "kazeds-ext-response",
          id,
          requestId: requestId || null,
          payload: protocolErrorForPayload(payload, "Extension error: " + err.message),
        },
        window.location.origin
      );
    }
  }

  window.addEventListener("message", onMessage);

  window.__kazedsBridgeCleanup = () => {
    window.removeEventListener("message", onMessage);
    delete window.__kazedsBridgeCleanup;
  };

  console.debug("[KazEDS] Bridge script installed");
})();
