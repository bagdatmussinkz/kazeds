// ============================================================
// KazEDS Shared Types
// Единые типы для всех компонентов экосистемы
// ============================================================

// --- QR Payload (генерируется Cloud Relay, показывается Extension, сканируется Web App) ---

export interface QRPayload {
  version: 1;
  session_id: string;
  challenge: string; // base64, 32 bytes
  origin: string; // домен сайта-инициатора
  operation: OperationType;
  data_hash?: string; // SHA-256 хеш данных (только для sign)
  callback_url: string; // HTTPS URL на Cloud Relay
  created_at: string; // ISO 8601
  expires_at: string; // ISO 8601
}

export type OperationType = "auth" | "sign";

// --- Session (Cloud Relay in-memory) ---

export type SessionStatus =
  | "pending"
  | "scanned"
  | "completed"
  | "rejected"
  | "expired"
  | "error";

export interface Session {
  id: string;
  origin: string;
  operation: OperationType;
  data?: string; // base64 данных для подписания
  reason?: string;
  challenge: string; // base64, 32 bytes
  status: SessionStatus;
  result?: SigningResult;
  createdAt: Date;
  expiresAt: Date;
  completedAt?: Date;
}

// --- Signing Result (iOS App / Web App → Cloud Relay → Extension) ---

export interface SigningResult {
  certificate: string; // base64 DER X.509
  signature: string; // base64
  algorithm: SigningAlgorithm;
  subjectDN?: string;
  notBefore?: string;
  notAfter?: string;
}

export type SigningAlgorithm = "SHA256withRSA" | "SHA256withECDSA";

// --- API: Create Session (Extension → Cloud Relay) ---

export interface CreateSessionRequest {
  origin: string;
  operation: OperationType;
  data?: string; // base64 (для sign)
  reason?: string;
}

export interface CreateSessionResponse {
  session_id: string;
  challenge: string;
  qr_payload: QRPayload;
  expires_at: string;
}

// --- API: Session Status (Extension → Cloud Relay polling) ---

export interface SessionStatusResponse {
  status: SessionStatus;
  expires_in?: number; // секунд до истечения
  result?: SigningResult; // только при completed
}

// --- API: Complete Session (Web App / iOS App → Cloud Relay) ---

export interface CompleteSessionRequest {
  certificate: string; // base64 DER X.509
  signature: string; // base64
  algorithm: SigningAlgorithm;
  subjectDN?: string;
  notBefore?: string;
  notAfter?: string;
}

export interface CompleteSessionResponse {
  status: "completed";
}

// --- API: Health Check ---

export interface HealthResponse {
  status: "ok";
  active_sessions: number;
  uptime: number;
}

// --- API: Error ---

export interface APIError {
  error: string;
  message: string;
}

// --- NCALayer JSON-RPC 2.0 (Extension WebSocket) ---

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
  id: string | number;
}

export interface JsonRpcSuccessResponse {
  jsonrpc: "2.0";
  result: unknown;
  id: string | number;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  error: {
    code: number;
    message: string;
  };
  id: string | number;
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

// --- Web App: Stored Certificate (IndexedDB) ---

export interface StoredCertificate {
  id: string;
  label: string;
  subjectCN: string;
  subjectEmail?: string;
  algorithm: "RSA" | "ECDSA";
  certificateDER: ArrayBuffer; // публичный X.509 (не зашифрован)
  wrappedPrivateKey: ArrayBuffer; // зашифрован AES-GCM
  salt: ArrayBuffer; // PBKDF2 salt, 16 bytes
  iv: ArrayBuffer; // AES-GCM IV, 12 bytes
  publicKeyJWK: JsonWebKey;
  createdAt: string;
  notBefore: string;
  notAfter: string;
}

export interface SigningHistoryEntry {
  id: string;
  certificateId: string;
  origin: string;
  operation: OperationType;
  status: "success" | "error" | "cancelled";
  timestamp: string;
}
