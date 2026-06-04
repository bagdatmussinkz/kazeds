# QR подписание в приложении eGov Mobile

Сторона клиента генерирует 2 API запроса для подписания документов:

- **API №1** — метод GET
- **API №2** — метод GET и PUT

---

## API №1 — QR код

API №1 будет содержаться в QR коде с префиксом `mobileSign`. Он содержит общие данные для подписания.

**Пример содержания QR кода** (пробелы исключаются):

```
mobileSign:https://some.domen.kz/mgovSign?some_url_parameters
```

### Структура JSON объекта, получаемого от API №1:

```json
{
  "description": "Кредитный договор, Соглашение о неразглашении",
  "expiry_date": "2022-09-29T16:21:37.06+0600",
  "organisation": {
    "nameRu": "Портал eGov.kz",
    "nameKz": "Портал eGov.kz",
    "nameEn": "Портал eGov.kz",
    "bin": "1234567890"
  },
  "document": {
    "uri": "API №2",
    "auth_type": "Token",
    "auth_token": "dcek23ej238wejd3uo2jdjlwed"
  }
}
```

### Поле `auth_type` в объекте `document`:

| Значение | Описание |
|----------|----------|
| `Token`  | Вызвать `uri` методом GET с заголовком `Authorization: Bearer {auth_token}` |
| `Eds`    | Вызвать `uri` методом POST с подписанным auth-ключом XML, содержащим `uri` |
| `None`   | Аутентификация не требуется |

Поле `uri` в объекте `document` содержит **API №2** для получения документов на подписание.

---

## API №2 — Получение и отправка документов

После вызова API №2 методом GET, в ответ возвращается JSON объект с:

- **`signMethod`** — тип подписания: `XML`, `CMS_WITH_DATA`, `CMS_SIGN_ONLY`
- **`documentsToSign`** — массив документов

### Поля документов:

- **`meta`** — массив мета-данных для отображения параметров документа *(не обязательно)*
- **XML**: поле `documentXml` — xml документ для подписания
- **CMS**: объект `document` с типом документа и содержимым в кодировке base64

### Отправка подписанных документов:

После подписания JSON объект «мутирует» — подписанные документы размещаются вместо исходных (`documentXml` или `data`). Остальные поля остаются в исходном виде.

Подписанный результат отправляется на **API №2 методом PUT**:

| Результат валидации | HTTP статус | Сообщение |
|---------------------|-------------|-----------|
| Успешно | `200` | `success` |
| Ошибка подписи | `403` | — |

---

## Примеры ответов GET по API №2

### Подписание по XML:

```json
{
  "signMethod": "XML",
  "documentsToSign": [
    {
      "id": 1,
      "nameRu": "Согласие на предоставление данных",
      "nameKz": "test",
      "nameEn": "test",
      "meta": [
        { "name": "ИИН", "value": "12345678" },
        { "name": "Тип запроса", "value": "Номер телефона" }
      ],
      "documentXml": "<data xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xsi:type=\"\"><iin>12345678</iin><groupId>1</groupId></data>"
    },
    {
      "id": 2,
      "nameRu": "Согласие на обработку данных",
      "nameKz": "test",
      "nameEn": "test",
      "meta": [
        { "name": "ИИН", "value": "87654321" },
        { "name": "Тип запроса", "value": "Кредитная история" }
      ],
      "documentXml": "<data xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xsi:type=\"\"><iin>87654321</iin><groupId>2</groupId></data>"
    }
  ]
}
```

### Подписание по CMS:

```json
{
  "signMethod": "CMS_SIGN_ONLY",
  "documentsToSign": [
    {
      "id": 1,
      "nameRu": "Согласие на предоставление данных",
      "nameKz": "test",
      "nameEn": "test",
      "meta": [
        { "name": "ИИН", "value": "12345678" },
        { "name": "Тип запроса", "value": "Номер телефона" }
      ],
      "document": {
        "file": {
          "mime": "@file/pdf",
          "data": "JVBERi0xLjUNCiW1tbW1DQoxIDAgb2JqDQo8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFIvT..."
        }
      }
    }
  ]
}
```

---

## Пошаговый сценарий подписания

