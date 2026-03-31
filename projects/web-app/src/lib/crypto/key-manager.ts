/**
 * Key Manager — генерация, шифрование и хранение ключей ЭЦП
 * Использует Web Crypto API + IndexedDB
 */

import { PBKDF2_ITERATIONS, AES_KEY_LENGTH, RSA_KEY_SIZE, ECDSA_CURVE } from "@kazeds/shared";

export type KeyAlgorithm = "RSA" | "ECDSA";

/**
 * Генерация пары ключей
 */
export async function generateKeyPair(algorithm: KeyAlgorithm): Promise<CryptoKeyPair> {
  if (algorithm === "RSA") {
    return crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: RSA_KEY_SIZE,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      } as RsaHashedKeyGenParams,
      true,
      ["sign", "verify"],
    );
  }

  return crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: ECDSA_CURVE },
    true,
    ["sign", "verify"],
  );
}

/**
 * Деривация AES ключа из PIN через PBKDF2
 */
export async function deriveKeyFromPin(
  pin: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: AES_KEY_LENGTH },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

/**
 * Шифрование приватного ключа
 */
export async function wrapPrivateKey(
  privateKey: CryptoKey,
  wrappingKey: CryptoKey,
  iv: Uint8Array,
): Promise<ArrayBuffer> {
  return crypto.subtle.wrapKey("pkcs8", privateKey, wrappingKey, {
    name: "AES-GCM",
    iv: iv as BufferSource,
  });
}

/**
 * Расшифровка приватного ключа
 */
export async function unwrapPrivateKey(
  wrappedKey: ArrayBuffer,
  wrappingKey: CryptoKey,
  iv: Uint8Array,
  algorithm: KeyAlgorithm,
): Promise<CryptoKey> {
  const importAlgo =
    algorithm === "RSA"
      ? { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }
      : { name: "ECDSA", namedCurve: ECDSA_CURVE };

  return crypto.subtle.unwrapKey(
    "pkcs8",
    wrappedKey,
    wrappingKey,
    { name: "AES-GCM", iv: iv as BufferSource },
    importAlgo,
    false,
    ["sign"],
  );
}

/**
 * Подписание данных
 */
export async function signData(
  privateKey: CryptoKey,
  data: ArrayBuffer,
  algorithm: KeyAlgorithm,
): Promise<ArrayBuffer> {
  const signAlgo =
    algorithm === "RSA"
      ? "RSASSA-PKCS1-v1_5"
      : { name: "ECDSA", hash: "SHA-256" };

  return crypto.subtle.sign(signAlgo, privateKey, data);
}
