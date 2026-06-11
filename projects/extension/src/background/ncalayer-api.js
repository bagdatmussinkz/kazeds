// NCALayer protocol handler
// Routes API calls by module + method and returns correctly formatted responses
// Response formats verified against Doodocs Sign and real NCALayer on KZ sites

import { executeSignFlow } from "./sign-flow.js";
import { trace } from "../lib/trace.js";
import { parseCertificate } from "../lib/x509.js";

// --- Module registry ---
const modules = new Map();

function registerModule(name, mod) {
  modules.set(name, mod);
}

// --- Public API ---

export async function handleNCALayerRequest(request, senderInfo) {
  if (!request || typeof request !== "object") {
    return errorCommon("Invalid request payload");
  }
  const mod = modules.get(request.module);
  if (!mod) {
    return { status: false, code: "MODULE_NOT_FOUND", message: `Unknown module: ${request.module}` };
  }
  const response = await mod.handle(request, senderInfo);
  // Failures are always traced (with full request+response payloads) so
  // "signature rejected on real site" cases are captured automatically.
  if (response && (response.status === false || response.code === "500" || response.error)) {
    trace(undefined, "error", `NCALayer ${request.module}.${request.method || request.command || request.type} failed`, {
      domain: senderInfo?.domain,
      request,
      response,
    });
  }
  return response;
}

export function formatErrorForModule(payload, message) {
  const mod = modules.get(payload?.module);
  return mod?.formatError ? mod.formatError(payload, message) : { code: "500", message };
}

// ============================================================
// Module: kz.gov.pki.knca.commonUtils
// Args: Array (positional), Response: { code, responseObject | message }
// ============================================================

registerModule("kz.gov.pki.knca.commonUtils", {
  async handle(request, senderInfo) {
    const handler = commonUtils[request.method];
    if (!handler) return errorCommon(`Unknown method: ${request.method}`);
    return handler(request.args || [], senderInfo);
  },
  formatError: (_p, msg) => ({ code: "500", message: msg }),
});

const commonUtils = {
  async getActiveTokens() {
    return successCommon(["PKCS12"]);
  },

  async getKeyInfo(_args, senderInfo) {
    try {
      const result = await executeSignFlow(senderInfo, "auth", undefined, undefined);
      // Real NCALayer returns parsed certificate fields (subjectDn, certNotAfter,
      // pem, ...) — sites do `.split()` on them and crash if absent (kazpatent).
      try {
        const info = parseCertificate(result.certificate);
        return successCommon({ ...info, certificate: result.certificate });
      } catch (parseErr) {
        // ECDSA demo mode returns a bare SPKI key, not an X.509 cert — keep old shape
        trace(undefined, "warn", "getKeyInfo: certificate parse failed, returning raw result", {
          domain: senderInfo?.domain,
          error: parseErr.message,
        });
        return successCommon(result);
      }
    } catch (e) {
      return catchCommon(e);
    }
  },

  // args: ["PKCS12", "SIGNATURE", "base64data", true]
  async createCAdESFromBase64(args, senderInfo) {
    const data = args[2];
    try {
      const result = await executeSignFlow(senderInfo, "sign", data, "cms");
      return successCommon(result.cmsSignature || result.signature);
    } catch (e) {
      return catchCommon(e);
    }
  },

  async createCMSSignatureFromBase64(args, senderInfo) {
    return commonUtils.createCAdESFromBase64(args, senderInfo);
  },

  async createCAdESFromBase64Hash(args, senderInfo) {
    const hash = args[2];
    try {
      const result = await executeSignFlow(senderInfo, "sign", hash, "cms");
      return successCommon(result.cmsSignature || result.signature);
    } catch (e) {
      return catchCommon(e);
    }
  },

  // args: ["PKCS12", "AUTHENTICATION"|"SIGNATURE", "<xml>...</xml>", "", ""]
  async signXml(args, senderInfo) {
    const xml = args[2];
    try {
      const xmlBase64 = btoa(unescape(encodeURIComponent(xml)));
      const result = await executeSignFlow(senderInfo, "sign", xmlBase64, "xml");
      // Return signed XML document string
      return successCommon(result.signedDocument || result.signature);
    } catch (e) {
      return catchCommon(e);
    }
  },

  async signXmls(args, senderInfo) {
    const xmls = args[2];
    if (!Array.isArray(xmls)) {
      return commonUtils.signXml(args, senderInfo);
    }
    try {
      const results = [];
      for (const xml of xmls) {
        const xmlBase64 = btoa(unescape(encodeURIComponent(xml)));
        const result = await executeSignFlow(senderInfo, "sign", xmlBase64, "xml");
        results.push(result.signedDocument || result.signature);
      }
      return successCommon(results);
    } catch (e) {
      return catchCommon(e);
    }
  },

  async createCAdESFromFile() {
    return errorCommon("File signing is not supported in browser extension.");
  },

  async createCMSSignatureFromFile() {
    return errorCommon("File signing is not supported in browser extension.");
  },

  async showFileChooser() {
    return errorCommon("File chooser is not supported in browser extension.");
  },

  async changeLocale() {
    return null; // fire-and-forget
  },
};

