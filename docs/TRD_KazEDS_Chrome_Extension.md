# TRD: KazEDS Chrome Extension

## 1. Обзор проекта

**Название:** KazEDS Chrome Extension
**Тип:** Расширение для Google Chrome (Manifest V3)
**Версия:** MVP 1.0
**Дата:** 31 марта 2026

Chrome Extension заменяет NCALayer, полностью эмулируя его WebSocket API на `wss://127.0.0.1:13579`. Любой сайт, работающий с NCALayer через стандартный `ncalayer-js-client`, будет работать с KazEDS без изменений кода. Вместо локальных ключей — QR-код для подписания через iOS App.

## 2. Архитектура

```
[Любой сайт] ──WebSocket──→ wss://127.0.0.1:13579  (Chrome Extension)
                                    │
                                    ├─ Эмулирует NCALayer JSON-RPC 2.0
                                    ├─ При запросе подписания → создаёт сессию на Cloud Relay
                                    ├─ Генерирует QR-код → показывает overlay
                                    │
                              [Cloud Relay]  ←── callback ──── [iOS App]
                                    │
                                    ├─ Polling результата
                                    │
                              Extension получает подпись → отвечает сайту через WebSocket
```

**Ключевой принцип:** Сайт НЕ знает что за NCALayer стоит KazEDS. Протокол 1:1 совместим.

## 3. Технологический стек

| Компонент | Технология |
|-----------|-----------|
| Manifest | V3 (Chrome 116+) |
| Service Worker | JavaScript (ES2022+) |
| Content Scripts | JavaScript, DOM injection |
| Overlay UI | HTML + CSS + Vanilla JS |
| QR-генерация | qrcode.js (встроена в расширение) |
| WebSocket сервер | Нативный API через Content Script + page-level script |
| Связь с Cloud Relay | fetch API + polling |
| Хранение настроек | chrome.storage.local |

## 4. NCALayer WebSocket API — полная эмуляция

### 4.1. Подключение

NCALayer слушает WebSocket на `wss://127.0.0.1:13579`. Chrome Extension эмулирует это поведение:

**Важно:** Chrome Extension не может напрямую слушать TCP-порт. Реализация через один из подходов:
- **Вариант A (рекомендуемый для MVP):** Нативное приложение-компаньон (Native Messaging Host) — маленький процесс, слушающий порт 13579 и проксирующий WebSocket-сообщения в расширение
- **Вариант B:** Service Worker перехватывает fetch/WebSocket через content script injection на всех страницах, подменяя `WebSocket` конструктор для адреса `127.0.0.1:13579`

### 4.2. Протокол: JSON-RPC 2.0

Все сообщения следуют формату JSON-RPC 2.0:

**Запрос (от сайта):**
```json
{
  "jsonrpc": "2.0",
  "method": "browseKeyStore",
  "params": {
    "storageName": "PKCS12",
    "fileExtension": "P12",
    "currentDirectory": ""
  },
  "id": 1
}
```

**Ответ (от Extension):**
```json
{
  "jsonrpc": "2.0",
  "result": "path/to/keystore.p12",
  "id": 1
}
```

**Ошибка:**
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32000,
    "message": "Операция отменена пользователем"
  },
  "id": 1
}
```

### 4.3. Поддерживаемые методы NCALayer

#### Модуль kz.gov.pki.knca.commonUtils (legacy)

| Метод | Поведение KazEDS | Приоритет |
|-------|-----------------|-----------|
| `browseKeyStore(storageName, fileExtension, currentDirectory)` | Возвращает виртуальный путь «KazEDS Mobile Key» | Обязательно |
| `getKeys(storageName, storagePath, password, type)` | Показывает QR → после сканирования возвращает публичный сертификат из iOS App | Обязательно |
| `signPlainData(storageName, storagePath, keyAlias, password, data)` | Показывает QR → подписание в iOS App → возвращает base64 подпись | Обязательно |
| `createCMSSignature(storageName, storagePath, keyAlias, password, data, flag)` | Показывает QR → CMS подпись через iOS App | Обязательно |
| `createCMSSignatureFromFile(storageName, storagePath, keyAlias, password, filePath, flag)` | Не поддерживается в MVP (возвращает ошибку) | Нет |
| `signXml(storageName, storagePath, keyAlias, password, xmlData)` | Показывает QR → XML подпись через iOS App | Желательно |
| `verifyPlainData(storageName, storagePath, keyAlias, password, data, signature)` | Верификация локально (публичным ключом из сертификата) | Желательно |
| `getSubjectDN(storageName, storagePath, keyAlias, password)` | Возвращает subject DN из сохранённого сертификата | Обязательно |
| `getNotBefore(...)` / `getNotAfter(...)` | Возвращает даты из сохранённого сертификата | Обязательно |
| `setLocale(locale)` | Сохраняет локаль (ru/kk/en) | Обязательно |

#### Модуль kz.gov.pki.knca.basics (новый)

| Метод | Поведение KazEDS | Приоритет |
|-------|-----------------|-----------|
| `basicsSign(storageName, data, keyType, isDetached, signingParams)` | Показывает QR → подписание → CMS | Обязательно |
| `basicsAuthenticate(storageName)` | Показывает QR → аутентификация → возвращает подпись challenge | Обязательно |

### 4.4. Маппинг NCALayer → KazEDS

Когда сайт вызывает метод подписания, Extension выполняет:

```
NCALayer метод             →  KazEDS действие
─────────────────────────────────────────────────────────
browseKeyStore()           →  return "KazEDS://mobile-key"
getKeys()                  →  Показать QR для привязки, запомнить сертификат
signPlainData(data)        →  POST /v1/sessions на Cloud Relay
                              → Показать QR overlay
                              → Polling /v1/sessions/{id}/status
                              → Вернуть подпись как JSON-RPC result
