// Service Worker — main background script
// Routes NCALayer API messages to the module handler
// No WASM, no keystore — all signing happens on the web app

import { handleNCALayerRequest, formatErrorForModule } from "./ncalayer-api.js";
import "./sign-flow.js"; // registers cancel message listener

// Message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "ncalayer-api") {
    const senderURL = sender.tab?.url ? new URL(sender.tab.url) : null;
    const senderInfo = {
      domain: senderURL?.hostname || "unknown",
      origin: senderURL?.origin || "null",
      tabId: sender.tab?.id,
    };

    console.debug("[KazEDS] Request:", message.payload?.module, message.payload?.method || message.payload?.command || message.payload?.type);

    (async () => {
      try {
        const response = await handleNCALayerRequest(message.payload, senderInfo);
        console.debug("[KazEDS] Response:", response?.code || response?.status || response?.errorCode || "ok");
        sendResponse(response);
      } catch (err) {
        console.error("[KazEDS] Error:", err.message);
        sendResponse(formatErrorForModule(message.payload, "Internal error: " + err.message));
      }
    })();
    return true; // async sendResponse
  }

  return false;
});

// Re-inject content scripts after extension install/reload
chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || tab.url?.startsWith("chrome://")) continue;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ["src/content/bridge.js"],
      });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ["src/content/ws-intercept.js"],
        world: "MAIN",
      });
    } catch (_) {
      // Ignore tabs we can't inject into
    }
  }
  console.debug("[KazEDS] Content scripts re-injected into existing tabs");
});

console.debug("[KazEDS] Service worker started v2.0");
