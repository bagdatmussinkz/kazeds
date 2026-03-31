# TRD: KazEDS Web App (Mobile Signer)

## 1. Обзор проекта

**Название:** KazEDS Web App
**Тип:** Progressive Web App (PWA) — мобильное веб-приложение
**Версия:** MVP 1.0
**Дата:** 31 марта 2026
**Фаза:** MVP (Phase 1). Заменяет iOS App для быстрого запуска. iOS App — Phase 2.

KazEDS Web App — PWA для хранения ключей ЭЦП и подписания через QR-код. Открывается в мобильном браузере, работает без установки из App Store. Функционально идентична iOS App — сканирует QR, подписывает, отправляет результат на Cloud Relay.

## 2. Почему Web App вместо iOS для MVP

| Критерий | iOS App | Web App (PWA) |
|----------|---------|---------------|
| Время разработки | 4-6 недель | 1-2 недели |
| Публикация | App Store Review (1-7 дней) | Деплой на Vercel за минуты |
| Установка | Скачать из App Store | Открыть URL в браузере |
| Платформа | Только iOS | iOS + Android + Desktop |
| Камера (QR) | AVFoundation | Web API (navigator.mediaDevices) |
| Криптография | Security.framework | Web Crypto API + OpenSSL (WASM) |
| Хранение ключей | iOS Keychain | IndexedDB + шифрование |
| Биометрия | Face ID / Touch ID | Нет (PIN-код вместо) |

**Компромиссы MVP:** Нет аппаратной защиты ключей (Keychain/Secure Enclave), нет биометрии. Приватный ключ хранится в IndexedDB, зашифрованный паролем пользователя. Для MVP это допустимо.

## 3. Роль в экосистеме KazEDS

```
[Демо-сайт] ──NCALayer API──→ [Chrome Extension] ──→ [Cloud Relay]
                                показывает QR            │
                                                         │ создаёт сессию
                                                         │
[Web App на телефоне]                                    │
   │                                                     │
   ├─ Открывает камеру                                   │
   ├─ Сканирует QR                                       │
   ├─ Подписывает данные (Web Crypto API)                │
   └─ POST /v1/sessions/{id}/complete ──────────────────→│
                                                         │
                              [Chrome Extension] ←── polling ──→ [Cloud Relay]
                                    │
                                    └──→ возвращает подпись сайту
```

Web App полностью заменяет iOS App в цепочке. Протокол тот же: QR → подпись → Cloud Relay.

## 4. Технологический стек

| Компонент | Технология |
|-----------|-----------|
| Фреймворк | Next.js 14+ (App Router) или Vite + React |
| Язык | TypeScript |
| Стили | Tailwind CSS |
| UI | shadcn/ui + мобильная адаптация |
| QR-сканер | html5-qrcode (npm) или @zxing/browser |
| Криптография | Web Crypto API (RSA/ECDSA) + pkijs (X.509 сертификаты) |
| Хранение ключей | IndexedDB (через idb) + AES-GCM шифрование |
| PWA | next-pwa или vite-plugin-pwa (service worker, manifest) |
| HTTP | fetch API |
| Развёртывание | Vercel / Netlify |

## 5. Функциональные требования

### 5.1. Генерация и хранение ключей

| ID | Требование | Приоритет |
|----|-----------|-----------|
| PWA-001 | Генерация пары ключей RSA-2048 или ECDSA P-256 через Web Crypto API | Обязательно |
| PWA-002 | Создание самоподписанного X.509 сертификата через pkijs | Обязательно |
| PWA-003 | Шифрование приватного ключа паролем пользователя (AES-256-GCM + PBKDF2) | Обязательно |
| PWA-004 | Хранение зашифрованного ключа в IndexedDB | Обязательно |
| PWA-005 | Просмотр списка сертификатов (subject, дата, срок) | Обязательно |
| PWA-006 | Удаление сертификата с подтверждением | Обязательно |
| PWA-007 | Первый запуск: установка PIN/пароля для защиты ключей | Обязательно |

### 5.2. Сканирование QR и подписание

