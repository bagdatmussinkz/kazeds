import { randomBytes, randomUUID } from "crypto";
import type {
  Session,
  SessionStatus,
  CreateSessionRequest,
  CreateSessionResponse,
  SigningResult,
  QRPayload,
} from "@kazeds/shared";
import {
  SESSION_TTL_SECONDS,
  SESSION_CLEANUP_INTERVAL_SECONDS,
  SESSION_RETAIN_AFTER_COMPLETE_SECONDS,
  QR_PAYLOAD_VERSION,
  CHALLENGE_BYTES,
  RELAY_BASE_URL,
} from "@kazeds/shared";

export class SessionStore {
  private sessions = new Map<string, Session>();
  private cleanupTimer: NodeJS.Timeout;

  constructor() {
    this.cleanupTimer = setInterval(
      () => this.cleanup(),
      (SESSION_CLEANUP_INTERVAL_SECONDS) * 1000,
    );
  }

  create(req: CreateSessionRequest): CreateSessionResponse {
    const id = randomUUID();
    const challenge = randomBytes(CHALLENGE_BYTES).toString("base64");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);

    const session: Session = {
      id,
      origin: req.origin,
      operation: req.operation,
      data: req.data,
      reason: req.reason,
      challenge,
      status: "pending",
      createdAt: now,
      expiresAt,
    };

    this.sessions.set(id, session);

    const qr_payload: QRPayload = {
      version: QR_PAYLOAD_VERSION,
      session_id: id,
      challenge,
      origin: req.origin,
      operation: req.operation,
      callback_url: `${RELAY_BASE_URL}/sessions/${id}/complete`,
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    };

    // Добавить data для sign операций
    if (req.operation === "sign" && req.data) {
      qr_payload.data_b64 = req.data;
      const crypto = require("crypto");
      const dataBuffer = Buffer.from(req.data, "base64");
      qr_payload.data_hash = crypto
        .createHash("sha256")
        .update(dataBuffer)
        .digest("hex");
    }

    // Pass format hint to web app
    if (req.format) {
      qr_payload.format = req.format;
    }

    return {
      session_id: id,
      challenge,
      qr_payload,
      expires_at: expiresAt.toISOString(),
    };
  }

  getPayload(id: string) {
    const session = this.sessions.get(id);
    if (!session) return null;

    if (session.status === "pending" && session.expiresAt < new Date()) {
      session.status = "expired";
    }

    if (session.status !== "pending" && session.status !== "scanned") {
      return null; // only allow payload fetch for active sessions
    }

    return {
      session_id: session.id,
      origin: session.origin,
      operation: session.operation,
      challenge: session.challenge,
      data: session.data || null,
      callback_url: `${RELAY_BASE_URL}/sessions/${session.id}/complete`,
      expires_at: session.expiresAt.toISOString(),
    };
  }

  markScanned(id: string) {
    const session = this.sessions.get(id);
    if (session && session.status === "pending") {
      session.status = "scanned";
    }
  }

  getStatus(id: string) {
    const session = this.sessions.get(id);
    if (!session) return null;

    // Проверить истечение
    if (session.status === "pending" && session.expiresAt < new Date()) {
      session.status = "expired";
    }

    const response: {
      status: SessionStatus;
      expires_in?: number;
      result?: SigningResult;
    } = {
      status: session.status,
    };

    if (session.status === "pending" || session.status === "scanned") {
      response.expires_in = Math.max(
        0,
        Math.floor((session.expiresAt.getTime() - Date.now()) / 1000),
      );
    }

    if (session.status === "completed" && session.result) {
      response.result = session.result;
    }

    return response;
  }

  complete(id: string, result: SigningResult): { success: boolean; error?: string; statusCode?: number } {
    const session = this.sessions.get(id);
    if (!session) {
      return { success: false, error: "Session not found", statusCode: 404 };
    }

    if (session.expiresAt < new Date() && session.status === "pending") {
      session.status = "expired";
    }

    if (session.status !== "pending" && session.status !== "scanned") {
      return {
        success: false,
        error: `Session already ${session.status}`,
        statusCode: 409,
      };
    }

    session.result = result;
    session.status = "completed";
    session.completedAt = new Date();

    return { success: true };
  }

  cancel(id: string): { success: boolean; error?: string; statusCode?: number } {
    const session = this.sessions.get(id);
    if (!session) {
      return { success: false, error: "Session not found", statusCode: 404 };
    }

    if (session.status !== "pending" && session.status !== "scanned") {
      return {
        success: false,
        error: `Session already ${session.status}`,
        statusCode: 409,
      };
    }

    session.status = "rejected";
    return { success: true };
  }

  getActiveCount(): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.status === "pending" || session.status === "scanned") {
        count++;
      }
    }
    return count;
  }

  private cleanup() {
    const now = new Date();
    const retainMs = SESSION_RETAIN_AFTER_COMPLETE_SECONDS * 1000;

    for (const [id, session] of this.sessions) {
      // Истечь pending сессии
      if (session.status === "pending" && session.expiresAt < now) {
        session.status = "expired";
      }

      // Удалить старые завершённые
      if (
        session.completedAt &&
        now.getTime() - session.completedAt.getTime() > retainMs
      ) {
        this.sessions.delete(id);
      }

      // Удалить старые expired/rejected/error
      if (
        ["expired", "rejected", "error"].includes(session.status) &&
        now.getTime() - session.expiresAt.getTime() > retainMs
      ) {
        this.sessions.delete(id);
      }
    }
  }

  destroy() {
    clearInterval(this.cleanupTimer);
  }
}
