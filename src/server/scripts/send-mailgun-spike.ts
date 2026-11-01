/**
 * Send ONE real test email through Mailgun to check your email setup
 * (domain, API key, deliverability). Useful before you open registration.
 *
 * SENDS AN EMAIL: this calls the Mailgun API and delivers a message to --to.
 * Use --dry-run to render the message and print it without sending.
 *
 * Needs MAILGUN_API_KEY and MAILGUN_DOMAIN. Order: process environment, then .env.ops at
 * the repo root, then the env file (default: src/server/.dev.vars; override with --env-file).
 * See src/server/.dev.vars.example and .env.ops.example.
 *
 * Usage (from the repo root):
 *   npm -w @smriti/server run spike:mailgun:confirmation -- \
 *     --to you@example.com --env stg
 *   npm -w @smriti/server run spike:mailgun:confirmation -- \
 *     --to you@example.com --base-url https://your-site.example.org --from-name "Your Reunion"
 *
 * --env stg|prod fills --base-url (siteUrl) and --from-name (senderName) from site.config.json.
 * Explicit --base-url and --from-name win over --env.
 *
 * Required flags:  --to, and either --env or both --base-url and --from-name
 * Optional flags:  --dry-run  --env-file <path>  --reg-code <code>
 *                  --mode html|text|both (default html)
 *                  --scenario rich|minimal-no-link|minimal-with-link (default rich)
 *                  --profile current|trusted (default current)
 * With --profile trusted these are also required: --reply-to, --unsubscribe-mailto, --unsubscribe-url
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { calculateTotal, toRegistration, type WizardDraft } from "@smriti/shared";

import { renderConfirmation } from "../src/infra/email-templates.ts";

interface CliOptions {
  to: string;
  envFile: string;
  baseUrl: string;
  regCode: string;
  fromName: string;
  mode: "html" | "text" | "both";
  profile: "current" | "trusted";
  scenario: "rich" | "minimal-no-link" | "minimal-with-link";
  replyTo: string;
  unsubscribeMailto: string;
  unsubscribeUrl: string;
  dryRun: boolean;
}

/** siteUrl and senderName from <repo>/site.config.json for --env stg|prod. Empty when --env is absent. */
function readSiteDefaults(repoRoot: string, env: string | undefined): { siteUrl?: string; senderName?: string } {
  if (env === undefined) return {};
  if (env !== "stg" && env !== "prod") {
    throw new Error(`--env must be stg or prod (got ${env}). There is no default.`);
  }
  const file = resolve(repoRoot, "site.config.json");
  if (!existsSync(file)) {
    throw new Error(`--env needs ${file}, which owns siteUrl and senderName. It does not exist.`);
  }
  const site = JSON.parse(readFileSync(file, "utf8")) as {
    senderName?: string;
    environments?: Record<string, { siteUrl?: string }>;
  };
  const siteUrl = site.environments?.[env]?.siteUrl;
  if (!siteUrl) throw new Error(`site.config.json: environments.${env}.siteUrl is not set.`);
  if (!site.senderName) throw new Error("site.config.json: senderName is not set.");
  return { siteUrl, senderName: site.senderName };
}

