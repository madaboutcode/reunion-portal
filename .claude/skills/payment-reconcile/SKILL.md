---
name: payment-reconcile
description: >
  Reconcile a bank statement against live registration data: cross-reference payments,
  verify proof images, categorize registrations, and produce a dated HTML status report
  (written to tmp/; uploading is an explicit, private-bucket-only option). Also handles one-off payment operations: partial payments,
  overpayments, refunds, proof rejection. Use when the organizer imports a bank statement,
  asks about payment status, who paid, who has not, reconciliation, or needs to fix or
  verify a specific payment.
---

# Payment Reconciliation

You are reconciling real money against real registrations for a college reunion.
Mistakes mean someone who paid gets chased for payment, or someone who didn't pay
gets confirmed. Both are bad. Accuracy over speed — when a transaction doesn't
cleanly match, say so and explain why, don't force a match.

## Prerequisites

Terms such as UTR, canary and D1 are defined in [docs/GLOSSARY.md](../../../docs/GLOSSARY.md). The human version of this workflow, with the same steps, is [ADMIN.md](../../../ADMIN.md) section 3.

This skill calls the `devops` skill (`.claude/skills/devops/scripts/d1-query`). Keep both skill folders together.

**Environment is always explicit.** Every command below takes `stg` or `prod`; there is no default. Prod commands print their target (site URL, D1 database, bucket) first.

**Where settings come from** (the scripts resolve them through `scripts/site_config.py`; you set nothing in your shell for these):

| Setting | Owner file |
|---------|-----------|
| D1 database, account ID, proof bucket (`proofs`) | `src/server/wrangler.toml` |
| Site URL for staff-API writes (`verify`, `link`, `reject`, `refund-complete`, `refunds`), event title, reports bucket and prefix | `site.config.json` |
| Registration-code prefix (bank-remark matching) | The constant `REG_CODE_PREFIX` in `src/shared/src/reg-code.ts` |
| `CLOUDFLARE_API_TOKEN` (the agent token: D1 read, R2 read) | process environment, else `.env.ops` |

A missing value stops the command with a message that names the key and the file that owns it. `make doctor` checks the whole setup. The optional `upload` and `report --upload` need `reports.bucket` in `site.config.json`, and a token with R2 write passed in your shell for that command (the agent token cannot write). Reports contain names, WhatsApp numbers and amounts: only to a private bucket; never a public URL.

**Staff token file.** The write commands take a staff session token (JWT) in a text file. To get one: sign in at `/login` as an admin, or a staff user with the `dashboard` scope (verify, reject) and the `bank_txns` scope (link and import), open the browser developer console, run `copy(localStorage.getItem("<key>"))` (the key name is `TOKEN_KEY` in `src/web/src/lib/auth.ts`), and paste the result into `tmp/staff-jwt.txt`. `tmp/` is git-ignored. **Delete `tmp/staff-jwt.txt` when you finish**; it is a live credential. Do not put it in `/tmp` or anywhere outside the repo's ignored `tmp/`.

**Writes are real.** `verify`, `link`, `reject` and `refund-complete` change live payment state and some email the registrant. The wrapper prints the host, endpoint and body before each request. Only `verify` and `link` from `reconcile.py` run a canary first (one item, then the rest). The wrapper's `reject` and `refund-complete` have no canary and no undo: run them one at a time and confirm each with the user.

**Supported bank.** Statement import and bank-description parsing are written for State Bank of India (SBI). For another bank, see "Bank statement source" below.

## When to use what

There are two modes. Read this before looking at the commands.

**Batch reconciliation** — the user imports a bank statement `.txt` via the staff UI.
You match unreconciled credits against pending registrations, extract proof data
with agents, run heuristic matching, link transactions, verify payments, and
generate a status report. Batch is for exact-amount matches — use surgical
operations for partials and shared transfers.

**Surgical operations** — One-off fixes. A couple shared one bank transfer across
two registrations. Someone overpaid. A proof image is wrong. Use the bash script
directly for these — each command is atomic, one payment at a time, with explicit
amounts. Always defer to the user's judgment on exceptional cases — present the
data, let them decide.

## Tools

### Bash script (surgical operations + batch building blocks)

```
RECONCILE=.claude/skills/payment-reconcile/scripts/reconcile
```

