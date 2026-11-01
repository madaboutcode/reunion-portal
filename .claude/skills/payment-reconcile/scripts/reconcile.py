#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["click"]
# ///
"""Payment reconciliation CLI: the mechanical steps an agent should not spend tokens on.

Run from the repo root:
  uv run .claude/skills/payment-reconcile/scripts/reconcile.py <command> ...

The environment (stg or prod) is a required argument of every command: there is no default.
Prod prints its target (site URL, D1, bucket) before acting.

Read commands (D1 SELECT through .claude/skills/devops/scripts/d1-query):
  pending prod          Show only unprocessed registrations
  bank-txns prod        List unreconciled bank credits (--all includes linked)
  prematch prod         Show pending regs + unreconciled bank credits
  prematch prod --proof-data proofs.json   Run heuristic matching
  download-proofs prod  Download proof files to tmp/proofs/ (personal data: delete when done)
Write commands (call the staff API through the `reconcile` wrapper, which prints
each request before sending it; the site URL comes from site.config.json):
  link manifest.json prod      Link bank transactions to payments
  verify manifest.json prod    Approve payments from manifest
Report:
  report manifest.json prod    Write tmp/registration-status-<date>.html; --upload (private bucket only) also
                               puts it in R2 (needs reports.bucket in site.config.json and a token with R2 write)

The manifest's "token_file" key names the staff JWT file (default tmp/staff-jwt.txt).
State is saved in tmp/reconcile-state/processed.json (git-ignored).
The name parser reads SBI statement descriptions only (UPI/IMPS/NEFT/SBIY formats).
Settings come from scripts/site_config.py: D1 and R2 names from src/server/wrangler.toml, site
URLs, event title, registration-code prefix and reports bucket from site.config.json, and
CLOUDFLARE_API_TOKEN from the process env or .env.ops.
"""
import json, os, re, subprocess, sys, html as html_mod
from datetime import datetime
from pathlib import Path

import click

SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str((SCRIPT_DIR / ".." / ".." / ".." / ".." / "scripts").resolve()))
import site_config  # noqa: E402
DEVOPS_DIR = SCRIPT_DIR / ".." / ".." / "devops" / "scripts"
PORTAL_ROOT = (SCRIPT_DIR / ".." / ".." / ".." / "..").resolve()
# State and reports live under the repo's git-ignored tmp/, whatever the current directory is.
STATE_DIR = PORTAL_ROOT / "tmp" / "reconcile-state"
REPORT_DIR = PORTAL_ROOT / "tmp"
DEFAULT_TOKEN_FILE = str(PORTAL_ROOT / "tmp" / "staff-jwt.txt")


def _setting(key: str) -> str:
    """A non-secret setting from site.config.json, or exit naming the key and its owner file."""
    try:
        return site_config.get(key)
    except site_config.SiteConfigError as e:
        click.echo(f"error: {e}", err=True)
        sys.exit(1)


# Event name shown in the HTML report title (site.config.json: eventTitle).
EVENT_TITLE = _setting("eventTitle")
# Registration codes start with this prefix (owner: REG_CODE_PREFIX in src/shared/src/reg-code.ts);
# bank remarks that begin with a code are parsed for the name.
try:
    REG_CODE_PREFIX = site_config.reg_code_prefix()
except site_config.SiteConfigError as _e:
    click.echo(f"error: {_e}", err=True)
    sys.exit(1)


def _env_callback(ctx, param, value):
    if value == "prod":
        site_config.print_target("prod")  # stderr: prod operations show their target first
    return value


env_argument = click.argument("env", type=click.Choice(list(site_config.ENVIRONMENTS)), callback=_env_callback)

REG_SQL = """SELECT r.id, r.reg_code, r.full_name, r.branch, r.email, r.whatsapp,
  r.city, r.country, r.status, r.total_amount, r.participation_type,
  p.id as payment_id, p.status as payment_status, p.amount as payment_amount,
  p.proof_file_key, p.gateway_ref, p.updated_at as payment_updated_at
FROM registrations r
LEFT JOIN payments p ON p.registration_id = r.id
ORDER BY r.branch, r.full_name"""

ATT_SQL = """SELECT a.registration_id, a.type, a.name, a.relationship, a.is_chargeable
FROM attendees a ORDER BY a.registration_id"""

REFUND_SQL = """SELECT rf.id, rf.registration_id, rf.amount, rf.status, rf.bank_reference,
  r.full_name, r.branch
FROM refunds rf
JOIN registrations r ON r.id = rf.registration_id
WHERE rf.status = 'pending'
ORDER BY r.branch, r.full_name"""

REPORT_REFUND_SQL = """SELECT rf.id, rf.registration_id, rf.source_payment_id, rf.amount, rf.status, rf.bank_reference, r.full_name, r.branch, r.whatsapp, r.city, r.country, r.participation_type FROM refunds rf JOIN registrations r ON r.id = rf.registration_id ORDER BY r.branch, r.full_name"""

BANK_TXN_UNRECONCILED_SQL = """SELECT bt.id, bt.txn_date, bt.txn_date_iso, bt.value_date,
  bt.description, bt.ref_no, bt.branch_code, bt.credit_paise, bt.debit_paise,
  bt.txn_type, bt.comment, bt.import_batch
FROM bank_transactions bt
WHERE bt.txn_type = 'credit'
AND bt.id NOT IN (SELECT bank_transaction_id FROM bank_transaction_payments)
ORDER BY bt.txn_date_iso DESC"""

BANK_TXN_ALL_SQL = """SELECT bt.id, bt.txn_date, bt.txn_date_iso, bt.value_date,
  bt.description, bt.ref_no, bt.branch_code, bt.credit_paise, bt.debit_paise,
  bt.txn_type, bt.comment, bt.import_batch
FROM bank_transactions bt
WHERE bt.txn_type = 'credit'
ORDER BY bt.txn_date_iso DESC"""