function parseArgs(argv: string[]): CliOptions {
  const get = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const scriptDir = fileURLToPath(new URL(".", import.meta.url));
  const defaultEnvFile = resolve(scriptDir, "../.dev.vars");
  const siteDefaults = readSiteDefaults(resolve(scriptDir, "../../.."), get("--env"));

  const required = (name: string): string => {
    const value = get(name);
    if (!value) {
      throw new Error(
        `Missing ${name}. Run with --help for usage. Example: npm -w @smriti/server run spike:mailgun:confirmation -- --to you@example.com --base-url https://your-site.example.org --from-name "Your Reunion"`,
      );
    }
    return value;
  };

  const to = required("--to");
  const profile = (get("--profile") as CliOptions["profile"] | undefined) ?? "current";
  const trusted = profile === "trusted";

  return {
    to,
    envFile: get("--env-file") ?? defaultEnvFile,
    baseUrl: (get("--base-url") ?? siteDefaults.siteUrl ?? required("--base-url")).replace(/\/$/, ""),
    regCode: get("--reg-code") ?? "SMRTTEST00000001",
    fromName: get("--from-name") ?? siteDefaults.senderName ?? required("--from-name"),
    mode: (get("--mode") as CliOptions["mode"] | undefined) ?? "html",
    profile,
    scenario: (get("--scenario") as CliOptions["scenario"] | undefined) ?? "rich",
    replyTo: trusted ? required("--reply-to") : (get("--reply-to") ?? ""),
    unsubscribeMailto: trusted ? required("--unsubscribe-mailto") : (get("--unsubscribe-mailto") ?? ""),
    unsubscribeUrl: trusted ? required("--unsubscribe-url") : (get("--unsubscribe-url") ?? ""),
    dryRun: argv.includes("--dry-run"),
  };
}

function loadEnvFile(filePath: string): Record<string, string> {
  // A missing file is fine when MAILGUN_API_KEY and MAILGUN_DOMAIN are in the environment.
  if (!existsSync(filePath)) {
    return {};
  }

  const env: Record<string, string> = {};
  const content = readFileSync(filePath, "utf8");

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) continue;

    const key = line.slice(0, equalsIndex).trim();
    const value = line.slice(equalsIndex + 1).trim();
    env[key] = value;
  }

  return env;
}

function buildPreviewDraft(recipientEmail: string): WizardDraft {
  return {
    fullName: "Ravi Kumar",
    branch: "Computer Science & Engineering",
    gender: "male",
    email: recipientEmail,
    whatsapp: "+919876543210",
    city: "Kochi",
    country: "India",
    attendanceIntent: "attending",
    participationType: "full_celebration",
    alumniMeal: "non_veg",
    tshirtSize: "L",
    spouseName: "Priya Kumar",
    spouseMeal: "veg",
    children: [{ id: "c1", name: "Arjun Kumar", age: 8, meal: "non_veg" }],
    guests: [],
    accommodation: "private",
    extraBed: true,
    checkIn: "2026-08-14",
    checkOut: "2026-08-16",
    donationAmount: "500",
    publicAcknowledgement: false,
    acknowledgementDisplayName: "",
    felicitationConsent: false,
    idFileName: "",
    idNote: "",
    collegeContribution: 500,
    photoFileName: "",
  };
}

function renderConfirmationText(args: {
  fullName: string;
  regCode: string;
  totalAmount: number;
  paymentUrl: string;
  profile: CliOptions["profile"];
  scenario: CliOptions["scenario"];
  replyTo: string;
  unsubscribeMailto: string;
  unsubscribeUrl: string;
}): string {
  if (args.scenario === "minimal-no-link") {
    return [
      "Smriti 2026 payment reminder test",
      "",
      `Hi ${args.fullName},`,
      "",
      `Registration code: ${args.regCode}`,
      `Amount due: INR ${args.totalAmount}`,
      "",
      "This is a deliverability test message for your Smriti 2026 registration.",
      "No action is required for this test email.",
      "",
      "Smriti 2026 Organizing Committee",
    ].join("\n");
  }

  if (args.scenario === "minimal-with-link") {
    return [
      "Smriti 2026 payment reminder test",
      "",
      `Hi ${args.fullName},`,
      "",
      `Registration code: ${args.regCode}`,
      `Amount due: INR ${args.totalAmount}`,
      "",
      "This is a deliverability test message for your Smriti 2026 registration.",
      "If you want to review the payment page for this registration, use:",
      args.paymentUrl,
      "",
      "Smriti 2026 Organizing Committee",
    ].join("\n");
  }

  const lines = [
    "Smriti '26 | TKMCE 2006 Reunion — Complete Your Payment",
    "",
    `Hi ${args.fullName},`,
    "",
    "We've received your registration for Smriti 2026.",
    "Your spot will be confirmed once your payment is received and verified.",
    "",
    `Registration code: ${args.regCode}`,
    `Amount due: INR ${args.totalAmount}`,
    "",
    "To secure your spot at the reunion, please complete your payment.",
    "You can pay via bank transfer or UPI using the payment page below:",
    args.paymentUrl,
    "",
    "If you have any questions, feel free to reach out to the organizing committee.",
    "",
    "See you at TKMCE on August 15, 2026.",
    "Smriti 2026 Organizing Committee",
  ];

  if (args.profile === "trusted") {
    lines.push(
      "",
      `Questions? Reply to this email or write to ${args.replyTo}.`,
      `To stop payment reminders for this registration, email ${args.unsubscribeMailto} or visit ${args.unsubscribeUrl}.`,
    );
  }

  return lines.join("\n");
}

