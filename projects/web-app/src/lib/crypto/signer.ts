/**
 * Unified Signer — выбирает между ECDSA (Web Crypto) и GOST (WASM)
 *
 * ECDSA: быстро, не требует p12 файла, работает на любом устройстве
 * GOST:  требует .p12 файл + пароль, совместим с NCALayer/eGov
 */

import { generateKeyPair, signData } from "./key-manager";

export type SignMethod = "ECDSA" | "GOST";

export interface SignResult {
  certificate: string; // base64 DER certificate or SPKI public key
  signature: string; // base64 signature
  algorithm: string; // "SHA256withECDSA" | "GOST34.10-2015"
  method: SignMethod;
  subjectCn?: string;
  keyType?: string;
}

/**
 * Sign data using ECDSA P-256 (Web Crypto API)
 * No certificate file needed — generates keypair on the fly
 */
export async function signWithECDSA(dataBase64: string): Promise<SignResult> {
  const keyPair = await generateKeyPair("ECDSA");

  // Export public key as base64 SPKI
  const pubKeyDer = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  const pubKeyBase64 = bufferToBase64(pubKeyDer);

  // Sign data
  const dataBuffer = base64ToBuffer(dataBase64);
  const signatureBuffer = await signData(keyPair.privateKey, dataBuffer, "ECDSA");
  const signatureBase64 = bufferToBase64(signatureBuffer);

  return {
    certificate: pubKeyBase64,
    signature: signatureBase64,
    algorithm: "SHA256withECDSA",
    method: "ECDSA",
    subjectCn: "KazEDS Mobile User",
    keyType: "ECDSA P-256",
  };
}

/**
 * Sign data using GOST (Go WASM + PKCS#12 certificate)
 * Requires .p12 file and password
 */
export async function signWithGOST(
  p12Base64: string,
  password: string,
  dataBase64: string,
): Promise<SignResult> {
  // Dynamic import to avoid loading 7MB WASM unless needed
  const { signRaw, getKeyInfo } = await import("./wasm-bridge");

  // Get certificate info
  const keyInfo = await getKeyInfo(p12Base64, password);

  // Sign with raw signature
  const { certificate, signature } = await signRaw(p12Base64, password, dataBase64);

  return {
    certificate,
    signature,
    algorithm: keyInfo.keyType.includes("512") ? "GOST34.10-2015/512" : "GOST34.10-2015/256",
    method: "GOST",
    subjectCn: keyInfo.subjectCn,
    keyType: keyInfo.keyType,
  };
}

/**
 * Sign CMS (PKCS#7) using GOST — full CMS envelope
 */
export async function signCMSWithGOST(
  p12Base64: string,
  password: string,
  dataBase64: string,
  detached = false,
): Promise<string> {
  const { signCMS } = await import("./wasm-bridge");
  return signCMS(p12Base64, password, dataBase64, detached);
}

/**
 * Sign XML using GOST — enveloped XMLDSig
 */
export async function signXMLWithGOST(
  p12Base64: string,
  password: string,
  xmlString: string,
): Promise<string> {
  const { signXML } = await import("./wasm-bridge");
  return signXML(p12Base64, password, xmlString);
}

/**
 * Check if GOST WASM is available
 */
export async function isGOSTAvailable(): Promise<boolean> {
  try {
    const { initWasm, isWasmReady } = await import("./wasm-bridge");
    if (isWasmReady()) return true;
    await initWasm();
    return true;
  } catch {
    return false;
  }
}

// Helpers
function base64ToBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
