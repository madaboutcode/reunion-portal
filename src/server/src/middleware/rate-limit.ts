import type { Context, Next } from "hono";
import type { AppEnv, Env } from "../env.js";

const store = new Map<string, { count: number; resetAt: number }>();

/** Clear all rate limit counters. Intended for use in tests only. */
export function clearRateLimitStore(): void {
  store.clear();
}

const PRESETS = {
  upload: {
    envMaxKey: "RATE_LIMIT_UPLOAD_MAX",
    envWindowKey: "RATE_LIMIT_UPLOAD_WINDOW_MS",
    defaultMax: 15,
    defaultWindowMs: 3_600_000, // 1 hour
  },
  auth: {
    envMaxKey: "RATE_LIMIT_AUTH_MAX",
    envWindowKey: "RATE_LIMIT_AUTH_WINDOW_MS",
    defaultMax: 10,
    defaultWindowMs: 60_000,
  },
  mutation: {
    envMaxKey: "RATE_LIMIT_MUTATION_MAX",
    envWindowKey: "RATE_LIMIT_MUTATION_WINDOW_MS",
    defaultMax: 10,
    defaultWindowMs: 60_000,
  },
  query: {
    envMaxKey: "RATE_LIMIT_QUERY_MAX",
    envWindowKey: "RATE_LIMIT_QUERY_WINDOW_MS",
    defaultMax: 30,
    defaultWindowMs: 60_000,
  },
  photo: {
    envMaxKey: "RATE_LIMIT_PHOTO_MAX",
    envWindowKey: "RATE_LIMIT_PHOTO_WINDOW_MS",
    defaultMax: 200,
    defaultWindowMs: 60_000,
  },
} as const;

export type RateLimitCategory = keyof typeof PRESETS;

export function rateLimitByCategory(category: RateLimitCategory) {
  return async (c: Context<AppEnv>, next: Next) => {
    if (!c.env || c.env.ENVIRONMENT === "development") {
      await next();
      return;
    }

    const preset = PRESETS[category];
    const envMax = c.env[preset.envMaxKey as keyof Env] as string | undefined;
    const envWindow = c.env[preset.envWindowKey as keyof Env] as string | undefined;
    const maxRequests = envMax !== undefined ? parseInt(envMax, 10) : preset.defaultMax;
    const windowMs = envWindow !== undefined ? parseInt(envWindow, 10) : preset.defaultWindowMs;

    const ip =
      c.req.header("cf-connecting-ip") ??
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown";

    const key = `${category}:${ip}`;
    const now = Date.now();
    const entry = store.get(key);

    if (entry && now < entry.resetAt) {
      if (entry.count >= maxRequests) {
        return c.json({ error: "Too many requests. Try again later." }, 429);
      }
      entry.count++;
    } else {
      store.set(key, { count: 1, resetAt: now + windowMs });
    }

    // Cleanup old entries periodically (every ~100 requests)
    if (Math.random() < 0.01) {
      for (const [k, val] of store) {
        if (now >= val.resetAt) store.delete(k);
      }
    }

    await next();
  };
}

