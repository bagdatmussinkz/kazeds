# TRD: KazEDS iOS App

> **Phase 2.** Для MVP используется Web App (PWA) — см. `TRD_KazEDS_Web_App.md`.
> iOS App разрабатывается после валидации гипотезы, добавляя аппаратную защиту ключей (Secure Enclave), биометрию (Face ID/Touch ID) и нативный UX. Протокол подписания и API Cloud Relay идентичны — Chrome Extension не потребует изменений.

## 1. Обзор проекта

**Название:** KazEDS iOS App
**Тип:** Нативное мобильное приложение (iOS, Swift/SwiftUI)
**Фаза:** Phase 2 (после валидации MVP через Web App)
**Дата:** 31 марта 2026

KazEDS iOS App — нативное приложение, заменяющее Web App для повышения безопасности. Хранит ключи в iOS Keychain (Secure Enclave), использует Face ID/Touch ID вместо PIN-кода. Протокол тот же: сканирование QR → подписание → отправка на Cloud Relay.

## 2. Роль в экосистеме KazEDS

```
[Демо-сайт] ──NCALayer API──→ [Chrome Extension] ──→ [Cloud Relay]
                                показывает QR            │
                                                         │ создаёт сессию
                                                         │
[iOS App] ──→ сканирует QR ──→ подписывает ──→ POST /v1/sessions/{id}/complete
                                                         │
                                                         │ completed
                                                         ↓
                              [Chrome Extension] ←── polling ──→ [Cloud Relay]
                                    │
                                    └──→ возвращает подпись сайту
```

iOS App — это «хранилище ключей» и «подписант». Приватный ключ никогда не покидает устройство. Обмен данными с Chrome Extension происходит через Cloud Relay (облако).

## 3. Технологический стек

| Компонент | Технология |
|-----------|-----------|
| Язык | Swift 5.9+ |
| UI | SwiftUI |
| Минимальная iOS | 16.0 |
| Криптография | Security.framework + CommonCrypto (OpenSSL-совместимые ключи) |
| QR-сканер | AVFoundation (камера) |
| Хранение ключей | iOS Keychain (kSecAttrAccessibleWhenUnlockedThisDeviceOnly) |
| Биометрия | LocalAuthentication.framework (Face ID / Touch ID) |
| Сеть | URLSession / async-await |
| Локальная БД | Нет (данные сертификатов в Keychain, история в UserDefaults) |

### MVP: OpenSSL-совместимые ключи
- RSA 2048-bit или ECDSA P-256
- Самоподписанные сертификаты X.509
- Формат подписи: raw signature (для signPlainData) или CMS/PKCS#7 (для createCMSSignature)

## 4. Функциональные требования

### 4.1. Генерация и хранение ключей ЭЦП

| ID | Требование | Приоритет |
|----|-----------|-----------|
| IOS-001 | Генерация пары ключей RSA-2048 или ECDSA P-256 через Security.framework | Обязательно |
| IOS-002 | Создание самоподписанного сертификата X.509 с данными пользователя (ФИО, email) | Обязательно |
| IOS-003 | Хранение приватного ключа в iOS Keychain (kSecAttrAccessibleWhenUnlockedThisDeviceOnly) | Обязательно |
| IOS-004 | Просмотр списка хранимых сертификатов (subject, дата выпуска, срок действия) | Обязательно |
| IOS-005 | Удаление сертификатов с подтверждением | Обязательно |
| IOS-006 | Экспорт публичного сертификата (base64 DER) | Желательно |

### 4.2. Сканирование QR-кода и подписание

| ID | Требование | Приоритет |
|----|-----------|-----------|
| IOS-010 | Сканирование QR-кода с камеры устройства | Обязательно |
| IOS-011 | Парсинг JSON из QR: version, session_id, challenge, origin, operation, callback_url, expires_at | Обязательно |
| IOS-012 | Отображение экрана подтверждения: «Сайт {origin} запрашивает {operation}» | Обязательно |
| IOS-013 | Выбор сертификата для подписания (если их несколько) | Обязательно |
| IOS-014 | Подписание данных приватным ключом (RSA-SHA256 или ECDSA-SHA256) | Обязательно |
| IOS-015 | Отправка результата на callback_url (Cloud Relay) | Обязательно |
| IOS-016 | Биометрическая авторизация (Face ID / Touch ID) перед подписанием | Обязательно |
| IOS-017 | Обработка разных типов операций (auth vs sign) | Обязательно |