| ID | Требование | Приоритет |
|----|-----------|-----------|
| PWA-010 | Доступ к камере через `navigator.mediaDevices.getUserMedia()` | Обязательно |
| PWA-011 | Сканирование QR-кода в реальном времени | Обязательно |
| PWA-012 | Парсинг JSON из QR: version, session_id, challenge, origin, operation, callback_url, expires_at | Обязательно |
| PWA-013 | Экран подтверждения: «{origin} запрашивает {operation}» | Обязательно |
| PWA-014 | Выбор сертификата (если несколько) | Обязательно |
| PWA-015 | Ввод PIN/пароля перед подписанием | Обязательно |
| PWA-016 | Расшифровка приватного ключа → подписание → отправка на Cloud Relay | Обязательно |
| PWA-017 | Обработка ошибок (истёкший QR, нет сети, неверный PIN) | Обязательно |

### 5.3. PWA-функции

| ID | Требование | Приоритет |
|----|-----------|-----------|
| PWA-020 | Service Worker для offline-доступа к UI (ключи и так в IndexedDB) | Обязательно |
| PWA-021 | Web App Manifest (иконки, splash screen, standalone display) | Обязательно |
| PWA-022 | Баннер «Добавить на главный экран» | Желательно |
| PWA-023 | Работа в standalone режиме (без адресной строки браузера) | Желательно |

## 6. Криптография (Web Crypto API)

### 6.1. Генерация ключей

```typescript
// RSA-2048
const keyPair = await crypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,  // extractable — нужно для экспорта и шифрования
  ["sign", "verify"]
);

// Или ECDSA P-256
const keyPair = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"]
);
```

### 6.2. Шифрование приватного ключа паролем

```typescript
// 1. Получить ключ из пароля через PBKDF2
const salt = crypto.getRandomValues(new Uint8Array(16));
const keyMaterial = await crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(password),
  "PBKDF2",
  false,
  ["deriveKey"]
);

const wrappingKey = await crypto.subtle.deriveKey(
  { name: "PBKDF2", salt, iterations: 600000, hash: "SHA-256" },
  keyMaterial,
  { name: "AES-GCM", length: 256 },
  false,
  ["wrapKey", "unwrapKey"]
);

// 2. Зашифровать приватный ключ
const iv = crypto.getRandomValues(new Uint8Array(12));
const wrappedKey = await crypto.subtle.wrapKey(
  "pkcs8",
  keyPair.privateKey,
  wrappingKey,
  { name: "AES-GCM", iv }
);

// 3. Сохранить в IndexedDB: { wrappedKey, salt, iv, publicKey }
```

### 6.3. Подписание

```typescript
// 1. Расшифровать приватный ключ (ввод PIN)
const privateKey = await crypto.subtle.unwrapKey(
  "pkcs8",
  storedWrappedKey,
  wrappingKey,
  { name: "AES-GCM", iv: storedIV },
  { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
  false,
  ["sign"]
);

// 2. Подписать данные
const dataToSign = SHA256(challenge + session_id + origin);  // для auth
const signature = await crypto.subtle.sign(
  "RSASSA-PKCS1-v1_5",
  privateKey,
  dataToSign
);
```

### 6.4. Создание X.509 сертификата (pkijs)

```typescript
import * as pkijs from "pkijs";
import * as asn1js from "asn1js";

// Создание самоподписанного сертификата
const certificate = new pkijs.Certificate();
certificate.version = 2;
certificate.serialNumber = new asn1js.Integer({ value: Date.now() });

// Subject: CN=Иванов Иван, emailAddress=ivanov@mail.ru
certificate.subject.typesAndValues.push(
  new pkijs.AttributeTypeAndValue({
    type: "2.5.4.3", // CN
    value: new asn1js.Utf8String({ value: fullName })
  })
);
// ... issuer = subject (self-signed)
// ... validity: notBefore = now, notAfter = now + 1 year
// ... sign with private key

const certDER = certificate.toSchema().toBER();
const certBase64 = btoa(String.fromCharCode(...new Uint8Array(certDER)));
```

## 7. Протокол подписания

Идентичен iOS App TRD (полная совместимость):

### Шаг 1: Сканирование
Web App сканирует QR камерой телефона, парсит JSON.

### Шаг 2: Валидация
- `version == 1`
- `expires_at` не истёк
- `callback_url` использует HTTPS

### Шаг 3: Подтверждение
- Экран: «{origin} запрашивает {operation}»
- Ввод PIN-кода (вместо Face ID)
- Выбор сертификата (если несколько)

### Шаг 4: Подписание

