// Minimal X.509 DER parser (vanilla JS, MV3 service-worker safe).
// Extracts the fields real NCALayer returns from commonUtils.getKeyInfo —
// sites like kazpatent do `responseObject.subjectDn.split(...)` etc. and
// crash if those fields are missing.

const OID_NAMES = {
  "2.5.4.3": "CN",
  "2.5.4.4": "SURNAME",
  "2.5.4.5": "SERIALNUMBER",
  "2.5.4.6": "C",
  "2.5.4.7": "L",
  "2.5.4.8": "S",
  "2.5.4.9": "STREET",
  "2.5.4.10": "O",
  "2.5.4.11": "OU",
  "2.5.4.12": "T",
  "2.5.4.42": "GIVENNAME",
  "1.2.840.113549.1.9.1": "EMAILADDRESS",
  "0.9.2342.19200300.100.1.25": "DC",
};

// --- DER TLV reader ---

function readTLV(bytes, offset) {
  const tag = bytes[offset];
  let len = bytes[offset + 1];
  let headerLen = 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = (len << 8) | bytes[offset + 2 + i];
    headerLen = 2 + n;
  }
  return { tag, len, headerLen, start: offset + headerLen, end: offset + headerLen + len };
}

function children(bytes, tlv) {
  const out = [];
  let off = tlv.start;
  while (off < tlv.end) {
    const c = readTLV(bytes, off);
    out.push(c);
    off = c.end;
  }
  return out;
}

function decodeOID(bytes, tlv) {
  const parts = [];
  let value = 0;
  for (let i = tlv.start; i < tlv.end; i++) {
    value = value * 128 + (bytes[i] & 0x7f);
    if (!(bytes[i] & 0x80)) {
      if (parts.length === 0) {
        parts.push(Math.floor(value / 40), value % 40);
      } else {
        parts.push(value);
      }
      value = 0;
    }
  }
  return parts.join(".");
}

function decodeString(bytes, tlv) {
  const slice = bytes.subarray(tlv.start, tlv.end);
  if (tlv.tag === 0x1e) {
    // BMPString — UTF-16BE
    let s = "";
    for (let i = 0; i < slice.length; i += 2) s += String.fromCharCode((slice[i] << 8) | slice[i + 1]);
    return s;
  }
  return new TextDecoder("utf-8").decode(slice);
}

function decodeTime(bytes, tlv) {
  const s = decodeString(bytes, tlv); // "YYMMDDHHMMSSZ" | "YYYYMMDDHHMMSSZ"
  let year, rest;
  if (tlv.tag === 0x17) {
    const yy = parseInt(s.slice(0, 2), 10);
    year = yy < 50 ? 2000 + yy : 1900 + yy;
    rest = s.slice(2);
  } else {
    year = parseInt(s.slice(0, 4), 10);
    rest = s.slice(4);
  }
  const month = parseInt(rest.slice(0, 2), 10) - 1;
  const day = parseInt(rest.slice(2, 4), 10);
  const hour = parseInt(rest.slice(4, 6), 10);
  const min = parseInt(rest.slice(6, 8), 10);
  const sec = parseInt(rest.slice(8, 10), 10) || 0;
  return Date.UTC(year, month, day, hour, min, sec);
}

function hex(bytes, start, end) {
  let s = "";
  for (let i = start; i < end; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

// Name (RDNSequence) → "CN=...,SERIALNUMBER=...,C=KZ" (reverse RDN order, как NCALayer)
function decodeName(bytes, nameTlv) {
  const rdns = [];
  for (const rdnSet of children(bytes, nameTlv)) {
    for (const attr of children(bytes, rdnSet)) {
      const kids = children(bytes, attr);
      const oid = decodeOID(bytes, kids[0]);
      const val = decodeString(bytes, kids[1]);
      rdns.push(`${OID_NAMES[oid] || `OID.${oid}`}=${val}`);
    }
  }
  return rdns.reverse().join(",");
}

function getCN(dn) {
  const m = dn.match(/(?:^|,)CN=([^,]*)/);
  return m ? m[1] : "";
}

/**
 * Parse a base64 DER X.509 certificate into NCALayer getKeyInfo fields.
 * Throws on anything that does not look like a certificate.
 */
export function parseCertificate(base64Der) {
  const bin = atob(base64Der.replace(/\s+/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  const cert = readTLV(bytes, 0); // Certificate SEQ
  const [tbs] = children(bytes, cert);
  const tbsKids = children(bytes, tbs);

  let idx = 0;
  if (tbsKids[idx].tag === 0xa0) idx++; // [0] version

  const serialTlv = tbsKids[idx++]; // INTEGER
  let serialStart = serialTlv.start;
  while (serialStart < serialTlv.end - 1 && bytes[serialStart] === 0) serialStart++; // strip leading 00
  const serialNumber = hex(bytes, serialStart, serialTlv.end);

  idx++; // signature AlgorithmIdentifier
  const issuerTlv = tbsKids[idx++];
  const validityTlv = tbsKids[idx++];
  const subjectTlv = tbsKids[idx++];
  const spkiTlv = tbsKids[idx++];

  const [notBeforeTlv, notAfterTlv] = children(bytes, validityTlv);
  const issuerDn = decodeName(bytes, issuerTlv);
  const subjectDn = decodeName(bytes, subjectTlv);

  // SPKI algorithm OID → NCALayer algorithm name
  const spkiAlgSeq = children(bytes, spkiTlv)[0];
  const spkiOid = decodeOID(bytes, children(bytes, spkiAlgSeq)[0]);
  let algorithm = "RSA";
  if (spkiOid.startsWith("1.2.398.3.10.1.1") || spkiOid.startsWith("1.2.643")) algorithm = "ECGOST34310";
  else if (spkiOid === "1.2.840.10045.2.1") algorithm = "EC";

  // Extensions [3]: subjectKeyIdentifier (2.5.29.14), authorityKeyIdentifier (2.5.29.35)
  let keyId = "";
  let authorityKeyIdentifier = "";
  for (let i = idx; i < tbsKids.length; i++) {
    if (tbsKids[i].tag !== 0xa3) continue;
    const extSeq = children(bytes, tbsKids[i])[0];
    for (const ext of children(bytes, extSeq)) {
      const kids = children(bytes, ext);
      const extOid = decodeOID(bytes, kids[0]);
      const valueOctets = kids[kids.length - 1]; // OCTET STRING (skip optional critical BOOLEAN)
      if (extOid === "2.5.29.14") {
        const inner = readTLV(bytes, valueOctets.start); // OCTET STRING inside
        keyId = hex(bytes, inner.start, inner.end);
      } else if (extOid === "2.5.29.35") {
        const seq = readTLV(bytes, valueOctets.start);
        for (const c of children(bytes, seq)) {
          if (c.tag === 0x80) authorityKeyIdentifier = hex(bytes, c.start, c.end);
        }
      }
    }
  }

  const b64 = btoa(bin);
  const pem =
    "-----BEGIN CERTIFICATE-----\n" +
    (b64.match(/.{1,64}/g) || []).join("\n") +
    "\n-----END CERTIFICATE-----\n";

  return {
    keyId,
    algorithm,
    subjectCn: getCN(subjectDn),
    subjectDn,
    issuerCn: getCN(issuerDn),
    issuerDn,
    serialNumber,
    certNotBefore: String(decodeTime(bytes, notBeforeTlv)),
    certNotAfter: String(decodeTime(bytes, notAfterTlv)),
    authorityKeyIdentifier,
    pem,
  };
}