// ============================================================
// Module: kz.gov.pki.knca.basics
// Args: Object (named), Response: { status, body: { result } }
// ============================================================

registerModule("kz.gov.pki.knca.basics", {
  async handle(request, senderInfo) {
    const handler = basics[request.method];
    if (!handler) return errorBasics("UNKNOWN_METHOD", `Unknown method: ${request.method}`);
    return handler(request.args || {}, senderInfo);
  },
  formatError: (_p, msg) => ({ status: false, code: "INTERNAL_ERROR", message: msg, body: {}, details: "" }),
});

const basics = {
  async sign(args, senderInfo) {
    const format = args.format || "cms";
    const data = args.data;
    const items = Array.isArray(data) ? data : [data || ""];

    try {
      if (format === "xml") {
        const results = [];
        for (const item of items) {
          const xmlBase64 = btoa(unescape(encodeURIComponent(item)));
          const result = await executeSignFlow(senderInfo, "sign", xmlBase64, "xml");
          results.push(result.signedDocument || result.signature);
        }
        return successBasics(results);
      }

      if (format === "raw") {
        const results = [];
        let certificate;
        for (const item of items) {
          const result = await executeSignFlow(senderInfo, "sign", item, "cms");
          results.push(result.signature);
          if (!certificate) certificate = result.certificate;
        }
        const response = { signatures: results };
        if (certificate) {
          response.certificate = wrapPEM(certificate, "CERTIFICATE");
        }
        return successBasics(response);
      }

      // CMS format
      const results = [];
      for (const item of items) {
        const result = await executeSignFlow(senderInfo, "sign", item, "cms");
        const cms = result.cmsSignature || result.signature;
        results.push(wrapPEM(cms, "CMS"));
      }
      return successBasics(results);
    } catch (e) {
      return catchBasics(e);
    }
  },
};

// ============================================================
// Module: NURSign
// Dispatch: `type` field, Response: { result, errorCode }
// ============================================================

registerModule("NURSign", {
  async handle(request, senderInfo) {
    const type = request.type;
    if (type === "version") {
      return { result: { version: "1.0.0" }, errorCode: "NONE" };
    }
    const handler = nurSignTypes[type];
    if (!handler) return { errorCode: "500", errorMessage: `Unsupported type: ${type}` };
    return handler(request, senderInfo);
  },
  formatError: (_p, msg) => ({ errorCode: "500", errorMessage: msg }),
});