| Subcommand | What it does |
|------------|-------------|
| `$RECONCILE verify <token> <stg\|prod> <pid:ref:amount> [--with-shortfall]` | Verify a payment (amount mandatory) |
| `$RECONCILE refunds <token> <stg\|prod> [--status pending\|completed]` | List refunds |
| `$RECONCILE refund-complete <token> <stg\|prod> <refund_id> <bank_ref>` | Mark refund as paid out |
| `$RECONCILE reject <token> <stg\|prod> <payment_id> <comment>` | Reject proof, reset to payment_pending |
| `$RECONCILE link <token> <stg\|prod> <bank_txn_id> <payment_id> [...]` | Link bank transaction to payment(s) |
| `$RECONCILE registrations <stg\|prod>` | Dump registrations, payments and attendees as JSON (D1 read) |
| `$RECONCILE upload <stg\|prod> <path>` | Optional. Upload an HTML report to the reports bucket (`reports.bucket`/`reports.prefix` in `site.config.json`). Only to a private bucket; never a public URL |
| `$RECONCILE proofs <stg\|prod> <key:name> [...]` | Download proof files from R2 to `tmp/proofs/` (personal data; delete when done) |

### Python script (batch reconciliation workflow)

```
PY=.claude/skills/payment-reconcile/scripts/reconcile.py
```

| Subcommand | What it does |
|------------|-------------|
| `uv run $PY pending <stg\|prod>` | Show unprocessed registrations + pending refunds |
| `uv run $PY download-proofs <stg\|prod>` | Download all proof images for pending_verification records |
| `uv run $PY bank-txns <stg\|prod> [--all]` | List unreconciled bank credits (--all includes linked) |
| `uv run $PY prematch <stg\|prod>` | Show pending regs + unreconciled credits from D1 side-by-side |
| `uv run $PY prematch <stg\|prod> --proof-data proofs.json` | Heuristic matching (UTR, name+amount, amount+date proximity) |
| `uv run $PY link <manifest.json> <stg\|prod>` | Link bank transactions to payments via API (canary-first) |
| `uv run $PY verify <manifest.json> <stg\|prod>` | Approve payments from manifest + update local state |
| `uv run $PY report <manifest.json> <stg\|prod> [--upload]` | Generate the HTML report in `tmp/`. `--upload` is optional: only to a private bucket; never a public URL |

### State tracking

Local state in `tmp/reconcile-state/processed.json` (under the repo root, whatever directory you run from) tracks which payment_ids
have been verified. The `pending` command filters these out — so next session only
shows NEW unprocessed records.

## Batch Reconciliation

Use when the user imports a bank statement. Bank transactions are stored in D1
via the staff UI — prematch reads unreconciled credits directly from the
`bank_transactions` table.

Current flow: statement HTML from the bank, then convert, then import in the staff UI, then `prematch`, then `verify` and `link`, then `report`.

### Bank statement source

| Your bank gives you | What to do |
|---------------------|-----------|
| **SBI YONO HTML export** (primary path) | Edit the `ACCOUNT_*` constants once at the top of `scripts/convert-sbi-html-to-text.py`. Run `uv run scripts/convert-sbi-html-to-text.py tmp/statement.html --output tmp/statement.txt`. Import the `.txt` in the staff UI (Step 1). |
| **SBI fixed-width `.txt` or `.xls` download** | Import it directly in the staff UI. |
| **Only a PDF, or another bank** (fallback) | Run `uv run scripts/build-statement-images.py statement.pdf` (writes `tmp/statement-pages/`), then run the `extract-statement` workflow (`.claude/workflows/extract-statement.js`, a Claude Code Workflow-tool script, not a Node script) with the page image paths. It returns a JSON transcription. The staff import accepts only SBI-format `.txt`/`.xls`, so this JSON is for matching payments by hand or with an agent. It does not feed `prematch`. Its name and reference parsing also assumes SBI descriptions. Delete `tmp/statement-pages/` when done. |

### Step 1: Prompt the user to import the statement

**Import is a UI action.** The user gets the statement from SBI (converted to `.txt` as in
"Bank statement source" above) and drag-drops it onto the Bank Transactions page at
`/staff/bank-transactions`.

Prompt the user with the exact steps:

> *"Please export the latest SBI statement from internet banking, convert it with
> `scripts/convert-sbi-html-to-text.py` if it is an HTML export, and drag-drop the `.txt`
> onto the Bank Transactions page at `/staff/bank-transactions`. The server parses
> fixed-width text, SHA-256 deduplicates, and stores all transactions in D1."*

While waiting for import, pull pending data:

```bash
uv run $PY pending prod
```

The `pending` command shows two things:
1. Pending registrations (pending_verification + payment_pending)
2. Pending refunds

Unreconciled bank credits are shown by `prematch`, not `pending`.

### Step 2: Extract proof data + run prematch

Download all proofs for `pending_verification` records:

```bash
uv run $PY download-proofs prod
```

This queries D1 for pending records with proof files and downloads them all to
`tmp/proofs/proof-{payment_id}-{name}.{ext}` in the repo. Output lists every file with its payment ID. These are personal data: delete `tmp/proofs/` when the session ends.

Then have an agent read each proof image (one agent per image works well) with this prompt:

> *"Look at this payment proof image. Extract these fields (return ONLY as JSON):*
> *- proof_utr: UTR or transaction reference number (most important — look for UPI ref, IMPS ref, NEFT UTR)*
> *- proof_amount: amount paid (number)*
> *- proof_date: date of transaction (YYYY-MM-DD)*
> *- proof_time: time of transaction (HH:MM:SS or HH:MM, 24hr — if visible)*
> *- proof_sender: sender name/account*
> *- proof_method: UPI / NEFT / IMPS*
> *Return: {"payment_id": 184, "proof_utr": "...", "proof_amount": 8500, "proof_date": "2026-07-19", "proof_time": "14:32", "proof_sender": "Jane Doe", "proof_method": "UPI"}*

Save all extracted outputs combined into `tmp/proofs.json`:

```json
[
  {"payment_id": 184, "proof_utr": "000000000001", "proof_amount": 8500, "proof_date": "2026-07-19", "proof_time": "14:32", "proof_sender": "Jane Doe", "proof_method": "UPI"},
  {"payment_id": 112, "proof_utr": "000000000002", "proof_amount": 15580, "proof_date": "2026-07-20", "proof_time": "09:15", "proof_sender": "John Roe", "proof_method": "UPI"}
]
```

Then run prematch with heuristic matching:

```bash
uv run $PY prematch prod --proof-data tmp/proofs.json
```

Prematch auto-matches only when certain — no false positives:

| Criterion | What it checks |
|-----------|---------------|
| **UTR match** | Proof UTR (≥8 chars) found in bank `ref_no` or `description` — gold standard |
| **Name + Amount** | Bank sender name matches registrant or proof sender AND same amount |
| **Regcode + Amount** | Bank description contains a registration code (starts with `REG_CODE_PREFIX`, the constant in `src/shared/src/reg-code.ts`; `SMRT` in the original) AND same amount |

Everything else is **UNMATCHED** with hints for the agent to investigate manually
with the user. Hints include amount-only and name-only near-matches but these are
never auto-matched — too many false positives (spouse accounts, same-amount payments).

If the same bank transaction auto-matches multiple registrations, all are demoted
to unmatched with a conflict warning.

### Step 3: Review matches with the user

Present proposed matches. **Only show pending matches — don't re-present already
confirmed records.** Edge cases requiring judgment:

- Multiple bank txns at the same amount — use sender name from bank description to disambiguate
- Sender name doesn't match registrant — could be spouse/parent/friend; check proof sender
- Amount shortfall (NEFT/international fees) — flag as `pending_committee` in manifest
- No match at all — proof may be from a payment not yet in this statement batch

### Step 4: Write manifest + verify payments

After the user approves matches, write the combined manifest:

```json
{
  "date": "20jul2026",
  "statement_cutoff": "20-Jul-2026, 16:30:00",
  "token_file": "tmp/staff-jwt.txt",
  "links": {
    "283": [184],
    "286": [112],
    "284": [131],
    "64": [60]
  },
  "verified_today": {
    "184": {"ref": "000000000001", "amount": 8500},
    "112": {"ref": "000000000002", "amount": 15580},
    "131": {"ref": "000000000003", "amount": 8500},
    "60": {"ref": "SCBLH00000000001", "amount": 13456, "withShortfall": true}
  },
  "proof_notes": {
    "60": "₹354 short — intl NEFT charges from Standard Chartered"
  },
  "pending_committee": {
    "60": "₹354 shortfall — verify whether to accept or ask for balance"
  }
}
```

Two sections: `links` maps `bank_transaction_id` → `[payment_id, ...]` (array for
couples sharing a bank txn). `verified_today` is the same format as before:
`payment_id` → `{ref, amount, withShortfall?}`.

Verify payments first — verification is the source of truth:

```bash
uv run $PY verify ./tmp/manifest-20jul2026.json prod
```

This does canary-first verification and updates local state.

### Step 5: Link bank transactions to payments

After verification, link bank transactions for reconciliation tracking:

```bash
uv run $PY link ./tmp/manifest-20jul2026.json prod
```

This calls `POST /api/staff/bank-transactions/:id/link` for each entry. Canary-first:
the first link is tested alone before the batch proceeds. Linking is a reconciliation
association — it doesn't affect payment status.

