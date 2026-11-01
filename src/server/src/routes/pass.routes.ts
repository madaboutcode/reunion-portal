/**
 * CONTRACT: Pass PDF route.
 *
 * GUARANTEE: GET /registrations/:code/pass.pdf returns a PDF entry pass for
 *   valid registrations where attendanceIntent !== "donation_only".
 *
 * GUARANTEE: BINARY_ASSETS_CACHED — template PDF and fonts are imported at
 *   module load time (wrangler bundles them via Data rules), not per-request.
 *
 * GUARANTEE: QR_CODE_URL — QR code encodes the pass page URL as
 *   {APP_BASE_URL}/pass#{normalizedCode}, matching the web app's PassPage route.
 *
 * EXPECTS: :code param is the display-format reg code (e.g. "SMRT-79WW-4A25-NWG1").
 *   Hyphens are stripped and uppercased before DB lookup — same normalization
 *   as the lookup route.
 *
 * FAILURE BEHAVIOR:
 *   - Invalid format → 400
 *   - Not found → 404
 *   - donation_only registration → 404 (no pass for donation-only)
 *   - Asset or PDF generation failure → propagates to error middleware
 */

import { Hono } from "hono";
import type { AppEnv } from "../env.js";
import { rateLimitByCategory } from "../middleware/rate-limit.js";
import { generatePassPdf, type FieldConfig } from "../services/pass-pdf.service.js";
import { formatRegCodeForDisplay, REG_CODE_PREFIX } from "@smriti/shared";

// Binary assets bundled by wrangler at build time (via [[rules]] Data globs)
import templatePdf from "../assets/pass/template.pdf";
import { requireVar } from "../lib/site-config.js";
import fontBold from "../assets/pass/DMSans-Bold.ttf";
import fontSemiBold from "../assets/pass/DMSans-SemiBold.ttf";
import fontRegular from "../assets/pass/DMSans-Regular.ttf";

// JSON is imported natively by the bundler
import fieldConfigJson from "../assets/pass/fields.json";

const fieldConfig = fieldConfigJson as FieldConfig;

const routes = new Hono<AppEnv>();

routes.get(
  "/registrations/:code/pass.pdf",
  rateLimitByCategory("query"),
  async (c) => {
    const param = c.req.param("code")!;
    const normalized = param.replace(/-/g, "").trim().toUpperCase();

    if (!normalized.startsWith(REG_CODE_PREFIX) || normalized.length !== 16) {
      return c.json({ error: "Invalid pass code format" }, 400);
    }

    const reg = await c.var.registrationRepo.findByRegCode(normalized);
    if (!reg) {
      return c.json({ error: "Not found" }, 404);
    }

    if (reg.attendanceIntent === "donation_only") {
      return c.json({ error: "Not found" }, 404);
    }

    // Fetch attendee rows to compute total headcount.
    // attendeeRepo returns spouse + children + guests; add 1 for alumni.
    const attendees = await c.var.attendeeRepo.findByRegistration(reg.id);
    const attendeeCount = 1 + attendees.length;

    // Build the pass URL — the QR code encodes the self-service lookup page
    const appBaseUrl = requireVar(c.env, "APP_BASE_URL");
    const passUrl = `${appBaseUrl}/pass#${normalized}`;

    const pdfBytes = await generatePassPdf(
      {
        name: reg.fullName,
        regCode: formatRegCodeForDisplay(normalized),
        attendeeCount,
        accommodation: reg.accommodation,
        participationType: reg.participationType,
        passUrl,
      },
      {
        templatePdf,
        fieldConfig,
        fontBold,
        fontSemiBold,
        fontRegular,
      },
    );

    const safeName = reg.fullName.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "-").toLowerCase();
    return new Response(pdfBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="pass-${safeName}.pdf"`,
        "Cache-Control": "public, max-age=3600",
        "Content-Length": pdfBytes.byteLength.toString(),
      },
    });
  },
);

export { routes as passRoutes };
