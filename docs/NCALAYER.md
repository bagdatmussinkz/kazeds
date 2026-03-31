# NCALayer Protocol Reference

Technical documentation for NCALayer WebSocket API, based on `ncalayer-js-client` v1.5.10 by SIGEX.

## 1. Connection Protocol

**WebSocket URL:** `wss://127.0.0.1:13579` (default)

### Handshake

1. Client opens WebSocket
2. **NCALayer sends first** (unsolicited) -- no request needed
3. Client expects `response.result.version`
4. After version, client probes KAZTOKEN: `{ module: "kz.digiflow.mobile.extensions", method: "getVersion" }`

```
Client: [opens WebSocket]
NCALayer: {"result":{"version":"1.3"}}
Client: {"module":"kz.digiflow.mobile.extensions","method":"getVersion"}
NCALayer: (response or error -- error means not KAZTOKEN)
```

## 2. Message Format

### Request
```json
{
  "module": "<module_name>",
  "method": "<method_name>",
  "args": <object_or_array>
}
```

- `kz.gov.pki.knca.basics` -- `args` is **object** (named params)
- `kz.gov.pki.knca.commonUtils` -- `args` is **array** (positional params)

### Response -- `basics` module
```json
{"status": true, "body": {"result": "<data>"}}       // success
{"status": true, "body": {}}                           // cancelled by user
{"status": false, "code": "...", "message": "..."}    // error
```

### Response -- `commonUtils` module
```json
{"code": "200", "responseObject": "<data>"}   // success
{"code": "500", "message": "Error"}           // error
```

## 3. Modules

| Module | Purpose |
|--------|---------|
| `kz.gov.pki.knca.basics` | New signing module (recommended) |
| `kz.gov.pki.knca.commonUtils` | Legacy module |
| `kz.digiflow.mobile.extensions` | KAZTOKEN detection |

## 4. Methods -- `kz.gov.pki.knca.basics`

### `sign`
```json
{
  "module": "kz.gov.pki.knca.basics",
  "method": "sign",
  "args": {
    "allowedStorages": ["PKCS12"] | null,
    "format": "cms" | "xml",
    "data": "<base64_or_array>",
    "signingParams": { "decode": true, "encapsulate": false, "digested": false, "tsaProfile": {} },
    "signerParams": { "extKeyUsageOids": ["1.3.6.1.5.5.7.3.4"] },
    "locale": "ru"
  }
}
```

JS client wrappers:
- `basicsSignCMS(allowedStorages, data, signingParams, signerParams, locale)` -- CMS signing
- `basicsSignXML(allowedStorages, data, signingParams, signerParams, locale)` -- XML signing

## 5. Methods -- `kz.gov.pki.knca.commonUtils`

### `getActiveTokens`
```json
{"module": "kz.gov.pki.knca.commonUtils", "method": "getActiveTokens"}
// Response: {"code": "200", "responseObject": ["PKCS12", "AKKaztokenStore"]}
```

### `getKeyInfo(storageType)`
```json
{"module": "kz.gov.pki.knca.commonUtils", "method": "getKeyInfo", "args": ["PKCS12"]}
```

### `createCAdESFromBase64(storageType, keyType, data, attach)`
```json
{"module": "kz.gov.pki.knca.commonUtils", "method": "createCAdESFromBase64", "args": ["PKCS12", "SIGNATURE", "<base64>", false]}
```

### `createCAdESFromBase64Hash(storageType, keyType, hash)`
```json
{"module": "kz.gov.pki.knca.commonUtils", "method": "createCAdESFromBase64Hash", "args": ["PKCS12", "SIGNATURE", "<base64Hash>"]}
```

### `createCMSSignatureFromBase64` (DEPRECATED -- includes TSP)
```json
{"module": "kz.gov.pki.knca.commonUtils", "method": "createCMSSignatureFromBase64", "args": ["PKCS12", "SIGNATURE", "<base64>", false]}
```

### `signXml(storageType, keyType, xml, tbsXPath, sigParentXPath)`
```json
{"module": "kz.gov.pki.knca.commonUtils", "method": "signXml", "args": ["PKCS12", "SIGNATURE", "<xml>", "", ""]}
```

### `signXmls(storageType, keyType, xmls, tbsXPath, sigParentXPath)`
```json
{"module": "kz.gov.pki.knca.commonUtils", "method": "signXmls", "args": ["PKCS12", "SIGNATURE", ["<xml1>", "<xml2>"], "", ""]}
```

### `changeLocale(localeId)`
```json
{"module": "kz.gov.pki.knca.commonUtils", "method": "changeLocale", "args": ["ru"]}
```

## 6. Storage Types

