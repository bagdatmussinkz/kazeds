// ============================================================
// KazEDS Shared Constants
// ============================================================

// --- Cloud Relay ---
// Unified host: sign.aitu.uz/relay is proxied by nginx to the Relay backend.
export const RELAY_URL =
  process.env.KAZEDS_RELAY_URL || "https://sign.aitu.uz/relay";
export const RELAY_API_VERSION = "v1";
export const RELAY_BASE_URL = `${RELAY_URL}/${RELAY_API_VERSION}`;

// --- Web App (PWA) ---
export const WEB_APP_URL =
  process.env.KAZEDS_WEB_APP_URL || "https://sign.aitu.uz/app";

// --- Extension / widget CDN ---
export const WIDGET_URL =
  process.env.KAZEDS_WIDGET_URL || "https://sign.aitu.uz/ext";

// --- Session ---
export const SESSION_TTL_SECONDS = 300; // 5 минут
export const SESSION_CLEANUP_INTERVAL_SECONDS = 60;
export const SESSION_RETAIN_AFTER_COMPLETE_SECONDS = 600; // 10 мин

// --- Polling ---
export const POLLING_INTERVAL_MS = 2000; // 2 секунды
export const POLLING_MAX_RETRIES = 150; // 5 мин / 2 сек

// --- QR ---
export const QR_PAYLOAD_VERSION = 1;
export const QR_CODE_SIZE_PX = 256;

// --- Crypto ---
export const CHALLENGE_BYTES = 32;
export const PBKDF2_ITERATIONS = 600_000;
export const AES_KEY_LENGTH = 256;
export const RSA_KEY_SIZE = 2048;
export const ECDSA_CURVE = "P-256" as const;

// --- NCALayer WebSocket ---
export const NCALAYER_WS_URL = "wss://127.0.0.1:13579";
export const NCALAYER_WS_PORT = 13579;

// --- NCALayer Storage Types ---
export const NCALAYER_STORAGE = {
  PKCS12: "PKCS12",
  KAZTOKEN: "AKKaztokenStore",
  IDCARD: "AKKZIDCardStore",
} as const;

// --- NCALayer Virtual Paths ---
export const KAZEDS_VIRTUAL_KEYSTORE = "KazEDS://mobile-key";

// --- JSON-RPC Error Codes ---
export const JSONRPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  USER_CANCELLED: -32000,
  SERVICE_UNAVAILABLE: -32001,
} as const;

// --- Rate Limiting ---
export const RATE_LIMIT = {
  CREATE: 10, // req/sec
  POLLING: 30,
  COMPLETE: 10,
} as const;