### Step 6: Generate the report (local)

```bash
uv run $PY report ./tmp/manifest-20jul2026.json prod
```

This pulls fresh data, categorizes ALL records automatically, and writes the
HTML (with a Refunds Due tab if any pending refunds exist) to `tmp/` (git-ignored).
The report has names, WhatsApp numbers and amounts. Open it locally.

Uploading is an explicit option, not part of the normal flow: add `--upload` only
to a private bucket; never a public URL.

## Surgical Operations

Use for one-off fixes — partial payments, shared bank transfers, overpayments,
rejections. Each command is atomic. Always present the situation to the user and
let them decide before executing.

**Always verify → then link.** After every surgical verify, link the bank
transaction to the payment. This keeps the `bank_transactions` table clean —
without the link, the credit stays "unreconciled" and future prematch runs
will try to match it again.

### Verify with exact amount

```bash
# 1. Verify the payment
$RECONCILE verify tmp/staff-jwt.txt prod 78:SBIY000000:13810
# 2. Link the bank transaction (find bank_txn_id from prematch or bank-txns output)
$RECONCILE link tmp/staff-jwt.txt prod 42 78
```

### Partial payment (short)

When someone paid less than expected. The `--with-shortfall` flag tells the
backend to auto-create a balance payment for the gap and notify the registrant.

```bash
$RECONCILE verify tmp/staff-jwt.txt prod 77:SBIY000000:11190 --with-shortfall
# → Verifies ₹11,190, creates ₹2,620 balance payment, emails registrant
$RECONCILE link tmp/staff-jwt.txt prod 42 77
```

### Overpayment

When someone paid more than expected. The system auto-creates a refund record
for the excess.

```bash
$RECONCILE verify tmp/staff-jwt.txt prod 80:IMPS000000:25000
# → Verifies at expected amount, records excess as pending refund
$RECONCILE link tmp/staff-jwt.txt prod 43 80
```

### Shared bank transfer (couples/families)

When one bank transaction covers two separate registrations (e.g. husband paid
₹25K for both herself and spouse at ₹13,810 each):

```bash
# 1. Verify husband at full amount
$RECONCILE verify tmp/staff-jwt.txt prod 78:SBIY000000:13810

# 2. Verify spouse at remainder, with shortfall for the gap
$RECONCILE verify tmp/staff-jwt.txt prod 77:SBIY000000:11190 --with-shortfall
# → ₹11,190 verified, ₹2,620 balance payment created

# 3. Link the single bank txn to both payments
$RECONCILE link tmp/staff-jwt.txt prod 42 78 77

# 4. Later, when spouse pays ₹2,620 and uploads proof, verify + link that payment
```

Both verifications cite the same bank UTR — that's fine, the system allows it.
The link command also supports multiple payment IDs for exactly this case.

### Reject bad proof

```bash
$RECONCILE reject tmp/staff-jwt.txt prod 80 "UTR doesn't match bank statement"
# → Resets to payment_pending, notifies registrant with new payment link
```

### Manage refunds

```bash
# List pending refunds
$RECONCILE refunds tmp/staff-jwt.txt prod --status pending

# After money is actually wired back, mark as completed
$RECONCILE refund-complete tmp/staff-jwt.txt prod 3 UTR456789
```

When you are done with the session, delete the token file: `rm tmp/staff-jwt.txt`.

## Report rules (baked into the generator)

- **Never show reg_code** — use location (city, country) instead
- **Never show amounts except in Needs Attention** — contribution amounts are private. Confirmed, Verified Today, Proof Submitted, Payment Pending, and Refunds Due tabs have no Amount column. Needs Attention keeps it because the shortfall/discrepancy amount is the reason the row needs a decision.
- **WhatsApp link on every tab** — confirmed, verified today, proof, pending
- **Process ALL records** — never manually exclude anyone
- **Self-validation**: the script checks `confirmed + proof + pending + flagged = total registrations` before generating HTML. If this fails, it exits with an error — never generates a wrong report.
- **Categorization uses `r.status` (registration status), NOT `p.status` (payment status)**:
  - `r.status == 'confirmed'` → Confirmed
  - `r.status == 'pending_verification'` AND payment_id in `pending_committee` → Needs Attention
  - `r.status == 'pending_verification'` AND NOT in `pending_committee` → Proof Submitted
  - `r.status == 'pending'` → Payment Pending
  - `refund.status == 'pending'` → Refunds Due
