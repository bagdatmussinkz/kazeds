# KazEDS — Customer Journey Map

## Полный цикл подписания ЭЦП

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  Demo Site   │    │  Cloud Relay │    │   Web App    │    │  Demo Site   │
│  "Войти"     │───▶│  Сессия      │───▶│  Подпись     │───▶│  Результат   │
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
```

### Шаг 1: Клиент нажимает "Войти по ЭЦП"

- Demo Site вызывает `ncalayer-js-client.basicsSignCMS()`
- `eds.js` перехватывает WebSocket `wss://127.0.0.1:13579`
- `eds.js` создаёт сессию: `POST relay/v1/sessions`
  ```json
  {"origin": "http://demo-sign.aitu.uz", "operation": "sign", "data": "ZGVtbw=="}
  ```
- Relay возвращает `session_id`, `challenge`, `qr_payload`
- `eds.js` показывает QR overlay с deep link и круговым прогрессом (5 мин)

### Шаг 2: Сканирование QR-кода

QR содержит deep link:
```
http://app-sign.aitu.uz/#/sign
  ?session=UUID
  &challenge=BASE64
  &origin=http://demo-sign.aitu.uz
  &callback=http://relay-sign.aitu.uz/v1/sessions/UUID/complete
  &data=ZGVtbw==
  &op=sign
```

Телефон сканирует → открывается Web App

### Шаг 3: Подписание в Web App

Web App показывает:
- Откуда запрос (origin)
- Что подписываем (data decoded → "demo")
- Тип операции (Подписание)

Пользователь нажимает "Подписать":
1. Если ключей нет → генерация ECDSA P-256 + запрос PIN → сохранение в IndexedDB
2. Если ключи есть → запрос PIN → расшифровка приватного ключа
3. Подпись `challenge + data` алгоритмом ECDSA P-256 + SHA-256
4. Отправка на Relay: `POST callback_url`
   ```json
   {
     "certificate": "MIIBxj...",
     "signature": "MEQCI...",
     "algorithm": "SHA256withECDSA"
   }
   ```

### Шаг 4: Результат на Demo Site

- `eds.js` получает результат через polling
- QR overlay закрывается
- Страница показывает:
  - Статус: "Документ подписан"
  - Подписант: CN=Bagdat Mussin, O=KazEDS Demo, C=KZ
  - Алгоритм: SHA256withECDSA
  - Время подписания
  - Команда верификации:
    ```bash
    ./scripts/verify.sh "demo" "MEQCI..."
    ```

## Диаграмма последовательности

```
Клиент          Demo Site         eds.js          Relay           Web App
  │                │                │               │               │
  │─ Войти по ЭЦП─▶│                │               │               │
  │                │──basicsSignCMS─▶│               │               │
  │                │                │──POST /sessions▶│               │
  │                │                │◀──session_id───│               │
  │                │                │                │               │
  │                │   ┌─QR Overlay─┐               │               │
  │                │   │  [QR code] │               │               │
  │                │   │  5:00 ⏱   │               │               │
  │                │   └────────────┘               │               │
  │                │                │               │               │
  │  Сканирует QR ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─▶│
  │                │                │               │               │
  │                │                │               │  ◀─GET params─│
  │                │                │               │               │
  │                │                │               │  Показывает   │
  │                │                │               │  данные       │
  │                │                │               │               │
  │  Подписать ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─▶│
  │                │                │               │               │
  │                │                │               │◀─POST complete│
  │                │                │               │               │
  │                │                │──GET /status──▶│               │
  │                │                │◀─ completed ──│               │
  │                │                │               │               │
  │                │◀──signature────│               │               │
  │                │                │               │               │
  │  ◀─ Результат ─│                │               │               │
  │    "Подписано"  │                │               │               │
```

## Статусы сессии

```
pending ──▶ scanned ──▶ completed
   │           │
   ▼           ▼
expired    rejected
```

## Безопасность

- Приватные ключи хранятся в IndexedDB, зашифрованы AES-256-GCM
- Ключ шифрования деривируется из PIN через PBKDF2 (600k итераций)
- Challenge предотвращает replay-атаки
- Сессии истекают через 5 минут
- callback_url валидируется (только HTTPS в production)
