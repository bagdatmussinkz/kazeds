# Changelog

Формат вдохновлён [Keep a Changelog](https://keepachangelog.com/ru/).
Версии указаны по компонентам: Extension (chrome), Web App (PWA), Relay/Shared.

## [Unreleased] — ветка `feature/aitu-miniapp`

### Extension 2.0.10 · Web App 2.0.9

**Added**
- Тоггл `trace` и ссылка «лог» прямо в QR-оверлее расширения — включение
  полного трейсинга и просмотр trace-лога сессии в один клик.
- В PWA на экране подписания: тоггл `trace` + ссылка «Трейс-лог сессии»
  (под ID сессии).

### Extension 2.0.9

**Fixed**
- **kazpatent.kz**: `getKeyInfo` возвращал только `certificate`, сайты
  (`nuc_rk.js`) падали на `.split()` от `undefined`. Добавлен собственный
  X.509 DER-парсер (`src/lib/x509.js`, без зависимостей): теперь ответ
  содержит все поля реального NCALayer — `subjectDn`, `issuerDn`,
  `serialNumber`, `certNotBefore/After` (epoch-ms), `keyId`,
  `authorityKeyIdentifier`, `pem`, `algorithm` (`ECGOST34310`).

### Extension 2.0.8 · Web App 2.0.8

**Fixed**
- **Телефон «застревал» на главном экране после скана QR** — три причины:
  1. Deep link строился как `.../app/#/sign` — слеш заставлял каждый скан
     проходить через 308-редирект, который мобильные браузеры кешируют
     навсегда (наблюдался `ERR_TOO_MANY_REDIRECTS`). Теперь `.../app#/sign`.
  2. `pnpm build` поверх работающего dev-сервера ломал `.next` — JS-чанки
     отдавали 500, React не гидратировался, hash-роутер был мёртв.
     Production-сборка теперь пишет в отдельный `.next-build`.
  3. `#` в URL был оправдан — parseHash работает корректно.

### Extension 2.0.7

**Added**
- **Always-on error tracing**: ошибки уровня warn/error уходят в relay
  без включения флага — провальные подписания на боевых сайтах фиксируются
  автоматически (SW: упавшие NCALayer-ответы с полными payload;
  page-context: ошибочные ответы прямо со страницы; PWA: error-события).

### Relay 0.3.x · Shared 0.3.0 · Extension 2.0.6 · Web App 2.0.6–2.0.7

**Added**
- **Распределённый трейсинг**: `POST/GET/DELETE /v1/trace` — кольцевой
  буфер (2000 событий, in-memory) с полными payload со всех компонентов.
  Relay всегда трейсит lifecycle сессий; PWA — `localStorage.kazeds_trace`
  или `trace=true` в URL; расширение — `chrome.storage {kazeds_trace}`.
- **Настоящий CAdES-T**: врапперы `buildTSARequest`/`applyTSAResponse`
  (экспорты были в WASM, отсутствовали в TS-bridge), TSA-прокси
  `/relay/tsa/{prod,test}` (браузер не может в TSA напрямую — CORS),
  метка времени RFC 3161 от боевого TSA НУЦ РК встраивается в CMS.
- **Chain-валидация в Java verifier**: Kalkan JCE provider (BC не знает
  национальную кривую KZ `1.2.398.3.10.1.1.2.2.1`), доверенные корневые
  сертификаты в образе, проход цепочки лист → НУЦ → корень, поля
  `chain`/`chainDetail` в ответах. Криптопроверка KZ GOST CMS (включая
  detached через `?data_b64=`) вместо «принято на веру».
- Тестовые фикстуры `test-fixtures/nuc-test-certs/`: 5 тестовых .p12 НУЦ
  (физлицо valid+revoked, юрлицо ×3), CA-цепочка, CRL (пароль `Qwerty12`).

**Fixed**
- **Таймауты**: TTL сессии 5 мин → 2 мин; `scanned`-сессии раньше не
  истекали вообще; счётчик в оверлее стал deadline-based (не дрейфует в
  фоновых вкладках) и ресинкается с серверным `expires_in` каждый полл;
  по нулю — «Время истекло» и автозакрытие.
- Полная сборка `pnpm build` впервые зелёная (web-app/relay/demo-site).

### Консолидация доменов · Extension 2.0.5 · Web App 2.0.5–2.0.6

**Changed**
- **Все сервисы на одном хосте `sign.aitu.uz`**: `/` лендинг, `/app/` PWA
  (Next.js basePath), `/relay/` API, `/relay/verify/` Java-верифаер,
  `/ext/` CDN виджета. Демо-сайт переехал на `demo.aitu.uz`.
  Старые хосты (`app-sign`, `relay-sign`, `extension-sign`, `miniapp-sign`,
  `demo-sign`) выведены из эксплуатации.

**Fixed**
- **GOST .p12 не сохранялся**: `sessionStorage` → `localStorage` (PWA и
  miniapp); пикер на экране подписания теперь запрашивает пароль и
  персистит ключ.
- **Экран «залипал» на success**: состояние сбрасывается при новой сессии,
  добавлена кнопка «Готово»; miniapp чистит модалку и URL при закрытии.
- WASM-путь `/app/wasm/crypto.wasm` (соответствие basePath).