def d1_query(env: str, sql: str) -> list[dict]:
    d1q = DEVOPS_DIR / "d1-query"
    result = subprocess.run(
        [str(d1q), env, sql],
        capture_output=True, text=True, cwd=str(PORTAL_ROOT.resolve()),
    )
    raw = result.stdout
    # wrangler may print banner text before the JSON; decode from the first "[".
    start = raw.find("[")
    if start == -1:
        click.echo(f"No JSON in d1-query output. Is CLOUDFLARE_API_TOKEN set (process env or .env.ops)? stderr: {result.stderr.strip()}", err=True)
        sys.exit(1)
    try:
        data, _ = json.JSONDecoder().raw_decode(raw[start:])
    except json.JSONDecodeError:
        click.echo("Malformed JSON in d1-query output", err=True)
        sys.exit(1)
    if isinstance(data, list) and data and isinstance(data[0], dict) and "results" in data[0]:
        return data[0]["results"]
    return data


def load_processed() -> dict:
    p = STATE_DIR / "processed.json"
    if p.exists():
        return json.loads(p.read_text())
    return {"verified": {}}


def save_processed(data: dict):
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    (STATE_DIR / "processed.json").write_text(json.dumps(data, indent=2))


def _get_payment_amount(env: str, pid: str) -> int:
    rows = d1_query(env, f"SELECT p.amount FROM payments p WHERE p.id = {pid}")
    if not rows:
        click.echo(f"No payment found for pid={pid}", err=True)
        sys.exit(1)
    return int(rows[0]["amount"])


# ── Prematch helpers ──────────────────────────────────────────────────────────

def _parse_sender_name(desc: str) -> str | None:
    """Extract sender name from an SBI transaction description (SBI statement formats only). Returns None if unparseable.
    Python port of src/shared/src/bank-description-parser.ts"""
    desc = desc.strip().rstrip("-").strip()

    # UPI: BY TRANSFER-UPI/CR/{txn_id}/{name}/{bank}/{upi_id}/{remark}
    m = re.match(r"BY TRANSFER-UPI/CR/\d+/([^/]+)/[A-Z]{4}/", desc)
    if m:
        return m.group(1).strip() or None

    # IMPS: BY TRANSFER-IMPS/{txn_id}/{bank}-XX{digits}-{name}/{remark}
    m = re.match(r"BY TRANSFER-IMPS/\d+/[a-zA-Z]+-XX\w+-([^/]+)", desc, re.I)
    if m:
        return m.group(1).strip() or None

    # NEFT: BY TRANSFER-NEFT*{ifsc}*{ref}*{name}*{batch}
    m = re.match(r"BY TRANSFER-NEFT\*[^*]+\*[^*]+\*([^*]+)", desc)
    if m:
        return m.group(1).strip() or None

    # CHQ NEFT: CHQ TRANSFER-NEFT UTR NO: {utr} {name}
    m = re.match(r"CHQ TRANSFER-NEFT UTR NO:\s*\S+\s+(.+)", desc)
    if m:
        return m.group(1).strip() or None

    # SBI: BY TRANSFER-SBIY{ref}/{type}/{remark}
    m = re.match(r"BY TRANSFER-SBIY\d+/[MP]/(.*)", desc)
    if m:
        rem = m.group(1).strip()
        name_m = re.match(r"^" + re.escape(REG_CODE_PREFIX) + r"\w+\s+(.+)", rem)
        if name_m:
            return name_m.group(1).strip() or None

    return None


def _parse_txn_type(desc: str) -> str:
    """Classify transaction type from description."""
    if "UPI" in desc:
        return "UPI"
    if "IMPS" in desc:
        return "IMPS"
    if "NEFT" in desc:
        return "NEFT"
    if "SBIY" in desc:
        return "SBI"
    return "OTHER"


def _fuzzy_name_match(registrant: str | None, sender: str | None) -> bool:
    """Check if registrant name tokens appear in sender name."""
    if not registrant or not sender:
        return False
    reg_tokens = set(registrant.lower().split())
    sender_tokens = set(sender.lower().split())
    # At least one meaningful token (len > 1) must match
    for token in reg_tokens:
        if len(token) <= 1:
            continue
        if token in sender_tokens or any(token in st for st in sender_tokens):
            return True
    return False


def _date_diff(d1: str, d2: str) -> int | None:
    """Days between two YYYY-MM-DD dates. Returns None if unparseable."""
    try:
        a = datetime.strptime(d1, "%Y-%m-%d")
        b = datetime.strptime(d2, "%Y-%m-%d")
        return abs((a - b).days)
    except ValueError:
        return None


@click.group()
def cli():
    """Payment reconciliation tools."""
    pass


