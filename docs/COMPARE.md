# KazEDS vs Doodocs Sign — Сравнение

## Общая таблица

| Функционал | Doodocs Sign v1.4.0 | KazEDS v2.0.0 | Статус |
|-----------|---------------------|---------------|--------|
| **WebSocket перехват** | FakeWebSocket с heartbeat, version handshake, cleanup при reload | eds.js — работает, но в виджете, не в extension | Extension content-script просто грузит eds.js |
| **WASM крипто** | Go WASM (7.2MB) — ГОСТ + RSA, приватный ключ внутри WASM | Есть в web-app, нет в extension | Extension не подписывает — делегирует в relay/app |
| **Keystore (IndexedDB)** | Зашифрованное хранение p12, AES-256-GCM, PBKDF2 PIN, TTL паролей, миграция v1→v2 | Нет | Ключи только в sessionStorage web-app |
| **Confirmation overlay** | Shadow DOM (closed), 7 экранов, выбор сертификата, PIN, auto-confirm с TTL | Нет — подписание в отдельной вкладке (app) | Принципиально другой подход |
| **Подпись в extension** | Всё внутри — p12 → WASM → подпись → ответ за 1 секунду | Extension → Relay → QR → App → Relay → polling | 5+ секунд, зависит от телефона |
| **NCALayer модули** | commonUtils, basics, KNP, NURSign, accessory, verify | basics.sign только | Нет legacy commonUtils |
| **PEM обёртка** | `-----BEGIN CMS-----` для CMS подписей | Нет — raw base64 | Некоторые сайты ожидают PEM |
| **CAdES-T (timestamp)** | Через `tsp.pki.gov.kz` — buildTSARequest → applyTSAResponse | Нет | Критично для юридической силы |
| **XMLDSig** | Enveloped подпись с EKU constraints | Нет | eGov использует XML |
| **Верификация** | POST на ezsigner.kz | verify.sh (openssl, оффлайн) | Разные подходы |
| **i18n** | ru/en/kz с полным словарём | Только ru | Несложно добавить |
| **Analytics** | Amplitude (анонимно) | Нет | Не критично |
| **Auto-confirm** | TTL per-key, skip overlay для доверенных | Нет | UX improvement |
| **Keepalive port** | Не даёт SW умереть во время подписания | Нет — SW минимальный | Нужно если подпись в SW |
| **Дедупликация ключей** | По serialNumber + keyId | Нет | Нужно при импорте |
| **eGov QR протокол** | Нет | Да — mobileSign: формат, API №1 + №2 | Уникальная фича KazEDS |
| **Мобильное подписание** | Нет — только десктоп | Да — QR → PWA на телефоне | Уникальная фича KazEDS |
| **Dual signing (ECDSA + ГОСТ)** | Только ГОСТ/RSA через p12 | Оба: ECDSA on-the-fly + ГОСТ через p12 | Уникальная фича KazEDS |

## Топ-5 критических недостач KazEDS

### 1. Keystore — зашифрованное хранение ключей

**Doodocs:** IndexedDB с AES-256-GCM шифрованием. p12 файл загружается один раз, шифруется, хранится. Пароль кешируется с TTL. PIN для дополнительной защиты.

**KazEDS:** Ключи в sessionStorage (теряются при закрытии). Пользователь загружает p12 каждый раз.

**Что нужно:** Реализовать `keystore.ts` с IndexedDB + AES-256-GCM. Переиспользовать паттерн из `crypto-utils.js`.

### 2. Подпись внутри Extension (без Relay)

**Doodocs:** p12 → WASM → подпись → ответ. Всё за 1 секунду, без сети.

**KazEDS:** Extension → Relay → QR → App → телефон → Relay → polling. 5-30 секунд, зависит от сети и телефона.

**Что нужно:** Загрузить crypto.wasm в Service Worker extension. При наличии сохранённого p12 — подписывать напрямую, без relay. Relay/QR — только как fallback для мобильного подписания.

### 3. commonUtils модуль (Legacy NCALayer API)

**Doodocs:** Полная поддержка `kz.gov.pki.knca.commonUtils` — `createCAdESFromBase64`, `signXml`, `getKeyInfo` и т.д.

**KazEDS:** Только `kz.gov.pki.knca.basics.sign`. Большинство казахстанских сайтов (eGov, банки, налоговая) используют legacy commonUtils API.

**Что нужно:** Добавить обработку commonUtils методов в eds.js WebSocket handler. Маппить на те же signing функции.

### 4. CAdES-T (метки времени TSA)

**Doodocs:** RFC 3161 timestamp через `tsp.pki.gov.kz`. CAdES-BES → CAdES-T. Юридически значимая подпись.

**KazEDS:** Нет TSA. Подпись без метки времени — ограниченная юридическая сила.

**Что нужно:** После подписания CMS → `buildTSARequest()` → POST на TSA → `applyTSAResponse()`. Всё через WASM.

### 5. XMLDSig подписание

**Doodocs:** Enveloped XML подпись с поддержкой EKU constraints. Необходимо для eGov QR протокола.

**KazEDS:** eGov роуты созданы, но Web App не умеет подписывать XML.

**Что нужно:** Использовать `signXML()` из WASM bridge. В Web App при получении eGov документов с `signMethod: "XML"` — подписывать через WASM.

## Уникальные преимущества KazEDS

### 1. Мобильное подписание через QR
Doodocs работает только на десктопе. KazEDS позволяет подписывать с телефона — QR → PWA → подпись. Критично для сценариев где десктоп не доступен.

### 2. eGov QR протокол
Совместимость с `mobileSign:` форматом eGov Mobile. API №1 + API №2 реализованы в Relay.

### 3. Widget CDN (eds.js)
Одна строка `<script>` — и сайт получает NCALayer совместимость без extension. Doodocs требует установку extension.

### 4. Dual signing
ECDSA P-256 (без p12, моментально) + ГОСТ (с p12). Пользователь выбирает.

## Roadmap приоритетов

```
P0 (критично):
  [ ] Keystore с шифрованием в Extension
  [ ] Подпись в Extension через WASM (без relay)
  [ ] commonUtils модуль (createCAdESFromBase64, signXml)

P1 (важно):
  [ ] CAdES-T timestamps (tsp.pki.gov.kz)
  [ ] XMLDSig подписание в Web App
  [ ] PEM обёртка для CMS подписей
  [ ] Confirmation overlay (Shadow DOM)

P2 (улучшения):
  [ ] i18n (en, kz)
  [ ] Auto-confirm с TTL
  [ ] Дедупликация ключей при импорте
  [ ] Sign log (история подписаний)
  [ ] Keepalive port для SW
```