const nurSignTypes = {
  async text(request, senderInfo) {
    try {
      const textBase64 = btoa(unescape(encodeURIComponent(request.data || "")));
      const result = await executeSignFlow(senderInfo, "sign", textBase64, "cms");
      return { result: result.cmsSignature || result.signature, errorCode: "NONE" };
    } catch (e) {
      return catchNurSign(e);
    }
  },

  async xml(request, senderInfo) {
    try {
      const xmlBase64 = btoa(unescape(encodeURIComponent(request.data || "")));
      const result = await executeSignFlow(senderInfo, "sign", xmlBase64, "xml");
      return { result: result.signedDocument || result.signature, errorCode: "NONE" };
    } catch (e) {
      return catchNurSign(e);
    }
  },

  async binary(request, senderInfo) {
    try {
      const result = await executeSignFlow(senderInfo, "sign", request.data || "", "cms");
      return { result: result.cmsSignature || result.signature, errorCode: "NONE" };
    } catch (e) {
      return catchNurSign(e);
    }
  },

  async multixml(request, senderInfo) {
    try {
      const items = Array.isArray(request.data) ? request.data : [request.data];
      const results = [];
      for (const xml of items) {
        const xmlBase64 = btoa(unescape(encodeURIComponent(xml || "")));
        const result = await executeSignFlow(senderInfo, "sign", xmlBase64, "xml");
        results.push(result.signedDocument || result.signature);
      }
      return { result: results, errorCode: "NONE" };
    } catch (e) {
      return catchNurSign(e);
    }
  },

  async multitext(request, senderInfo) {
    try {
      const data = request.data || {};
      const keys = Object.keys(data);
      const items = {};
      for (const k of keys) {
        const textBase64 = btoa(unescape(encodeURIComponent(data[k] || "")));
        const result = await executeSignFlow(senderInfo, "sign", textBase64, "cms");
        items[k] = result.cmsSignature || result.signature;
      }
      return { result: { items }, errorCode: "NONE" };
    } catch (e) {
      return catchNurSign(e);
    }
  },

  async file() {
    return { errorCode: "500", errorMessage: "File signing is not supported in browser extension" };
  },
};

// ============================================================
// Module: kz.gov.pki.ncalayerservices.accessory
// ============================================================

const KNCA_BUNDLES = Object.freeze({
  "kz.gov.pki.osgi.layer.common": "0.3.4",
  "org.apache.felix.framework": "7.0.3",
  "kz.gov.pki.api.layer.NCALayerServices": "0.7.3",
  "kz.gov.pki.knca.applet.knca_applet": "0.4.10",
  "kz.gov.pki.cms.NLDocSignerModule": "1.1.0",
  "kz.gov.pki.kalkan.xmldsig": "0.4.0",
  "kz.inessoft.kgd.knp.sono_knp_ncalayer_module": "1.2.0",
  "kz.ecc.NurSignBundle": "5.1.2",
  "kz.gov.pki.provider.knca_provider_util": "0.8.8",
  "kz.gov.pki.osgi.layer.websocket": "0.4.1",
  "kz.gov.pki.kalkan.knca_provider_jce_kalkan": "0.7.6",
});

const KNCA_SERVICES = Object.freeze([
  "kz.gov.pki.ncalayerservices.accessory",
  "kz.gov.pki.knca.commonUtils",
  "kz.gov.pki.knca.basics",
  "kz.inessoft.kgd.knp.ncalayer.KNPModuleService",
  "NURSign",
]);

registerModule("kz.gov.pki.ncalayerservices.accessory", {
  async handle(request) {
    switch (request?.method) {
      case "getBundles": return { ...KNCA_BUNDLES };
      case "getServices": return { services: [...KNCA_SERVICES] };
      case "installBundle": return { success: false, errorCode: "MODULE_INSTALL_NOT_SUPPORTED" };
      default: return { success: false, errorCode: "UNKNOWN_METHOD" };
    }
  },
  formatError: (_p, msg) => ({ success: false, errorCode: "INTERNAL_ERROR", message: msg }),
});

// ============================================================
// Module: kz.inessoft.kgd.knp.ncalayer.KNPModuleService (KNP/SONO)
// Dispatch: `command` field
// ============================================================

const STORAGES = Object.freeze([
  { name: "PKCS12", token: false },
  { name: "KAZTOKEN", token: true },
  { name: "KZIDCARD", token: true },
  { name: "ETOKEN_72K", token: true },
  { name: "JACARTA", token: true },
]);