@cli.command()
@env_argument
def pending(env):
    """Show only unprocessed registrations (pending_verification + payment_pending)."""
    regs = d1_query(env, REG_SQL)
    processed = load_processed()
    verified_ids = set(int(k) for k in processed["verified"].keys())

    pending_regs = [
        r for r in regs
        if r["payment_status"] in ("pending_verification", "payment_pending")
        and r.get("payment_id") not in verified_ids
    ]

    click.echo(f"\n{'='*80}")
    click.echo(f"PENDING REGISTRATIONS ({len(pending_regs)} of {len(regs)} total)")
    click.echo(f"{'='*80}\n")

    for status in ["pending_verification", "payment_pending"]:
        group = [r for r in pending_regs if r["payment_status"] == status]
        if not group:
            continue
        label = "PROOF SUBMITTED (pending_verification)" if status == "pending_verification" else "PAYMENT PENDING"
        click.echo(f"--- {label} ({len(group)}) ---\n")
        click.echo(f"{'ID':<6} {'PmtID':<6} {'Name':<28} {'Branch':<12} {'PmtAmt':>8} {'RegTot':>8}  {'Ref'}")
        click.echo("-" * 116)
        for r in group:
            branch_short = r["branch"][:11] if r["branch"] else ""
            ref = r.get("gateway_ref") or ""
            if len(ref) > 30: ref = ref[:27] + "..."
            pmt_amt = r.get("payment_amount") or r.get("total_amount") or 0
            reg_tot = r.get("total_amount") or 0
            tot_col = f"{reg_tot:>8,}" if pmt_amt != reg_tot else f"{'':>8}"
            click.echo(f"{r['id']:<6} {r.get('payment_id',''):<6} {r['full_name']:<28} {branch_short:<12} {pmt_amt:>8,} {tot_col}  {ref}")
        click.echo()

    refunds = d1_query(env, REFUND_SQL)
    if refunds:
        click.echo(f"--- PENDING REFUNDS ({len(refunds)}) ---\n")
        click.echo(f"{'RefID':<6} {'Name':<28} {'Branch':<14} {'Amount':>8}")
        click.echo("-" * 62)
        for rf in refunds:
            branch_short = (rf["branch"] or "")[:13]
            click.echo(f"{rf['id']:<6} {rf['full_name']:<28} {branch_short:<14} {rf['amount']:>8,}")
        click.echo()


@cli.command("download-proofs")
@env_argument
def download_proofs(env):
    """Download all proof images for pending_verification records."""
    regs = d1_query(env, REG_SQL)
    pending_with_proof = [
        r for r in regs
        if r["payment_status"] == "pending_verification"
        and r.get("proof_file_key")
    ]

    if not pending_with_proof:
        click.echo("No pending_verification records with proof files.")
        return

    click.echo(f"Downloading {len(pending_with_proof)} proof files...\n")

    reconcile_sh = SCRIPT_DIR / "reconcile"
    pairs = []
    for r in pending_with_proof:
        key = r["proof_file_key"]
        pid = r.get("payment_id", "unknown")
        name = r["full_name"].strip().lower().replace(" ", "-").strip("-")
        ext = Path(key).suffix or ".jpg"
        local_name = f"proof-{pid}-{name}{ext}"
        pairs.append(f"{key}:{local_name}")

    result = subprocess.run(
        [str(reconcile_sh), "proofs", env] + pairs,
        capture_output=True, text=True,
    )
    click.echo(result.stdout)
    if result.returncode != 0:
        click.echo(result.stderr, err=True)

    click.echo(f"\nDownloaded to {PORTAL_ROOT / 'tmp' / 'proofs'}/. Delete that folder when done. Files:")
    for r in pending_with_proof:
        pid = r.get("payment_id", "?")
        name = r["full_name"].strip().lower().replace(" ", "-").strip("-")
        ext = Path(r["proof_file_key"]).suffix or ".jpg"
        click.echo(f"  tmp/proofs/proof-{pid}-{name}{ext}  ← {r['full_name']} (payment {pid})")


@cli.command("bank-txns")
@env_argument
@click.option("--all", "show_all", is_flag=True, default=False, help="Show all credits (including already-linked)")
def bank_txns(env, show_all):
    """List bank credit transactions from D1. Default: unreconciled only."""
    sql = BANK_TXN_ALL_SQL if show_all else BANK_TXN_UNRECONCILED_SQL
    txns = d1_query(env, sql)

    label = "ALL CREDITS" if show_all else "UNRECONCILED CREDITS"
    click.echo(f"\n{'='*80}")
    click.echo(f"{label} ({len(txns)})")
    click.echo(f"{'='*80}\n")
    click.echo(f"{'TxnID':<6} {'Date':<12} {'Sender':<28} {'Amount':>10}  {'Type':<6} {'Ref'}")
    click.echo("-" * 95)
    for t in txns:
        sender = _parse_sender_name(t["description"]) or "?"
        amt = t["credit_paise"] // 100
        ttype = _parse_txn_type(t["description"])
        ref = (t.get("ref_no") or "")[:20]
        click.echo(f"{t['id']:<6} {t['txn_date']:<12} {sender:<28} {amt:>10,}  {ttype:<6} {ref}")
    click.echo()


@cli.command()
@env_argument
@click.option("--transactions", "-t", "transactions_file", type=click.Path(exists=True),
              help="JSON file with bank transactions (legacy mode; omit to query D1 by default)")
@click.option("--proof-data", type=click.Path(exists=True),
              help="Agent-extracted proof data JSON [{payment_id, proof_utr, proof_date, proof_time, proof_sender, proof_amount, proof_method}]")