createCMSSignature(data)   →  То же + обернуть в CMS/PKCS#7
basicsAuthenticate()       →  POST /v1/sessions (operation: "auth")
                              → QR → подпись challenge → вернуть результат
```

## 5. Функциональные требования

### 5.1. WebSocket-сервер (через Native Messaging Host)

| ID | Требование | Приоритет |
|----|-----------|-----------|
| EXT-001 | Native Messaging Host: процесс, слушающий `wss://127.0.0.1:13579` | Обязательно |
| EXT-002 | Приём JSON-RPC 2.0 запросов от любого сайта | Обязательно |
| EXT-003 | Маршрутизация запросов: метод → обработчик в Extension | Обязательно |
| EXT-004 | Отправка JSON-RPC 2.0 ответов обратно сайту | Обязательно |
| EXT-005 | Поддержка нескольких одновременных WebSocket-подключений | Обязательно |
| EXT-006 | Автозапуск Native Host при установке Extension | Желательно |

### 5.2. QR-код и взаимодействие с Cloud Relay

| ID | Требование | Приоритет |
|----|-----------|-----------|
| EXT-010 | POST `/v1/sessions` на Cloud Relay при запросе подписания | Обязательно |
| EXT-011 | Генерация QR-кода из session payload | Обязательно |
| EXT-012 | Overlay поверх активной страницы с QR-кодом | Обязательно |
| EXT-013 | Таймер 5 мин с автообновлением QR | Обязательно |
| EXT-014 | Polling `GET /v1/sessions/{id}/status` каждые 2 сек | Обязательно |
| EXT-015 | При `completed` — закрыть overlay, вернуть результат как JSON-RPC response | Обязательно |
| EXT-016 | При отмене — DELETE сессию, вернуть JSON-RPC error | Обязательно |

### 5.3. Кэширование сертификата

| ID | Требование | Приоритет |
|----|-----------|-----------|
| EXT-020 | После первого успешного подписания — сохранить публичный сертификат в chrome.storage.local | Обязательно |
| EXT-021 | `getSubjectDN`, `getNotBefore`, `getNotAfter` — отвечать из кэша без QR | Обязательно |
| EXT-022 | `browseKeyStore` — возвращать виртуальный путь без QR | Обязательно |
| EXT-023 | Кнопка «Забыть сертификат» в popup расширения | Обязательно |

## 6. Протокол взаимодействия (полный цикл)

### Пример: сайт вызывает createCMSSignature

**Шаг 1.** Сайт подключается к `wss://127.0.0.1:13579` (думает что это NCALayer)

**Шаг 2.** Сайт отправляет:
```json
{
  "jsonrpc": "2.0",
  "method": "createCMSSignature",
  "params": {
    "storageName": "PKCS12",
    "storagePath": "KazEDS://mobile-key",
    "keyAlias": "SIGNING",
    "password": "",
    "data": "SGVsbG8gV29ybGQ=",
    "flag": true
  },
  "id": 42
}
```

**Шаг 3.** Extension создаёт сессию на Cloud Relay:
```
POST https://relay.kazeds.kz/v1/sessions
{
  "origin": "https://demo.kazeds.kz",
  "operation": "sign",
  "data": "SGVsbG8gV29ybGQ=",
  "reason": "CMS подписание"
}
→ { "session_id": "uuid", "challenge": "...", "qr_payload": {...}, "expires_at": "..." }
```

**Шаг 4.** Extension показывает QR overlay, начинает polling.

**Шаг 5.** iOS App сканирует QR → подписывает → отправляет на Cloud Relay.

**Шаг 6.** Polling возвращает `completed` с подписью.

**Шаг 7.** Extension отвечает сайту:
```json
{
  "jsonrpc": "2.0",
  "result": "MIIGOgYJKo...base64-CMS-signature...",
  "id": 42
}
```

Сайт получил CMS-подпись, как если бы работал с настоящим NCALayer.

## 7. Native Messaging Host

Маленькое приложение (Node.js или Go), устанавливаемое вместе с Extension:

