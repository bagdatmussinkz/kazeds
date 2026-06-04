"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { completeSession } from "@/lib/network/relay-client";
import { signWithECDSA, signWithGOST, type SignMethod, type SignResult } from "@/lib/crypto/signer";

// --- Types ---

interface SignParams {
  session: string;
  challenge: string;
  origin: string;
  callback: string;
  data: string;
  op: "sign" | "auth" | "signxml";
  fmt: string; // "cms" | "xml"
  needsFetch?: boolean; // true when using short QR URL — must fetch from relay
}

type Route = { page: "home" } | { page: "sign"; params: SignParams };
type SigningState =
  | { status: "idle" }
  | { status: "signing" }
  | { status: "success"; signature: string; certificate: string; cmsSignature?: string }
  | { status: "error"; message: string; rawError?: string; stack?: string };

type VerifyState = "idle" | "verifying" | "valid" | "invalid";

// --- Helpers ---

const RELAY_BASE = "https://sign.aitu.uz/relay/v1";

function parseHash(): Route {
  if (typeof window === "undefined") return { page: "home" };
  const hash = window.location.hash;
  if (!hash.startsWith("#/sign")) return { page: "home" };
  const qIndex = hash.indexOf("?");
  if (qIndex === -1) return { page: "home" };
  const search = new URLSearchParams(hash.slice(qIndex + 1));

  // Short format: #/sign?s={sessionId}&f={fmt}
  const shortSession = search.get("s");
  if (shortSession) {
    const fmt = search.get("f") || "cms";
    const op = fmt === "xml" ? "signxml" : "sign";
    return {
      page: "sign",
      params: {
        session: shortSession,
        challenge: "", // will be fetched from relay
        origin: "",
        callback: "",
        data: "",
        op,
        fmt,
        needsFetch: true, // flag to fetch full data from relay
      },
    };
  }

  // Legacy long format: #/sign?session=...&challenge=...&origin=...&callback=...
  const session = search.get("session");
  const challenge = search.get("challenge");
  const origin = search.get("origin");
  const callback = search.get("callback");
  const data = search.get("data") ?? "";
  const opRaw = search.get("op") || "sign";
  const op = opRaw === "auth" ? "auth" : opRaw === "signxml" ? "signxml" : "sign";
  const fmt = search.get("fmt") || "cms";
  if (!session || !challenge || !origin || !callback) return { page: "home" };
  return { page: "sign", params: { session, challenge, origin, callback, data, op, fmt } };
}

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

function tryDecodeBase64Text(b64: string): string | null {
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch { return null; }
}

function friendlyError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("pkcs#12 parse error") || lower.includes("pkcs12")) {
    if (lower.includes("invalid padding") || lower.includes("decrypt")) {
      return "Неверный пароль к .p12 файлу. Проверьте пароль и попробуйте снова.";
    }
    return "Не удалось прочитать .p12 файл. Файл повреждён или имеет неподдерживаемый формат.";
  }
  if (lower.includes("session not found") || lower.includes("404")) {
    return "Сессия не найдена или истекла. Запросите новый QR-код.";
  }
  if (lower.includes("session expired") || lower.includes("expired")) {
    return "Сессия истекла. Запросите новый QR-код.";
  }
  if (lower.includes("network") || lower.includes("fetch") || lower.includes("failed to fetch")) {
    return "Ошибка сети. Проверьте интернет-соединение.";
  }
  return raw;
}

// --- Root ---

export default function Home() {
  const [route, setRoute] = useState<Route>({ page: "home" });

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (route.page === "sign") return <SigningPage params={route.params} />;
  return <HomePage />;
}

// ==================== Home Page with QR Scanner ====================

