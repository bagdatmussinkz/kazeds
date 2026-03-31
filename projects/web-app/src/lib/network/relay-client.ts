/**
 * Cloud Relay HTTP client
 */

import type {
  CompleteSessionRequest,
  CompleteSessionResponse,
} from "@kazeds/shared";
import { RELAY_BASE_URL } from "@kazeds/shared";

/**
 * Отправка результата подписания на Cloud Relay
 */
export async function completeSession(
  sessionId: string,
  data: CompleteSessionRequest,
  callbackUrl?: string,
): Promise<CompleteSessionResponse> {
  const url = callbackUrl || `${RELAY_BASE_URL}/sessions/${sessionId}/complete`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Unknown error" }));
    throw new RelayError(response.status, error.error || error.message || "Request failed");
  }

  return response.json();
}

export class RelayError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "RelayError";
  }
}
