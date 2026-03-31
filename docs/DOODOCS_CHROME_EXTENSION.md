# Doodocs Sign Chrome Extension — Technical Reference

Полный реверс-инжиниринг расширения Doodocs Sign v1.4.0 — браузерной замены NCALayer для казахстанских ЭЦП.

## Архитектура

```
Веб-страница (MAIN world)
  │ new WebSocket("ws://127.0.0.1:13579")
  ▼
ws-intercept.js → FakeWebSocket
  │ window.postMessage
  ▼
bridge.js (ISOLATED world)
  │ chrome.runtime.sendMessage
  ▼
service-worker.js (Background)
  │
  ├── ncalayer-api.js (Module Router)
  │     ├── kz.gov.pki.knca.commonUtils
  │     ├── kz.gov.pki.knca.basics
  │     ├── KNP Module (SONO)
  │     └── NURSign Module
  │
  ├── sign-utils.js (Key Selection)
  │     └── confirm-manager.js → confirm-overlay.js (Shadow DOM UI)
  │
  └── wasm-bridge.js → crypto.wasm (Go WASM)
        ├── signCMS()      — CMS/PKCS#7
        ├── signRaw()      — Raw ECDSA/GOST
        ├── signXML()      — Enveloped XMLDSig
        ├── getKeyInfo()   — Certificate parsing
        └── parsePKCS12()  — PKCS#12 extraction
```

## Manifest (MV3)

```json
{
  "manifest_version": 3,
  "name": "Doodocs Sign",
  "version": "1.4.0",
  "permissions": ["storage", "scripting"],
  "host_permissions": ["<all_urls>"],
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
  }
}
```

Content Scripts:
- `ws-intercept.js` — MAIN world, `document_start`, все URL
- `bridge.js` — ISOLATED world, `document_start`, все URL
- `confirm-overlay.js` — lazy-loaded через `chrome.scripting.executeScript`

## WebSocket Перехват

**Файл:** `src/content/ws-intercept.js` (192 строки, MAIN world)

```javascript
const NCALAYER_HOSTS = new Set(["127.0.0.1", "localhost"]);
const NCALAYER_PORT = "13579";

window.WebSocket = function(url, protocols) {
  if (isNCALayerURL(url)) return new FakeWebSocket(url, protocols);
  return new OriginalWebSocket(url, protocols);
};
```

### FakeWebSocket

- Эмулирует `readyState`, `onopen/onclose/onmessage/onerror`, `addEventListener`
- При `open` отправляет version: `{ result: { version: "1.4" } }`
- Поддерживает heartbeat (`--heartbeat--` и `{}`)
- `send()` парсит JSON, проверяет `module`/`method`/`command`/`type`, роутит через `postMessage`
- Дропает malformed пакеты без ошибок

### Защита от дублирования

```javascript
const INSTALL_FLAG = "__ncalayerWebBridgeInstalled";
if (window.__ncalayerWebBridgeCleanup) {
  window.__ncalayerWebBridgeCleanup(); // cleanup при reload extension
}
```

## Bridge (Message Router)

**Файл:** `src/content/bridge.js` (98 строк, ISOLATED world)

```
Page → postMessage({type: "ncalayer-ext-request", id, payload})
  → Bridge → chrome.runtime.sendMessage({type: "ncalayer-api", payload})
  → Service Worker → response
  → Bridge → postMessage({type: "ncalayer-ext-response", id, payload})
  → Page
```

Обработка ошибок: если SW недоступен → возвращает `{code: "500", message: "Extension error"}`

## NCALayer API Router

**Файл:** `src/background/ncalayer-api.js` (343 строки)

### Module: `kz.gov.pki.knca.commonUtils`

Формат: массив аргументов, ответ `{code, responseObject}`

| Метод | Аргументы | Описание |
|-------|-----------|----------|
| `getActiveTokens()` | — | Список хранилищ |
| `getKeyInfo(storage)` | `["PKCS12"]` | Метаданные сертификата |
| `createCAdESFromBase64(storage, type, data, flag)` | `["PKCS12","SIGNATURE",b64,true]` | CMS подпись |
| `createCAdESFromBase64Hash(storage, type, hash)` | `["PKCS12","SIGNATURE",hashB64]` | CMS от хеша |
| `signXml(storage, type, xml, "", "")` | `["PKCS12","SIGNATURE",xml,"",""]` | XMLDSig |
| `signXmls(storage, type, xmls, "", "")` | Массив XML | Множественный XMLDSig |
| `changeLocale(lang)` | `["ru"]` | Fire-and-forget |

