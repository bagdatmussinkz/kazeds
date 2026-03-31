"use client";

import { useEffect, useState } from "react";

type ConnectionStatus = "checking" | "connected" | "disconnected";

type SigningResult = {
  success: boolean;
  signature?: string;
  data?: string;
  timestamp?: string;
  errorMessage?: string;
};

const SIGN_DATA = "demo";
const SIGN_DATA_B64 = "ZGVtbw==";

export default function Home() {
  const [page, setPage] = useState<"login" | "dashboard" | "error">("login");
  const [result, setResult] = useState<SigningResult | null>(null);

  if (page === "dashboard" && result?.success) {
    return <DashboardPage result={result} onLogout={() => { setPage("login"); setResult(null); }} />;
  }

  return <LoginPage onResult={(r) => { setResult(r); setPage(r.success ? "dashboard" : "error"); }} />;
}

// ==================== Login Page ====================

function LoginPage({ onResult }: { onResult: (r: SigningResult) => void }) {
  const [status, setStatus] = useState<ConnectionStatus>("checking");
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const handleLogin = async () => {
    setSigning(true);
    setError(null);
    try {
      const { NCALayerClient } = await import("ncalayer-js-client");
      const client = new NCALayerClient();
      await client.connect();

      const signature = await client.basicsSignCMS(
        NCALayerClient.basicsStorageAll,
        SIGN_DATA_B64,
        NCALayerClient.basicsCMSParamsDetached,
        NCALayerClient.basicsSignerSignAny,
      );

      onResult({
        success: true,
        signature,
        data: SIGN_DATA,
        timestamp: new Date().toLocaleString("ru-KZ", {
          day: "2-digit", month: "2-digit", year: "numeric",
          hour: "2-digit", minute: "2-digit", second: "2-digit",
        }),
      });
    } catch (err: any) {
      if (err.canceledByUser) {
        setError("Отменено пользователем");
      } else {
        setError(err.message || "Ошибка подключения к NCALayer");
      }
    } finally {
      setSigning(false);
    }
  };

  return (
    <main className="flex flex-col items-center justify-center min-h-screen p-6">
      <div className="w-full max-w-lg">
        <div className="bg-white rounded-2xl shadow-lg shadow-blue-900/5 border border-slate-200/60 p-8 mb-6">
          {/* Logo */}
          <div className="flex items-center justify-center gap-3 mb-6">
            <div className="w-10 h-10 bg-[#1F4E79] rounded-xl flex items-center justify-center">
              <span className="text-white font-bold text-lg">K</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800 leading-tight">KazEDS Demo</h1>
              <p className="text-sm text-slate-400">Электронная цифровая подпись</p>
            </div>
          </div>

          {/* Status */}
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
                KazEDS Extension не найден
              </div>
            )}
          </div>

          <div className="border-t border-slate-100 mb-6" />

          {/* Login */}
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

            {error && (
              <div className="mt-4 p-3 rounded-lg text-sm text-left bg-red-50 text-red-600 ring-1 ring-red-200">
                <p className="font-medium mb-1">Ошибка</p>
                <p className="text-xs break-all opacity-80">{error}</p>
              </div>
            )}
          </div>
        </div>

        {/* Install banner */}
        {status === "disconnected" && (
          <div className="bg-amber-50/80 backdrop-blur-sm border border-amber-200/60 rounded-2xl p-6 text-center shadow-sm mb-6">
            <p className="text-amber-900 font-semibold mb-1">Установите расширение</p>
            <p className="text-amber-700/80 text-sm mb-4">
              KazEDS Extension заменяет NCALayer — подписание происходит на вашем телефоне
            </p>
            <a
              href="https://extension-sign.aitu.uz/eds_v2.0.0.zip"
              download
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#1F4E79] text-white rounded-xl font-medium
                hover:bg-[#163d5e] transition-all duration-150 shadow-md shadow-blue-900/20 hover:shadow-lg mb-3"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Скачать Extension v2.0.0
            </a>
            <div className="mt-2 text-left bg-white/60 rounded-lg p-3 text-xs text-slate-500 space-y-1">
              <p className="font-medium text-slate-600">Установка:</p>
              <p>1. Скачайте и распакуйте ZIP</p>
              <p>2. Откройте <code className="bg-slate-100 px-1 rounded">chrome://extensions</code></p>
              <p>3. Включите <strong>Режим разработчика</strong></p>
              <p>4. <strong>Загрузить распакованное расширение</strong> → выберите папку</p>
            </div>
            <a
              href="https://sign.aitu.uz"
              className="text-[#1F4E79] text-sm font-medium underline mt-3 inline-block"
            >
              Подробнее на sign.aitu.uz
            </a>
          </div>
        )}

        <p className="text-center text-slate-300 text-xs mt-6">KazEDS Demo v1.0</p>
      </div>
    </main>
  );
}