def prematch(env, transactions_file, proof_data):
    """Pre-match pending registrations against unreconciled bank transactions.

    Default: queries D1 for unreconciled credits and shows pending regs side-by-side.
    With --proof-data: runs heuristic scoring (UTR, name+amount, amount+date) and
    outputs proposed matches grouped by confidence (high/medium/low).

    Legacy: use --transactions for old JSON file mode.
    """
    regs = d1_query(env, REG_SQL)
    pending_regs = [r for r in regs if r["payment_status"] in ("pending_verification", "payment_pending")]

    # Legacy mode: JSON file
    if transactions_file:
        txns = json.loads(Path(transactions_file).read_text())
        _legacy_prematch(pending_regs, txns)
        return

    # New mode: query D1 for unreconciled credits
    txns = d1_query(env, BANK_TXN_UNRECONCILED_SQL)

    click.echo(f"\n{'='*80}")
    click.echo(f"UNRECONCILED CREDITS ({len(txns)})")
    click.echo(f"{'='*80}\n")
    click.echo(f"{'TxnID':<6} {'Date':<12} {'Sender':<28} {'Amount':>10}  {'Type':<6} {'Ref'}")
    click.echo("-" * 95)
    for t in txns:
        sender = _parse_sender_name(t["description"]) or "?"
        amt = t["credit_paise"] // 100
        ttype = _parse_txn_type(t["description"])
        ref = (t.get("ref_no") or "")[:20]
        click.echo(f"{t['id']:<6} {t['txn_date']:<12} {sender:<28} {amt:>10,}  {ttype:<6} {ref}")
    click.echo()

    click.echo(f"--- PENDING REGISTRATIONS ({len(pending_regs)}) ---\n")
    click.echo(f"{'PmtID':<6} {'Name':<28} {'Amount':>10}  {'Status':<22} {'Proof'}")
    click.echo("-" * 98)
    for r in pending_regs:
        pid = r.get("payment_id") or "?"
        pf = (r.get("proof_file_key") or "").split("/")[-1] or "—"
        if len(pf) > 28:
            pf = pf[:25] + "..."
        click.echo(f"{str(pid):<6} {r['full_name']:<28} {r['total_amount']:>10,}  {r['payment_status']:<22} {pf}")
    click.echo()

    if not proof_data:
        click.echo("No --proof-data provided. Run proof extraction first, then re-run with --proof-data for heuristic matching.")
        return

    # Run heuristics with proof data
    proofs = json.loads(Path(proof_data).read_text())
    _run_heuristics(pending_regs, txns, proofs)


def _legacy_prematch(pending_regs, txns):
    """Old prematch logic for JSON file backward compatibility."""
    click.echo(f"\nPre-matching {len(pending_regs)} pending regs against {len(txns)} transactions\n")

    by_amount: dict[int, list] = {}
    for t in txns:
        amt = int(t.get("amount", 0))
        by_amount.setdefault(amt, []).append(t)

    matched, unmatched = [], []
    for r in pending_regs:
        candidates = by_amount.get(r["total_amount"], [])
        if candidates:
            matched.append((r, candidates))
        else:
            unmatched.append(r)

    if matched:
        click.echo(f"--- AMOUNT MATCHES ({len(matched)}) ---\n")
        for r, cands in matched:
            click.echo(f"  {r['full_name']:<30} ₹{r['total_amount']:>8,}  ({r['payment_status']})")
            for c in cands:
                click.echo(f"    → {c.get('date','?'):<12} {c.get('sender','?'):<30} {c.get('ref','')}")
            click.echo()

    if unmatched:
        click.echo(f"--- NO AMOUNT MATCH ({len(unmatched)}) ---\n")
        for r in unmatched:
            click.echo(f"  {r['full_name']:<30} ₹{r['total_amount']:>8,}  ({r['payment_status']})")


MIN_UTR_LEN = 8


def _extract_regcode(desc: str) -> str | None:
    """Extract SMRT regcode from bank description remark field."""
    m = re.search(r"(SMRT\w{4,})", desc)
    return m.group(1) if m else None


def _run_heuristics(pending_regs, bank_txns, proofs):
    """Match pending registrations to bank transactions. Only auto-matches when
    certain (UTR, name+amount, regcode+amount). Everything else is unmatched
    with hints for the agent to investigate manually with the user."""
    proof_by_pid = {p["payment_id"]: p for p in proofs}

    click.echo(f"\n{'='*80}")
    click.echo(f"HEURISTIC MATCHING")
    click.echo(f"{'='*80}\n")

    auto_matched = []
    unmatched_regs = []

    for reg in pending_regs:
        pid = reg.get("payment_id")
        proof = proof_by_pid.get(pid)

        if not proof:
            unmatched_regs.append((reg, "no proof data", []))
            continue

        best_auto = None
        hints = []

        for txn in bank_txns:
            desc = txn.get("description", "")
            ref = txn.get("ref_no", "")
            txn_amount = txn["credit_paise"] // 100
            reg_amount = reg["total_amount"]
            amount_hit = txn_amount == reg_amount

            sender = _parse_sender_name(desc)
            reg_name = reg["full_name"]
            proof_name = proof.get("proof_sender", "")
            name_hit = _fuzzy_name_match(reg_name, sender) or _fuzzy_name_match(proof_name, sender)

            # Auto-match criteria (no false positives allowed):

            # 1. UTR match (gold standard) — min length to avoid short numeric coincidences
            utr = proof.get("proof_utr")
            if utr and len(utr) >= MIN_UTR_LEN and (utr in desc or (ref and utr in ref)):
                best_auto = (txn, "UTR")
                break

            # 2. Name + Amount match
            if name_hit and amount_hit:
                best_auto = (txn, "name+amount")
                break

            # 3. Regcode in bank description + amount match
            regcode = _extract_regcode(desc)
            if regcode and reg.get("reg_code") and regcode in reg["reg_code"] and amount_hit:
                best_auto = (txn, "regcode+amount")
                break

            # Not certain enough for auto-match — collect as hints
            if amount_hit:
                hints.append((txn, f"amount ₹{txn_amount:,} matches (sender: {sender or '?'})"))
            elif name_hit:
                hints.append((txn, f"name matches (bank ₹{txn_amount:,} vs reg ₹{reg_amount:,})"))

        if best_auto:
            auto_matched.append((reg, best_auto[0], best_auto[1]))
        else:
            reason = "no candidates" if not hints else "no certain match"
            unmatched_regs.append((reg, reason, hints))

    # Check for duplicate auto-matches (same bank txn matched to multiple regs)
    txn_to_regs: dict[int, list] = {}
    for reg, txn, reason in auto_matched:
        txn_to_regs.setdefault(txn["id"], []).append((reg, txn, reason))

    clean_auto = []
    for txn_id, entries in txn_to_regs.items():
        if len(entries) == 1:
            clean_auto.append(entries[0])
        else:
            # Conflict — same bank txn matched multiple regs. Demote all to unmatched.
            names = ", ".join(e[0]["full_name"] for e in entries)
            click.echo(f"  ⚠ bank_txn {txn_id} matched {len(entries)} registrations ({names}) — demoting to manual review\n")
            for reg, txn, reason in entries:
                unmatched_regs.append((reg, f"conflict: bank_txn {txn_id} also matches other regs", [(txn, f"{reason} (conflicted)")]))

    # Output
    if clean_auto:
        click.echo(f"--- AUTO-MATCH ({len(clean_auto)}) ---\n")
        for reg, txn, reason in clean_auto:
            sender = _parse_sender_name(txn["description"]) or "?"
            amt = txn["credit_paise"] // 100
            pid = reg.get("payment_id")
            click.echo(f"  payment {pid} ({reg['full_name']}, ₹{reg['total_amount']:,})")
            click.echo(f"    → bank_txn {txn['id']} ({sender}, ₹{amt:,}, {txn['txn_date']})  [{reason}]")
            click.echo()

    if unmatched_regs:
        click.echo(f"--- UNMATCHED ({len(unmatched_regs)}) — agent + user to resolve ---\n")
        for reg, reason, hints in unmatched_regs:
            pid = reg.get("payment_id", "?")
            click.echo(f"  payment {pid} ({reg['full_name']}, ₹{reg['total_amount']:,}) — {reason}")
            for txn, hint in hints[:3]:
                sender = _parse_sender_name(txn["description"]) or "?"
                amt = txn["credit_paise"] // 100
                click.echo(f"    hint: bank_txn {txn['id']} ({sender}, ₹{amt:,}, {txn['txn_date']}) — {hint}")
            click.echo()

    # Summary
    click.echo(f"Summary: {len(clean_auto)} auto-matched, {len(unmatched_regs)} unmatched")
    if clean_auto:
        click.echo(f"\nUse auto-matched entries to write link + verify manifest.")
    if unmatched_regs:
        click.echo(f"Unmatched entries need agent investigation with user.")


