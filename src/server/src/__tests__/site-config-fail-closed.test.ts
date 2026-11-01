/**
 * URLs and identity come from the Worker environment only (site.config.json via
 * deploy.sh, or .dev.vars locally). These tests lock the fail-closed behavior:
 * no fallback to any built-in domain.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { MockEmailService, MailgunEmailService } from "../infra/email.service.js";
import type { Env } from "../env.js";

function envWith(overrides: Partial<Env>): Env {
  return {
    DB: {} as D1Database,
    STORAGE: {} as R2Bucket,
    JWT_SECRET: "test-secret-test-secret-test-secret-123",
    ...overrides,
  } as Env;
}

const SITE = "https://app.example.test";

describe("missing APP_BASE_URL fails closed", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  it("returns 500 naming the variable, and logs which variable is missing", async () => {
    const res = await createApp().request("/api/health", {}, envWith({}));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Server configuration error: APP_BASE_URL is not set" });
    expect(JSON.stringify(errorSpy.mock.calls)).toContain("APP_BASE_URL");
  });

  it("does not fall back to localhost when ENVIRONMENT is development", async () => {
    const res = await createApp().request("/api/health", {}, envWith({ ENVIRONMENT: "development" }));
    expect(res.status).toBe(500);
  });

  it("treats a blank or non-URL value as missing", async () => {
    for (const bad of ["", "   ", "not a url"]) {
      const res = await createApp().request("/api/health", {}, envWith({ APP_BASE_URL: bad }));
      expect(res.status, `value "${bad}"`).toBe(500);
    }
  });

  it("Mailgun without SENDER_NAME returns a 500 config error naming SENDER_NAME", async () => {
    const res = await createApp().request(
      "/api/health",
      {},
      envWith({ APP_BASE_URL: SITE, MAILGUN_API_KEY: "k", MAILGUN_DOMAIN: "mg.example.test" }),
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Server configuration error: SENDER_NAME is not set" });
  });
});

describe("CORS and CSP use the configured values", () => {
  const env = envWith({
    APP_BASE_URL: SITE,
    PUBLIC_THUMBS_URL: "https://thumbs.example.test",
    PUBLIC_PORTRAITS_URL: "https://cdn.example.test/portraits",
  });

  it("allows the configured site origin", async () => {
    const res = await createApp().request("/api/health", { headers: { Origin: SITE } }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(SITE);
  });

  it("does not allow another origin, including localhost outside development", async () => {
    for (const origin of ["https://evil.example.test", "http://localhost:5173"]) {
      const res = await createApp().request("/api/health", { headers: { Origin: origin } }, env);
      expect(res.headers.get("access-control-allow-origin"), origin).toBeNull();
    }
  });

  it("allows localhost in development", async () => {
    const res = await createApp().request(
      "/api/health",
      { headers: { Origin: "http://localhost:5173" } },
      { ...env, ENVIRONMENT: "development" },
    );
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });

  it("puts only the configured asset hosts into the CSP", async () => {
    const res = await createApp().request("/api/health", {}, env);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("img-src 'self' data: blob: https://thumbs.example.test https://cdn.example.test");
    expect(csp).toContain("connect-src 'self' https://thumbs.example.test https://cdn.example.test");
    expect(csp).not.toContain("smriti");
  });

  it("with no asset hosts configured, the CSP lists none", async () => {
    const res = await createApp().request("/api/health", {}, envWith({ APP_BASE_URL: SITE }));
    expect(res.headers.get("content-security-policy")).toContain("img-src 'self' data: blob:;");
  });
});

describe("Mailgun sender identity", () => {
  it("uses the configured sender name and Mailgun domain", async () => {
    const calls: Array<{ body: FormData }> = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
      calls.push({ body: init?.body as FormData });
      return new Response("{}", { status: 200 });
    });
    const svc = new MailgunEmailService("k", "mg.example.test", [], undefined, SITE, "Example Reunion");
    await svc.sendMagicLink("a@example.test", { token: `${SITE}/auth/verify?token=t`, expiresIn: 10 });
    fetchSpy.mockRestore();
    expect(calls[0]?.body.get("from")).toBe("Example Reunion <noreply@mg.example.test>");
  });
});

describe("magic links without Mailgun", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  const link = (base: string) => `${base}/auth/verify?token=SECRET-TOKEN-123`;
  const printed = () => JSON.stringify([...logSpy.mock.calls, ...errorSpy.mock.calls]);

  it.each(["http://localhost:5173", "http://127.0.0.1:5173"])("prints the link when running locally (%s)", async (base) => {
    await new MockEmailService(base).sendMagicLink("a@example.test", { token: link(base), expiresIn: 10 });
    expect(printed()).toContain("SECRET-TOKEN-123");
  });

  it("does not print the link on a deployed host, and logs that email is not configured", async () => {
    await new MockEmailService(SITE).sendMagicLink("a@example.test", { token: link(SITE), expiresIn: 10 });
    expect(printed()).not.toContain("SECRET-TOKEN-123");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain("email is not configured");
  });

  it("applies the same rule to staff-welcome and payment links", async () => {
    const svc = new MockEmailService(SITE);
    await svc.sendStaffWelcome("a@example.test", { token: link(SITE), expiresIn: 10 } as never);
    await svc.sendPaymentLink("a@example.test", { link: link(SITE), expiresInHours: 1 } as never);
    expect(printed()).not.toContain("SECRET-TOKEN-123");
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });

  it("a host that merely contains 'localhost' is not local", async () => {
    const base = "https://localhost.example.test";
    await new MockEmailService(base).sendMagicLink("a@example.test", { token: link(base), expiresIn: 10 });
    expect(printed()).not.toContain("SECRET-TOKEN-123");
  });
});
