/**
 * WASM Bridge for GOST signing
 * Loads Go WASM (crypto.wasm) and exposes async signing functions
 * Supports GOST R 34.10-2012/2015 via Go crypto
 */

let wasmReady = false;
let wasmReadyResolve: () => void;
const wasmReadyPromise = new Promise<void>((resolve) => {
  wasmReadyResolve = resolve;
});

// Called by Go WASM when initialization is complete
if (typeof globalThis !== "undefined") {
  (globalThis as any).wasmReady = function () {
    wasmReady = true;
    wasmReadyResolve();
    console.log("[KazEDS WASM] Engine ready (GOST + RSA)");
  };
}

/**
 * Initialize the WASM engine
 * Must be called once before any crypto operations
 */
export async function initWasm(): Promise<void> {
  if (wasmReady) return;

  // Load Go runtime (wasm_exec.js sets globalThis.Go)
  if (!(globalThis as any).Go) {
    await import("./wasm_exec.js");
  }

  const go = new (globalThis as any).Go();

  // Fetch WASM from public directory. Must match Next.js basePath ("/app" in production).
  const wasmURL = "/app/wasm/crypto.wasm";
  const wasmResponse = fetch(wasmURL);
  const result = await WebAssembly.instantiateStreaming(wasmResponse, go.importObject);

  // Run the Go program (calls wasmReady when done)
  go.run(result.instance);

  await wasmReadyPromise;
}

async function ensureReady(): Promise<void> {
  if (!wasmReady) {
    await initWasm();
  }
}

function unwrapResult(result: any): string {
  if (result.error) {
    throw new Error(result.error);
  }
  return result.result;
}

// ============ Signing Functions ============

/**
 * Sign data using CMS/PKCS#7 format (GOST or RSA depending on certificate)
 */
export async function signCMS(
  p12Base64: string,
  password: string,
  dataBase64: string,
  detached = false,
): Promise<string> {
  await ensureReady();
  const result = (globalThis as any).wasmSignCMS(p12Base64, password, dataBase64, detached);
  return unwrapResult(result);
}

/**
 * Sign data with raw signature (no CMS/XML envelope)
 * Returns {certificate, signature} where both are base64
 */
export async function signRaw(
  p12Base64: string,
  password: string,
  dataBase64: string,
  digested = false,
  outputCert = true,
): Promise<{ certificate: string; signature: string }> {
  await ensureReady();
  const result = (globalThis as any).wasmSignRaw(p12Base64, password, dataBase64, digested, outputCert);
  const value = unwrapResult(result);
  return JSON.parse(value);
}

/**
 * Sign XML data with enveloped XMLDSig signature
 */
export async function signXML(
  p12Base64: string,
  password: string,
  xmlString: string,
): Promise<string> {
  await ensureReady();
  const result = (globalThis as any).wasmSignXML(p12Base64, password, xmlString, []);
  return unwrapResult(result);
}

/**
 * Get certificate info from a PKCS#12 file
 */
export async function getKeyInfo(
  p12Base64: string,
  password: string,
): Promise<{
  keyType: string;
  subjectCn: string;
  issuerCn: string;
  serialNumber: string;
  notBefore: string;
  notAfter: string;
  iin?: string;
  bin?: string;
}> {
  await ensureReady();
  const result = (globalThis as any).wasmGetKeyInfo(p12Base64, password);
  const value = unwrapResult(result);
  return JSON.parse(value);
}

/**
 * Compute hash digest
 */
export async function hashData(
  algorithm: string,
  dataBase64: string,
): Promise<string> {
  await ensureReady();
  const result = (globalThis as any).wasmHashData(algorithm, dataBase64);
  return unwrapResult(result);
}

/**
 * Check if WASM engine is loaded
 */
export function isWasmReady(): boolean {
  return wasmReady;
}