@cli.command()
@click.argument("manifest_path", type=click.Path(exists=True))
@env_argument
def link(manifest_path, env):
    """Link bank transactions to payments from a manifest file.

    Manifest must have a 'links' section mapping bank_transaction_id → [payment_id, ...].

    Calls POST /api/staff/bank-transactions/:id/link for each entry.
    """
    manifest = json.loads(Path(manifest_path).read_text())
    links = manifest.get("links", {})

    if not links:
        click.echo("No links section in manifest.")
        return

    token_file = manifest.get("token_file", DEFAULT_TOKEN_FILE)
    if not Path(token_file).exists():
        click.echo(f"Token file not found: {token_file}", err=True)
        sys.exit(1)

    reconcile_sh = SCRIPT_DIR / "reconcile"

    items = list(links.items())
    ok = 0
    fail = 0

    click.echo(f"Linking {len(items)} bank transactions to payments against {env}...\n")

    # Canary: first link
    first_txn_id, first_pids = items[0]
    cmd = [str(reconcile_sh), "link", token_file, env, str(first_txn_id)] + [str(p) for p in first_pids]
    result = subprocess.run(cmd, capture_output=True, text=True)
    click.echo(result.stdout)
    if result.returncode != 0:
        click.echo(f"Canary failed: {result.stderr}", err=True)
        sys.exit(1)
    ok += 1

    # Batch: remaining links
    for txn_id, pids in items[1:]:
        cmd = [str(reconcile_sh), "link", token_file, env, str(txn_id)] + [str(p) for p in pids]
        result = subprocess.run(cmd, capture_output=True, text=True)
        click.echo(result.stdout)
        if result.returncode == 0:
            ok += 1
        else:
            click.echo(result.stderr, err=True)
            fail += 1

    click.echo(f"\n── link summary [{env}]: {ok} ok, {fail} failed ──")
    if fail > 0:
        sys.exit(1)


@cli.command()
@click.argument("manifest_path", type=click.Path(exists=True))
@env_argument
def verify(manifest_path, env):
    """Approve payments from a manifest file."""
    manifest = json.loads(Path(manifest_path).read_text())
    verified_today = manifest.get("verified_today", {})

    if not verified_today:
        click.echo("No verified_today entries in manifest.")
        return

    token_file = manifest.get("token_file", DEFAULT_TOKEN_FILE)
    if not Path(token_file).exists():
        click.echo(f"Token file not found: {token_file}", err=True)
        sys.exit(1)

    reconcile_sh = SCRIPT_DIR / "reconcile"

    # Build triples, grouping shortfall vs regular
    regular_triples: list[str] = []
    shortfall_triples: list[str] = []

    for pid, val in verified_today.items():
        if isinstance(val, str):
            # Old format: string ref — look up amount from DB
            amount = _get_payment_amount(env, pid)
            triple = f"{pid}:{val}:{amount}"
            regular_triples.append(triple)
        else:
            # New format: dict with ref, amount, optional withShortfall
            triple = f"{pid}:{val['ref']}:{val['amount']}"
            if val.get("withShortfall"):
                shortfall_triples.append(triple)
            else:
                regular_triples.append(triple)

    total = len(regular_triples) + len(shortfall_triples)
    click.echo(f"Verifying {total} payments against {env}...\n")

    # Groups: (triples, with_shortfall_flag)
    groups: list[tuple[list[str], bool]] = []
    if regular_triples:
        groups.append((regular_triples, False))
    if shortfall_triples:
        groups.append((shortfall_triples, True))

    canary_done = False
    for triples, with_shortfall in groups:
        flag = ["--with-shortfall"] if with_shortfall else []

        if not canary_done:
            # Canary: first triple of first group
            result = subprocess.run(
                [str(reconcile_sh), "verify", token_file, env] + flag + [triples[0]],
                capture_output=True, text=True,
            )
            click.echo(result.stdout)
            if result.returncode != 0:
                click.echo(f"Canary failed: {result.stderr}", err=True)
                sys.exit(1)
            canary_done = True
            remaining = triples[1:]
        else:
            remaining = triples

        if remaining:
            result = subprocess.run(
                [str(reconcile_sh), "verify", token_file, env] + flag + remaining,
                capture_output=True, text=True,
            )
            click.echo(result.stdout)
            if result.returncode != 0:
                click.echo(result.stderr, err=True)

    # Update processed state — store ref string either way
    processed = load_processed()
    for pid, val in verified_today.items():
        ref = val if isinstance(val, str) else val["ref"]
        processed["verified"][str(pid)] = {"ref": ref, "date": manifest.get("date", "unknown")}
    save_processed(processed)
    click.echo(f"\nState saved to {STATE_DIR / 'processed.json'}")


