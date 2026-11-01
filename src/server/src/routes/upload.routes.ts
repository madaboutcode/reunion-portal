import { type Context, Hono } from "hono";
import type { AppEnv } from "../env.js";
import { rateLimitByCategory } from "../middleware/rate-limit.js";
import { setRequestMeta } from "../infra/request-meta.js";

const MAX_SIZE = 5 * 1024 * 1024; // 5MB

function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 50);
}

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "application/pdf": "pdf",
  };
  return map[mime] ?? "bin";
}

async function shortHash(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 8);
}

interface UploadConfig {
  allowedTypes: string[];
  typeErrorMessage: string;
  keyPrefix: string;
}

async function handleUpload(c: Context<AppEnv>, config: UploadConfig) {
  const body = await c.req.parseBody();

  const file = body["file"];
  const fullName = body["fullName"];
  const branch = body["branch"];
  const email = body["email"];

  setRequestMeta(c, {
    reqType: `upload:${config.keyPrefix.split("/")[0]}`,
    email: typeof email === "string" ? email : undefined,
    fullName: typeof fullName === "string" ? fullName : undefined,
  });

  // Validate required fields
  if (!file || !(file instanceof File)) {
    return c.json({ error: "File is required" }, 400);
  }
  if (typeof fullName !== "string" || !fullName.trim()) {
    return c.json({ error: "fullName is required" }, 400);
  }
  if (typeof branch !== "string" || !branch.trim()) {
    return c.json({ error: "branch is required" }, 400);
  }
  if (typeof email !== "string" || !email.trim()) {
    return c.json({ error: "email is required" }, 400);
  }

  // Validate file type
  if (!config.allowedTypes.includes(file.type)) {
    return c.json({ error: config.typeErrorMessage }, 400);
  }

  // Validate file size
  if (file.size > MAX_SIZE) {
    return c.json({ error: "File too large. Maximum 5MB" }, 400);
  }

  if (file.size === 0) {
    return c.json({ error: "File is empty" }, 400);
  }

  // Build R2 key
  const fileData = await file.arrayBuffer();
  const hash = await shortHash(fileData);
  const ext = extFromMime(file.type);
  const safeName = sanitizeName(fullName);
  const safeBranch = sanitizeName(branch);
  const fileKey = `${config.keyPrefix}/${safeBranch}/${safeName}/${hash}.${ext}`;

  // Upload to R2
  const storage = c.env.STORAGE;
  await storage.put(fileKey, fileData, {
    httpMetadata: { contentType: file.type },
  });

  return c.json({ fileKey }, 201);
}

const routes = new Hono<AppEnv>();

routes.post("/uploads/id-document", rateLimitByCategory("upload"), (c) =>
  handleUpload(c, {
    allowedTypes: ["image/jpeg", "image/png", "application/pdf"],
    typeErrorMessage: "Invalid file type. Accepted: JPEG, PNG, PDF",
    keyPrefix: "id-docs/pending",
  }),
);

routes.post("/uploads/photo", rateLimitByCategory("upload"), (c) =>
  handleUpload(c, {
    allowedTypes: ["image/jpeg", "image/png"],
    typeErrorMessage: "Invalid file type. Accepted: JPEG, PNG",
    keyPrefix: "photos/pending",
  }),
);

export { routes as uploadRoutes };