PEM обёртка: `-----BEGIN CMS-----\n...\n-----END CMS-----`

### Module: `kz.gov.pki.knca.basics`

Формат: именованные параметры, ответ `{status, body}`

```json
{
  "module": "kz.gov.pki.knca.basics",
  "method": "sign",
  "args": {
    "format": "cms|xml|raw",
    "data": "base64|xml|array",
    "signingParams": { "encapsulate": "true|false", "digested": "true|false" },
    "signerParams": { "extKeyUsageOids": ["1.3.6.1.5.5.7.3.4"] }
  }
}
```

Ответы:
- Успех: `{status: true, body: {result: "..."}}`
- Отмена: `{status: true, body: {}}` (пустой body)
- Ошибка: `{status: false, code: "...", message: "..."}`

Raw формат возвращает: `{signatures: [b64], certificate: "-----BEGIN CERTIFICATE-----..."}`

### Module: `kz.ncalayer.web.verify`

Метод `checkSign` — POST на `https://ezsigner.kz/checkSign` для верификации CMS.

### Module: `kz.gov.pki.ncalayerservices.accessory`

Возвращает мок-данные о бандлах NCALayer (версии, сервисы).

## WASM Bridge

**Файл:** `src/lib/wasm-bridge.js` (140 строк)

### Инициализация

```javascript
export async function initWasm() {
  const go = new globalThis.Go();
  const wasmURL = chrome.runtime.getURL("src/crypto.wasm");
  const result = await WebAssembly.instantiateStreaming(fetch(wasmURL), go.importObject);
  go.run(result.instance); // Go вызовет globalThis.wasmReady()
  await wasmReadyPromise;
}
```

### Функции

| Функция | Вход | Выход |
|---------|------|-------|
| `signCMS(p12B64, pwd, dataB64, detached)` | PKCS#12 + данные | Base64 CMS |
| `signRaw(p12B64, pwd, dataB64, digested, outputCert)` | PKCS#12 + данные | `{certificate, signature}` |
| `signXML(p12B64, pwd, xml)` | PKCS#12 + XML | Signed XML string |
| `signXMLWithEku(p12B64, pwd, xml, ekuOids)` | + EKU фильтр | Signed XML |
| `getKeyInfo(p12B64, pwd)` | PKCS#12 | JSON метаданные |
| `parsePKCS12(p12B64, pwd)` | PKCS#12 | JSON структура |
| `hashData(algorithm, dataB64)` | Алгоритм + данные | Base64 хеш |
| `buildTSARequest(cmsB64)` | CMS подпись | RFC 3161 запрос |
| `applyTSAResponse(cmsB64, tsaRespB64)` | CMS + TSA ответ | CAdES-T подпись |

Go WASM возвращает: `{error?, result?}` → `unwrapResult()` бросает Error если error.

### Поддерживаемые алгоритмы

- GOST R 34.10-2012 / 2015 (256-bit и 512-bit)
- RSA (fallback)
- GOST R 34.11-2012 (хеширование, внутренний)
- SHA-256 (WebCrypto API)

## Подтверждение подписания

### confirm-manager.js (155 строк)

```javascript
export async function requestSigningConfirmation(context) {
  const reqId = crypto.randomUUID();
  // Inject overlay scripts
  await chrome.scripting.executeScript({
    target: { tabId: context.tabId },
    files: ["src/lib/i18n.js", "src/lib/errors.js", "src/content/confirm-overlay.js"],
  });
  // Send message to overlay
  await chrome.tabs.sendMessage(context.tabId, {
    type: "show-confirm-overlay",
    reqId, context: { keys, domain, favicon, signingMethod, ... }
  });
  // Timeout: 5 minutes
  // Keepalive port prevents SW termination
}
```

### confirm-overlay.js (700+ строк, Shadow DOM)

7 экранов:
1. **view-select** — Выбор сертификата
2. **view-pin** — Ввод PIN (4 цифры)
3. **view-password** — Ввод пароля
4. **view-progress** — Спиннер подписания
5. **view-success** — Зелёная галочка
6. **view-error** — Красная ошибка + retry
7. **view-empty** — Нет сертификатов