@cli.command()
@click.argument("manifest_path", type=click.Path(exists=True))
@env_argument
@click.option("--upload/--no-upload", default=False, help="Optional: upload to the reports bucket (site.config.json reports.bucket) after generating. Report has names and WhatsApp numbers: private bucket only, never a public URL")
def report(manifest_path, env, upload):
    """Generate HTML status report from manifest + fresh DB data."""
    manifest = json.loads(Path(manifest_path).read_text())
    regs = d1_query(env, REG_SQL)
    # attendees = d1_query(env, ATT_SQL)  # available if needed

    proof_notes = manifest.get("proof_notes", {})
    verified_today_evidence = manifest.get("verified_today", {})
    pending_committee = manifest.get("pending_committee", {})
    flagged_pids = set(int(k) for k in pending_committee.keys())

    # Derive "verified today" from server timestamps, not manifest
    today_sql = """SELECT p.id as payment_id FROM payments p
      WHERE p.status = 'verified'
      AND date(p.updated_at/1000, 'unixepoch') = date('now')"""
    today_from_server = set(r["payment_id"] for r in d1_query(env, today_sql))
    verified_today_ids = today_from_server | set(int(k) for k in verified_today_evidence.keys())

    cats = {"confirmed": [], "verified_today": [], "proof_submitted": [], "payment_pending": [], "refunds_due": [], "flagged": []}

    # Dedup: one row per registration. Pick the row with the highest payment_id
    # (most recent payment) to carry payment-specific fields.
    deduped = {}
    for r in regs:
        rid = r["id"]
        pid = r.get("payment_id") or 0
        if rid not in deduped or pid > (deduped[rid].get("payment_id") or 0):
            deduped[rid] = r

    # Categorize by r.status (registration status), NOT p.status (payment status).
    # This matches the dashboard, which uses the same field.
    for rid, r in deduped.items():
        reg_status = r.get("status", "")
        pid = r.get("payment_id")
        if reg_status == "confirmed":
            cats["confirmed"].append(r)
        elif reg_status == "pending_verification":
            if pid and pid in flagged_pids:
                cats["flagged"].append({**r, "_note": pending_committee.get(str(pid), "")})
            else:
                cats["proof_submitted"].append({**r, "_note": proof_notes.get(str(pid or ""), "Proof uploaded, awaiting bank statement match.")})
        elif pid and pid in flagged_pids:
            cats["flagged"].append({**r, "_note": pending_committee.get(str(pid), "")})
        else:
            cats["payment_pending"].append(r)

    # Verified Today: check ALL payment rows (not deduped — a reg may have multiple
    # payments verified today), but deduplicate by registration for display.
    seen_today = set()
    for r in regs:
        pid = r.get("payment_id")
        rid = r["id"]
        if pid and pid in verified_today_ids and rid not in seen_today:
            seen_today.add(rid)
            ev = verified_today_evidence.get(str(pid), "")
            ev_ref = ev.get("ref", "") if isinstance(ev, dict) else ev
            cats["verified_today"].append({**r, "_evidence": ev_ref})

    # Self-validation: category counts must equal total unique registrations
    total_regs = len(deduped)
    categorized = len(cats["confirmed"]) + len(cats["proof_submitted"]) + len(cats["payment_pending"]) + len(cats["flagged"])
    if categorized != total_regs:
        click.echo(f"VALIDATION FAILED: {categorized} categorized but {total_regs} total registrations", err=True)
        click.echo(f"  confirmed={len(cats['confirmed'])} proof={len(cats['proof_submitted'])} pending={len(cats['payment_pending'])} flagged={len(cats['flagged'])}", err=True)
        sys.exit(1)
    click.echo(f"Validation OK: {total_regs} registrations — {len(cats['confirmed'])} confirmed, {len(cats['proof_submitted'])} proof, {len(cats['payment_pending'])} pending, {len(cats['flagged'])} flagged")

    refunds_raw = d1_query(env, REPORT_REFUND_SQL)
    cats["refunds_due"] = [rf for rf in refunds_raw if rf["status"] == "pending"]

    date_str = manifest.get("date", "unknown")
    cutoff = manifest.get("statement_cutoff", "Unknown")
    footer = manifest.get("footer_notes", "")
    out_path = REPORT_DIR / f"registration-status-{date_str}.html"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    h = _generate_html(cats, date_str, cutoff, footer)
    out_path.write_text(h)
    click.echo(f"Report: {out_path}")

    if upload:
        reconcile_sh = SCRIPT_DIR / "reconcile"
        result = subprocess.run(
            [str(reconcile_sh), "upload", env, str(out_path)],
            capture_output=True, text=True,
        )
        click.echo(result.stdout.strip())
        if result.returncode != 0:
            click.echo(result.stderr, err=True)


def _esc(s): return html_mod.escape(str(s or ""))