function HomePage() {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyInfo, setKeyInfo] = useState<{ name: string; type: string; expires: string } | null>(null);
  const [p12Stored, setP12Stored] = useState(false);
  const scannerRef = useRef<any>(null);
  const viewfinderRef = useRef<HTMLDivElement>(null);
  const keyFileRef = useRef<HTMLInputElement>(null);

  // Check if p12 is stored in localStorage (persists across PWA restarts)
  useEffect(() => {
    const stored = localStorage.getItem("kazeds_p12");
    const info = localStorage.getItem("kazeds_keyinfo");
    if (stored && info) {
      setP12Stored(true);
      try { setKeyInfo(JSON.parse(info)); } catch {}
    }
  }, []);

  const handleKeyUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const password = prompt("Введите пароль от ЭЦП:");
    if (!password) return;

    try {
      const buf = await file.arrayBuffer();
      const base64 = btoa(new Uint8Array(buf).reduce((s, b) => s + String.fromCharCode(b), ""));

      // Try to get key info via WASM
      let info = { name: file.name, type: "GOST", expires: "N/A" };
      try {
        const { getKeyInfo } = await import("@/lib/crypto/wasm-bridge");
        const ki = await getKeyInfo(base64, password);
        info = { name: ki.subjectCn || file.name, type: ki.keyType || "GOST", expires: ki.notAfter || "N/A" };
      } catch (err) {
        // WASM might not load on HTTP — store anyway
        console.warn("[KazEDS] WASM not available, storing p12 without validation");
      }

      localStorage.setItem("kazeds_p12", base64);
      localStorage.setItem("kazeds_p12_password", password);
      localStorage.setItem("kazeds_keyinfo", JSON.stringify(info));
      setKeyInfo(info);
      setP12Stored(true);
      setError(null);
    } catch (err) {
      setError("Ошибка загрузки: " + (err instanceof Error ? err.message : "неизвестная ошибка"));
    }
  };

  const handleKeyRemove = () => {
    localStorage.removeItem("kazeds_p12");
    localStorage.removeItem("kazeds_p12_password");
    localStorage.removeItem("kazeds_keyinfo");
    setKeyInfo(null);
    setP12Stored(false);
  };

  const startScanner = useCallback(async () => {
    setError(null);
    setScanning(true);

    try {
      const { Html5Qrcode } = await import("html5-qrcode");

      // Small delay for DOM to render viewfinder div
      await new Promise((r) => setTimeout(r, 100));

      const scanner = new Html5Qrcode("kazeds-viewfinder");
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          // QR scanned!
          console.log("[KazEDS App] QR scanned:", decodedText);
          scanner.stop().catch(() => {});
          scannerRef.current = null;
          setScanning(false);
          handleQRResult(decodedText);
        },
        () => {}, // ignore scan failures
      );
    } catch (err) {
      console.error("[KazEDS App] Scanner error:", err);
      setError(err instanceof Error ? err.message : "Не удалось открыть камеру");
      setScanning(false);
    }
  }, []);

  const stopScanner = useCallback(() => {
    if (scannerRef.current) {
      scannerRef.current.stop().catch(() => {});
      scannerRef.current = null;
    }
    setScanning(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
      }
    };
  }, []);

  const handleQRResult = (text: string) => {
    // Extract hash from deep link URL
    // Expected: https://sign.aitu.uz/app/#/sign?session=...
    try {
      const hashIndex = text.indexOf("#/sign");
      if (hashIndex !== -1) {
        window.location.hash = text.slice(hashIndex);
        return;
      }
      // Try as raw JSON (QR payload from relay)
      const parsed = JSON.parse(text);
      if (parsed.session_id) {
        window.location.hash = `#/sign?session=${parsed.session_id}&challenge=${encodeURIComponent(parsed.challenge || "")}&origin=${encodeURIComponent(parsed.origin || "")}&callback=${encodeURIComponent(parsed.callback_url || "")}&data=${encodeURIComponent(parsed.data_b64 || "")}&op=${parsed.operation || "sign"}`;
        return;
      }
    } catch {}
    setError("QR-код не содержит запроса на подписание");
  };

  return (
    <main className="flex flex-col items-center justify-center min-h-screen p-6">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-[#1F4E79] rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-blue-900/20">
            <span className="text-white font-bold text-2xl">K</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-800">KazEDS</h1>
          <p className="text-slate-400 text-sm">Мобильная ЭЦП</p>
        </div>

        {/* Main card */}
        <div className="bg-white rounded-2xl shadow-lg shadow-slate-200/50 border border-slate-200/60 p-6 space-y-4">

          {/* QR Scanner area */}
          {scanning ? (
            <div className="space-y-3">
              <div id="kazeds-viewfinder" ref={viewfinderRef}
                className="w-full aspect-square rounded-xl overflow-hidden bg-black" />
              <button onClick={stopScanner}
                className="w-full py-3 text-slate-500 text-sm font-medium rounded-xl hover:bg-slate-50 transition">
                Закрыть камеру
              </button>
            </div>
          ) : (
            <button onClick={startScanner}
              className="w-full flex items-center gap-4 p-4 bg-[#1F4E79] text-white rounded-xl
                hover:bg-[#163d5e] active:scale-[0.98] transition-all duration-150
                shadow-md shadow-blue-900/20">
              <div className="w-10 h-10 bg-white/15 rounded-lg flex items-center justify-center flex-shrink-0">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
                </svg>
              </div>
              <div className="text-left">
                <span className="font-semibold block">Сканировать QR-код</span>
                <span className="text-white/60 text-sm">Для входа или подписания</span>
              </div>
            </button>
          )}

          {/* Error */}
          {error && (
            <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm ring-1 ring-red-200">
              {error}
            </div>
          )}

          {/* My keys */}
          <input type="file" ref={keyFileRef} accept=".p12,.pfx" onChange={handleKeyUpload} className="hidden" />
          {p12Stored && keyInfo ? (
            <div className="p-4 bg-white border border-emerald-200 rounded-xl">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div className="text-left flex-1 min-w-0">
                  <span className="font-medium text-slate-700 block text-sm truncate">{keyInfo.name}</span>
                  <span className="text-emerald-600 text-xs">{keyInfo.type}</span>
                </div>
                <button onClick={handleKeyRemove} className="text-slate-400 hover:text-red-500 transition p-1">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => keyFileRef.current?.click()}
              className="w-full flex items-center gap-4 p-4 bg-white border border-slate-200 rounded-xl
                hover:bg-slate-50 active:scale-[0.98] transition-all duration-150">
              <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
                </svg>
              </div>
              <div className="text-left">
                <span className="font-medium text-slate-700 block">Загрузить ЭЦП (.p12)</span>
                <span className="text-slate-400 text-sm">Загрузите файл ключа для подписания</span>
              </div>
              <svg className="w-5 h-5 text-slate-300 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>
          )}

          {/* History */}
          <button className="w-full flex items-center gap-4 p-4 bg-white border border-slate-200 rounded-xl
            hover:bg-slate-50 active:scale-[0.98] transition-all duration-150">
            <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="text-left">
              <span className="font-medium text-slate-700 block">История</span>
              <span className="text-slate-400 text-sm">Операции подписания</span>
            </div>
            <svg className="w-5 h-5 text-slate-300 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </button>
        </div>

        <p className="text-center text-slate-300 text-xs mt-6">KazEDS v2.0.6 — Мобильная ЭЦП</p>
      </div>
    </main>
  );
}

