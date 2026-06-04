// Signing flow manager
// Creates relay session, shows QR overlay on the requesting tab, polls for result

import { createSession, pollSession, cancelSession, buildDeepLink, POLL_INTERVAL_MS, MAX_POLLS } from "../lib/relay-client.js";
import { generateQRDataURL } from "../lib/qr-generate.js";

const pendingFlows = new Map();

/**
 * Execute signing flow: create session → show QR → poll → return result
 * @param {Object} senderInfo - { domain, origin, tabId }
 * @param {string} operation - "auth" | "sign"
 * @param {string} [data] - base64 data to sign
 * @param {string} [format] - "cms" | "xml"
 * @returns {Promise<Object>} SigningResult from relay
 */
export async function executeSignFlow(senderInfo, operation, data, format) {
  const origin = senderInfo.origin || `https://${senderInfo.domain}`;

  // Create relay session
  let session;
  try {
    session = await createSession(origin, operation, data, format);
  } catch (err) {
    throw new Error("Failed to create signing session: " + err.message);
  }

  const sessionId = session.session_id;
  const deepLink = buildDeepLink(session, format);
  const qrImageUrl = generateQRDataURL(deepLink, 280);

  console.debug("[KazEDS] Session created:", sessionId, "deep link:", deepLink.slice(0, 100));

  // Show QR overlay on requesting tab
  if (senderInfo.tabId != null) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: senderInfo.tabId },
        files: ["src/content/qr-overlay.js"],
      });

      await chrome.tabs.sendMessage(senderInfo.tabId, {
        type: "kazeds-show-qr",
        sessionId,
        qrImageUrl,
        deepLink,
        operation,
        domain: senderInfo.domain,
        expiresAt: session.expires_at,
      });
    } catch (err) {
      console.warn("[KazEDS] Failed to show QR overlay:", err.message);
    }
  }

  // Store abort controller for cancellation
  const abortController = new AbortController();
  pendingFlows.set(sessionId, { abortController, tabId: senderInfo.tabId });

  try {
    // Poll for result
    for (let i = 0; i < MAX_POLLS; i++) {
      if (abortController.signal.aborted) {
        throw new Error("User cancelled signing");
      }

      await sleep(POLL_INTERVAL_MS);

      let status;
      try {
        status = await pollSession(sessionId, abortController.signal);
      } catch (err) {
        if (err.name === "AbortError") throw new Error("User cancelled signing");
        continue;
      }

      if (!status) continue;

      if (status.status === "completed" && status.result) {
        hideQR(senderInfo.tabId, sessionId);
        return status.result;
      }

      if (status.status === "rejected") {
        hideQR(senderInfo.tabId, sessionId);
        throw new Error("User cancelled signing");
      }

      if (status.status === "expired") {
        hideQR(senderInfo.tabId, sessionId);
        throw new Error("Signing session expired");
      }

      if (status.status === "error") {
        hideQR(senderInfo.tabId, sessionId);
        throw new Error("Signing error on mobile device");
      }

      // Update overlay status (scanned)
      if (status.status === "scanned" && senderInfo.tabId != null) {
        try {
          chrome.tabs.sendMessage(senderInfo.tabId, {
            type: "kazeds-qr-status",
            sessionId,
            status: "scanned",
          });
        } catch {}
      }
    }

    hideQR(senderInfo.tabId, sessionId);
    throw new Error("Signing session timed out");
  } finally {
    pendingFlows.delete(sessionId);
  }
}

/**
 * Cancel a pending signing flow (called from QR overlay cancel button)
 */
export function cancelFlow(sessionId) {
  const flow = pendingFlows.get(sessionId);
  if (flow) {
    flow.abortController.abort();
    cancelSession(sessionId);
    hideQR(flow.tabId, sessionId);
    pendingFlows.delete(sessionId);
  }
}

function hideQR(tabId, sessionId) {
  if (tabId != null) {
    try {
      chrome.tabs.sendMessage(tabId, { type: "kazeds-hide-qr", sessionId });
    } catch {}
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Listen for cancel messages from QR overlay
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "kazeds-cancel-flow") {
    cancelFlow(message.sessionId);
    sendResponse({ ok: true });
    return true;
  }
  return false;
});