def _fmt(n):
    if not n: return "₹0"
    s = str(int(n))
    if len(s) <= 3: return f"₹{s}"
    last3 = s[-3:]
    rest = s[:-3]
    parts = []
    while rest:
        parts.insert(0, rest[-2:])
        rest = rest[:-2]
    return f"₹{','.join(parts)},{last3}"

def _wa(num):
    if not num: return ""
    clean = "".join(c for c in num if c in "+0123456789")
    digits = clean.lstrip("+")
    return f'<a class="wa-link" href="https://wa.me/{digits}" target="_blank">{_esc(clean)}</a>'

def _type_badge(t):
    if t == "full_celebration": return '<span class="tb tf">Full Celebration</span>'
    if t == "campus_only": return '<span class="tb tc">Campus Only</span>'
    if t == "donation_only": return '<span class="tb td">Donation Only</span>'
    return f'<span class="tb">{_esc(t)}</span>'

def _loc(r):
    parts = [s.strip() for s in [r.get("city"), r.get("country")] if s]
    return _esc(", ".join(parts))

def _group_by_branch(items):
    groups = {}
    for r in items:
        b = r.get("branch") or "Other"
        groups.setdefault(b, []).append(r)
    return sorted(groups.items())

def _branch_table(groups, headers, row_fn):
    out = []
    for branch, items in groups:
        out.append(f'<div class="bg"><div class="bh">{_esc(branch)} <span class="bc">({len(items)})</span></div>')
        out.append(f'<table><tr>{"".join(f"<th>{h}</th>" for h in headers)}</tr>')
        out.extend(row_fn(r) for r in items)
        out.append("</table></div>")
    return "\n".join(out)

def _generate_html(cats, date_str, cutoff, footer_notes):
    nc, nt, np, npe, nr, nf = len(cats["confirmed"]), len(cats["verified_today"]), len(cats["proof_submitted"]), len(cats["payment_pending"]), len(cats["refunds_due"]), len(cats["flagged"])
    d, co = _esc(date_str), _esc(cutoff)

    def confirmed_row(r):
        return f'<tr><td>{_esc(r["full_name"])}</td><td>{_loc(r)}</td><td>{_type_badge(r["participation_type"])}</td><td>{_wa(r.get("whatsapp"))}</td></tr>'

    def today_row(r):
        return f'<tr><td>{_esc(r["full_name"])}</td><td>{_loc(r)}</td><td>{_type_badge(r["participation_type"])}</td><td><div class="ev">{_esc(r.get("_evidence",""))}</div></td><td>{_wa(r.get("whatsapp"))}</td></tr>'

    def proof_row(r):
        return f'<tr><td>{_esc(r["full_name"])}</td><td>{_loc(r)}</td><td>{_type_badge(r["participation_type"])}</td><td><div class="ev">{_esc(r.get("_note",""))}</div></td><td>{_wa(r.get("whatsapp"))}</td></tr>'

    def pending_row(r):
        return f'<tr><td>{_esc(r["full_name"])}</td><td>{_type_badge(r["participation_type"])}</td><td>{_loc(r)}</td><td>{_wa(r.get("whatsapp"))}</td></tr>'

    def refund_row(r):
        return f'<tr><td>{_esc(r["full_name"])}</td><td>{_loc(r)}</td><td>{_type_badge(r["participation_type"])}</td><td>{_wa(r.get("whatsapp"))}</td></tr>'

    def flagged_row(r):
        return f'<tr><td>{_esc(r["full_name"])}</td><td>{_loc(r)}</td><td class="am">{_fmt(r["total_amount"])}</td><td>{_type_badge(r["participation_type"])}</td><td><div class="ev">{_esc(r.get("_note",""))}</div></td><td>{_wa(r.get("whatsapp"))}</td></tr>'

    confirmed_html = _branch_table(_group_by_branch(cats["confirmed"]), ["Name", "Location", "Type", "WhatsApp"], confirmed_row)
    today_html = _branch_table(_group_by_branch(cats["verified_today"]), ["Name", "Location", "Type", "Bank Match", "WhatsApp"], today_row)
    proof_html = _branch_table(_group_by_branch(cats["proof_submitted"]), ["Name", "Location", "Type", "Details", "WhatsApp"], proof_row)
    pending_html = _branch_table(_group_by_branch(cats["payment_pending"]), ["Name", "Type", "Location", "WhatsApp"], pending_row)
    refunds_html = _branch_table(_group_by_branch(cats["refunds_due"]), ["Name", "Location", "Type", "WhatsApp"], refund_row)
    flagged_html = _branch_table(_group_by_branch(cats["flagged"]), ["Name", "Location", "Amount", "Type", "Issue", "WhatsApp"], flagged_row)

    today_note = f'<div class="note"><strong>Verified {d}</strong> — These {nt} registrations were matched to the bank statement and approved in this reconciliation run.</div>' if nt else ""
    proof_note = '<div class="note"><strong>Proof uploaded but not yet confirmed.</strong> Payment may appear in the next statement, or there may be a discrepancy requiring follow-up.</div>' if np else ""
    footer_p = f"<p>{_esc(footer_notes)}</p>" if footer_notes else ""
    refunds_stat = f'<div class="st" style="background:#fff3cd;color:#b45309"><span class="n">{nr}</span>Refunds Due</div>' if nr else ""
    flagged_stat = f'<div class="st" style="background:#fce4ec;color:#c62828"><span class="n">{nf}</span>Needs Attention</div>' if nf else ""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{EVENT_TITLE} — Registration Status ({d})</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8f9fa;color:#212529;line-height:1.5}}