Для **auth**:
```
signature = sign(private_key, SHA256(challenge + session_id + origin))
```

Для **sign**:
```
signature = sign(private_key, SHA256(challenge + session_id + origin + data_hash))
```

### Шаг 5: Отправка на Cloud Relay
```
POST {callback_url}
Content-Type: application/json

{
  "certificate": "MIIBxTCCAWugAwIBAgI...",
  "signature": "MEUCIQC...",
  "algorithm": "SHA256withRSA"
}
```

### Шаг 6: Результат
- 200 → «Подписание выполнено»
- 404 → «Сессия не найдена»
- 409 → «Сессия истекла»
- Сетевая ошибка → «Нет подключения» + retry

## 8. Структура проекта

```
kazeds-webapp/
├── src/
│   ├── app/
│   │   ├── page.tsx                     # Главная: список сертификатов
│   │   ├── layout.tsx                   # Mobile-first layout
│   │   ├── create/
│   │   │   └── page.tsx                 # Создание сертификата
│   │   ├── certificate/[id]/
│   │   │   └── page.tsx                 # Детали сертификата
│   │   ├── scan/
│   │   │   └── page.tsx                 # QR-сканер
│   │   ├── confirm/
│   │   │   └── page.tsx                 # Подтверждение подписания
│   │   ├── setup/
│   │   │   └── page.tsx                 # Первый запуск: установка PIN
│   │   └── history/
│   │       └── page.tsx                 # История подписаний
│   ├── components/
│   │   ├── QRScanner.tsx                # Камера + html5-qrcode
│   │   ├── CertificateCard.tsx          # Карточка сертификата
│   │   ├── PinInput.tsx                 # Ввод PIN-кода
│   │   ├── ConfirmSheet.tsx             # Bottom sheet подтверждения
│   │   └── StatusBadge.tsx              # Статус операции
│   ├── lib/
│   │   ├── crypto/
│   │   │   ├── key-manager.ts           # Генерация, шифрование, хранение ключей
│   │   │   ├── certificate.ts           # Создание X.509 (pkijs)
│   │   │   ├── signer.ts               # Подписание (Web Crypto)
│   │   │   └── pin.ts                  # PBKDF2 из PIN → AES ключ
│   │   ├── storage/
│   │   │   ├── key-store.ts            # IndexedDB для зашифрованных ключей
│   │   │   └── history-store.ts        # IndexedDB для истории
│   │   ├── network/
│   │   │   └── relay-client.ts         # HTTP-клиент для Cloud Relay
│   │   ├── qr/
│   │   │   └── parser.ts              # Парсинг QR payload
│   │   └── utils.ts
│   └── hooks/
│       ├── useCamera.ts                # Доступ к камере
│       ├── useKeyStore.ts              # CRUD ключей
│       └── usePin.ts                   # Проверка PIN
├── public/
│   ├── manifest.json                   # PWA manifest
│   ├── sw.js                           # Service Worker
│   ├── icons/
│   │   ├── icon-192.png
│   │   └── icon-512.png
│   └── favicon.ico
├── package.json
├── tsconfig.json
├── tailwind.config.ts
└── next.config.ts
```

## 9. PWA Manifest

```json
{
  "name": "KazEDS",
  "short_name": "KazEDS",
  "description": "Электронная цифровая подпись",
  "start_url": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#ffffff",
  "theme_color": "#1F4E79",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

## 10. Экраны (Mobile-first)

| # | Экран | Описание |
|---|-------|----------|
| 1 | **Установка PIN** | Первый запуск: создание 6-значного PIN-кода |
| 2 | **Мои сертификаты** | Список карточек + FAB «Создать» + кнопка «Сканировать QR» |
| 3 | **Создание сертификата** | Форма: ФИО, email, тип ключа → ввод PIN → генерация |
| 4 | **Детали сертификата** | Subject, serial, validity, кнопка «Удалить» |
| 5 | **QR-сканер** | Полноэкранная камера с рамкой |
| 6 | **Подтверждение** | Bottom sheet: origin, операция, выбор сертификата, ввод PIN, кнопки |
| 7 | **Результат** | Успех (галочка) / ошибка (крест) с описанием |
| 8 | **История** | Список операций: дата, origin, тип, статус |

### Навигация
```
Bottom Tab Bar:
[Сертификаты] | [Сканер (камера)] | [История]
```

## 11. IndexedDB схема

```typescript
// Database: kazeds-keystore, version: 1