- **Verified Today** comes from server `p.updated_at` timestamps (union with manifest for next-day runs) — includes payments verified manually, not just by this script
- **`pending_committee` strict criteria** — only two cases qualify:
  - **Amount shortfall**: bank received less than expected (NEFT fees, partial payment)
  - **Proof discrepancy**: proof doesn't match any bank transaction
  - Everything else stays in Proof Submitted. International wires in transit, post-cutoff payments — NOT committee issues.
- **`not_in_statement` does not exist** — the server already knows the correct category. Never invent categories the DB doesn't have.

## Delegation Pattern

| Task | Who | Why |
|------|-----|-----|
| Prompt the user to import statement | **You** | UI action, human hands needed |
| Pull pending + unreconciled data | `pending` command | D1 query |
| Download proof images | `download-proofs` command | Queries D1, downloads all pending proofs |
| Extract text from proof images | one agent per image (parallel) | Mechanical extraction |
| Heuristic matching | `prematch` script | UTR, name, amount, date scoring |
| Edge case decisions | **the user** | Requires human judgment |
| Write manifest | **You** | Your synthesis (~25 lines) |
| Verify payments | `verify` command | API calls, canary-first |
| Link transactions to payments | `link` command | API calls, canary-first |
| Pull data / categorize / generate HTML | `report` command | 100% mechanical, self-validated |

## Typical Sessions

### Batch reconciliation
```
user: "new statement ready"

You:
1. Prompt: "Convert the SBI export to .txt (scripts/convert-sbi-html-to-text.py) → drag-drop on /staff/bank-transactions"
2. Run `pending prod` → shows pending regs + refunds
3. Run `download-proofs prod` → downloads all proof images to tmp/proofs/
4. Have agents read each proof to extract UTRs/names/amounts → save to tmp/proofs.json
5. Run `prematch prod --proof-data tmp/proofs.json`
6. Present matches for review (~10 lines, not 60+)
7. After approval: write manifest.json (~25 lines, includes links)
8. Run `verify manifest.json prod` → approves payments, updates state
9. Run `link manifest.json prod` → links bank txns to payments
10. Run `report manifest.json prod` → writes the HTML report to `tmp/` (no upload)
11. Tell the user the local path of the report and to delete `tmp/staff-jwt.txt` and `tmp/proofs/`. Offer `--upload` only if they name a private bucket
```

### Surgical operation
```
user: "Alice Example paid 25K for herself and Bob Example"

You:
1. Pull both registrations, show the data
2. Present the breakdown: "Alice Example ₹13,810, Bob Example ₹13,810, total ₹27,620, bank txn ₹25K, short ₹2,620"
3. Ask the user: "Verify Alice Example at full, Bob Example at ₹11,190 with shortfall?"
4. After approval: run verify commands
```

## What Can Go Wrong

- **Import fails or shows duplicates**: The parser is built for SBI fixed-width `.txt` format.
  If the user uploads a different format (CSV, PDF), it will error. See "Bank statement source". Dedup is SHA-256 hash of
  `txnDate|description|amount` — same transaction imported twice will be skipped (shown as
  "skipped" in the import result).
- **Bank statement already imported**: Re-importing the same `.txt` file is safe — all
  duplicates are skipped. The import result tells you how many were new vs. skipped.
- **Statement cutoff**: Payments after cutoff won't appear. Note prominently in manifest's
  `statement_cutoff`.
- **Different sender names**: Family accounts. Amount-match + UTR from proof extraction
  usually enough. The `prematch` heuristic checks both bank description AND proof sender name.
- **Duplicate amounts**: Two people, same amount, same day. UTR match from proof extraction
  is the gold standard for disambiguation.
- **Missing proof data**: Some pending records may not have `proof_file_key` or the proof
  may be unreadable. These show as unmatched in prematch output.
- **Partial payments**: Use `"withShortfall": true` in `verified_today` to verify partial +
  auto-create balance.
- **Shared bank txn (couples)**: Link the bank txn to both payments in the manifest's
  `links` section. Verify each registration separately citing same UTR. Use
  `--with-shortfall` for the one that's short.
- **Overpayments (₹25K advances)**: Verify with actual amount — system auto-creates refund
  for excess if actualAmount > expected.
- **International transfers**: Bank charges reduce the credited amount (e.g. ₹354 NEFT fee).
  Flag in `pending_committee` for the user to decide.
- **Verify before linking**: Verification is the source of truth — always verify first.
  Bank transaction linking is a reconciliation association that can be done after, or
  even retroactively. If `link` fails, it doesn't affect the verified payment status.
- **All exceptional cases**: Defer to the user's judgment — present the data, let them decide.
