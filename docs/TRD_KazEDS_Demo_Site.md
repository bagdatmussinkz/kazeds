# TRD: KazEDS Demo Site

## 1. Обзор проекта

**Название:** KazEDS Demo Site
**Тип:** Frontend веб-приложение (SPA)
**Версия:** MVP 1.0
**Дата:** 31 марта 2026

Demo Site — веб-приложение для демонстрации экосистемы KazEDS. Использует стандартный `ncalayer-js-client` от sigex-kz для подключения к NCALayer (а по факту — к Chrome Extension KazEDS). Демонстрирует вход по ЭЦП и подписание документов. Бэкенд не нужен — сайт работает как статический SPA.

## 2. Архитектура

```
[Demo Site]  ──WebSocket──→  wss://127.0.0.1:13579  (Chrome Extension / NCALayer)
   │
   ├─ Использует ncalayer-js-client (npm: ncalayer-js-client)
   ├─ Подключение к NCALayer стандартным способом
   ├─ Вход: basicsAuthenticate() → получает сертификат
   ├─ Подписание: createCMSSignature() → получает CMS-подпись
   │
   ├─ Верификация подписи — на клиенте (OpenSSL / pkijs)
   ├─ Сессия пользователя — в памяти (sessionStorage)
   └─ Нет бэкенда, нет базы данных
```

**Ключевой принцип:** Демо-сайт не знает о KazEDS. Он работает с NCALayer стандартным способом через `ncalayer-js-client`. Это доказывает что Chrome Extension полностью совместим с существующей инфраструктурой.

## 3. Технологический стек

| Компонент | Технология |
|-----------|-----------|
| Фреймворк | Next.js 14+ (App Router) или Vite + React |
| Язык | TypeScript |
| Стили | Tailwind CSS |
| UI-компоненты | shadcn/ui |
| NCALayer клиент | `ncalayer-js-client` (npm, от sigex-kz) |
| Верификация подписей | pkijs (клиентская верификация X.509/CMS) |
| Хеширование | Web Crypto API (SHA-256) |
| Состояние | React Context / useState |
| Сессия пользователя | sessionStorage (в памяти браузера) |
| Развёртывание | Vercel / Netlify / static hosting |

### Без бэкенда
- Аутентификация: сертификат хранится в sessionStorage
- Подписание: всё на клиенте (hash + NCALayer + верификация)
- Нет сервера, нет базы данных

## 4. Функциональные требования

### 4.1. Определение NCALayer / KazEDS Extension

| ID | Требование | Приоритет |
|----|-----------|-----------|
| WEB-001 | При загрузке — попытка подключения к `wss://127.0.0.1:13579` | Обязательно |
| WEB-002 | Если подключение успешно — показать «NCALayer подключён» (зелёный индикатор) | Обязательно |
| WEB-003 | Если не подключается — баннер: «Установите NCALayer или KazEDS Extension» со ссылками | Обязательно |
| WEB-004 | Автоматический retry подключения каждые 5 секунд | Желательно |

### 4.2. Вход по ЭЦП

| ID | Требование | Приоритет |
|----|-----------|-----------|
| WEB-010 | Кнопка «Войти по ЭЦП» на главной странице | Обязательно |
| WEB-011 | При нажатии — вызов `browseKeyStore()` для выбора хранилища | Обязательно |
| WEB-012 | Затем `getKeys()` для получения сертификата | Обязательно |
| WEB-013 | Генерация случайного challenge на клиенте | Обязательно |
| WEB-014 | Вызов `signPlainData(challenge)` для подписания challenge | Обязательно |
| WEB-015 | Верификация подписи challenge на клиенте (pkijs / Web Crypto) | Обязательно |
| WEB-016 | Извлечение данных из сертификата (CN, email, org) | Обязательно |
| WEB-017 | Сохранение сертификата и данных пользователя в sessionStorage | Обязательно |
| WEB-018 | Переход в личный кабинет | Обязательно |

### 4.3. Подписание документов

| ID | Требование | Приоритет |
|----|-----------|-----------|
| WEB-020 | Страница «Подписать документ» (доступна после входа) | Обязательно |
| WEB-021 | Загрузка файла (drag & drop или file input) | Обязательно |
| WEB-022 | Вычисление SHA-256 хеша файла через Web Crypto API | Обязательно |
| WEB-023 | Вызов `createCMSSignature(base64FileContent)` | Обязательно |
| WEB-024 | Отображение результата: подписант, алгоритм, дата | Обязательно |
| WEB-025 | Скачивание CMS-подписи (detached .sig файл) | Обязательно |
| WEB-026 | Верификация подписи на клиенте | Желательно |

### 4.4. Проверка подписи

| ID | Требование | Приоритет |
|----|-----------|-----------|
| WEB-030 | Страница «Проверить подпись» (доступна без входа) | Желательно |
| WEB-031 | Загрузка оригинального файла + .sig файла | Желательно |
| WEB-032 | Верификация CMS-подписи на клиенте (pkijs) | Желательно |
| WEB-033 | Отображение результата: валидна / невалидна, данные подписанта | Желательно |

## 5. Флоу входа по ЭЦП (через NCALayer API)

