/**
 * CONTRACT: per-environment URLs and identity, read from the Worker environment.
 *
 * Owner of the values: site.config.json (repo root). scripts/deploy.sh reads it and
 * passes the values to `wrangler deploy --var KEY:VALUE`. Locally they come from
 * src/server/.dev.vars. No default exists in code: a missing value is a configuration
 * error, never a silent fallback to some other site.
 *
 * GUARANTEES:
 *   - requireVar throws ConfigError naming the missing variable.
 *   - originOf returns scheme://host[:port] or null when the value is not a URL.
 *   - isLocalUrl is true only for localhost, 127.0.0.1 and [::1] hosts.
 */
export class ConfigError extends Error {
  readonly variable: string;
  constructor(variable: string) {
    super(
      `${variable} is not set. Deploy with scripts/deploy.sh (it reads site.config.json), ` +
        `or set ${variable} in src/server/.dev.vars for local development.`,
    );
    this.name = "ConfigError";
    this.variable = variable;
  }
}

export function requireVar<K extends string>(env: { [P in K]?: string }, name: K): string {
  const value = env[name];
  if (typeof value !== "string" || value.trim() === "") throw new ConfigError(name);
  return value.trim();
}

export function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

export function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  } catch {
    return false;
  }
}

/** Origins the browser may load assets from: the configured thumbs and portraits hosts. */
export function assetOrigins(env: { PUBLIC_THUMBS_URL?: string; PUBLIC_PORTRAITS_URL?: string }): string[] {
  const out = new Set<string>();
  for (const v of [env.PUBLIC_THUMBS_URL, env.PUBLIC_PORTRAITS_URL]) {
    const o = originOf(v);
    if (o) out.add(o);
  }
  return [...out];
}

/** CORS allow-list: the configured site origin, plus the local web app in development. */
export function allowedOrigins(env: { APP_BASE_URL?: string; ENVIRONMENT?: string }): string[] {
  const site = originOf(requireVar(env, "APP_BASE_URL"));
  if (!site) throw new ConfigError("APP_BASE_URL");
  const out = [site];
  if (env.ENVIRONMENT === "development") out.push("http://localhost:5173", "http://127.0.0.1:5173");
  return out;
}