```
kazeds-native-host/
├── host.js (или host.exe)      # WebSocket сервер на порту 13579
├── manifest.json                # Native Messaging Host manifest
└── install.sh / install.bat     # Скрипт регистрации в Chrome
```

### Native Host manifest (Chrome)
```json
{
  "name": "kz.kazeds.native_host",
  "description": "KazEDS WebSocket Bridge",
  "path": "/path/to/host.js",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://EXTENSION_ID_HERE/"
  ]
}
```

### Логика host.js
```
1. Запустить WebSocket сервер на wss://127.0.0.1:13579
   - Использовать самоподписанный сертификат (генерируется при установке)
2. При получении JSON-RPC сообщения от сайта:
   → Переслать в Chrome Extension через Native Messaging (stdio)
3. При получении ответа от Extension:
   → Переслать обратно сайту через WebSocket
```

## 8. Структура проекта

```
kazeds-extension/
├── manifest.json
├── src/
│   ├── background/
│   │   ├── service-worker.js         # Основная логика
│   │   ├── ncalayer-handler.js       # Обработчик NCALayer методов
│   │   ├── session-manager.js        # Создание сессий, polling
│   │   └── native-messaging.js       # Мост с Native Host
│   ├── content/
│   │   ├── content-script.js         # Инжекция overlay
│   │   └── qr-overlay.js            # QR overlay компонент
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.js                  # Статус, настройки, кэш сертификата
│   │   └── popup.css
│   ├── lib/
│   │   └── qrcode.min.js
│   └── shared/
│       ├── relay-client.js           # HTTP-клиент для Cloud Relay
│       └── constants.js
├── native-host/
│   ├── host.js                       # WebSocket сервер (Node.js)
│   ├── cert-gen.js                   # Генератор самоподписанного TLS-сертификата
│   ├── native-manifest.json
│   └── install.sh / install.bat
├── icons/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
└── _locales/
    ├── ru/messages.json
    └── kk/messages.json
```

## 9. manifest.json

```json
{
  "manifest_version": 3,
  "name": "KazEDS",
  "version": "1.0.0",
  "description": "Замена NCALayer — ЭЦП через мобильное приложение",
  "permissions": [
    "storage",
    "activeTab",
    "nativeMessaging"
  ],
  "host_permissions": [
    "https://relay.kazeds.kz/*"
  ],
  "background": {
    "service_worker": "src/background/service-worker.js"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["src/content/content-script.js"],
      "run_at": "document_idle"
    }
  ],
  "web_accessible_resources": [
    {
      "resources": ["src/content/qr-overlay.js", "src/content/qr-overlay.css"],
      "matches": ["<all_urls>"]
    }
  ],
  "action": {
    "default_popup": "src/popup/popup.html",
    "default_icon": { "16": "icons/icon-16.png", "48": "icons/icon-48.png", "128": "icons/icon-128.png" }
  }
}
```

## 10. UI Overlay

### QR Overlay (рендерится Content Script)
- Полупрозрачный backdrop
- Модальный блок: QR (256x256), текст «Отсканируйте в KazEDS»
- Тип операции: «Подписание» или «Аутентификация»
- Origin запроса: `demo.kazeds.kz запрашивает подпись`
- Таймер обратного отсчёта (5 мин)
- Кнопка «Отмена»
- Состояния: ожидание QR → отсканировано (scanned) → подписано → готово

### Popup расширения
- Статус: «Готов» / «Ожидание подписания»
- Привязанный сертификат (CN, email, срок)
- Кнопка «Забыть сертификат»
- Настройки: URL Cloud Relay (для dev-режима)
- Ссылка на установку iOS App

## 11. Обработка ошибок

| Ситуация | JSON-RPC ответ |
|----------|----------------|
| Cloud Relay недоступен | `{ "error": { "code": -32001, "message": "Сервис KazEDS временно недоступен" } }` |
| QR истёк | Автоматически создать новую сессию, показать новый QR |
| Пользователь отклонил в iOS App | `{ "error": { "code": -32000, "message": "Операция отменена пользователем" } }` |
| Пользователь нажал «Отмена» в overlay | `{ "error": { "code": -32000, "message": "Операция отменена пользователем" } }` |
| Неподдерживаемый метод | `{ "error": { "code": -32601, "message": "Method not found" } }` |
| Native Host не запущен | Popup: «Установите компонент KazEDS Native Host» |

## 12. Критерии приёмки MVP

1. Сайт, использующий `ncalayer-js-client` от sigex-kz, подключается к `wss://127.0.0.1:13579` и успешно работает
2. `browseKeyStore()` возвращает виртуальный путь без ошибок
3. `createCMSSignature()` показывает QR, после сканирования в iOS App возвращает валидную CMS-подпись
4. `basicsAuthenticate()` работает через тот же QR-механизм
5. `getSubjectDN()` возвращает данные из кэшированного сертификата
6. Ошибки возвращаются в стандартном формате JSON-RPC 2.0
7. Native Host устанавливается и запускается на Windows и macOS
