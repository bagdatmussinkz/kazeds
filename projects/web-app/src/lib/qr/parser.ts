/**
 * QR Payload Parser
 */

import type { QRPayload } from "@kazeds/shared";
import { QR_PAYLOAD_VERSION } from "@kazeds/shared";

export class QRParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QRParseError";
  }
}

export function parseQRPayload(raw: string): QRPayload {
  let payload: QRPayload;

  try {
    payload = JSON.parse(raw);
  } catch {
    throw new QRParseError("Невалидный QR-код: не удалось разобрать JSON");
  }

  if (payload.version !== QR_PAYLOAD_VERSION) {
    throw new QRParseError(`Неподдерживаемая версия протокола: ${payload.version}`);
  }

  if (!payload.session_id || !payload.challenge || !payload.origin || !payload.callback_url) {
    throw new QRParseError("QR-код содержит неполные данные");
  }

  if (!payload.callback_url.startsWith("https://")) {
    throw new QRParseError("callback_url должен использовать HTTPS");
  }

  const expiresAt = new Date(payload.expires_at);
  if (expiresAt < new Date()) {
    throw new QRParseError("QR-код истёк. Запросите новый на сайте");
  }

  if (payload.operation !== "auth" && payload.operation !== "sign") {
    throw new QRParseError(`Неизвестный тип операции: ${payload.operation}`);
  }

  return payload;
}
