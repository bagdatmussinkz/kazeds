import { describe, it, expect, vi, beforeEach } from "vitest";
import { completeSession, RelayError } from "../lib/network/relay-client";

describe("completeSession", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mockRequest = {
    certificate: "MIIB...",
    signature: "abc123",
    algorithm: "SHA256withRSA" as const,
  };

  it("sends POST request with correct body", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await completeSession("session-123", mockRequest);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain("session-123");
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(options.body)).toEqual(mockRequest);
  });

  it("uses callback_url when provided", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await completeSession("session-123", mockRequest, "https://custom.relay/complete");

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://custom.relay/complete");
  });

  it("throws RelayError on non-ok response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ error: "Session already completed" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await expect(completeSession("session-123", mockRequest)).rejects.toThrow(RelayError);
    await expect(completeSession("session-123", mockRequest)).rejects.toThrow("Session already completed");
  });

  it("RelayError includes status code", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: "Not found" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    try {
      await completeSession("session-123", mockRequest);
    } catch (e) {
      expect(e).toBeInstanceOf(RelayError);
      expect((e as RelayError).statusCode).toBe(404);
    }
  });

  it("handles json parse failure in error response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error("bad json")),
    });
    vi.stubGlobal("fetch", mockFetch);

    await expect(completeSession("session-123", mockRequest)).rejects.toThrow(RelayError);
  });
});