### 4.3. Управление профилем

| ID | Требование | Приоритет |
|----|-----------|-----------|
| IOS-020 | Экран «Мои сертификаты» со списком всех выпущенных ЭЦП | Обязательно |
| IOS-021 | Просмотр деталей сертификата (subject, issuer, serial, validity) | Обязательно |
| IOS-022 | История операций подписания (дата, сайт, тип) — в UserDefaults | Желательно |

## 5. Структура QR-кода

QR-код содержит JSON (генерируется Cloud Relay, отображается Chrome Extension):

```json
{
  "version": 1,
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "challenge": "dGhpcyBpcyBhIHJhbmRvbSBjaGFsbGVuZ2U=",
  "origin": "https://demo.kazeds.kz",
  "operation": "sign",
  "data_hash": "abc123def456...",
  "callback_url": "https://relay.kazeds.kz/v1/sessions/550e8400-.../complete",
  "created_at": "2026-03-31T12:00:00Z",
  "expires_at": "2026-03-31T12:05:00Z"
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| version | int | Версия протокола (1) |
| session_id | UUID | Уникальный идентификатор сессии |
| challenge | string (base64) | 32 байта случайных данных для подписания |
| origin | string | Домен сайта, запросившего подписание |
| operation | "auth" \| "sign" | Тип операции |
| data_hash | string? | SHA-256 хеш данных для подписания (только для sign) |
| callback_url | string (HTTPS) | URL для отправки результата (Cloud Relay) |
| created_at | ISO 8601 | Время создания сессии |
| expires_at | ISO 8601 | Время истечения (5 минут) |

## 6. Протокол подписания

### Шаг 1: Сканирование
iOS App сканирует QR-код, парсит JSON.

### Шаг 2: Валидация
- Проверить что `version == 1`
- Проверить что `expires_at` не истёк
- Проверить что `callback_url` использует HTTPS
- Проверить что `session_id` валидный UUID

### Шаг 3: Подтверждение пользователем
- Показать экран: «Сайт {origin} запрашивает {operation}»
- Если operation = "sign" — показать data_hash
- Запросить Face ID / Touch ID
- Если несколько сертификатов — предложить выбор

### Шаг 4: Подписание

Для **auth** операции:
```
signedData = sign(private_key, SHA256(challenge + session_id + origin))
```

Для **sign** операции:
```
signedData = sign(private_key, SHA256(challenge + session_id + origin + data_hash))
```

Алгоритм: `SHA256withRSA` для RSA-ключей, `SHA256withECDSA` для ECDSA-ключей.

### Шаг 5: Отправка результата на Cloud Relay
```
POST {callback_url}
Content-Type: application/json