// ==================== Signing Page ====================

type TraceEvent = { ts: number; level: "info" | "warn" | "error"; msg: string; data?: unknown };

function SigningPage({ params: initialParams }: { params: SignParams }) {
  const [params, setParams] = useState<SignParams>(initialParams);
  const [loading, setLoading] = useState(!!initialParams.needsFetch);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [state, setState] = useState<SigningState>({ status: "idle" });
  const [verifyState, setVerifyState] = useState<VerifyState>("idle");
  const [verifyInfo, setVerifyInfo] = useState<{ algorithm: string; curve: string; bits: number } | null>(null);
  const [traceLog, setTraceLog] = useState<TraceEvent[]>([]);
  const [traceOpen, setTraceOpen] = useState(false);
  const traceStartRef = useRef<number>(Date.now());

  const addTrace = useCallback((level: TraceEvent["level"], msg: string, data?: unknown) => {
    const ev: TraceEvent = { ts: Date.now() - traceStartRef.current, level, msg, data };
    setTraceLog((prev) => [...prev, ev]);
    const log = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    log("[KazEDS trace]", `+${ev.ts}ms`, msg, data ?? "");
  }, []);

  // Reset signing state when entering a new session (fresh QR scan after a previous success)
  useEffect(() => {
    setState({ status: "idle" });
    setVerifyState("idle");
    setVerifyInfo(null);
    setTraceLog([]);
    traceStartRef.current = Date.now();
  }, [initialParams.session]);

  // Fetch full session data from relay when using short QR URL
  useEffect(() => {
    if (!initialParams.needsFetch) return;
    (async () => {
      addTrace("info", "fetch session payload", { session: initialParams.session, fmt: initialParams.fmt, op: initialParams.op });
      try {
        const resp = await fetch(`${RELAY_BASE}/sessions/${initialParams.session}/payload`);
        if (!resp.ok) throw new Error(`Session not found (${resp.status})`);
        const payload = await resp.json();
        addTrace("info", "session payload received", {
          origin: payload.origin,
          operation: payload.operation,
          dataLen: payload.data?.length || 0,
          challengeLen: payload.challenge?.length || 0,
        });
        setParams({
          session: payload.session_id,
          challenge: payload.challenge || "",
          origin: payload.origin || "",
          callback: payload.callback_url || "",
          data: payload.data || "",
          op: initialParams.op,
          fmt: initialParams.fmt,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to load session";
        addTrace("error", "fetch payload failed", { error: msg });
        setFetchError(msg);
      } finally {
        setLoading(false);
      }
    })();
  }, [initialParams, addTrace]);

  const handleVerify = useCallback(async () => {
    if (state.status !== "success") return;
    setVerifyState("verifying");
    try {
      const pubKeyDer = Uint8Array.from(atob(state.certificate), c => c.charCodeAt(0));
      const pubKey = await crypto.subtle.importKey("spki", pubKeyDer.buffer,
        { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]);
      const sigBytes = Uint8Array.from(atob(state.signature), c => c.charCodeAt(0));
      const dataToVerify = params.data || params.challenge;
      const dataBytes = base64ToBuffer(dataToVerify);
      const valid = await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" }, pubKey, sigBytes, dataBytes);
      const jwk = await crypto.subtle.exportKey("jwk", pubKey);
      setVerifyInfo({ algorithm: "ECDSA", curve: jwk.crv || "P-256", bits: 256 });
      setVerifyState(valid ? "valid" : "invalid");
    } catch {
      setVerifyState("invalid");
    }
  }, [state, params]);
  const [p12File, setP12File] = useState<string | null>(null);
  const [p12Password, setP12Password] = useState("");
  const [p12FileName, setP12FileName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-detect method: if p12 in localStorage → GOST, else ECDSA
  const storedP12 = typeof window !== "undefined" ? localStorage.getItem("kazeds_p12") : null;
  const storedPassword = typeof window !== "undefined" ? localStorage.getItem("kazeds_p12_password") : null;
  const [method, setMethod] = useState<SignMethod>(storedP12 ? "GOST" : "ECDSA");

  // Pre-fill from localStorage
  useEffect(() => {
    if (storedP12 && storedPassword) {
      setP12File(storedP12);
      setP12Password(storedPassword);
      const info = localStorage.getItem("kazeds_keyinfo");
      if (info) {
        try { setP12FileName(JSON.parse(info).name); } catch {}
      }
    }
  }, [storedP12, storedPassword]);

  const decodedData = params.data ? tryDecodeBase64Text(params.data) : null;
  const opLabel = params.op === "auth" ? "Аутентификация" : "Подписание";

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const password = prompt("Введите пароль от ЭЦП:");
    if (!password) {
      e.target.value = "";
      return;
    }
    setP12FileName(file.name);
    setP12Password(password);
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = btoa(
        new Uint8Array(reader.result as ArrayBuffer).reduce((s, b) => s + String.fromCharCode(b), "")
      );
      setP12File(base64);
      try {
        localStorage.setItem("kazeds_p12", base64);
        localStorage.setItem("kazeds_p12_password", password);
        localStorage.setItem(
          "kazeds_keyinfo",
          JSON.stringify({ name: file.name, type: "GOST", expires: "N/A" }),
        );
      } catch {
        // ignore quota / disabled storage
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleSign = useCallback(async () => {
    setState({ status: "signing" });
    addTrace("info", "sign start", { method, fmt: params.fmt, op: params.op, p12FileName, hasPassword: !!p12Password });
    try {
      let result: SignResult;

      if (method === "GOST") {
        if (!p12File || !p12Password) {
          addTrace("error", "missing p12 or password");
          setState({ status: "error", message: "Выберите .p12 файл и введите пароль" });
          return;
        }
        const dataToSign = params.data || params.challenge;
        addTrace("info", "GOST branch", { fmt: params.fmt, dataLen: dataToSign.length });

        if (params.fmt === "xml") {
          const { signXMLWithGOST, signWithGOST: signRawGOST } = await import("@/lib/crypto/signer");
          const xmlString = atob(dataToSign);
          addTrace("info", "signXMLWithGOST call", { xmlLen: xmlString.length });
          const signedXml = await signXMLWithGOST(p12File, p12Password, xmlString);
          addTrace("info", "signXMLWithGOST done", { signedLen: signedXml.length });
          const rawResult = await signRawGOST(p12File, p12Password, dataToSign);
          addTrace("info", "raw GOST sign done", { sigLen: rawResult.signature.length, certLen: rawResult.certificate.length });
          result = { ...rawResult, signature: signedXml };
        } else {
          const { signCMSWithGOST, signWithGOST: signRawGOST } = await import("@/lib/crypto/signer");
          addTrace("info", "signCMSWithGOST call");
          const cmsB64 = await signCMSWithGOST(p12File, p12Password, dataToSign, false);
          addTrace("info", "signCMSWithGOST done", { cmsLen: cmsB64.length });
          const rawResult = await signRawGOST(p12File, p12Password, dataToSign);
          addTrace("info", "raw GOST sign done", { sigLen: rawResult.signature.length });
          result = { ...rawResult, signature: cmsB64, cmsSignature: cmsB64 };
        }
      } else {
        const dataToSign = params.data || params.challenge;
        addTrace("info", "ECDSA branch", { dataLen: dataToSign.length });
        result = await signWithECDSA(dataToSign);
        addTrace("info", "ECDSA sign done", { sigLen: result.signature.length });
      }

      const completeData: any = {
        certificate: result.certificate,
        signature: result.signature,
        algorithm: result.algorithm,
      };
      if (result.cmsSignature) completeData.cmsSignature = result.cmsSignature;
      if (params.fmt === "xml" && result.signature) {
        completeData.signedDocument = result.signature;
      }
      addTrace("info", "completeSession call", { session: params.session, hasCallback: !!params.callback });
      await completeSession(params.session, completeData, params.callback);
      addTrace("info", "completeSession done");

      setState({
        status: "success",
        signature: result.signature,
        certificate: result.certificate,
        cmsSignature: result.cmsSignature,
      });
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Неизвестная ошибка";
      const stack = err instanceof Error ? err.stack : undefined;
      addTrace("error", "sign failed", { raw, stack });
      setState({ status: "error", message: friendlyError(raw), rawError: raw, stack });
    }
  }, [params, method, p12File, p12Password, p12FileName, addTrace]);

  const buildDebugReport = useCallback((): string => {
    const errInfo = state.status === "error" ? { friendly: state.message, raw: state.rawError, stack: state.stack } : null;
    const report = {
      version: "2.0.6",
      time: new Date().toISOString(),
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "n/a",
      session: params.session,
      origin: params.origin,
      operation: params.op,
      format: params.fmt,
      method,
      p12: { fileName: p12FileName || null, hasPassword: !!p12Password },
      dataLen: params.data?.length || 0,
      challengeLen: params.challenge?.length || 0,
      error: errInfo,
      trace: traceLog,
    };
    return JSON.stringify(report, null, 2);
  }, [state, params, method, p12FileName, p12Password, traceLog]);

  const copyDebugReport = useCallback(async () => {
    const text = buildDebugReport();
    try {
      await navigator.clipboard.writeText(text);
      addTrace("info", "debug report copied to clipboard", { len: text.length });
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch {}
      document.body.removeChild(ta);
    }
  }, [buildDebugReport, addTrace]);

  return (
    <main className="flex flex-col items-center justify-center min-h-screen p-6">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 bg-[#1F4E79] rounded-2xl flex items-center justify-center mb-3 shadow-lg shadow-blue-900/20">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-slate-800">{opLabel}</h1>
          <p className="text-slate-400 text-sm">KazEDS</p>
        </div>

        {/* Request card */}
        <div className="bg-white rounded-2xl shadow-lg shadow-slate-200/50 border border-slate-200/60 p-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Источник</label>
            <p className="text-sm text-slate-700 mt-1 break-all font-medium">{params.origin}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Операция</label>
            <p className="text-sm text-slate-700 mt-1">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${params.op === "auth" ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"}`}>
                {opLabel}
              </span>
            </p>
          </div>
          {params.data && (
            <div>
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Данные</label>
              <div className="mt-1 bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-600 font-mono whitespace-pre-wrap break-all">
                  {decodedData ?? `[base64] ${params.data.slice(0, 80)}`}
                </p>
              </div>
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">ID сессии</label>
            <p className="text-xs text-slate-400 mt-1 font-mono break-all">{params.session}</p>
          </div>
          <div className="border-t border-slate-100" />

          {loading && (
            <div className="flex flex-col items-center py-6 gap-3">
              <div className="w-8 h-8 border-2 border-[#1F4E79] border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-slate-500">Загрузка данных сессии...</p>
            </div>
          )}
          {fetchError && (
            <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm ring-1 ring-red-200">
              {fetchError}
            </div>
          )}
          {!loading && !fetchError && state.status === "idle" && (
            <div className="space-y-3">
              {/* Method selector */}
              <div className="flex gap-2">
                <button onClick={() => setMethod("ECDSA")}
                  className={`flex-1 py-2 text-xs font-medium rounded-lg transition-all ${
                    method === "ECDSA"
                      ? "bg-[#1F4E79] text-white shadow-sm"
                      : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                  }`}>
                  ECDSA P-256
                </button>
                <button onClick={() => setMethod("GOST")}
                  className={`flex-1 py-2 text-xs font-medium rounded-lg transition-all ${
                    method === "GOST"
                      ? "bg-[#1F4E79] text-white shadow-sm"
                      : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                  }`}>
                  ГОСТ (ЭЦП .p12)
                </button>
              </div>

              {/* GOST: p12 file + password */}
              {method === "GOST" && (
                <div className="space-y-2 bg-slate-50 rounded-lg p-3">
                  <input type="file" ref={fileInputRef} accept=".p12,.pfx" onChange={handleFileSelect} className="hidden" />
                  <button onClick={() => fileInputRef.current?.click()}
                    className="w-full py-2.5 text-sm border border-dashed border-slate-300 rounded-lg text-slate-500 hover:border-[#1F4E79] hover:text-[#1F4E79] transition">
                    {p12FileName || "Выбрать .p12 файл"}
                  </button>
                  <input
                    type="password"
                    placeholder="Пароль от ЭЦП"
                    value={p12Password}
                    onChange={(e) => setP12Password(e.target.value)}
                    className="w-full py-2.5 px-3 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1F4E79]/20 focus:border-[#1F4E79]"
                  />
                </div>
              )}

              <button onClick={handleSign}
                disabled={method === "GOST" && (!p12File || !p12Password)}
                className="w-full py-3.5 bg-[#1F4E79] text-white font-semibold rounded-xl hover:bg-[#163d5e] active:scale-[0.98] transition-all duration-150 shadow-md shadow-blue-900/20 disabled:opacity-30 disabled:cursor-not-allowed">
                {method === "GOST" ? "Подписать (ГОСТ)" : "Подписать (ECDSA)"}
              </button>
              <button onClick={() => { window.location.hash = ""; }}
                className="w-full py-3 text-slate-400 text-sm font-medium rounded-xl hover:bg-slate-50 transition">
                Отмена
              </button>
            </div>
          )}
          {state.status === "signing" && (
            <div className="flex flex-col items-center py-4 gap-3">
              <div className="w-8 h-8 border-2 border-[#1F4E79] border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-slate-500">Подписание...</p>
            </div>
          )}
          {state.status === "success" && (
            <div className="flex flex-col items-center py-4 gap-3">
              <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-emerald-700 font-semibold">Подписано успешно</p>
              <div className="flex gap-2">
                <button onClick={handleVerify}
                  disabled={verifyState === "verifying"}
                  className="px-5 py-2 bg-[#1F4E79] text-white text-sm font-medium rounded-xl hover:bg-[#163d5e] active:scale-[0.98] transition-all shadow-sm disabled:opacity-50">
                  {verifyState === "verifying" ? "Проверка..." : "Проверить"}
                </button>
                <button onClick={() => { window.location.hash = ""; }}
                  className="px-5 py-2 bg-slate-100 text-slate-700 text-sm font-medium rounded-xl hover:bg-slate-200 active:scale-[0.98] transition-all">
                  Готово
                </button>
              </div>
            </div>
          )}

          {/* Verify modal */}
          {(verifyState === "valid" || verifyState === "invalid") && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
              onClick={() => setVerifyState("idle")}>
              <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-[90%] p-6"
                onClick={(e) => e.stopPropagation()}>
                {verifyState === "valid" ? (
                  <>
                    <div className="flex flex-col items-center mb-4">
                      <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center mb-2">
                        <svg className="w-7 h-7 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                        </svg>
                      </div>
                      <h2 className="text-lg font-bold text-emerald-700">Подпись верна</h2>
                      <p className="text-slate-400 text-xs">Криптографическая проверка пройдена</p>
                    </div>
                    <div className="bg-slate-50 rounded-xl p-3 space-y-2 text-sm mb-4">
                      <div className="flex justify-between">
                        <span className="text-slate-400 text-xs">Данные</span>
                        <span className="text-slate-800 font-mono text-xs font-semibold">"{decodedData || params.data}"</span>
                      </div>
                      <div className="border-t border-slate-200" />
                      <div className="flex justify-between">
                        <span className="text-slate-400 text-xs">Алгоритм</span>
                        <span className="text-slate-700 font-mono text-xs">{verifyInfo?.algorithm} {verifyInfo?.curve}</span>
                      </div>
                      <div className="border-t border-slate-200" />
                      <div className="flex justify-between">
                        <span className="text-slate-400 text-xs">Ключ</span>
                        <span className="text-slate-700 font-mono text-xs">{verifyInfo?.bits} бит</span>
                      </div>
                      <div className="border-t border-slate-200" />
                      <div className="flex justify-between">
                        <span className="text-slate-400 text-xs">Время</span>
                        <span className="text-slate-700 text-xs">{new Date().toLocaleString("ru-KZ")}</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center mb-4">
                    <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mb-2">
                      <svg className="w-7 h-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                      </svg>
                    </div>
                    <h2 className="text-lg font-bold text-red-600">Подпись невалидна</h2>
                    <p className="text-slate-400 text-xs text-center">Данные не соответствуют подписи</p>
                  </div>
                )}
                <button onClick={() => setVerifyState("idle")}
                  className="w-full py-2.5 bg-slate-100 text-slate-600 font-medium rounded-xl hover:bg-slate-200 transition text-sm">
                  Закрыть
                </button>
              </div>
            </div>
          )}
          {state.status === "error" && (
            <div className="flex flex-col items-center py-4 gap-3 w-full">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <p className="text-red-600 font-semibold">Ошибка</p>
              <p className="text-slate-400 text-sm text-center px-2">{state.message}</p>
              <div className="flex gap-2 w-full">
                <button onClick={() => setState({ status: "idle" })}
                  className="flex-1 px-4 py-2 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50 transition">
                  Попробовать снова
                </button>
                <button onClick={copyDebugReport}
                  className="flex-1 px-4 py-2 bg-slate-100 text-slate-700 text-sm font-medium rounded-xl hover:bg-slate-200 transition">
                  Копировать debug
                </button>
              </div>
              <button onClick={() => setTraceOpen((v) => !v)}
                className="text-xs text-slate-400 hover:text-slate-600 underline mt-1">
                {traceOpen ? "Скрыть" : "Показать"} технические детали ({traceLog.length} событий)
              </button>
              {traceOpen && (
                <div className="w-full bg-slate-900 rounded-lg p-3 max-h-64 overflow-auto">
                  <pre className="text-[10px] font-mono text-slate-300 whitespace-pre-wrap break-all">
                    {buildDebugReport()}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>

        <p className="text-center text-slate-300 text-xs mt-6">KazEDS v2.0.6 — Мобильная ЭЦП</p>
      </div>
    </main>
  );
}
