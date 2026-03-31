# TRD: KazEDS Cloud Relay Server

## 1. Обзор проекта

**Название:** KazEDS Cloud Relay Server
**Тип:** REST API сервер (облачный)
**Версия:** MVP 1.0
**Дата:** 31 марта 2026

Cloud Relay — лёгкий облачный сервер, выступающий посредником между Chrome Extension и iOS App. Хранит сессии подписания в оперативной памяти (без базы данных). Extension создаёт сессию и получает QR-payload, iOS App завершает сессию, отправляя подпись. Extension узнаёт результат через polling.

## 2. Архитектура

```
[Chrome Extension]                              [iOS App]
      │                                              │
      ├─ POST /v1/sessions ──────→ [Cloud Relay] ←───┤
      │                              │  In-Memory     │
      ├─ GET  /v1/sessions/{id}/ ←───┤  Map<UUID,     │
      │       status (polling)       │  Session>      │
      │                              │                │
      │                              ├──── POST /v1/sessions/{id}/complete
      │                              │
      ├─ Получает completed ←────────┤
      │
      └─ Возвращает подпись сайту
```

**Принцип:** Relay ничего не знает о криптографии. Он просто передаёт данные между Extension и iOS App. Верификация подписи — ответственность потребителя (сайта).

## 3. Технологический стек

| Компонент | Технология |
|-----------|-----------|
| Runtime | Node.js 20+ |
| Фреймворк | Fastify (лёгкий, быстрый) |
| Язык | TypeScript |
| Хранилище | In-Memory Map (без БД) |
| Валидация | zod |
| CORS | @fastify/cors |
| Rate Limiting | @fastify/rate-limit |
| Логирование | pino (встроен в Fastify) |
| Развёртывание | Docker / Railway / Fly.io |

### Почему без базы данных
- MVP: сессии живут максимум 5 минут
- Данные не нужно хранить долгосрочно
- In-memory Map с автоочисткой по TTL
- При рестарте сервера — все активные сессии сбрасываются (допустимо для MVP)

## 4. Функциональные требования

| ID | Требование | Приоритет |
|----|-----------|-----------|
| RLY-001 | POST `/v1/sessions` — создание сессии подписания | Обязательно |
| RLY-002 | GET `/v1/sessions/{id}/status` — получение статуса (для polling) | Обязательно |
| RLY-003 | POST `/v1/sessions/{id}/complete` — приём результата от iOS App | Обязательно |
| RLY-004 | DELETE `/v1/sessions/{id}` — отмена сессии | Обязательно |
| RLY-005 | Автоматическое истечение сессий через 5 минут (TTL) | Обязательно |
| RLY-006 | Генерация challenge: 32 байта crypto.randomBytes | Обязательно |
| RLY-007 | Периодическая очистка истёкших сессий (каждые 60 сек) | Обязательно |
| RLY-008 | Rate limiting: 10 req/sec на создание, 30 req/sec на polling | Обязательно |
| RLY-009 | CORS: разрешить только Extension origin и iOS App | Обязательно |
| RLY-010 | Health check: GET `/health` | Обязательно |

## 5. API спецификация

### POST /v1/sessions

Создание новой сессии подписания. Вызывается Chrome Extension.

**Request:**
```json
{
  "origin": "https://demo.kazeds.kz",
  "operation": "sign",
  "data": "SGVsbG8gV29ybGQ=",
  "reason": "CMS подписание документа"
}
```

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| origin | string | Да | Домен сайта, запросившего подписание |
| operation | "auth" \| "sign" | Да | Тип операции |
| data | string (base64) | Для sign | Данные для подписания (base64) |
| reason | string | Нет | Описание (показывается в iOS App) |

**Response 201:**
```json
{
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "challenge": "dGhpcyBpcyBhIHJhbmRvbSBjaGFsbGVuZ2U=",
  "qr_payload": {
    "version": 1,
    "session_id": "550e8400-e29b-41d4-a716-446655440000",
    "challenge": "dGhpcyBpcyBhIHJhbmRvbSBjaGFsbGVuZ2U=",
    "origin": "https://demo.kazeds.kz",
    "operation": "sign",
    "data_hash": "abc123...",
    "callback_url": "https://relay.kazeds.kz/v1/sessions/550e8400-.../complete",
    "created_at": "2026-03-31T12:00:00Z",
    "expires_at": "2026-03-31T12:05:00Z"
  },
  "expires_at": "2026-03-31T12:05:00Z"
}
```