registerModule("kz.inessoft.kgd.knp.ncalayer.KNPModuleService", {
  async handle(request, senderInfo) {
    const command = typeof request?.command === "string" ? request.command : "";
    const requestId = request?.requestId ?? null;
    if (!command) return knpResult(requestId, "INVALID_INPUT_DATA", {}, "Missing command");
    const handler = knpCommands[command];
    if (!handler) return knpResult(requestId, "ERROR", {}, `Unsupported command: ${command}`);
    return handler(request, senderInfo);
  },
  formatError: (payload, msg) => knpResult(payload?.requestId ?? null, "ERROR", {}, msg),
});

const knpCommands = {
  info(request) {
    return knpResult(request?.requestId ?? null, "OK", {
      type: "personal", version: "1.1.0", status: "READY",
    });
  },

  getStorageType(request) {
    return knpResult(request?.requestId ?? null, "OK", {
      storages: STORAGES.map((s) => ({ ...s })),
    });
  },

  getStorageDevicesByType(request) {
    const requestId = request?.requestId ?? null;
    if (request?.storage === "PKCS12") {
      return knpResult(requestId, "OK", { tokenTerminals: [] });
    }
    return knpResult(requestId, "ERROR");
  },

  // KNP/SONO uses a site-driven UI: getCertificates feeds the site's own cert
  // picker. KazEDS signs on the phone (no key in the extension), so we return a
  // single virtual "remote" certificate — the site shows it, the user picks it,
  // and the real signing happens via the QR flow in signDocument. The actual
  // signer certificate comes back in the signature result.
  getCertificates(request) {
    const requestId = request?.requestId ?? null;
    const farFuture = new Date(Date.now() + 5 * 365 * 24 * 3600 * 1000).toISOString();
    // The KNP site parses the DN itself (certificateService.getCN does
    // `dn.split(...)`), so every DN-ish field it might read must be a string,
    // never undefined. Provide all common aliases.
    const subjectDn = "CN=KazEDS — подпись на телефоне,O=KazEDS,SERIALNUMBER=kazeds-remote,C=KZ";
    const issuerDn = "CN=KazEDS Cloud,O=KazEDS,C=KZ";
    return knpResult(requestId, "OK", {
      certificates: [
        {
          alias: "kazeds-remote",
          serialNumber: "kazeds-remote",
          // CN
          subjectCn: "KazEDS — подпись на телефоне",
          issuerCn: "KazEDS Cloud",
          // DN aliases (subject)
          subject: subjectDn,
          subjectDn: subjectDn,
          subjectDN: subjectDn,
          subjectName: subjectDn,
          dn: subjectDn,
          // DN aliases (issuer)
          issuer: issuerDn,
          issuerDn: issuerDn,
          issuerDN: issuerDn,
          issuerName: issuerDn,
          // validity
          notBefore: new Date().toISOString(),
          notAfter: farFuture,
          certNotBefore: new Date().toISOString(),
          certNotAfter: farFuture,
          // key meta (superset of fields the Kalkan WASM emits)
          keyType: "ECGOST3410-2015-512",
          keyId: "kazeds-remote",
          keyUsage: "sign",
          authorityKeyId: "kazeds-cloud",
          authorityKeyIdentifier: "kazeds-cloud",
          signatureAlgorithm: "ECGOST3410-2015-512",
          storageName: "PKCS12",
          remote: true,
        },
      ],
    });
  },

  async signDocument(request, senderInfo) {
    const requestId = request?.requestId ?? null;
    // Storage type may arrive as `storageType` or `type`; KazEDS only handles
    // software certs (the actual key lives on the phone, not in a token).
    const storage = request?.storageType ?? request?.type;
    if (storage && storage !== "PKCS12") {
      return knpCryptoError(requestId, "TOKEN_NOT_AVAILABLE");
    }
    try {
      const xml = request?.xml || request?.xmlToSign || request?.data || "";
      const xmlBase64 = btoa(unescape(encodeURIComponent(xml)));
      const result = await executeSignFlow(senderInfo, "sign", xmlBase64, "xml");
      return knpResult(requestId, "OK", { signedXml: result.signedDocument || result.signature });
    } catch (err) {
      return knpCryptoError(requestId, "SIGN_UNKNOWN_ERROR", err.message);
    }
  },
};