{
  "certificate": "MIIBxTCCAWugAwIBAgI...",
  "signature": "MEUCIQC...",
  "algorithm": "SHA256withRSA"
}
```

| Поле | Описание |
|------|----------|
| certificate | Публичный сертификат X.509 в base64 DER |
| signature | Подпись в base64 |
| algorithm | "SHA256withRSA" или "SHA256withECDSA" |

### Шаг 6: Обработка ответа Cloud Relay

| HTTP-код | Значение | Действие в App |
|----------|----------|----------------|
| 200 | Успех | Показать «Подписание выполнено» с зелёной галочкой |
| 404 | Сессия не найдена | Показать «Сессия не найдена. Попробуйте отсканировать QR заново» |
| 409 | Сессия уже завершена/истекла | Показать «Сессия истекла. Запросите новый QR-код» |
| 400 | Невалидные данные | Показать «Ошибка данных подписания» |
| Сетевая ошибка | Нет связи | Показать «Нет подключения к серверу. Проверьте интернет» с кнопкой retry |

## 7. Структура проекта

```
KazEDS/
├── App/
│   ├── KazEDSApp.swift              # Точка входа
│   └── ContentView.swift             # TabView (Сертификаты / Сканер / История)
├── Features/
│   ├── Certificate/
│   │   ├── CertificateListView.swift     # Список сертификатов
│   │   ├── CertificateDetailView.swift   # Детали сертификата
│   │   ├── CreateCertificateView.swift   # Форма создания (ФИО, email, тип ключа)
│   │   └── CertificateViewModel.swift
│   ├── Scanner/
│   │   ├── QRScannerView.swift           # Камера + парсинг QR
│   │   ├── SigningConfirmView.swift       # Экран подтверждения
│   │   ├── SigningResultView.swift        # Результат (успех/ошибка)
│   │   └── ScannerViewModel.swift
│   └── History/
│       ├── HistoryListView.swift
│       └── HistoryViewModel.swift
├── Core/
│   ├── Crypto/
│   │   ├── KeyManager.swift              # Генерация ключей, Keychain CRUD
│   │   ├── CertificateGenerator.swift    # Создание X.509 (самоподписанных)
│   │   └── Signer.swift                  # Подписание: SHA256 + RSA/ECDSA
│   ├── Network/
│   │   ├── RelayClient.swift             # HTTP-клиент для Cloud Relay
│   │   └── Models/
│   │       ├── QRPayload.swift           # Декодирование JSON из QR
│   │       ├── CompleteRequest.swift      # POST body для complete
│   │       └── RelayResponse.swift
│   └── Security/
│       └── BiometricAuth.swift           # Face ID / Touch ID
├── Models/
│   ├── Certificate.swift                 # Модель сертификата
│   └── SigningHistory.swift              # Запись истории
└── Resources/
    └── Assets.xcassets
```

## 8. Безопасность

| Аспект | Реализация |
|--------|-----------|
| Хранение приватных ключей | iOS Keychain, kSecAttrAccessibleWhenUnlockedThisDeviceOnly |
| Авторизация подписания | Face ID / Touch ID перед каждой операцией |
| Передача данных | Только HTTPS |
| Replay-защита | challenge + expires_at (5 мин TTL) |
| Приватный ключ | Никогда не покидает устройство |
| Callback URL | Валидация HTTPS перед отправкой |
| Certificate pinning | Для relay.kazeds.kz (желательно) |

## 9. Экраны приложения (MVP)

| # | Экран | Описание |
|---|-------|----------|
| 1 | **Мои сертификаты** | Список сертификатов + кнопка «Создать новый» |
| 2 | **Создать сертификат** | Форма: ФИО, email, тип ключа (RSA/ECDSA) → «Создать» |
| 3 | **Детали сертификата** | Subject, serial, validity, fingerprint, кнопка «Удалить» |
| 4 | **QR-сканер** | Камера с рамкой для QR-кода (tab bar: центральная кнопка) |
| 5 | **Подтверждение** | Сайт, тип операции, выбор сертификата, кнопки «Подписать» / «Отклонить» |
| 6 | **Результат** | Успех (зелёная галочка) или ошибка (красный крест) с деталями |
| 7 | **История** | Список: дата, сайт (origin), тип операции, статус |

### Навигация (TabView)
```
[Сертификаты] | [Сканер] | [История]
```

## 10. API эндпоинты (вызываемые приложением)

Все запросы к Cloud Relay Server (`https://relay.kazeds.kz`):

| Метод | URL | Описание |
|-------|-----|----------|
| POST | `/v1/sessions/{id}/complete` | Отправка результата подписания |

Это единственный эндпоинт, который вызывает iOS App. Сессию создаёт Chrome Extension, iOS App только завершает её.

## 11. Критерии приёмки MVP

1. Пользователь может создать ключевую пару (RSA-2048 или ECDSA P-256) и самоподписанный сертификат X.509
2. Приватный ключ хранится в iOS Keychain и защищён биометрией
3. Приложение сканирует QR-код и корректно парсит JSON payload
4. Отображается экран подтверждения с origin и типом операции
5. После Face ID/Touch ID — подписывает данные и отправляет на Cloud Relay
6. Cloud Relay возвращает 200 → App показывает «Подписание выполнено»
7. Chrome Extension получает результат через polling и завершает операцию на сайте
8. Повторное сканирование истёкшего QR-кода (>5 мин) показывает понятную ошибку
9. При отсутствии интернета — показывает ошибку с кнопкой retry
