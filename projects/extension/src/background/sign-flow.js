// Signing flow manager
// Creates relay session, shows QR overlay on the requesting tab, polls for result

import { createSession, pollSession, cancelSession, buildDeepLink, createEgovSession, pollEgovStatus, RELAY_URL, POLL_INTERVAL_MS, MAX_POLLS } from "../lib/relay-client.js";
import { generateQRDataURL } from "../lib/qr-generate.js";
import { trace, isTraceEnabled } from "../lib/trace.js";

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
    trace(undefined, "error", "createSession failed", { origin, operation, format, error: err.message });
    throw new Error("Failed to create signing session: " + err.message);
  }

  const sessionId = session.session_id;
  const deepLink = buildDeepLink(session, format);
  const qrImageUrl = generateQRDataURL(deepLink, 280);

  console.debug("[KazEDS] Session created:", sessionId, "deep link:", deepLink.slice(0, 100));
  trace(sessionId, "info", "session created", { origin, operation, format, session, deepLink });

  // Parallel eGov Mobile session. Best-effort: if the egov session fails,
  // the KazEDS QR still works alone.
  // - sign: документ as-is (XML raw / CMS base64)
  // - auth: egovQR не имеет auth-флоу — подписываем challenge-XML, сертификат
  //   подписанта достаём из XMLDSig (ds:X509Certificate) для getKeyInfo.
  let egov = null;
  if ((operation === "sign" && data) || operation === "auth") {
    try {
      let documentsToSign;
      let signMethod;
      if (operation === "auth") {
        signMethod = "XML";
        const challengeXml =
          `<auth><challenge>${session.challenge || sessionId}</challenge>` +
          `<origin>${origin}</origin></auth>`;
        documentsToSign = [{ id: 1, nameRu: `Авторизация на ${senderInfo.domain}`, documentXml: challengeXml }];
      } else if (format === "xml") {
        // data — base64 от btoa(unescape(encodeURIComponent(xml)))
        const xmlString = decodeURIComponent(escape(atob(data)));
        signMethod = "XML";
        documentsToSign = [{ id: 1, nameRu: `Документ с ${senderInfo.domain}`, documentXml: xmlString }];
      } else {
        signMethod = "CMS_SIGN_ONLY";
        documentsToSign = [{
          id: 1,
          nameRu: `Документ с ${senderInfo.domain}`,
          document: { file: { mime: "@file/bin", data } },
        }];
      }
      const egovSession = await createEgovSession(origin, signMethod, documentsToSign);
      egov = {
        sessionId: egovSession.session_id,
        signMethod,
        deeplink: egovSession.deeplink,
        // QR по спеке egovQR: "mobileSign:<url>" — формат сканера внутри
        // eGov Mobile (кнопка "eGov QR"). https-deeplink (m.egov.kz) — только
        // запасной вариант для системной камеры, в данных он тоже есть.
        qrImageUrl: generateQRDataURL(egovSession.qr_content, 280),
      };
      trace(sessionId, "info", "egov session created", {
        egovSessionId: egov.sessionId,
        signMethod,
        qr_content: egovSession.qr_content,
        deeplink: egovSession.deeplink,
      });
    } catch (err) {
      trace(sessionId, "warn", "egov session creation failed (KazEDS QR only)", { error: err.message });
    }
  }

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
        traceEnabled: isTraceEnabled(),
        traceUrl: `${RELAY_URL}/trace?session_id=${sessionId}&limit=200`,
        egov: egov ? { qrImageUrl: egov.qrImageUrl, deeplink: egov.deeplink } : null,
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

      // eGov Mobile branch: first completed session wins
      if (egov) {
        try {
          const egovStatus = await pollEgovStatus(egov.sessionId, abortController.signal);
          if (egovStatus?.status === "completed" && egovStatus.signedDocuments?.length) {
            hideQR(senderInfo.tabId, sessionId);
            cancelSession(sessionId); // abandon the kazeds session
            const result = egovResultToSigningResult(egov.signMethod, egovStatus.signedDocuments);
            trace(sessionId, "info", "signing completed via eGov Mobile", { egovSessionId: egov.sessionId, result });
            return result;
          }
          if (egovStatus?.status === "scanned" && senderInfo.tabId != null) {
            try {
              chrome.tabs.sendMessage(senderInfo.tabId, {
                type: "kazeds-qr-status",
                sessionId,
                status: "scanned",
              });
            } catch {}
          }
        } catch (err) {
          if (err.name === "AbortError") throw new Error("User cancelled signing");
          // egov poll errors are non-fatal — kazeds branch keeps going
        }
      }

      if (!status) continue;

      if (status.status === "completed" && status.result) {
        hideQR(senderInfo.tabId, sessionId);
        trace(sessionId, "info", "signing completed", { result: status.result });
        return status.result;
      }

      if (status.status === "rejected") {
        hideQR(senderInfo.tabId, sessionId);
        throw new Error("User cancelled signing");
      }

      if (status.status === "expired") {
        hideQR(senderInfo.tabId, sessionId);
        trace(sessionId, "warn", "session expired during polling", { poll: i });
        throw new Error("Signing session expired");
      }

      if (status.status === "error") {
        hideQR(senderInfo.tabId, sessionId);
        throw new Error("Signing error on mobile device");
      }

      // Update overlay status (scanned)
      // Push status + authoritative expires_in to the overlay every poll,
      // so the countdown stays in sync with the relay's clock.
      if (senderInfo.tabId != null) {
        try {
          chrome.tabs.sendMessage(senderInfo.tabId, {
            type: "kazeds-qr-status",
            sessionId,
            status: status.status,
            expiresIn: status.expires_in,
          });
        } catch {}
      }
    }

    hideQR(senderInfo.tabId, sessionId);
    trace(sessionId, "warn", "polling timed out (MAX_POLLS reached)", { maxPolls: MAX_POLLS });
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
    trace(sessionId, "info", "flow cancelled by user/overlay");
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

/**
 * Map eGov Mobile signed documents to the SigningResult shape the
 * NCALayer handlers expect ({signature, cmsSignature?, signedDocument?, certificate}).
 */
function egovResultToSigningResult(signMethod, signedDocuments) {
  if (signMethod === "XML") {
    const signedXml = signedDocuments[0].documentXml || "";
    // Сертификат подписанта — из ds:X509Certificate внутри XMLDSig
    const m = signedXml.match(/X509Certificate[^>]*>([^<]+)</);
    const certificate = m ? m[1].replace(/\s+/g, "") : "";
    return {
      certificate,
      signature: signedXml,
      signedDocument: signedXml,
      algorithm: "ECGOST3410-2015",
      method: "GOST",
    };
  }
  const cms = signedDocuments[0].document?.file?.data || "";
  return {
    certificate: "",
    signature: cms,
    cmsSignature: cms,
    algorithm: "ECGOST3410-2015",
    method: "GOST",
  };
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
