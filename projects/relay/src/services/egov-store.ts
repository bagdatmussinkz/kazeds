import { randomBytes, randomUUID } from "crypto";
import type { CreateEgovSessionInput, PutEgovDocumentsInput } from "../schemas/egov.schema";

const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute
const RETAIN_AFTER_COMPLETE_MS = 5 * 60 * 1000; // 5 minutes

const RELAY_BASE_URL = process.env.RELAY_PUBLIC_URL || "https://sign.aitu.uz/relay";

type EgovSessionStatus = "pending" | "scanned" | "completed" | "rejected" | "expired";

interface EgovSession {
  id: string;
  token: string;
  status: EgovSessionStatus;
  description: string;
  organisation: {
    nameRu: string;
    nameKz?: string;
    nameEn?: string;
    bin: string;
  };
  signMethod: "XML" | "CMS_SIGN_ONLY" | "CMS_WITH_DATA";
  documentsToSign: CreateEgovSessionInput["documentsToSign"];
  signedDocuments?: PutEgovDocumentsInput["documentsToSign"];
  createdAt: Date;
  expiresAt: Date;
  completedAt?: Date;
}

export class EgovStore {
  private sessions = new Map<string, EgovSession>();
  private cleanupTimer: NodeJS.Timeout;

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
  }

  create(req: CreateEgovSessionInput) {
    const id = randomUUID();
    const token = randomBytes(32).toString("hex");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

    const session: EgovSession = {
      id,
      token,
      status: "pending",
      description: req.description,
      organisation: req.organisation,
      signMethod: req.signMethod,
      documentsToSign: req.documentsToSign,
      createdAt: now,
      expiresAt,
    };

    this.sessions.set(id, session);

    const mgovSignUrl = `${RELAY_BASE_URL}/v1/egov/${id}/mgovSign`;
    // Universal deeplink — открывает eGov Mobile при сканировании системной
    // камерой (формат как у rekassa: isi/ibi/apn — App Store / bundle id / Android package)
    const deeplink =
      `https://m.egov.kz/mobileSign?link=${encodeURIComponent(mgovSignUrl)}` +
      `&isi=1476128386&ibi=kz.egov.mobile&apn=kz.mobile.mgov`;

    return {
      session_id: id,
      token,
      qr_content: `mobileSign:${mgovSignUrl}`,
      deeplink,
      expires_at: expiresAt.toISOString(),
    };
  }

  getMgovSign(id: string) {
    const session = this.sessions.get(id);
    if (!session) return null;

    this.expireIfNeeded(session);
    if (session.status === "expired") return null;

    // Mark as scanned when mgovSign is accessed
    if (session.status === "pending") {
      session.status = "scanned";
    }

    return {
      description: session.description,
      expiry_date: session.expiresAt.toISOString(),
      organisation: session.organisation,
      document: {
        uri: `${RELAY_BASE_URL}/v1/egov/${id}/documents`,
        auth_type: "Token" as const,
        auth_token: session.token,
      },
    };
  }

  getDocuments(id: string, token: string): { data?: any; error?: string; statusCode?: number } {
    const session = this.sessions.get(id);
    if (!session) return { error: "Session not found", statusCode: 404 };

    this.expireIfNeeded(session);
    if (session.status === "expired") return { error: "Session expired", statusCode: 403 };

    if (session.token !== token) return { error: "Invalid token", statusCode: 401 };

    return {
      data: {
        signMethod: session.signMethod,
        documentsToSign: session.documentsToSign,
      },
    };
  }

  /** Проверки доступа/состояния ДО валидации подписи (401/404/409 раньше 403). */
  checkPutPreconditions(
    id: string,
    token: string,
  ): { success: boolean; error?: string; statusCode?: number } {
    const session = this.sessions.get(id);
    if (!session) {
      return { success: false, error: "Session not found", statusCode: 404 };
    }

    this.expireIfNeeded(session);
    if (session.status === "expired") {
      return { success: false, error: "Session expired", statusCode: 403 };
    }

    if (session.token !== token) {
      return { success: false, error: "Invalid token", statusCode: 401 };
    }

    if (session.status !== "pending" && session.status !== "scanned") {
      return { success: false, error: `Session already ${session.status}`, statusCode: 409 };
    }

    return { success: true };
  }

  putDocuments(
    id: string,
    token: string,
    signedDocs: PutEgovDocumentsInput,
  ): { success: boolean; error?: string; statusCode?: number } {
    const pre = this.checkPutPreconditions(id, token);
    if (!pre.success) return pre;

    const session = this.sessions.get(id)!;
    session.signedDocuments = signedDocs.documentsToSign;
    session.status = "completed";
    session.completedAt = new Date();

    return { success: true };
  }

  getStatus(id: string) {
    const session = this.sessions.get(id);
    if (!session) return null;

    this.expireIfNeeded(session);

    const response: {
      status: EgovSessionStatus;
      expires_in?: number;
      signedDocuments?: PutEgovDocumentsInput["documentsToSign"];
    } = {
      status: session.status,
    };

    if (session.status === "pending" || session.status === "scanned") {
      response.expires_in = Math.max(
        0,
        Math.floor((session.expiresAt.getTime() - Date.now()) / 1000),
      );
    }

    if (session.status === "completed" && session.signedDocuments) {
      response.signedDocuments = session.signedDocuments;
    }

    return response;
  }

  private expireIfNeeded(session: EgovSession) {
    if (
      (session.status === "pending" || session.status === "scanned") &&
      session.expiresAt < new Date()
    ) {
      session.status = "expired";
    }
  }

  private cleanup() {
    const now = new Date();

    for (const [id, session] of this.sessions) {
      this.expireIfNeeded(session);

      // Remove completed sessions after retain period
      if (
        session.completedAt &&
        now.getTime() - session.completedAt.getTime() > RETAIN_AFTER_COMPLETE_MS
      ) {
        this.sessions.delete(id);
      }

      // Remove expired/rejected sessions after retain period
      if (
        ["expired", "rejected"].includes(session.status) &&
        now.getTime() - session.expiresAt.getTime() > RETAIN_AFTER_COMPLETE_MS
      ) {
        this.sessions.delete(id);
      }
    }
  }

  destroy() {
    clearInterval(this.cleanupTimer);
  }
}