| Static Getter | Value | Description |
|---|---|---|
| `basicsStoragePKCS12` | `['PKCS12']` | File-based PKCS#12 |
| `basicsStorageKAZTOKEN` | `['AKKaztokenStore']` | KAZTOKEN hardware token |
| `basicsStorageIDCard` | `['AKKZIDCardStore']` | Kazakhstan ID card |
| `basicsStorageAll` | `null` | Any available storage |
| `basicsStorageHardware` | `['AKKaztokenStore', 'AKKZIDCardStore', 'AKEToken72KStore', 'AKEToken5110Store', 'AKAKEYStore']` | Hardware only |

## 7. CMS Signing Parameters

| Static Getter | Description |
|---|---|
| `basicsCMSParamsDetached` | `{decode:true, encapsulate:false, digested:false, tsaProfile:{}}` -- Detached with TSP |
| `basicsCMSParamsDetachedNoTSP` | `{decode:true, encapsulate:false, digested:false}` -- Detached, no TSP |
| `basicsCMSParamsDetachedHash` | `{decode:true, encapsulate:false, digested:true, tsaProfile:{}}` -- From pre-hash |
| `basicsCMSParamsAttached` | `{decode:true, encapsulate:true, digested:false, tsaProfile:{}}` -- Data embedded |

## 8. Signer Parameters (Certificate Selection)

| Static Getter | OIDs | Description |
|---|---|---|
| `basicsSignerAny` | `[]` | Any certificate |
| `basicsSignerSignAny` | `['1.3.6.1.5.5.7.3.4']` | Any signing cert |
| `basicsSignerSignPerson` | `['1.3.6.1.5.5.7.3.4', '1.2.398.3.3.4.1.1']` | Individual person |
| `basicsSignerSignOrg` | `['1.3.6.1.5.5.7.3.4', '1.2.398.3.3.4.1.2']` | Org employee |
| `basicsSignerSignHead` | `['1.3.6.1.5.5.7.3.4', '1.2.398.3.3.4.1.2.1']` | Org head/CEO |
| `basicsSignerAuthAny` | `['1.3.6.1.5.5.7.3.2']` | Any auth cert |
| `basicsSignerAuthPerson` | `['1.3.6.1.5.5.7.3.2', '1.2.398.3.3.4.1.1']` | Individual person auth |
| `basicsSignerTestAny` | `{extKeyUsageOids:[], chain:[]}` | Any cert including test CA |

**OID meanings:**
- `1.3.6.1.5.5.7.3.4` -- emailProtection (signing)
- `1.3.6.1.5.5.7.3.2` -- clientAuth (authentication)
- `1.2.398.3.3.4.1.1` -- KZ NCA individual person
- `1.2.398.3.3.4.1.2` -- KZ NCA organization
- `1.2.398.3.3.4.1.2.1` -- KZ NCA org head
- `1.2.398.3.3.4.1.2.2` -- KZ NCA authorized signer

## 9. Wire-Level Examples

### CMS Detached Sign (basics)
```
-> {"module":"kz.gov.pki.knca.basics","method":"sign","args":{"allowedStorages":null,"format":"cms","data":"MTEK","signingParams":{"decode":true,"encapsulate":false,"digested":false,"tsaProfile":{}},"signerParams":{"extKeyUsageOids":["1.3.6.1.5.5.7.3.4"]},"locale":"ru"}}
<- {"status":true,"body":{"result":["MIIGbg..."]}}
```

### CAdES Sign (commonUtils)
```
-> {"module":"kz.gov.pki.knca.commonUtils","method":"createCAdESFromBase64","args":["PKCS12","SIGNATURE","MTEK",false]}
<- {"code":"200","responseObject":"MIIGbg..."}
```

## 10. JS Client Methods Summary

| Method | Module | Purpose |
|--------|--------|---------|
| `connect()` | -- | Open WebSocket, get version |
| `basicsSignCMS(...)` | basics | CMS signing |
| `basicsSignXML(...)` | basics | XML signing |
| `getActiveTokens()` | commonUtils | List storages |
| `getKeyInfo(storage)` | commonUtils | Get key/cert info |
| `createCAdESFromBase64(...)` | commonUtils | CAdES signing |
| `createCAdESFromBase64Hash(...)` | commonUtils | CAdES from hash |
| `signXml(...)` | commonUtils | Sign XML |
| `signXmls(...)` | commonUtils | Sign multiple XMLs |
| `changeLocale(id)` | commonUtils | Change language |

## 11. KazEDS Implementation Gap

Currently handled: `browseKeyStore`, `getVersion`, `basics_sign`, `basics_authenticate`, `getKeys`, `signPlainData`, `createCMSSignature`, `basicsSign`, `basicsAuthenticate`, `getSubjectDN`, `getNotBefore`, `getNotAfter`, `setLocale`

**Not yet handled:**
- `getActiveTokens` (commonUtils)
- `getKeyInfo` (commonUtils)
- `createCAdESFromBase64` (commonUtils)
- `createCAdESFromBase64Hash` (commonUtils)
- `signXml` / `signXmls` (commonUtils)
- `changeLocale` (commonUtils)