**Логика:**
1. Сгенерировать UUID v4 для session_id
2. Сгенерировать 32 байта challenge через `crypto.randomBytes(32)`
3. Вычислить `data_hash = SHA256(data)` если operation = "sign" (для отображения в iOS App)
4. Установить `expires_at = now + 5 минут`
5. Сохранить в Map
6. Сформировать `qr_payload` — JSON, который Extension превратит в QR-код

---

### GET /v1/sessions/{id}/status

Polling статуса сессии. Вызывается Chrome Extension каждые 2 секунды.

**Response (ожидание):**
```json
{
  "status": "pending",
  "expires_in": 287
}
```

**Response (отсканировано):**
```json
{
  "status": "scanned",
  "expires_in": 245
}
```

**Response (завершено):**
```json
{
  "status": "completed",
  "result": {
    "certificate": "MIIBxTCCAWugAwIBAgI...",
    "signature": "MEUCIQC...",
    "algorithm": "SHA256withRSA"
  }
}
```

**Response (истекла):**
```json
{
  "status": "expired"
}
```

**Response (отклонена):**
```json
{
  "status": "rejected"
}
```

**Статусы сессии:**

| Статус | Описание | Кто устанавливает |
|--------|----------|------------------|
| `pending` | Создана, ожидает сканирования | Сервер (при создании) |
| `scanned` | QR отсканирован, ожидает подтверждения | iOS App (опционально) |
| `completed` | Подпись получена | Сервер (при complete) |
| `rejected` | Пользователь отклонил | iOS App или Extension (DELETE) |
| `expired` | Истекло время (5 мин) | Сервер (автоматически) |
| `error` | Ошибка верификации или сервера | Сервер |

---

### POST /v1/sessions/{id}/complete

Приём результата подписания. Вызывается iOS App.

**Request:**
```json
{
  "certificate": "MIIBxTCCAWugAwIBAgI...",
  "signature": "MEUCIQC...",
  "algorithm": "SHA256withRSA"
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| certificate | string (base64 DER) | Публичный X.509 сертификат подписанта |
| signature | string (base64) | Подпись данных (challenge + session_id + origin) |
| algorithm | string | "SHA256withRSA" или "SHA256withECDSA" |

**Response 200:**
```json
{
  "status": "completed"
}
```

**Логика:**
1. Найти сессию по id
2. Проверить что не истекла
3. Проверить что статус `pending` или `scanned`
4. **НЕ верифицировать подпись** (Relay — просто посредник, верификация на стороне потребителя)
5. Сохранить certificate + signature + algorithm в сессии
6. Статус → `completed`

**Ошибки:**
- `404` — сессия не найдена
- `409` — сессия уже завершена (completed/expired/rejected)
- `400` — невалидные данные

---

### DELETE /v1/sessions/{id}

Отмена сессии. Вызывается Chrome Extension при нажатии «Отмена» или iOS App при отклонении.

**Response 200:**
```json
{
  "status": "rejected"
}
```

**Логика:** Если статус `pending`/`scanned` → установить `rejected`. Иначе → 409.

---

### GET /health

Health check для мониторинга.

**Response 200:**
```json
{
  "status": "ok",
  "active_sessions": 42,
  "uptime": 86400
}
```

## 6. In-Memory хранилище

### Структура данных

```typescript
interface Session {
  id: string;                    // UUID v4
  origin: string;
  operation: "auth" | "sign";
  data?: string;                 // base64 данных для подписания
  reason?: string;
  challenge: string;             // base64, 32 bytes
  status: SessionStatus;
  result?: {
    certificate: string;
    signature: string;
    algorithm: string;
  };
  createdAt: Date;
  expiresAt: Date;
  completedAt?: Date;
}

type SessionStatus = "pending" | "scanned" | "completed" | "rejected" | "expired" | "error";

