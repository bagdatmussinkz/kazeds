"use client";

import { useEffect, useState } from "react";

type ConnectionStatus = "checking" | "connected" | "disconnected";
type Page = "main" | "wifi";

const APP_URL = "http://app.eds.aitu.uz";
const WIFI_SSID = "pred";
const WIFI_PASS = "8n4egr4d3ynbx";
const WIFI_QR_DATA = `WIFI:T:WPA;S:${WIFI_SSID};P:${WIFI_PASS};;`;

export default function Home() {
  const [status, setStatus] = useState<ConnectionStatus>("checking");
  const [page, setPage] = useState<Page>("main");

  // Hash routing
  useEffect(() => {
    const onHash = () => {
      setPage(window.location.hash === "#/wifi" ? "wifi" : "main");
    };
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Extension detection
  useEffect(() => {
    if ((window as any).__KAZEDS_INSTALLED__) {
      setStatus("connected");
      return;
    }
    const onInstalled = () => setStatus("connected");
    window.addEventListener("kazeds:installed", onInstalled);
    const timeout = setTimeout(() => {
      setStatus((prev) => (prev === "checking" ? "disconnected" : prev));
    }, 1500);
    return () => {
      window.removeEventListener("kazeds:installed", onInstalled);
      clearTimeout(timeout);
    };
  }, []);

  if (page === "wifi") return <WifiPage />;

  const [signing, setSigning] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleLogin = async () => {
    setSigning(true);
    setResult(null);
    try {
      const { NCALayerClient } = await import("ncalayer-js-client");
      const client = new NCALayerClient();
      await client.connect();

      // Аутентификация — подписываем challenge
      const challenge = btoa(String(Date.now()));
      const signature = await client.basicsSignCMS(
        NCALayerClient.basicsStorageAll,
        challenge,
        NCALayerClient.basicsCMSParamsDetached,
        NCALayerClient.basicsSignerSignAny,
      );

      setResult({
        success: true,
        message: `Подпись получена (${signature.slice(0, 40)}...)`,
      });
    } catch (err: any) {
      if (err.canceledByUser) {
        setResult({ success: false, message: "Отменено пользователем" });
      } else {
        setResult({ success: false, message: err.message || "Ошибка подключения к NCALayer" });
      }
    } finally {
      setSigning(false);
    }
  };

  const appQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(APP_URL)}`;

  return (
    <main className="flex flex-col items-center justify-center min-h-screen p-6">
      <div className="w-full max-w-lg">

        {/* Main card */}
        <div className="bg-white rounded-2xl shadow-lg shadow-blue-900/5 border border-slate-200/60 p-8 mb-6">
          <div className="flex items-center justify-center gap-3 mb-6">
            <div className="w-10 h-10 bg-[#1F4E79] rounded-xl flex items-center justify-center">
              <span className="text-white font-bold text-lg">K</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800 leading-tight">KazEDS Demo</h1>
              <p className="text-sm text-slate-400">Электронная цифровая подпись</p>
            </div>
          </div>

          {/* Status badge */}
          <div className="flex justify-center mb-6">
            {status === "checking" && (
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-500 rounded-full text-sm">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Проверка подключения...
              </div>
            )}
            {status === "connected" && (
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 rounded-full text-sm font-medium ring-1 ring-emerald-200">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                KazEDS Extension подключён
              </div>
            )}
            {status === "disconnected" && (
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-full text-sm font-medium ring-1 ring-red-200">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                Extension не найден
              </div>
            )}
          </div>

          <div className="border-t border-slate-100 mb-6" />

          <div className="text-center">
            <p className="text-slate-500 text-sm mb-4">Для входа в систему нажмите кнопку ниже</p>
            <button
              onClick={handleLogin}
              disabled={status !== "connected" || signing}
              className="w-full py-3 px-6 bg-[#1F4E79] text-white rounded-xl font-semibold text-base
                disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#163d5e] active:scale-[0.98]
                transition-all duration-150 shadow-md shadow-blue-900/20 hover:shadow-lg hover:shadow-blue-900/25"
            >
              {signing ? (
                <span className="inline-flex items-center gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Ожидание подписи...
                </span>
              ) : "Войти по ЭЦП"}
            </button>

            {/* Result */}
            {result && (
              <div className={`mt-4 p-3 rounded-lg text-sm text-left ${
                result.success
                  ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                  : "bg-red-50 text-red-600 ring-1 ring-red-200"
              }`}>
                <p className="font-medium mb-1">{result.success ? "Успешно" : "Ошибка"}</p>
                <p className="text-xs break-all opacity-80">{result.message}</p>
              </div>
            )}
          </div>
        </div>

        {/* Install banner */}
        {status === "disconnected" && (
          <div className="bg-amber-50/80 backdrop-blur-sm border border-amber-200/60 rounded-2xl p-6 text-center shadow-sm mb-6">
            <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </div>
            <p className="text-amber-900 font-semibold mb-1">Установите расширение</p>
            <p className="text-amber-700/80 text-sm mb-4">
              KazEDS Extension заменяет NCALayer — подписание происходит на вашем телефоне
            </p>
            <a
              href="/kazeds-extension.zip"
              download
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#1F4E79] text-white rounded-xl font-medium
                hover:bg-[#163d5e] transition-all duration-150 shadow-md shadow-blue-900/20 hover:shadow-lg"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Скачать KazEDS Extension (.zip)
            </a>
            <div className="mt-4 text-left bg-white/60 rounded-lg p-3 text-xs text-slate-500 space-y-1">
              <p className="font-medium text-slate-600">Как установить:</p>
              <p>1. Скачайте и распакуйте ZIP-архив</p>
              <p>2. Откройте <code className="bg-slate-100 px-1 rounded">chrome://extensions</code></p>
              <p>3. Включите <strong>Режим разработчика</strong> (справа вверху)</p>
              <p>4. Нажмите <strong>Загрузить распакованное расширение</strong></p>
              <p>5. Выберите распакованную папку</p>
            </div>
            <p className="text-slate-400 text-xs mt-3">
              Google Chrome, Яндекс Браузер, Edge и другие Chromium-браузеры
            </p>
          </div>
        )}

        {/* Mobile App QR card */}
        <div className="bg-white rounded-2xl shadow-lg shadow-blue-900/5 border border-slate-200/60 p-6 text-center mb-6">
          <h2 className="text-lg font-semibold text-slate-700 mb-1">Мобильное приложение</h2>
          <p className="text-slate-400 text-sm mb-4">Отсканируйте QR-код телефоном для подписания</p>
          <div className="inline-block p-3 bg-white rounded-xl border border-slate-200 shadow-sm">
            <img src={appQrUrl} alt="QR-код для KazEDS App" width={200} height={200} className="rounded-lg" />
          </div>
          <div className="mt-4">
            <a
              href={APP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-[#1F4E79] hover:text-[#163d5e] font-medium text-sm transition"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
              Открыть app.eds.aitu.uz
            </a>
          </div>
        </div>

        {/* WiFi link */}
        <div className="text-center mb-6">
          <a
            href="#/wifi"
            className="inline-flex items-center gap-2 text-slate-400 hover:text-[#1F4E79] text-sm transition"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z" />
            </svg>
            Подключиться к WiFi
          </a>
        </div>

        <p className="text-center text-slate-300 text-xs">KazEDS Demo v1.0 — тестовый стенд</p>
      </div>
    </main>
  );
}

function WifiPage() {
  const wifiQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(WIFI_QR_DATA)}`;
  const [copied, setCopied] = useState(false);

  const copyPassword = () => {
    navigator.clipboard.writeText(WIFI_PASS);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main className="flex flex-col items-center justify-center min-h-screen p-6">
      <div className="w-full max-w-sm">
        {/* Back link */}
        <a href="#/" className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-600 text-sm mb-6 transition">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Назад
        </a>

        <div className="bg-white rounded-2xl shadow-lg shadow-blue-900/5 border border-slate-200/60 p-8 text-center">
          {/* WiFi icon */}
          <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-[#1F4E79]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z" />
            </svg>
          </div>

          <h1 className="text-xl font-bold text-slate-800 mb-1">Подключение к WiFi</h1>
          <p className="text-slate-400 text-sm mb-6">
            Отсканируйте QR-код камерой телефона
          </p>

          {/* QR code */}
          <div className="inline-block p-4 bg-white rounded-2xl border border-slate-200 shadow-sm mb-6">
            <img src={wifiQrUrl} alt="WiFi QR" width={250} height={250} className="rounded-lg" />
          </div>

          {/* Credentials */}
          <div className="bg-slate-50 rounded-xl p-4 text-left space-y-3">
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wider font-medium mb-1">Сеть</p>
              <p className="text-lg font-semibold text-slate-700">{WIFI_SSID}</p>
            </div>
            <div className="border-t border-slate-200" />
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wider font-medium mb-1">Пароль</p>
              <div className="flex items-center justify-between gap-2">
                <code className="text-lg font-mono font-semibold text-slate-700 select-all">{WIFI_PASS}</code>
                <button
                  onClick={copyPassword}
                  className="flex-shrink-0 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-500
                    hover:bg-slate-100 active:scale-95 transition-all"
                >
                  {copied ? (
                    <span className="text-emerald-600 font-medium">Скопировано</span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                      </svg>
                      Копировать
                    </span>
                  )}
                </button>
              </div>
            </div>
          </div>

          <p className="text-slate-300 text-xs mt-4">WPA/WPA2</p>
        </div>
      </div>
    </main>
  );
}