function applyTrustedHtmlFooter(html: string, args: {
  replyTo: string;
  unsubscribeMailto: string;
  unsubscribeUrl: string;
}): string {
  const footer = `<p style="margin-top:24px; font-size:13px; color:#666;">
Questions? Reply to this email or write to
<a href="mailto:${args.replyTo}" style="color:#B9DFE2;">${args.replyTo}</a>.
</p>
<p style="font-size:13px; color:#666;">
To stop payment reminders for this registration, email
<a href="mailto:${args.unsubscribeMailto}?subject=Stop%20payment%20reminders" style="color:#B9DFE2;">${args.unsubscribeMailto}</a>
or visit
<a href="${args.unsubscribeUrl}" style="color:#B9DFE2;">this contact page</a>.
</p>`;

  return html.replace("</div>\n      <div class=\"footer\">", `${footer}\n      </div>\n      <div class="footer">`);
}

function renderMinimalHtml(args: {
  fullName: string;
  regCode: string;
  totalAmount: number;
  paymentUrl: string;
  includeLink: boolean;
}): string {
  const linkBlock = args.includeLink
    ? `<p>If you want to review the payment page for this registration, use:<br><a href="${args.paymentUrl}">${args.paymentUrl}</a></p>`
    : `<p>No action is required for this test email.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Smriti 2026 payment reminder test</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.5; color: #222;">
  <p>Hi ${args.fullName},</p>
  <p>Registration code: ${args.regCode}<br>Amount due: INR ${args.totalAmount}</p>
  <p>This is a deliverability test message for your Smriti 2026 registration.</p>
  ${linkBlock}
  <p>Smriti 2026 Organizing Committee</p>
</body>
</html>`;
}

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    const doc = readFileSync(fileURLToPath(import.meta.url), "utf8").match(/^\/\*\*([\s\S]*?)\*\//);
    console.log((doc?.[1] ?? "").replace(/^ \* ?/gm, "").trim());
    return;
  }
  const options = parseArgs(process.argv.slice(2));
  const scriptDir = fileURLToPath(new URL(".", import.meta.url));
  const opsFile = loadEnvFile(resolve(scriptDir, "../../../.env.ops"));
  // A blank value in .env.ops (as copied from .env.ops.example) must not hide a value in .dev.vars.
  const envFile = { ...loadEnvFile(options.envFile), ...Object.fromEntries(Object.entries(opsFile).filter(([, v]) => v !== "")) };

  const mailgunApiKey = process.env.MAILGUN_API_KEY || envFile.MAILGUN_API_KEY;
  const mailgunDomain = process.env.MAILGUN_DOMAIN || envFile.MAILGUN_DOMAIN;

  if (!mailgunDomain) throw new Error(`MAILGUN_DOMAIN is not set (checked the environment, .env.ops and ${options.envFile})`);

  const draft = buildPreviewDraft(options.to);
  const registration = toRegistration(draft);
  const pricingBreakup = calculateTotal(registration);
  const accommodation = registration.accommodation;

  const { subject: richSubject, html } = renderConfirmation({
    regId: "999",
    regCode: options.regCode,
    fullName: draft.fullName,
    totalAmount: pricingBreakup.total,
    attendanceIntent: registration.attendance.intent,
    participationType: registration.attendance.participationType,
    alumniMeal: registration.attendance.alumniMeal,
    tshirtSize: registration.attendance.tshirtSize ?? null,
    spouseName: registration.attendees.spouse?.name ?? null,
    childCount: registration.attendees.children.length,
    guestCount: registration.attendees.guests.length,
    accommodation: accommodation?.type ?? "none",
    checkIn: accommodation?.checkIn ?? null,
    checkOut: accommodation?.checkOut ?? null,
    extraBed: accommodation?.extraBed ?? false,
    pricingBreakup,
    baseUrl: options.baseUrl,
  });
  const paymentUrl = `${options.baseUrl}/pay/${options.regCode}`;
  const subject = options.scenario === "rich"
    ? richSubject
    : "Smriti 2026 payment reminder test";
  const text = renderConfirmationText({
    fullName: draft.fullName,
    regCode: options.regCode,
    totalAmount: pricingBreakup.total,
    paymentUrl,
    profile: options.profile,
    scenario: options.scenario,
    replyTo: options.replyTo,
    unsubscribeMailto: options.unsubscribeMailto,
    unsubscribeUrl: options.unsubscribeUrl,
  });
  const baseHtml = options.scenario === "rich"
    ? html
    : renderMinimalHtml({
        fullName: draft.fullName,
        regCode: options.regCode,
        totalAmount: pricingBreakup.total,
        paymentUrl,
        includeLink: options.scenario === "minimal-with-link",
      });
  const finalHtml = options.profile === "trusted"
    ? applyTrustedHtmlFooter(baseHtml, {
        replyTo: options.replyTo,
        unsubscribeMailto: options.unsubscribeMailto,
        unsubscribeUrl: options.unsubscribeUrl,
      })
    : baseHtml;
  const unsubscribeHeader = `<mailto:${options.unsubscribeMailto}?subject=Stop%20payment%20reminders>, <${options.unsubscribeUrl}>`;

  const form = new FormData();
  form.append("from", `${options.fromName} <noreply@${mailgunDomain}>`);
  form.append("to", options.to);
  form.append("subject", subject);
  if (options.profile === "trusted") {
    form.append("h:Reply-To", options.replyTo);
    form.append("h:List-Unsubscribe", unsubscribeHeader);
    form.append("h:List-Unsubscribe-Post", "List-Unsubscribe=One-Click");
  }
  if (options.mode === "html" || options.mode === "both") {
    form.append("html", finalHtml);
  }
  if (options.mode === "text" || options.mode === "both") {
    form.append("text", text);
  }

  if (options.dryRun) {
    console.log(JSON.stringify({
      dryRun: true,
      wouldSendTo: options.to,
      domain: mailgunDomain,
      from: `${options.fromName} <noreply@${mailgunDomain}>`,
      subject,
      mode: options.mode,
      profile: options.profile,
      scenario: options.scenario,
      paymentUrl,
    }, null, 2));
    return;
  }

  if (!mailgunApiKey) throw new Error(`MAILGUN_API_KEY is not set (checked the environment, .env.ops and ${options.envFile})`);
  console.log(`Sending one email to ${options.to} through Mailgun domain ${mailgunDomain}...`);
  const response = await fetch(`https://api.mailgun.net/v3/${mailgunDomain}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${mailgunApiKey}`).toString("base64")}`,
    },
    body: form,
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Mailgun API error ${response.status}: ${body}`);
  }

  console.log(JSON.stringify({
    ok: true,
    to: options.to,
    domain: mailgunDomain,
    mode: options.mode,
    profile: options.profile,
    scenario: options.scenario,
    subject,
    paymentUrl,
    replyTo: options.profile === "trusted" ? options.replyTo : null,
    listUnsubscribe: options.profile === "trusted" ? unsubscribeHeader : null,
    mailgun: body,
  }, null, 2));
}

main().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});