// ============================================================
// Module: kz.ncalayer.web.verify — server-side CMS verification
// Some sites verify the produced signature via this module.
// ============================================================

registerModule("kz.ncalayer.web.verify", {
  async handle(request) {
    if (request.method === "checkSign") return verifyCMS(request.args || {});
    return { status: false, code: "UNKNOWN_METHOD", message: `Unknown method: ${request.method}` };
  },
  formatError: (_p, msg) => ({ status: false, code: "INTERNAL_ERROR", message: msg }),
});

// Verify a CMS — KazEDS Java verifier (GOST + chain) first, ezsigner fallback.
async function verifyCMS(args) {
  const cmsBase64 = args?.cmsBase64 || args?.cms || args?.signature;
  if (!cmsBase64) {
    return { status: false, code: "NO_DATA", message: "cmsBase64 is required" };
  }
  // 1) KazEDS verifier (nginx → Java BouncyCastle + Kalkan)
  try {
    const resp = await fetch("https://sign.aitu.uz/relay/verify/checkSign", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: cmsBase64,
    });
    if (resp.ok) {
      const body = await resp.json();
      return { status: true, body };
    }
  } catch {
    // fall through to ezsigner
  }
  // 2) Fallback: ezsigner.kz (multipart, like reference NCALayer web verify)
  try {
    const binary = atob(cmsBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const form = new FormData();
    form.append("signData", new Blob([bytes], { type: "application/octet-stream" }), args?.filename || "signature.cms");
    const resp = await fetch("https://ezsigner.kz/checkSign", { method: "POST", body: form });
    if (!resp.ok) return { status: false, code: "HTTP_ERROR", message: `verify returned ${resp.status}` };
    return { status: true, body: await resp.json() };
  } catch (e) {
    return { status: false, code: "VERIFY_ERROR", message: e.message };
  }
}

// ============================================================
// Module: kz.digiflow.mobile.extensions
// ============================================================

registerModule("kz.digiflow.mobile.extensions", {
  async handle() {
    return { result: { version: "1.4" } };
  },
  formatError: (_p, msg) => ({ code: "500", message: msg }),
});

// ============================================================
// Helpers
// ============================================================

function successCommon(responseObject) {
  return { code: "200", responseObject };
}

function errorCommon(message) {
  return { code: "500", message };
}

function successBasics(result) {
  return { status: true, body: { result } };
}

function errorBasics(code, message, details = "") {
  return { status: false, code, message, details, body: {} };
}

function wrapPEM(base64Data, label) {
  if (!base64Data) return base64Data;
  if (base64Data.startsWith("-----BEGIN")) return base64Data;
  const lines = [];
  for (let i = 0; i < base64Data.length; i += 76) {
    lines.push(base64Data.slice(i, i + 76));
  }
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
}

function catchCommon(e) {
  if (e.message === "User cancelled signing") {
    return errorCommon("Signing cancelled by user");
  }
  return errorCommon(e.message);
}

function catchBasics(e) {
  if (e.message === "User cancelled signing") {
    return errorBasics("CANCELLED", "Signing cancelled by user");
  }
  return errorBasics("SIGN_ERROR", e.message);
}

function catchNurSign(e) {
  if (e.message === "User cancelled signing") {
    return { errorCode: "500", errorMessage: "Canceled" };
  }
  return { errorCode: "500", errorMessage: e.message };
}

function knpResult(requestId, resultCode, extra = {}, resultText = "") {
  const response = { ...extra, resultStatus: { resultCode } };
  if (resultText) response.resultStatus.resultText = resultText;
  if (requestId != null) response.requestId = requestId;
  return response;
}

function knpCryptoError(requestId, code, resultText = "") {
  return knpResult(requestId, "ERROR", { error: { cryptoError: code } }, resultText);
}