```javascript
import NCALayerClient from 'ncalayer-js-client';

// 1. Подключение к NCALayer (или KazEDS Extension)
const ncaLayer = new NCALayerClient();
await ncaLayer.connect();

// 2. Выбор хранилища
const keyStore = await ncaLayer.browseKeyStore('PKCS12', 'P12', '');

// 3. Получение ключей
const keys = await ncaLayer.getKeys('PKCS12', keyStore, '', 'AUTHENTICATION');

// 4. Генерация challenge
const challenge = crypto.getRandomValues(new Uint8Array(32));
const challengeBase64 = btoa(String.fromCharCode(...challenge));

// 5. Подписание challenge
const signature = await ncaLayer.signPlainData(
  'PKCS12', keyStore, keys[0], '', challengeBase64
);

// 6. Получение сертификата
const subjectDN = await ncaLayer.getSubjectDN('PKCS12', keyStore, keys[0], '');
const notBefore = await ncaLayer.getNotBefore('PKCS12', keyStore, keys[0], '');
const notAfter = await ncaLayer.getNotAfter('PKCS12', keyStore, keys[0], '');

// 7. Сохранение в сессию
sessionStorage.setItem('user', JSON.stringify({
  subjectDN,
  notBefore,
  notAfter,
  authenticatedAt: new Date().toISOString()
}));
```

## 6. Флоу подписания документа

```javascript
// 1. Пользователь загружает файл
const file = event.target.files[0];
const arrayBuffer = await file.arrayBuffer();
const base64Data = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

// 2. Подписание через NCALayer
const cmsSignature = await ncaLayer.createCMSSignature(
  'PKCS12',
  keyStore,    // из сессии
  keyAlias,    // из сессии
  '',          // пароль (запрашивает NCALayer/KazEDS)
  base64Data,
  true         // flag: attached signature
);

// 3. Отображение результата
// cmsSignature — base64-encoded CMS/PKCS#7

// 4. Скачивание .sig файла
const blob = new Blob([atob(cmsSignature)], { type: 'application/pkcs7-signature' });
const url = URL.createObjectURL(blob);
// → ссылка на скачивание
```

## 7. Страницы

### 7.1. Главная (`/`)
- Логотип KazEDS, описание проекта
- Индикатор подключения к NCALayer (зелёный / красный)
- Кнопка «Войти по ЭЦП» (активна если NCALayer подключён)
- Баннер установки если не подключён
- Ссылка на страницу «Проверить подпись»

### 7.2. Личный кабинет (`/dashboard`)
- Данные из сертификата: ФИО (CN), email, организация
- Срок действия сертификата
- Кнопка «Подписать документ»
- Кнопка «Выйти» (очистка sessionStorage)

### 7.3. Подписание (`/sign`)
- Зона drag & drop для файла
- Информация о файле: имя, размер, SHA-256 хеш
- Кнопка «Подписать» → вызов NCALayer
- Результат: информация о подписи + скачивание .sig
- История подписаний (в sessionStorage, сбрасывается при закрытии)

### 7.4. Проверка подписи (`/verify`)
- Два поля: оригинальный файл + .sig файл
- Кнопка «Проверить»
- Результат: валидна/невалидна, данные подписанта

## 8. Структура проекта

```
kazeds-demo/
├── src/
│   ├── app/
│   │   ├── page.tsx                 # Главная
│   │   ├── layout.tsx
│   │   ├── dashboard/
│   │   │   └── page.tsx             # Личный кабинет
│   │   ├── sign/
│   │   │   └── page.tsx             # Подписание
│   │   └── verify/
│   │       └── page.tsx             # Проверка подписи
│   ├── components/
│   │   ├── AuthButton.tsx           # Кнопка «Войти по ЭЦП»
│   │   ├── NCALayerStatus.tsx       # Индикатор подключения
│   │   ├── ExtensionBanner.tsx      # Баннер установки
│   │   ├── FileDropZone.tsx         # Drag & drop файлов
│   │   ├── SignResult.tsx           # Результат подписания
│   │   └── VerifyResult.tsx         # Результат верификации
│   ├── lib/
│   │   ├── ncalayer.ts             # Обёртка над ncalayer-js-client
│   │   ├── crypto.ts               # Хеширование, верификация (pkijs)
│   │   ├── auth.ts                 # sessionStorage сессия
│   │   └── utils.ts                # base64, форматирование DN
│   └── hooks/
│       ├── useNCALayer.ts          # React hook для подключения
│       └── useAuth.ts             # React hook для сессии
├── public/
│   └── favicon.ico
├── package.json
├── tsconfig.json
├── tailwind.config.ts
└── next.config.ts
```

## 9. Зависимости

```json
{
  "dependencies": {
    "next": "^14.0.0",
    "react": "^18.0.0",
    "ncalayer-js-client": "^1.5.7",
    "pkijs": "^3.0.0",
    "tailwindcss": "^3.4.0",
    "@radix-ui/react-dialog": "latest",
    "lucide-react": "latest"
  }
}
```

## 10. Безопасность

| Аспект | Реализация |
|--------|-----------|
| Сессия | sessionStorage (очищается при закрытии вкладки) |
| Challenge | Генерируется через Web Crypto API (crypto.getRandomValues) |
| Верификация | Клиентская, через pkijs |
| Приватные ключи | Никогда не покидают NCALayer/iOS App |
| HTTPS | Обязателен в production |
| XSS | React автоматически экранирует, CSP headers |

## 11. Развёртывание

Статический сайт (SSG) или SPA — развёртывается на любом хостинге:

```bash
# Build
npm run build

# Preview
npm run start

# Deploy (Vercel)
vercel deploy
```

Никаких серверных зависимостей, баз данных или API-ключей.

## 12. Критерии приёмки MVP

1. Сайт определяет подключение к NCALayer/KazEDS Extension (зелёный/красный индикатор)
2. Если не подключён — показывает баннер со ссылками на установку
3. «Войти по ЭЦП» вызывает стандартные методы NCALayer через `ncalayer-js-client`
4. После входа — отображает данные из сертификата (ФИО, email, срок)
5. «Подписать документ» — загрузка файла, CMS-подпись, скачивание .sig
6. Работает одинаково с настоящим NCALayer и с KazEDS Chrome Extension
7. Сайт не имеет бэкенда — полностью клиентский