.bn{{background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;padding:24px 32px}}
.bn h1{{font-size:1.5rem;font-weight:600;margin-bottom:4px}}
.bn .mt{{font-size:.85rem;color:#adb5bd}} .bn .mt span{{margin-right:20px}}
.sb{{display:flex;gap:12px;padding:16px 32px;background:#fff;border-bottom:1px solid #dee2e6;flex-wrap:wrap}}
.st{{padding:8px 16px;border-radius:8px;font-size:.9rem;font-weight:600}}
.st .n{{font-size:1.4rem;display:block}}
.sc{{background:#d1e7dd;color:#198754}} .sd{{background:#cfe2ff;color:#0d6efd}}
.sp{{background:#fff3cd;color:#b45309}} .se{{background:#f8d7da;color:#dc3545}}
.tabs{{display:flex;padding:0 32px;background:#fff;border-bottom:2px solid #dee2e6}}
.tab{{padding:12px 24px;cursor:pointer;font-weight:500;font-size:.9rem;border-bottom:3px solid transparent;margin-bottom:-2px;transition:.15s}}
.tab:hover{{background:#f1f3f5}}
.tab.a{{border-bottom-color:#0d6efd;color:#0d6efd}}
.tab .bd{{display:inline-block;background:#6c757d;color:#fff;border-radius:10px;padding:1px 8px;font-size:.75rem;margin-left:6px}}
.tab.a .bd{{background:#0d6efd}}
.ct{{padding:24px 32px;display:none}} .ct.a{{display:block}}
.bg{{margin-bottom:24px}}
.bh{{font-size:.85rem;font-weight:600;color:#6c757d;text-transform:uppercase;letter-spacing:.5px;padding:8px 0;border-bottom:1px solid #dee2e6;margin-bottom:8px}}
.bc{{font-weight:400;color:#adb5bd}}
table{{width:100%;border-collapse:collapse;margin-bottom:8px}}
th{{text-align:left;font-size:.75rem;text-transform:uppercase;color:#6c757d;padding:6px 12px;border-bottom:1px solid #dee2e6}}
td{{padding:8px 12px;font-size:.88rem;border-bottom:1px solid #f1f3f5;vertical-align:top}}
tr:hover td{{background:#f8f9fa}}
.tb{{display:inline-block;padding:2px 8px;border-radius:4px;font-size:.75rem;font-weight:500}}
.tf{{background:#e8f5e9;color:#2e7d32}} .tc{{background:#e3f2fd;color:#1565c0}} .td{{background:#fff3e0;color:#e65100}}
.ev{{font-size:.78rem;color:#6c757d;margin-top:2px}}
.wa-link{{color:#25d366;text-decoration:none;font-weight:500;font-size:.85rem}}
.wa-link:hover{{text-decoration:underline}}
.am{{font-variant-numeric:tabular-nums;font-weight:500}}
.ft{{padding:24px 32px;background:#fff;border-top:1px solid #dee2e6;font-size:.8rem;color:#6c757d;margin-top:24px}}
.lg{{display:flex;gap:24px;flex-wrap:wrap;margin-bottom:12px}}
.li{{display:flex;align-items:center;gap:6px}}
.ld{{width:10px;height:10px;border-radius:50%}}
.note{{background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:.85rem}}
.note strong{{color:#b45309}}
@media(max-width:768px){{.bn,.sb,.tabs,.ct,.ft{{padding-left:16px;padding-right:16px}}.tabs{{overflow-x:auto}}.tab{{white-space:nowrap;padding:10px 14px;font-size:.82rem}}table{{font-size:.82rem}}td,th{{padding:6px 8px}}}}
</style>
</head>
<body>
<div class="bn"><h1>{EVENT_TITLE} — Registration Status</h1>
<div class="mt"><span>Report generated: {d}</span><span>Statement cutoff: {co}</span></div></div>
<div class="sb">
<div class="st sc"><span class="n">{nc}</span>Confirmed</div>
<div class="st sd"><span class="n">{nt}</span>Verified Today</div>
<div class="st sp"><span class="n">{np}</span>Proof Submitted</div>
<div class="st se"><span class="n">{npe}</span>Payment Pending</div>
{refunds_stat}
{flagged_stat}
</div>
<div class="tabs">
<div class="tab a" onclick="T('c')">Confirmed <span class="bd">{nc}</span></div>
<div class="tab" onclick="T('t')">Verified Today <span class="bd">{nt}</span></div>
<div class="tab" onclick="T('p')">Proof Submitted <span class="bd">{np}</span></div>
<div class="tab" onclick="T('pe')">Payment Pending <span class="bd">{npe}</span></div>
<div class="tab" onclick="T('rf')">Refunds Due <span class="bd">{nr}</span></div>
<div class="tab" onclick="T('fl')">Needs Attention <span class="bd">{nf}</span></div>
</div>
<div id="c" class="ct a">{confirmed_html}</div>
<div id="t" class="ct">{today_note}{today_html}</div>
<div id="p" class="ct">{proof_note}{proof_html}</div>
<div id="pe" class="ct">{pending_html}</div>
<div id="rf" class="ct">{refunds_html}</div>
<div id="fl" class="ct"><div class="note"><strong>These records need committee or admin attention.</strong> Amount shortfalls or proof discrepancies requiring a decision.</div>{flagged_html}</div>
<div class="ft">
<div class="lg">
<div class="li"><div class="ld" style="background:#198754"></div> Full Celebration — attending all events</div>
<div class="li"><div class="ld" style="background:#1565c0"></div> Campus Only — campus visit only</div>
</div>
{footer_p}
<p style="margin-top:8px">Statement cutoff: {co}. Payments after this time will not appear until the next statement.</p>
</div>
<script>function T(id){{document.querySelectorAll('.ct').forEach(c=>c.classList.remove('a'));document.querySelectorAll('.tab').forEach(t=>t.classList.remove('a'));document.getElementById(id).classList.add('a');document.querySelector('[onclick=\"T(\\''+id+'\\')\"').classList.add('a')}}</script>
</body></html>"""


if __name__ == "__main__":
    cli()
