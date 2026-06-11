import type { PutEgovDocumentsInput } from "../schemas/egov.schema";

// Java verifier (BouncyCastle + Kalkan). Недоступность верифаера не блокирует
// приём подписи (best-effort) — но криптографически невалидный CMS даёт 403.
const VERIFIER_URL = process.env.KAZEDS_VERIFIER_URL || "http://localhost:8082";

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  checked: number; // сколько документов прошло реальную проверку
}

/**
 * Валидация подписанных документов из PUT (шаг 8 спеки eGovQR):
 * - XML  → структурная проверка XMLDSig (SignatureValue + X509Certificate);
 * - CMS  → криптографическая проверка через Java verifier /checkSign.
 */
export async function validateSignedDocuments(
  signMethod: PutEgovDocumentsInput["signMethod"],
  docs: PutEgovDocumentsInput["documentsToSign"],
): Promise<ValidationResult> {
  let checked = 0;

  for (const doc of docs) {
    if (signMethod === "XML") {
      const xml = doc.documentXml || "";
      if (!/SignatureValue\s*>/.test(xml) || !/X509Certificate\s*>/.test(xml)) {
        return {
          valid: false,
          checked,
          reason: `Document ${doc.id}: no XMLDSig signature found`,
        };
      }
      checked++;
      continue;
    }

    // CMS_SIGN_ONLY / CMS_WITH_DATA
    const cms = doc.document?.file?.data;
    if (!cms) {
      return { valid: false, checked, reason: `Document ${doc.id}: empty CMS` };
    }
    try {
      const resp = await fetch(`${VERIFIER_URL}/checkSign`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: cms,
        signal: AbortSignal.timeout(5000),
      });
      const body: any = await resp.json().catch(() => ({}));
      if (resp.ok && body.valid === true) {
        checked++;
        continue;
      }
      if (body.valid === false && body.error === undefined) {
        // верифаер уверенно сказал «подпись неверна»
        return {
          valid: false,
          checked,
          reason: `Document ${doc.id}: CMS signature invalid`,
        };
      }
      // парс-ошибка/прочее — считаем непроверенным, но не отклоняем
    } catch {
      // verifier недоступен — best-effort: принимаем без проверки
    }
  }

  return { valid: true, checked };
}