1. **Шаг 1** — Генерация QR кода для подписания на стороне клиента
2. **Шаг 2** — Пользователь в приложении eGov Mobile нажимает кнопку «eGov QR»
3. **Шаг 3** — Пользователь сканирует QR код
4. **Шаг 4** — Пользователь проходит авторизацию в приложении
5. **Шаг 5-1** — Приложение проверяет домен полученного API в списке разрешённых доменов. Если домен не добавлен — отображается ошибка
6. **Шаг 5-2** — Если домен проходит проверку, приложение получает список документов по API №2
7. **Шаг 6** — Пользователь подписывает полученные документы
8. **Шаг 7** — Приложение отправляет PUT запрос с подписанными документами на API клиента
9. **Шаг 8** — Валидация подписи на стороне клиента:
   - **8-1**: Подпись валидна → PUT возвращает статус `200`
   - **8-2**: Подпись невалидна → PUT возвращает статус `403`
10. **Шаг 9** — Завершение подписания и отображение результата на стороне клиента


Примеры жизненные

QR Deeplink https://m.egov.kz/mobileSign?link=https://sign.rekassa.kz/51484b16-af42-11f0-a43b-02420a0b0025/mgovSign&isi=1476128386&ibi=kz.egov.mobile&apn=kz.mobile.mgov

