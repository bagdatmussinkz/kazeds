# Тестовые сертификаты НУЦ РК (GOST 34.10-2015)

Источник: официальный KalkanCrypt SDK 2.0 (`Keys and Certs/`), батч
**2026.05.08 — 2027.05.07**. Это публичные тестовые ключи НУЦ РК для
интеграционного тестирования — не содержат секретов.

**Пароль ко всем .p12: `Qwerty12`**

| Файл | Тип | Назначение |
|------|-----|-----------|
| `individual_valid.p12` | Физлицо, валидный | Основной happy-path GOST-подписи (IIN) |
| `individual_revoked.p12` | Физлицо, отозванный | Негативные тесты OCSP/CRL |
| `legal_ceo_valid.p12` | Юрлицо, первый руководитель | Подпись от организации (IIN+BIN) |
| `legal_signer_valid.p12` | Юрлицо, сотрудник с правом подписи | Корпоративные сценарии |
| `legal_infosystem_valid.p12` | Юрлицо, информационная система | API/М2М подпись |
| `ca/root_test_gost_2022.cer` | Корневой тестовый КУЦ | Chain-валидация (verifier) |
| `ca/nca_gost2022_test.cer` | Промежуточный тестовый НУЦ | Chain-валидация (verifier) |
| `crl/nca_gost2022_test.crl` | Базовый CRL | Проверка отзыва |
| `crl/nca_gost2022_d_test.crl` | Delta CRL | Проверка отзыва |

## Тестовые сервисы НУЦ

- TSA (метки времени): `http://test.pki.gov.kz/tsp/`
- OCSP: `http://test.pki.gov.kz/ocsp/`
- CRL: `http://test.pki.gov.kz/crl/nca_gost2022_test.crl`

Алгоритм всех ключей: GOST Р 34.10-2015 (512 бит), хеш GOST Р 34.11-2015.