Shadow DOM (`mode: "closed"`) — полная изоляция от стилей страницы.

### sign-utils.js (101 строка)

Auto-confirm flow:
```javascript
// Если ключ имеет autoConfirm + hasPassword + не требует PIN + не истёк TTL:
if (k.autoConfirm && k.hasPassword && !k.pinOnSign && k.autoConfirmUntil > Date.now()) {
  return { key: fullKey, password: fullKey.password }; // Без UI
}
```

## Keystore (IndexedDB)

**Файл:** `src/lib/keystore.js` (499 строк)

### Схема (v2)

```javascript
{
  id: UUID,
  name: string,
  p12Enc: { ct: base64, iv: base64 },     // AES-256-GCM encrypted PKCS#12
  passwordEnc: { ct: base64, iv: base64 }, // Encrypted password
  certInfo: {
    keyType: "ECGOST3410-2015-256",
    subjectCn: "Иванов Иван",
    issuerCn: "NCA National Certificate Center",
    serialNumber: "...",
    notBefore: "2023-01-01T00:00:00Z",
    notAfter: "2025-12-31T23:59:59Z",
    iin: "...", bin: "..."
  },
  signPinHash: hex | null,    // PBKDF2 хеш PIN
  signPinSalt: hex | null,
  pinOnSign: boolean,
  autoConfirm: boolean,
  autoConfirmUntil: number | null,
  passwordTTL: number | null,
  passwordSavedAt: number | null,
  addedAt: number,
  order: number,
}
```

### Миграция v1 → v2

v1 хранил p12Base64 и password открытым текстом. v2 шифрует AES-256-GCM.

### Ключевые функции

- `addKey(name, p12Bytes, password, certInfo, savePassword)`
- `getKey(id)` — расшифровывает p12 + проверяет TTL пароля
- `listKeys()` — только метаданные (без p12/password)
- `findKeyBySerial(serial, keyId)` — дедупликация при импорте
- `updatePassword/updatePinOnSign/updateSignPin/enableAutoConfirm`

## Шифрование

**Файл:** `src/lib/crypto-utils.js` (162 строки)

### AES-256-GCM (данные at rest)

```javascript
// Генерация/получение ключа
export async function getEncryptionKey() {
  const stored = await chrome.storage.local.get("encKeyRaw");
  if (stored.encKeyRaw) return importKey(stored.encKeyRaw);
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt","decrypt"]);
  // Сохраняем raw в chrome.storage.local
}

// Шифрование
export async function encrypt(plaintext, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  return { ct: base64(ciphertext), iv: base64(iv) };
}
```

### PBKDF2 (PIN хеширование)

```javascript
// 100,000 итераций, 16-byte salt, SHA-256
export async function hashPinSecure(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    keyMaterial, 256
  );
  return { hash: hex(derived), salt: hex(salt) };
}
```

## KNP Module (SONO)

**Файл:** `src/background/modules/knp/knp.js` (162 строки)

Модуль: `kz.inessoft.kgd.knp.ncalayer.KNPModuleService`

| Команда | Описание |
|---------|----------|
| `info` | `{type:"personal", version:"1.1.0", status:"READY"}` |
| `getStorageType` | Список хранилищ (PKCS12, KAZTOKEN, KZIDCARD...) |
| `getCertificates` | Сертификаты из p12 файла |
| `signDocument` | XML подпись с конвертацией форматов |

## NURSign Module

**Файл:** `src/background/modules/nursign/nursign.js` (207 строк)

Модуль: `NURSign` (v5.1.2, реверс-инжиниринг `kz.ecc.NurSignBundle`)

| Тип | Описание |
|-----|----------|
| `version` | Версия модуля |
| `text` | CMS подпись текста + CAdES-T timestamp |
| `xml` | Enveloped XMLDSig |
| `binary` | CMS подпись бинарных данных + MD5/SHA-256 хеши |
| `multixml` | Множественный XMLDSig |
| `multitext` | Множественная CMS подпись |

### TSA (CAdES-T)

```javascript
const DEFAULT_TSA_URL = "http://tsp.pki.gov.kz/tsp/";
// POST application/timestamp-query → apply via WASM applyTSAResponse()
```

## QR Code Generation

**Файл:** `src/lib/qr-generate.js` (401 строка)

