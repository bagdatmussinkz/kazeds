"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { generateKeyPair, signData } from "@/lib/crypto/key-manager";
import { completeSession } from "@/lib/network/relay-client";

// --- Types ---

interface SignParams {
  session: string;
  challenge: string;
  origin: string;
  callback: string;
  data: string;
  op: "sign" | "auth";
}

type Route = { page: "home" } | { page: "sign"; params: SignParams };
type SigningState = { status: "idle" } | { status: "signing" } | { status: "success" } | { status: "error"; message: string };

// --- Helpers ---

function parseHash(): Route {
  if (typeof window === "undefined") return { page: "home" };
  const hash = window.location.hash;
  if (!hash.startsWith("#/sign")) return { page: "home" };
  const qIndex = hash.indexOf("?");
  if (qIndex === -1) return { page: "home" };
  const search = new URLSearchParams(hash.slice(qIndex + 1));
  const session = search.get("session");
  const challenge = search.get("challenge");
  const origin = search.get("origin");
  const callback = search.get("callback");
  const data = search.get("data") ?? "";
  const op = search.get("op") === "auth" ? "auth" : "sign";
  if (!session || !challenge || !origin || !callback) return { page: "home" };
  return { page: "sign", params: { session, challenge, origin, callback, data, op } };
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
  const scannerRef = useRef<any>(null);
  const viewfinderRef = useRef<HTMLDivElement>(null);

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
    // Expected: http://app.sign.aitu.uz/#/sign?session=...
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
          <button className="w-full flex items-center gap-4 p-4 bg-white border border-slate-200 rounded-xl
            hover:bg-slate-50 active:scale-[0.98] transition-all duration-150">
            <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
              </svg>
            </div>
            <div className="text-left">
              <span className="font-medium text-slate-700 block">Мои ключи</span>
              <span className="text-slate-400 text-sm">Нет сохранённых ключей</span>
            </div>
            <svg className="w-5 h-5 text-slate-300 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </button>

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

        <p className="text-center text-slate-300 text-xs mt-6">KazEDS v1.0 — Мобильная ЭЦП</p>
      </div>
    </main>
  );
}

// ==================== Signing Page ====================

function SigningPage({ params }: { params: SignParams }) {
  const [state, setState] = useState<SigningState>({ status: "idle" });
  const decodedData = params.data ? tryDecodeBase64Text(params.data) : null;
  const opLabel = params.op === "auth" ? "Аутентификация" : "Подписание";

  const handleSign = useCallback(async () => {
    setState({ status: "signing" });
    try {
      const keyPair = await generateKeyPair("ECDSA");
      const pubKeyDer = await crypto.subtle.exportKey("spki", keyPair.publicKey);
      const pubKeyBase64 = bufferToBase64(pubKeyDer);
      const challengeBuffer = base64ToBuffer(params.challenge);
      const signatureBuffer = await signData(keyPair.privateKey, challengeBuffer, "ECDSA");
      const signatureBase64 = bufferToBase64(signatureBuffer);

      await completeSession(params.session, {
        certificate: pubKeyBase64,
        signature: signatureBase64,
        algorithm: "SHA256withECDSA",
      }, params.callback);

      setState({ status: "success" });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : "Неизвестная ошибка" });
    }
  }, [params]);

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

          {state.status === "idle" && (
            <div className="space-y-3">
              <button onClick={handleSign}
                className="w-full py-3.5 bg-[#1F4E79] text-white font-semibold rounded-xl hover:bg-[#163d5e] active:scale-[0.98] transition-all duration-150 shadow-md shadow-blue-900/20">
                Подписать
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
              <p className="text-slate-400 text-sm">Можно закрыть страницу</p>
            </div>
          )}
          {state.status === "error" && (
            <div className="flex flex-col items-center py-4 gap-3">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <p className="text-red-600 font-semibold">Ошибка</p>
              <p className="text-slate-400 text-sm text-center">{state.message}</p>
              <button onClick={() => setState({ status: "idle" })}
                className="px-6 py-2 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50 transition">
                Попробовать снова
              </button>
            </div>
          )}
        </div>

        <p className="text-center text-slate-300 text-xs mt-6">KazEDS v1.0 — Мобильная ЭЦП</p>
      </div>
    </main>
  );
}