// ==================== Dashboard Page ====================

function DashboardPage({ result, onLogout }: { result: SigningResult; onLogout: () => void }) {
  const [copiedSig, setCopiedSig] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);

  const copySignature = () => {
    if (result.signature) {
      navigator.clipboard.writeText(result.signature);
      setCopiedSig(true);
      setTimeout(() => setCopiedSig(false), 2000);
    }
  };

  const copyVerifyCommand = () => {
    if (result.signature) {
      navigator.clipboard.writeText(`./scripts/verify.sh "${SIGN_DATA}" "${result.signature}"`);
      setCopiedCmd(true);
      setTimeout(() => setCopiedCmd(false), 2000);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-200/60">
        <div className="max-w-2xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-[#1F4E79] rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-xs">K</span>
            </div>
            <span className="font-bold text-slate-800 text-sm">KazEDS Demo</span>
          </div>
          <button onClick={onLogout} className="text-sm text-slate-400 hover:text-slate-600 transition">
            Выйти
          </button>
        </div>
      </header>

      <div className="max-w-2xl mx-auto p-6 mt-6">
        {/* Success card */}
        <div className="bg-white rounded-2xl shadow-lg shadow-blue-900/5 border border-slate-200/60 p-6 mb-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center flex-shrink-0">
              <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <h1 className="text-emerald-700 font-bold text-xl">Вход выполнен</h1>
              <p className="text-slate-400 text-sm">{result.timestamp}</p>
            </div>
          </div>

          <p className="text-slate-600 text-sm mb-6">
            Документ <strong>"{result.data}"</strong> успешно подписан электронной цифровой подписью.
          </p>

          <div className="space-y-3">
            {/* Signed data */}
            <div className="bg-slate-50 rounded-xl p-4">
              <p className="text-xs text-slate-400 uppercase tracking-wider font-medium mb-1">Подписанные данные</p>
              <p className="text-base font-mono text-slate-800 font-semibold">{result.data}</p>
            </div>

            {/* Signature */}
            <div className="bg-slate-50 rounded-xl p-4">
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="text-xs text-slate-400 uppercase tracking-wider font-medium">Подпись (ECDSA)</p>
                <button onClick={copySignature}
                  className="flex-shrink-0 px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs text-slate-500 hover:bg-slate-100 active:scale-95 transition-all">
                  {copiedSig ? <span className="text-emerald-600 font-medium">Скопировано</span> : "Копировать"}
                </button>
              </div>
              <p className="text-xs font-mono text-slate-600 break-all leading-relaxed">
                {result.signature && result.signature.length > 80
                  ? result.signature.slice(0, 80) + "..."
                  : result.signature}
              </p>
            </div>

            {/* Details */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-50 rounded-xl p-4">
                <p className="text-xs text-slate-400 uppercase tracking-wider font-medium mb-1">Алгоритм</p>
                <p className="text-sm font-mono text-slate-700 font-medium">SHA256withECDSA</p>
              </div>
              <div className="bg-slate-50 rounded-xl p-4">
                <p className="text-xs text-slate-400 uppercase tracking-wider font-medium mb-1">Время</p>
                <p className="text-sm text-slate-700 font-medium">{result.timestamp}</p>
              </div>
            </div>

            {/* Verify command */}
            <div className="bg-slate-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-slate-400 uppercase tracking-wider font-medium">Команда проверки</p>
                <button onClick={copyVerifyCommand}
                  className="flex-shrink-0 px-2.5 py-1 bg-slate-700 border border-slate-600 rounded-lg text-xs text-slate-300 hover:bg-slate-600 active:scale-95 transition-all">
                  {copiedCmd ? <span className="text-emerald-400 font-medium">Скопировано</span> : "Копировать"}
                </button>
              </div>
              <pre className="text-xs font-mono text-emerald-400 break-all whitespace-pre-wrap leading-relaxed">
{`./scripts/verify.sh "${SIGN_DATA}" "${result.signature ? result.signature.slice(0, 20) + "..." : ""}"`}
              </pre>
            </div>
          </div>
        </div>

        {/* Welcome message */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 p-6">
          <h2 className="text-lg font-semibold text-slate-800 mb-2">Добро пожаловать!</h2>
          <p className="text-slate-500 text-sm">
            Вы вошли в личный кабинет демо-системы KazEDS. Подписание было выполнено
            с помощью алгоритма ECDSA P-256 через мобильное устройство.
          </p>
        </div>
      </div>
    </main>
  );
}
