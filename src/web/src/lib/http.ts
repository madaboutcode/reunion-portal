import { getToken, clearAuth } from "./auth";
import { clearScopeCache } from "@/hooks/useStaffScopes";

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, details?: unknown) {
    super(code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

type AuthMode = "none" | "optional" | "required";

interface ClientConfig {
  auth: AuthMode;
  on401?: () => void;
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  json?: unknown;
  body?: BodyInit;
  raw?: boolean;
}

function createClient(config: ClientConfig) {
  async function request<T = unknown>(
    path: string,
    init: RequestOptions = {},
  ): Promise<T> {
    const { json, raw, ...fetchInit } = init;
    const headers = new Headers(fetchInit.headers);

    // 1. Body serialization
    if (json !== undefined) {
      fetchInit.body = JSON.stringify(json);
      if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
    }
    // FormData: let browser set Content-Type with boundary
    // (don't touch headers if body is already FormData)

    // 2. Auth injection
    if (config.auth === "required") {
      const token = getToken();
      if (!token) {
        config.on401?.();
        throw new ApiError(401, "NO_TOKEN", "No auth token available");
      }
      headers.set("Authorization", `Bearer ${token}`);
    } else if (config.auth === "optional") {
      const token = getToken();
      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }
    }

    fetchInit.headers = headers;

    // 3. Fetch
    let response: Response;
    try {
      response = await fetch(path, fetchInit as RequestInit);
    } catch {
      throw new ApiError(0, "NETWORK_ERROR", "Network error — check your connection and try again.");
    }

    // 4. Response handling
    if (response.status === 401) {
      config.on401?.();
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: "Unknown error" }));
      throw new ApiError(
        response.status,
        body.error ?? body.code ?? "REQUEST_FAILED",
        body,
      );
    }

    // 5. Raw mode for non-JSON responses (file downloads, CSV)
    if (raw) {
      return response as T;
    }

    return response.json() as Promise<T>;
  }

  return request;
}

// ---------------------------------------------------------------------------
// Client instances
// ---------------------------------------------------------------------------

export const publicClient = createClient({ auth: "none" });

export const authClient = createClient({
  auth: "required",
  on401: () => {
    clearAuth();
    window.dispatchEvent(new CustomEvent("auth:expired"));
  },
});

export const optionalAuthClient = createClient({ auth: "optional" });

export const staffClient = createClient({
  auth: "required",
  on401: () => {
    clearAuth();
    clearScopeCache();
    const returnTo = encodeURIComponent(window.location.pathname);
    window.location.href = `/login?returnTo=${returnTo}`;
  },
});

// ---------------------------------------------------------------------------
// Query string helper
// ---------------------------------------------------------------------------

export function toQueryString(params?: object): string {
  if (!params) return "";
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}