// Object Store: certificates
interface StoredCertificate {
  id: string;                      // UUID
  label: string;                   // «Иванов Иван — рабочий»
  subjectCN: string;
  subjectEmail?: string;
  algorithm: "RSA" | "ECDSA";
  certificateDER: ArrayBuffer;     // Публичный X.509 сертификат (не зашифрован)
  wrappedPrivateKey: ArrayBuffer;  // Приватный ключ, зашифрованный AES-GCM
  salt: ArrayBuffer;               // PBKDF2 salt (16 bytes)
  iv: ArrayBuffer;                 // AES-GCM IV (12 bytes)
  publicKeyJWK: JsonWebKey;        // Публичный ключ в JWK (для верификации)
  createdAt: string;               // ISO 8601
  notBefore: string;
  notAfter: string;
}

// Object Store: history
interface SigningHistoryEntry {
  id: string;
  certificateId: string;
  origin: string;
  operation: "auth" | "sign";
  status: "success" | "error" | "cancelled";
  timestamp: string;
}

// Object Store: settings
interface AppSettings {
  pinHash: string;                 // SHA-256(PIN + salt) — для быстрой проверки
  pinSalt: string;
  setupCompleted: boolean;
}
```

## 12. Безопасность

| Аспект | Реализация |
|--------|-----------|
| Хранение приватных ключей | IndexedDB, зашифрованы AES-256-GCM |
| Ключ шифрования | Деривируется из PIN через PBKDF2 (600K итераций) |
| Авторизация подписания | Ввод PIN перед каждой операцией |
| Передача данных | Только HTTPS |
| Replay-защита | challenge + expires_at (5 мин) |
| Приватный ключ | Никогда не покидает браузер в открытом виде |
| Service Worker | Кэширует только UI, не криптоматериалы |
| XSS-защита | CSP headers, React auto-escaping |

### Ограничения по сравнению с iOS App
- Нет аппаратной защиты (Secure Enclave)
- Нет биометрии (PIN вместо Face ID)
- IndexedDB менее защищена чем iOS Keychain
- Ключи теоретически доступны через DevTools (для MVP допустимо)

## 13. Зависимости

```json
{
  "dependencies": {
    "next": "^14.0.0",
    "react": "^18.0.0",
    "html5-qrcode": "^2.3.8",
    "pkijs": "^3.0.0",
    "asn1js": "^3.0.0",
    "idb": "^8.0.0",
    "tailwindcss": "^3.4.0",
    "@radix-ui/react-dialog": "latest",
    "lucide-react": "latest"
  }
}
```

## 14. Развёртывание

```bash
# Build
npm run build

# Deploy (Vercel)
vercel deploy

# Результат: https://app.kazeds.kz
```

Доступно по URL на любом устройстве с камерой. Установка через «Добавить на главный экран» в мобильном браузере.

## 15. Миграция на iOS App (Phase 2)

При переходе на нативное iOS приложение:

| Что меняется | Web App → iOS App |
|-------------|-------------------|
| Хранение ключей | IndexedDB → iOS Keychain (Secure Enclave) |
| Авторизация | PIN → Face ID / Touch ID |
| QR-сканер | html5-qrcode → AVFoundation |
| Криптография | Web Crypto API → Security.framework |
| X.509 | pkijs → Security.framework |
| Распространение | URL → App Store |

**Что НЕ меняется:**
- Протокол подписания (QR → sign → Cloud Relay)
- Формат QR-кода
- API Cloud Relay
- Chrome Extension (не знает Web App это или iOS App)

## 16. Критерии приёмки MVP

1. PWA открывается на мобильном телефоне, предлагает «Добавить на главный экран»
2. Пользователь устанавливает PIN-код при первом запуске
3. Пользователь создаёт ключевую пару и самоподписанный X.509 сертификат
4. Приватный ключ зашифрован и хранится в IndexedDB
5. Камера открывается и сканирует QR-код
6. Экран подтверждения показывает origin и тип операции
7. После ввода PIN — подписывает и отправляет результат на Cloud Relay
8. Chrome Extension получает подпись и завершает операцию на сайте
9. Работает на iOS Safari 16+ и Android Chrome 90+
10. Весь цикл (QR → подпись → результат на сайте) занимает менее 10 секунд