Response
{
    "signMethod": "XML",
    "documentsToSign": [
        {
            "id": 1,
            "nameRu": "Договор на оказание услуг ОФД",
            "nameKz": "Договор на оказание услуг ОФД",
            "nameEn": "Договор на оказание услуг ОФД",
            "meta": [
                {
                    "name": "БИН",
                    "value": "180140005198"
                }
            ],
            "documentXml": "\u003Cdiv class=\"root\"\u003E\u003Cdiv class=\"kk\"\u003E\u003Cdiv class=\"header\"\u003E№1 өтініш\u003C/div\u003E\u003Cdiv class=\"offerCompanyName\"\u003E«COMRUN» ЖШС\u003C/div\u003E\u003Cdiv class=\"joinContract\"\u003E мемлекеттік кірістер органдарына фискалдық деректерді қабылдау, өңдеу, сақтау және өзгеріссіз беру қызметтерін көрсетуге арналған Шартқа қосылу жөнінде\u003C/div\u003E\u003Cdiv class=\"userHeader\"\u003EПайдаланушы туралы мәліметтер:\u003C/div\u003E\u003Cdiv class=\"companyNameHeader\"\u003E1) ұйымның атауы\u003C/div\u003E\u003Cdiv class=\"companyName\"\u003EYUUKI\u003C/div\u003E\u003Cdiv class=\"iinBinHeader\"\u003E2) ҰСН/БСН:\u003C/div\u003E\u003Cdiv class=\"iinBin\"\u003E890403400050\u003C/div\u003E\u003Cdiv class=\"legalAddressHeader\"\u003E3) заңды мекенжайы::\u003C/div\u003E\u003Cdiv class=\"legalAddress\"\u003EАстана қ., Есіл ауд., Сауран көш., 10Т, б/н\u003C/div\u003E\u003Cdiv class=\"bankHeader\"\u003E4) есеп айырысу шотының деректемелері (банк, БСК, ЖСК)*:\u003C/div\u003E\u003Cdiv class=\"bank\"\u003E\u003C/div\u003E\u003Cdiv class=\"contactHeader\"\u003E5) байланыс деректері:\u003C/div\u003E\u003Cdiv class=\"phone\"\u003Eтелефон нөмірі: +77777777772\u003C/div\u003E\u003Cdiv class=\"email\"\u003Eэлектрондық пошта мекенжайы: \u003C/div\u003E\u003Cdiv class=\"footer\"\u003EОсы өтінішке қол қою арқылы Пайдаланушы салық органдарына фискалдық деректерді тұрақты түрде қабылдау, өңдеу, сақтау және беру қызметтерін көрсетуге арналған Үлгілік шарттың талаптарымен танысқанын растайды және оған қосылады\u003C/div\u003E\u003Cdiv class=\"notRequired\"\u003E * толтыруға арналған міндетті емес өріс\u003C/div\u003E\u003C/div\u003E\u003Cdiv class=\"ru\"\u003E\u003Cdiv class=\"header\"\u003EЗаявка №1 \u003C/div\u003E\u003Cdiv class=\"joinContract\"\u003Eна присоединение к Договору на оказание услуги приема, обработки, хранения и передачи в неизменном виде фискальных данных в органы государственных доходов в \u003C/div\u003E\u003Cdiv class=\"offerCompanyName\"\u003EТОО «COMRUN»\u003C/div\u003E\u003Cdiv class=\"userHeader\"\u003EСведения о Пользователе:\u003C/div\u003E\u003Cdiv class=\"companyNameHeader\"\u003E1) наименование организации\u003C/div\u003E\u003Cdiv class=\"companyName\"\u003EYUUKI\u003C/div\u003E\u003Cdiv class=\"iinBinHeader\"\u003E2) ИИН/БИН:\u003C/div\u003E\u003Cdiv class=\"iinBin\"\u003E890403400050\u003C/div\u003E\u003Cdiv class=\"legalAddressHeader\"\u003E3) юридический адрес:\u003C/div\u003E\u003Cdiv class=\"legalAddress\"\u003EАстана г., Есиль р-н, ул. Сауран, 10Т, б/н\u003C/div\u003E\u003Cdiv class=\"bankHeader\"\u003E4) реквизиты расчетного счета (банк, БИК, ИИК)*:\u003C/div\u003E\u003Cdiv class=\"bank\"\u003E\u003C/div\u003E\u003Cdiv class=\"contactHeader\"\u003E5) контактные данные:\u003C/div\u003E\u003Cdiv class=\"phone\"\u003Eномер телефона: +77777777772\u003C/div\u003E\u003Cdiv class=\"email\"\u003Eадрес электронной почты: \u003C/div\u003E\u003Cdiv class=\"footer\"\u003EПодписанием настоящей заявки Пользователь подтверждает, что ознакомлен с условиями Типового договора на оказание услуг приёма, обработки, хранения и передачи в неизменном виде фискальных данных в налоговые органы и присоединяется к нему\u003C/div\u003E\u003Cdiv class=\"notRequired\"\u003E* необязательное поле для заполнения\u003C/div\u003E\u003C/div\u003E\u003C/div\u003E"
        },
        {
            "id": 2,
            "nameRu": "Заявка на присоединение к Договору на оказание услуги приема, обработки, хранения и передачи в неизменном виде фискальных данных в органы государственных доходов",
            "nameKz": "Заявка на присоединение к Договору на оказание услуги приема, обработки, хранения и передачи в неизменном виде фискальных данных в органы государственных доходов",
            "nameEn": "Заявка на присоединение к Договору на оказание услуги приема, обработки, хранения и передачи в неизменном виде фискальных данных в органы государственных доходов",
            "meta": [
                {
                    "name": "БИН",
                    "value": "180140005198"
                }
            ],
            "documentXml": "\u003Cdata\u003E\n\u003CServiceInfo\u003E\n    \u003CRequestGUID\u003E03a19074-0adf-11f0-a58f-02420a0b001b\u003C/RequestGUID\u003E\n    \u003COfdId\u003E9\u003C/OfdId\u003E\n    \u003CRequestDate\u003E2025-03-27T15:15:33.032582+05:00\u003C/RequestDate\u003E\n    \u003CActionType\u003EUSC_ISNA_REGKKM\u003C/ActionType\u003E\n\u003C/ServiceInfo\u003E\n\u003CAcceptanceDate\u003E2025-03-27T15:15:33.032582+05:00\u003C/AcceptanceDate\u003E\n\u003CCodeBI\u003E890403400050\u003C/CodeBI\u003E\n\u003CKKM\u003E\n    \u003CSerialNumber\u003E754HSYD4-PLD\u003C/SerialNumber\u003E\n    \u003CMadeYear\u003E2025\u003C/MadeYear\u003E\n    \u003CMark\u003E0x006500008d1b\u003C/Mark\u003E\n\u003C/KKM\u003E\n\u003CAddress\u003E\n    \u003CRKA\u003E0202100299573386\u003C/RKA\u003E\n    \u003CFlat\u003Eб/н\u003C/Flat\u003E\n\u003C/Address\u003E\n\u003CDigiSign\u003E\u003C/DigiSign\u003E\n\u003C/data\u003E"
        }
    ]
}
