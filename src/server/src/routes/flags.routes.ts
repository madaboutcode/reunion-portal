import { Hono } from "hono";
import type { AppEnv } from "../env.js";

export const flagsRoutes = new Hono<AppEnv>();

flagsRoutes.get("/:code", async (c) => {
  const rawCode = c.req.param("code");
  const code = rawCode?.trim().toLowerCase();

  if (!code || !/^[a-z]{2}$/.test(code)) {
    return c.text("Flag not found", 404);
  }

  const upstream = await fetch(`https://flagcdn.com/${code}.svg`, {
    headers: {
      Accept: "image/svg+xml,image/*;q=0.8,*/*;q=0.5",
    },
  });

  if (!upstream.ok) {
    return c.text("Flag not found", upstream.status === 404 ? 404 : 502);
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "image/svg+xml",
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  });
});
