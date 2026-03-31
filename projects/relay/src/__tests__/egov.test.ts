/**
 * eGov QR signing API — Fastify integration tests
 *
 * Tests the eGov-compatible endpoints that emulate the mobileSign protocol:
 * - POST /v1/egov/sessions — create an eGov signing session
 * - GET  /v1/egov/:id/mgovSign — API #1: session metadata + document URI
 * - GET  /v1/egov/:id/documents — API #2 GET: retrieve documents to sign
 * - PUT  /v1/egov/:id/documents — API #2 PUT: submit signed documents
 * - GET  /v1/egov/:id/status — poll session status (for the creating party)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { egovRoutes } from "../routes/egov";
import { EgovStore } from "../services/egov-store";

let app: ReturnType<typeof Fastify>;

const validSession = {
  description: "Кредитный договор",
  organisation: {
    nameRu: "Портал eGov.kz",
    nameKz: "Портал eGov.kz",
    nameEn: "Portal eGov.kz",
    bin: "1234567890",
  },
  signMethod: "XML" as const,
  documentsToSign: [
    {
      id: 1,
      nameRu: "Согласие на предоставление данных",
      nameKz: "test",
      nameEn: "test",
      meta: [
        { name: "ИИН", value: "12345678" },
        { name: "Тип запроса", value: "Номер телефона" },
      ],
      documentXml:
        '<data xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><iin>12345678</iin></data>',
    },
  ],
};

const validCmsSession = {
  description: "PDF документ",
  organisation: {
    nameRu: "Тест орг",
    bin: "9876543210",
  },
  signMethod: "CMS_SIGN_ONLY" as const,
  documentsToSign: [
    {
      id: 1,
      nameRu: "Документ PDF",
      nameKz: "test",
      nameEn: "test",
      document: {
        file: {
          mime: "@file/pdf",
          data: "JVBERi0xLjUNCg==",
        },
      },
    },
  ],
};

beforeAll(async () => {
  app = Fastify();
  await app.register(cors);

  const store = new EgovStore();
  app.decorate("egovStore", store);

  await app.register(egovRoutes, { prefix: "/v1" });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

// Helper: inject request
function inject(
  method: string,
  url: string,
  payload?: unknown,
  headers?: Record<string, string>
) {
  return app.inject({
    method: method as any,
    url,
    payload,
    headers: { "content-type": "application/json", ...headers },
  });
}

// ==================== POST /v1/egov/sessions ====================

describe("POST /v1/egov/sessions", () => {
  it("201 — creates session with valid XML input", async () => {
    const res = await inject("POST", "/v1/egov/sessions", validSession);
    expect(res.statusCode).toBe(201);

    const body = res.json();
    expect(body.session_id).toBeDefined();
    expect(typeof body.session_id).toBe("string");
    expect(body.qr_content).toBeDefined();
    expect(body.qr_content).toMatch(/^mobileSign:/);
    expect(body.expires_at).toBeDefined();
  });

  it("201 — creates session with CMS_SIGN_ONLY input", async () => {
    const res = await inject("POST", "/v1/egov/sessions", validCmsSession);
    expect(res.statusCode).toBe(201);

    const body = res.json();
    expect(body.session_id).toBeDefined();
    expect(body.qr_content).toMatch(/^mobileSign:/);
  });

  it("201 — creates session with CMS_WITH_DATA input", async () => {
    const res = await inject("POST", "/v1/egov/sessions", {
      ...validCmsSession,
      signMethod: "CMS_WITH_DATA",
    });
    expect(res.statusCode).toBe(201);
  });

  it("400 — missing description", async () => {
    const { description, ...rest } = validSession;
    const res = await inject("POST", "/v1/egov/sessions", rest);
    expect(res.statusCode).toBe(400);
  });

  it("400 — missing organisation", async () => {
    const { organisation, ...rest } = validSession;
    const res = await inject("POST", "/v1/egov/sessions", rest);
    expect(res.statusCode).toBe(400);
  });

  it("400 — missing signMethod", async () => {
    const { signMethod, ...rest } = validSession;
    const res = await inject("POST", "/v1/egov/sessions", rest);
    expect(res.statusCode).toBe(400);
  });

  it("400 — missing documentsToSign", async () => {
    const { documentsToSign, ...rest } = validSession;
    const res = await inject("POST", "/v1/egov/sessions", rest);
    expect(res.statusCode).toBe(400);
  });

  it("400 — empty documentsToSign array", async () => {
    const res = await inject("POST", "/v1/egov/sessions", {
      ...validSession,
      documentsToSign: [],
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 — invalid signMethod", async () => {
    const res = await inject("POST", "/v1/egov/sessions", {
      ...validSession,
      signMethod: "INVALID",
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 — empty body", async () => {
    const res = await inject("POST", "/v1/egov/sessions", {});
    expect(res.statusCode).toBe(400);
  });

  it("400 — missing organisation.bin", async () => {
    const res = await inject("POST", "/v1/egov/sessions", {
      ...validSession,
      organisation: { nameRu: "Test" },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ==================== GET /v1/egov/:id/mgovSign (API #1) ====================

describe("GET /v1/egov/:id/mgovSign", () => {
  it("200 — returns correct mgovSign structure", async () => {
    const create = await inject("POST", "/v1/egov/sessions", validSession);
    const { session_id } = create.json();

    const res = await inject("GET", `/v1/egov/${session_id}/mgovSign`);
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.description).toBe(validSession.description);
    expect(body.expiry_date).toBeDefined();
    expect(body.organisation).toBeDefined();
    expect(body.organisation.nameRu).toBe(validSession.organisation.nameRu);
    expect(body.organisation.bin).toBe(validSession.organisation.bin);
    expect(body.document).toBeDefined();
    expect(body.document.uri).toBeDefined();
    expect(typeof body.document.uri).toBe("string");
    expect(body.document.auth_type).toBe("Token");
    expect(body.document.auth_token).toBeDefined();
    expect(typeof body.document.auth_token).toBe("string");
    expect(body.document.auth_token.length).toBeGreaterThan(0);
  });

  it("200 — document.uri contains the session id", async () => {
    const create = await inject("POST", "/v1/egov/sessions", validSession);
    const { session_id } = create.json();

    const res = await inject("GET", `/v1/egov/${session_id}/mgovSign`);
    const body = res.json();
    expect(body.document.uri).toContain(session_id);
  });

  it("404 — non-existent session", async () => {
    const res = await inject(
      "GET",
      "/v1/egov/00000000-0000-0000-0000-000000000000/mgovSign"
    );
    expect(res.statusCode).toBe(404);
  });
});

// ==================== GET /v1/egov/:id/documents (API #2 GET) ====================

describe("GET /v1/egov/:id/documents", () => {
  async function createSessionAndGetToken() {
    const create = await inject("POST", "/v1/egov/sessions", validSession);
    const { session_id } = create.json();

    const mgovRes = await inject("GET", `/v1/egov/${session_id}/mgovSign`);
    const { document } = mgovRes.json();
    return { session_id, auth_token: document.auth_token };
  }

  it("200 — returns documents with valid Bearer token", async () => {
    const { session_id, auth_token } = await createSessionAndGetToken();

    const res = await inject(
      "GET",
      `/v1/egov/${session_id}/documents`,
      undefined,
      { authorization: `Bearer ${auth_token}` }
    );
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.signMethod).toBe("XML");
    expect(body.documentsToSign).toBeDefined();
    expect(Array.isArray(body.documentsToSign)).toBe(true);
    expect(body.documentsToSign.length).toBe(1);
    expect(body.documentsToSign[0].id).toBe(1);
    expect(body.documentsToSign[0].nameRu).toBe(
      "Согласие на предоставление данных"
    );
    expect(body.documentsToSign[0].documentXml).toBeDefined();
  });

  it("200 — returns CMS documents correctly", async () => {
    const create = await inject("POST", "/v1/egov/sessions", validCmsSession);
    const { session_id } = create.json();
    const mgovRes = await inject("GET", `/v1/egov/${session_id}/mgovSign`);
    const { document } = mgovRes.json();

    const res = await inject(
      "GET",
      `/v1/egov/${session_id}/documents`,
      undefined,
      { authorization: `Bearer ${document.auth_token}` }
    );
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.signMethod).toBe("CMS_SIGN_ONLY");
    expect(body.documentsToSign[0].document).toBeDefined();
    expect(body.documentsToSign[0].document.file.mime).toBe("@file/pdf");
  });

  it("200 — returns meta fields when present", async () => {
    const { session_id, auth_token } = await createSessionAndGetToken();

    const res = await inject(
      "GET",
      `/v1/egov/${session_id}/documents`,
      undefined,
      { authorization: `Bearer ${auth_token}` }
    );
    const body = res.json();
    expect(body.documentsToSign[0].meta).toBeDefined();
    expect(body.documentsToSign[0].meta).toHaveLength(2);
    expect(body.documentsToSign[0].meta[0].name).toBe("ИИН");
  });

  it("401 — without authorization header", async () => {
    const create = await inject("POST", "/v1/egov/sessions", validSession);
    const { session_id } = create.json();

    const res = await inject(
      "GET",
      `/v1/egov/${session_id}/documents`,
      undefined
    );
    expect(res.statusCode).toBe(401);
  });

  it("401 — with wrong token", async () => {
    const create = await inject("POST", "/v1/egov/sessions", validSession);
    const { session_id } = create.json();

    const res = await inject(
      "GET",
      `/v1/egov/${session_id}/documents`,
      undefined,
      { authorization: "Bearer wrong-token-value" }
    );
    expect(res.statusCode).toBe(401);
  });

  it("401 — with malformed authorization header", async () => {
    const create = await inject("POST", "/v1/egov/sessions", validSession);
    const { session_id } = create.json();

    const res = await inject(
      "GET",
      `/v1/egov/${session_id}/documents`,
      undefined,
      { authorization: "Basic dXNlcjpwYXNz" }
    );
    expect(res.statusCode).toBe(401);
  });

  it("404 — non-existent session", async () => {
    const res = await inject(
      "GET",
      "/v1/egov/00000000-0000-0000-0000-000000000000/documents",
      undefined,
      { authorization: "Bearer some-token" }
    );
    expect(res.statusCode).toBe(404);
  });
});

// ==================== PUT /v1/egov/:id/documents (API #2 PUT) ====================

describe("PUT /v1/egov/:id/documents", () => {
  async function createAndGetDocuments() {
    const create = await inject("POST", "/v1/egov/sessions", validSession);
    const { session_id } = create.json();

    const mgovRes = await inject("GET", `/v1/egov/${session_id}/mgovSign`);
    const { document } = mgovRes.json();
    const auth_token = document.auth_token;

    // Retrieve documents to know the structure
    const getDocsRes = await inject(
      "GET",
      `/v1/egov/${session_id}/documents`,
      undefined,
      { authorization: `Bearer ${auth_token}` }
    );
    const docs = getDocsRes.json();

    return { session_id, auth_token, docs };
  }

  it("200 — accepts signed documents", async () => {
    const { session_id, auth_token, docs } = await createAndGetDocuments();

    // Mutate: replace documentXml with "signed" version
    const signedDocs = {
      ...docs,
      documentsToSign: docs.documentsToSign.map((doc: any) => ({
        ...doc,
        documentXml: doc.documentXml
          ? `<signed>${doc.documentXml}</signed>`
          : doc.documentXml,
      })),
    };

    const res = await inject(
      "PUT",
      `/v1/egov/${session_id}/documents`,
      signedDocs,
      { authorization: `Bearer ${auth_token}` }
    );
    expect(res.statusCode).toBe(200);
  });

  it("401 — without authorization header", async () => {
    const create = await inject("POST", "/v1/egov/sessions", validSession);
    const { session_id } = create.json();

    const res = await inject("PUT", `/v1/egov/${session_id}/documents`, {
      signMethod: "XML",
      documentsToSign: [{ id: 1, nameRu: "test", documentXml: "<signed/>" }],
    });
    expect(res.statusCode).toBe(401);
  });

  it("401 — with wrong token", async () => {
    const create = await inject("POST", "/v1/egov/sessions", validSession);
    const { session_id } = create.json();

    const res = await inject(
      "PUT",
      `/v1/egov/${session_id}/documents`,
      {
        signMethod: "XML",
        documentsToSign: [
          { id: 1, nameRu: "test", documentXml: "<signed/>" },
        ],
      },
      { authorization: "Bearer wrong-token" }
    );
    expect(res.statusCode).toBe(401);
  });

  it("409 — double submit", async () => {
    const { session_id, auth_token, docs } = await createAndGetDocuments();

    const signedDocs = {
      ...docs,
      documentsToSign: docs.documentsToSign.map((doc: any) => ({
        ...doc,
        documentXml: doc.documentXml
          ? `<signed>${doc.documentXml}</signed>`
          : doc.documentXml,
      })),
    };

    const headers = { authorization: `Bearer ${auth_token}` };

    // First submit — should succeed
    const first = await inject(
      "PUT",
      `/v1/egov/${session_id}/documents`,
      signedDocs,
      headers
    );
    expect(first.statusCode).toBe(200);

    // Second submit — should be 409
    const second = await inject(
      "PUT",
      `/v1/egov/${session_id}/documents`,
      signedDocs,
      headers
    );
    expect(second.statusCode).toBe(409);
  });

  it("404 — non-existent session", async () => {
    const res = await inject(
      "PUT",
      "/v1/egov/00000000-0000-0000-0000-000000000000/documents",
      {
        signMethod: "XML",
        documentsToSign: [
          { id: 1, nameRu: "test", documentXml: "<signed/>" },
        ],
      },
      { authorization: "Bearer some-token" }
    );
    expect(res.statusCode).toBe(404);
  });
});

// ==================== GET /v1/egov/:id/status (polling) ====================

describe("GET /v1/egov/:id/status", () => {
  it("200 — returns pending before signing", async () => {
    const create = await inject("POST", "/v1/egov/sessions", validSession);
    const { session_id } = create.json();

    const res = await inject("GET", `/v1/egov/${session_id}/status`);
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.status).toBe("pending");
  });

  it("200 — returns completed after PUT with signedDocuments", async () => {
    const create = await inject("POST", "/v1/egov/sessions", validSession);
    const { session_id } = create.json();

    // Get token from mgovSign
    const mgovRes = await inject("GET", `/v1/egov/${session_id}/mgovSign`);
    const auth_token = mgovRes.json().document.auth_token;

    // Get documents
    const getDocsRes = await inject(
      "GET",
      `/v1/egov/${session_id}/documents`,
      undefined,
      { authorization: `Bearer ${auth_token}` }
    );
    const docs = getDocsRes.json();

    // Submit signed documents
    const signedDocs = {
      ...docs,
      documentsToSign: docs.documentsToSign.map((doc: any) => ({
        ...doc,
        documentXml: `<signed>${doc.documentXml}</signed>`,
      })),
    };
    await inject("PUT", `/v1/egov/${session_id}/documents`, signedDocs, {
      authorization: `Bearer ${auth_token}`,
    });

    // Poll status
    const res = await inject("GET", `/v1/egov/${session_id}/status`);
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.status).toBe("completed");
    expect(body.signedDocuments).toBeDefined();
    expect(Array.isArray(body.signedDocuments)).toBe(true);
    expect(body.signedDocuments.length).toBe(1);
  });

  it("404 — non-existent session", async () => {
    const res = await inject(
      "GET",
      "/v1/egov/00000000-0000-0000-0000-000000000000/status"
    );
    expect(res.statusCode).toBe(404);
  });
});

// ==================== E2E: Full signing cycle ====================

describe("E2E: eGov QR signing flow", () => {
  it("full XML cycle: create → mgovSign → get docs → put signed → poll completed", async () => {
    // Step 1: Website creates an eGov signing session
    const createRes = await inject("POST", "/v1/egov/sessions", validSession);
    expect(createRes.statusCode).toBe(201);

    const { session_id, qr_content, expires_at } = createRes.json();
    expect(session_id).toBeDefined();
    expect(qr_content).toMatch(/^mobileSign:/);
    expect(expires_at).toBeDefined();

    // Step 2: Mobile app scans QR and calls mgovSign (API #1)
    const mgovRes = await inject("GET", `/v1/egov/${session_id}/mgovSign`);
    expect(mgovRes.statusCode).toBe(200);

    const mgovBody = mgovRes.json();
    expect(mgovBody.description).toBe("Кредитный договор");
    expect(mgovBody.organisation.nameRu).toBe("Портал eGov.kz");
    expect(mgovBody.organisation.bin).toBe("1234567890");
    expect(mgovBody.document.auth_type).toBe("Token");

    const { auth_token } = mgovBody.document;

    // Meanwhile, the creating party polls — should be pending
    const pollPending = await inject("GET", `/v1/egov/${session_id}/status`);
    expect(pollPending.statusCode).toBe(200);
    // After mgovSign, status becomes "scanned"
    expect(["pending", "scanned"]).toContain(pollPending.json().status);

    // Step 3: Mobile app fetches documents (API #2 GET)
    const getDocsRes = await inject(
      "GET",
      `/v1/egov/${session_id}/documents`,
      undefined,
      { authorization: `Bearer ${auth_token}` }
    );
    expect(getDocsRes.statusCode).toBe(200);

    const docsBody = getDocsRes.json();
    expect(docsBody.signMethod).toBe("XML");
    expect(docsBody.documentsToSign).toHaveLength(1);
    expect(docsBody.documentsToSign[0].documentXml).toContain("<iin>");

    // Step 4: Mobile app signs and submits (API #2 PUT)
    const signedPayload = {
      signMethod: docsBody.signMethod,
      documentsToSign: docsBody.documentsToSign.map((doc: any) => ({
        ...doc,
        documentXml: `<signed>${doc.documentXml}</signed>`,
      })),
    };

    const putRes = await inject(
      "PUT",
      `/v1/egov/${session_id}/documents`,
      signedPayload,
      { authorization: `Bearer ${auth_token}` }
    );
    expect(putRes.statusCode).toBe(200);

    // Step 5: Creating party polls — should be completed with signed docs
    const pollCompleted = await inject("GET", `/v1/egov/${session_id}/status`);
    expect(pollCompleted.statusCode).toBe(200);

    const finalBody = pollCompleted.json();
    expect(finalBody.status).toBe("completed");
    expect(finalBody.signedDocuments).toBeDefined();
    expect(finalBody.signedDocuments).toHaveLength(1);
    expect(finalBody.signedDocuments[0].documentXml).toContain("<signed>");
  });

  it("full CMS cycle: create → mgovSign → get docs → put signed → poll completed", async () => {
    // Create CMS session
    const createRes = await inject(
      "POST",
      "/v1/egov/sessions",
      validCmsSession
    );
    expect(createRes.statusCode).toBe(201);

    const { session_id } = createRes.json();

    // API #1
    const mgovRes = await inject("GET", `/v1/egov/${session_id}/mgovSign`);
    expect(mgovRes.statusCode).toBe(200);
    const auth_token = mgovRes.json().document.auth_token;

    // API #2 GET
    const getDocsRes = await inject(
      "GET",
      `/v1/egov/${session_id}/documents`,
      undefined,
      { authorization: `Bearer ${auth_token}` }
    );
    expect(getDocsRes.statusCode).toBe(200);

    const docsBody = getDocsRes.json();
    expect(docsBody.signMethod).toBe("CMS_SIGN_ONLY");
    expect(docsBody.documentsToSign[0].document.file.data).toBeDefined();

    // API #2 PUT — sign the CMS data
    const signedPayload = {
      signMethod: docsBody.signMethod,
      documentsToSign: docsBody.documentsToSign.map((doc: any) => ({
        ...doc,
        document: {
          file: {
            ...doc.document.file,
            data: "U0lHTkVEX0RBVEFfSEVSRQ==", // "SIGNED_DATA_HERE" in base64
          },
        },
      })),
    };

    const putRes = await inject(
      "PUT",
      `/v1/egov/${session_id}/documents`,
      signedPayload,
      { authorization: `Bearer ${auth_token}` }
    );
    expect(putRes.statusCode).toBe(200);

    // Poll — completed
    const pollRes = await inject("GET", `/v1/egov/${session_id}/status`);
    expect(pollRes.statusCode).toBe(200);
    expect(pollRes.json().status).toBe("completed");
    expect(pollRes.json().signedDocuments[0].document.file.data).toBe(
      "U0lHTkVEX0RBVEFfSEVSRQ=="
    );
  });

  it("multiple concurrent eGov sessions are isolated", async () => {
    // Create 3 sessions
    const [s1, s2, s3] = await Promise.all([
      inject("POST", "/v1/egov/sessions", validSession),
      inject("POST", "/v1/egov/sessions", validCmsSession),
      inject("POST", "/v1/egov/sessions", {
        ...validSession,
        description: "Третий документ",
      }),
    ]);

    expect(s1.statusCode).toBe(201);
    expect(s2.statusCode).toBe(201);
    expect(s3.statusCode).toBe(201);

    const id1 = s1.json().session_id;
    const id2 = s2.json().session_id;
    const id3 = s3.json().session_id;

    // All unique
    expect(new Set([id1, id2, id3]).size).toBe(3);

    // Complete only the second
    const mgov2 = await inject("GET", `/v1/egov/${id2}/mgovSign`);
    const token2 = mgov2.json().document.auth_token;

    const docs2 = await inject(
      "GET",
      `/v1/egov/${id2}/documents`,
      undefined,
      { authorization: `Bearer ${token2}` }
    );
    const docsBody2 = docs2.json();

    await inject(
      "PUT",
      `/v1/egov/${id2}/documents`,
      {
        signMethod: docsBody2.signMethod,
        documentsToSign: docsBody2.documentsToSign.map((doc: any) => ({
          ...doc,
          document: {
            file: { ...doc.document.file, data: "c2lnbmVk" },
          },
        })),
      },
      { authorization: `Bearer ${token2}` }
    );

    // Check statuses
    const [st1, st2, st3] = await Promise.all([
      inject("GET", `/v1/egov/${id1}/status`),
      inject("GET", `/v1/egov/${id2}/status`),
      inject("GET", `/v1/egov/${id3}/status`),
    ]);

    expect(st1.json().status).toBe("pending");
    expect(st2.json().status).toBe("completed");
    expect(st3.json().status).toBe("pending");
  });
});