// Хранилище
const sessions = new Map<string, Session>();
```

### Автоочистка (garbage collection)

```typescript
// Запускается каждые 60 секунд
function cleanupExpiredSessions() {
  const now = new Date();
  for (const [id, session] of sessions) {
    if (session.expiresAt < now && session.status === "pending") {
      session.status = "expired";
    }
    // Удалить завершённые сессии старше 10 минут (чтобы polling успел забрать результат)
    if (session.completedAt && (now - session.completedAt) > 10 * 60 * 1000) {
      sessions.delete(id);
    }
    // Удалить истёкшие/отклонённые сессии старше 10 минут
    if (["expired", "rejected", "error"].includes(session.status) && (now - session.expiresAt) > 10 * 60 * 1000) {
      sessions.delete(id);
    }
  }
}

setInterval(cleanupExpiredSessions, 60_000);
```

## 7. Структура проекта

```
kazeds-relay/
├── src/
│   ├── index.ts                  # Entry point, Fastify init
│   ├── routes/
│   │   ├── sessions.ts           # /v1/sessions/* — все эндпоинты
│   │   └── health.ts             # /health
│   ├── services/
│   │   ├── session-store.ts      # In-memory Map + CRUD + TTL
│   │   └── challenge.ts          # crypto.randomBytes генерация
│   ├── schemas/
│   │   ├── session.schema.ts     # zod-схемы запросов/ответов
│   │   └── common.schema.ts
│   ├── middleware/
│   │   ├── cors.ts
│   │   └── rate-limit.ts
│   └── utils/
│       └── config.ts             # Переменные окружения
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
└── .env.example
```

## 8. Конфигурация

```env
# Server
PORT=3001
HOST=0.0.0.0
NODE_ENV=production

# Sessions
SESSION_TTL_SECONDS=300
SESSION_CLEANUP_INTERVAL_SECONDS=60
SESSION_RETAIN_AFTER_COMPLETE_SECONDS=600

# CORS
CORS_ORIGINS=chrome-extension://EXTENSION_ID,https://demo.kazeds.kz

# Rate Limiting
RATE_LIMIT_CREATE=10       # req/sec на POST /v1/sessions
RATE_LIMIT_POLLING=30      # req/sec на GET /v1/sessions/{id}/status
RATE_LIMIT_COMPLETE=10     # req/sec на POST /v1/sessions/{id}/complete

# Logging
LOG_LEVEL=info
```

## 9. Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist/ ./dist/
EXPOSE 3001
CMD ["node", "dist/index.js"]
```

```yaml
# docker-compose.yml
services:
  relay:
    build: .
    ports:
      - "3001:3001"
    environment:
      PORT: 3001
      SESSION_TTL_SECONDS: 300
      CORS_ORIGINS: "chrome-extension://EXTENSION_ID,https://demo.kazeds.kz"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
      interval: 30s
      timeout: 5s
      retries: 3
```

## 10. Безопасность

| Аспект | Реализация |
|--------|-----------|
| Challenge | 32 байта, `crypto.randomBytes(32)` — криптографически стойкий |
| CORS | Только Chrome Extension origin + разрешённые домены |
| Rate Limiting | Защита от DDoS: ограничение на создание и polling |
| HTTPS | Обязателен в production (через reverse proxy / cloud provider) |
| Без аутентификации | MVP: сессии защищены UUID (неугадываемый). v2: API key для Extension |
| Нет хранения ключей | Relay не видит приватных ключей, только передаёт подписи |
| TTL | Сессии автоматически истекают через 5 мин |
| Нет персональных данных | Relay не извлекает данные из сертификатов |

## 11. Масштабирование (post-MVP)

Для MVP один инстанс достаточен. Для масштабирования:
- Заменить `Map` на Redis (одна строчка — адаптер)
- Добавить sticky sessions или shared store
- Добавить WebSocket вместо polling (Server-Sent Events или WS)

## 12. Критерии приёмки MVP

1. `POST /v1/sessions` создаёт сессию и возвращает QR payload с challenge
2. `GET /v1/sessions/{id}/status` корректно возвращает текущий статус (pending → scanned → completed)
3. `POST /v1/sessions/{id}/complete` принимает подпись от iOS App и устанавливает статус completed
4. После completed — polling возвращает certificate + signature
5. Сессии автоматически истекают через 5 минут
6. Истёкшие сессии очищаются из памяти
7. Rate limiting работает корректно
8. `GET /health` возвращает статус и количество активных сессий
9. Сервер стартует за менее чем 2 секунды, потребляет менее 50 МБ RAM при 100 активных сессиях
