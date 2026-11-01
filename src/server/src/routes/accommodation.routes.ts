import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { rateLimitByCategory } from "../middleware/rate-limit.js";

export const accommodationRoutes = new Hono<AppEnv>();

accommodationRoutes.get(
  "/availability",
  rateLimitByCategory("query"),
  async (c) => {
    const result = await c.var.availabilityService.getAvailability();
    return c.json(result);
  },
);