Встроенная генерация QR без внешних зависимостей:
- Byte mode encoding
- Версии 1-40, автодетекция
- Reed-Solomon ECC
- Mask 0: (row+col) % 2 == 0
- Экспорт: `generateQRDataURL(text, size)` → data:image/png;base64

## Relay Client (QR Signing)

**Файл:** `src/lib/relay-client.js` (95 строк)

```javascript
const RELAY_BASE = "http://localhost:8080";
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_TIME_MS = 5 * 60 * 1000;

export async function createSession(signRequest) → { id, token, expiresAt }
export async function pollSession(sessionId, token, signal) → session
export function buildQRPayload(sessionId, token) → URL (token in fragment)
```

## I18n

**Файл:** `src/lib/i18n.js` (400+ строк)

3 языка: ru (default), en, kz

```javascript
const { t, setLang, getLang, applyTranslations } = globalThis.__i18n;
t("confirm_signing_request") // "Запрос на подписание"
```

## Analytics

**Файл:** `src/lib/analytics.js` (101 строка)

Amplitude API V2, анонимизирован (`device_id: "anon"`, `ip: "0.0.0.0"`).

| Event | Когда |
|-------|-------|
| `install` | Установка |
| `heartbeat` | Раз в 24ч |
| `sign` | После подписи (method, keyType) |
| `error` | При ошибке |

## Константы

| Константа | Значение |
|-----------|----------|
| `NCALAYER_HOSTS` | `["127.0.0.1", "localhost"]` |
| `NCALAYER_PORT` | `13579` |
| `CONFIRM_TIMEOUT` | 5 минут |
| `PBKDF2_ITERATIONS` | 100,000 |
| `SALT_BYTES` | 16 |
| `TSA_URL` | `http://tsp.pki.gov.kz/tsp/` |
| `ezsigner` | `https://ezsigner.kz/checkSign` |

## Безопасность

- **At-Rest:** AES-256-GCM для PKCS#12 и паролей в IndexedDB
- **PIN:** PBKDF2-SHA-256 (100k итераций) — верифицируется в Service Worker
- **Private Keys:** никогда не покидают Go WASM runtime
- **Shadow DOM:** closed mode для UI изоляции
- **Логирование:** REDACTED_KEYS для p12, password, pin, pinHash, pinSalt
- **CSP:** `script-src 'self' 'wasm-unsafe-eval'`

## Build

```bash
# Go WASM
GOOS=js GOARCH=wasm go build -o src/crypto.wasm .

# Patch wasm_exec.js для ES modules
sed -i '' 's/^(() => {$//' src/lib/wasm_exec.js
sed -i '' 's/^})();$//' src/lib/wasm_exec.js
```

## Файловая структура

```
src/
├── crypto.wasm                    # Go WASM (7.2MB)
├── background/
│   ├── service-worker.js          # Главный SW (251 строка)
│   ├── ncalayer-api.js            # API router (343)
│   ├── sign-utils.js              # Key selection (101)
│   ├── confirm-manager.js         # Overlay orchestration (155)
│   ├── custom-modules.js          # Module registry (69)
│   └── modules/
│       ├── knp/knp.js             # KNP/SONO (162)
│       └── nursign/nursign.js     # NURSign (207)
├── content/
│   ├── ws-intercept.js            # WebSocket monkey-patch (192)
│   ├── bridge.js                  # Message relay (98)
│   ├── confirm-overlay.js         # Shadow DOM UI (700+)
│   └── confirm-overlay.css        # Overlay styles
├── lib/
│   ├── wasm-bridge.js             # Go WASM bridge (140)
│   ├── wasm_exec.js               # Go runtime shim
│   ├── keystore.js                # IndexedDB store (499)
│   ├── crypto-utils.js            # AES/PBKDF2 (162)
│   ├── qr-generate.js             # QR code gen (401)
│   ├── relay-client.js            # QR signing relay (95)
│   ├── i18n.js                    # Translations (400+)
│   ├── errors.js                  # Error mapping (24)
│   └── analytics.js               # Amplitude (101)
├── popup/
│   ├── popup.html                 # UI layout (300+)
│   ├── popup.js                   # UI logic (1000+)
│   └── popup.css                  # Styles (535)
└── legal/
    ├── legal.js                   # Terms consent (89)
    └── policy.html                # Privacy policy
```
