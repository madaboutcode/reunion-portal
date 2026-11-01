#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Rebuild tmp/payment-pending-report.html from live D1 data.

Pulls every registration stuck in status='pending' (payment initiated,
proof never uploaded) joined to its pending payment record(s), computes
days-since-pending, and writes a self-contained filterable HTML report.

The amount shown is the ACTUAL pending payment (sum of the payment_pending
records' amounts) — the balance still to be collected, not the registration
total. The report also shows the grand total still to be collected (reactive
to the branch/search filter).


Requires --env stg|prod (no default). Account, D1 database and R2 come from
src/server/wrangler.toml; the token from CLOUDFLARE_API_TOKEN (process env or .env.ops) or --token <file>.
Output: tmp/payment-pending-report.html (names, WhatsApp numbers) (tmp/ is git-ignored; the file contains personal data).

Usage:
  uv run scripts/build-payment-pending-report.py --env prod
  uv run scripts/build-payment-pending-report.py --env stg
  uv run scripts/build-payment-pending-report.py --dry-run       # print rows, don't write
  uv run scripts/build-payment-pending-report.py --token tmp/cf-token.txt
"""
import argparse
import json
import os
import subprocess
from datetime import datetime, timezone

# Cloudflare settings (account, D1 database, token) are resolved in ops_common.py via site_config.py.
from ops_common import add_env_argument, d1_query, preflight, site_value  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
PORTAL = os.path.dirname(HERE)
REPORT = os.path.join(PORTAL, "tmp/payment-pending-report.html")
EVENT_TITLE = site_value("eventName")  # report title, from site.config.json

QUERY = """
SELECT r.full_name AS name, r.branch AS branch, r.whatsapp AS whatsapp,
       r.participation_type AS ptype,
       MIN(p.created_at) AS first_pending_at,
       SUM(p.amount) AS pending_amount
FROM registrations r
JOIN payments p ON p.registration_id = r.id AND p.status = 'payment_pending'
WHERE r.status = 'pending'
GROUP BY r.id
ORDER BY pending_amount DESC
"""

TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Payment Pending List — {event_title} ({env_label})</title>
<style>
  :root {{
    --soft-aqua: #B9DFE2;
    --terracotta: #D76B51;
    --charcoal: #1F2A33;
    --bg: #F7F5F2;
    --row-alt: #F0EEEA;
    --warn: #C0392B;
    --warn-bg: #FDEBEA;
    --mid-bg: #FFF6E5;
    --mid: #B7791F;
  }}
  * {{ box-sizing: border-box; }}
  body {{
    font-family: 'Helvetica Neue', Arial, sans-serif;
    background: var(--bg);
    color: var(--charcoal);
    margin: 0;
    padding: 32px 24px 64px;
  }}
  .wrap {{ max-width: 980px; margin: 0 auto; }}
  h1 {{ font-size: 24px; margin: 0 0 4px; color: var(--charcoal); }}
  .sub {{ color: #5b6773; font-size: 14px; margin-bottom: 20px; }}
  .stats {{ display: flex; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }}
  .stat {{
    background: #fff; border: 1px solid #e2ddd4; border-radius: 10px;
    padding: 14px 20px; min-width: 180px;
  }}
  .stat-label {{
    font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;
    color: #8a92a0; margin-bottom: 4px;
  }}
  .stat-val {{ font-size: 26px; font-weight: 800; color: var(--charcoal); font-variant-numeric: tabular-nums; }}
  .stat-amount {{ border-color: var(--terracotta); background: #fdf1ec; }}
  .stat-amount .stat-val {{ color: var(--terracotta); }}
  .toolbar {{
    display: flex; gap: 12px; align-items: center; flex-wrap: wrap;
    margin-bottom: 16px; background: #fff; padding: 14px 16px;
    border-radius: 10px; border: 1px solid #e2ddd4;
  }}
  .toolbar label {{ font-size: 13px; font-weight: 600; color: var(--charcoal); }}
  select, input[type="text"] {{
    font-size: 14px; padding: 7px 10px; border-radius: 6px;
    border: 1px solid #c9c2b6; background: #fff; color: var(--charcoal);
  }}
  select {{ min-width: 260px; }}
  input[type="text"] {{ min-width: 220px; }}
  .count-pill {{
    margin-left: auto; background: var(--terracotta); color: #fff;
    font-size: 13px; font-weight: 700; padding: 6px 14px; border-radius: 999px;
  }}
  table {{
    width: 100%; border-collapse: collapse; background: #fff;
    border-radius: 10px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  }}
  thead th {{
    text-align: left; font-size: 12px; text-transform: uppercase;
    letter-spacing: 0.04em; color: #fff; background: var(--charcoal);
    padding: 12px 14px; cursor: pointer; user-select: none; white-space: nowrap;
  }}
  thead th:hover {{ background: #2c3a47; }}
  thead th .arrow {{ opacity: 0.5; font-size: 10px; margin-left: 4px; }}
  tbody tr {{ border-bottom: 1px solid #ece8e1; }}
  tbody tr:nth-child(even) {{ background: var(--row-alt); }}
  tbody tr:hover {{ background: #fdf1ec; }}
  td {{ padding: 11px 14px; font-size: 14px; vertical-align: middle; }}
  td.name {{ font-weight: 600; }}
  td.branch {{ color: #4a5560; }}
  th.amount-th, td.amount {{ text-align: right; }}
  td.amount {{ font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }}
  .kind-badge {{
    display: inline-block; padding: 3px 10px; border-radius: 999px;
    font-weight: 700; font-size: 12px; letter-spacing: 0.02em; white-space: nowrap;
  }}
  .kind-attendee {{ background: var(--soft-aqua); color: #1a5560; }}
  .kind-donor {{ background: var(--terracotta); color: #fff; }}
  a.wa {{ color: #1f7a4d; text-decoration: none; font-variant-numeric: tabular-nums; }}
  a.wa:hover {{ text-decoration: underline; }}
  .days-badge {{
    display: inline-block; padding: 3px 10px; border-radius: 999px;
    font-weight: 700; font-size: 13px; font-variant-numeric: tabular-nums;
  }}
  .days-ok {{ background: #E7F3EC; color: #1f7a4d; }}
  .days-mid {{ background: var(--mid-bg); color: var(--mid); }}
  .days-warn {{ background: var(--warn-bg); color: var(--warn); }}
  .empty-state {{ text-align: center; padding: 40px; color: #8a92a0; font-size: 14px; }}
  footer {{ margin-top: 20px; font-size: 12px; color: #9aa2ac; text-align: center; }}
</style>
</head>
<body>
<div class="wrap">
  <h1>Payment Pending List</h1>
  <div class="sub">Registrations with an unpaid balance (no proof uploaded yet) — {event_title}, {env_label} D1, generated {generated_date}. Amount shown is the actual pending payment, not the registration total.</div>

  <div class="stats">
    <div class="stat">
      <div class="stat-label">People pending</div>
      <div class="stat-val" id="statPeople">—</div>
    </div>
    <div class="stat">
      <div class="stat-label">Attendees — to collect</div>
      <div class="stat-val" id="statAttendee">—</div>
    </div>
    <div class="stat stat-amount">
      <div class="stat-label">Donations — to collect</div>
      <div class="stat-val" id="statDonor">—</div>
    </div>
    <div class="stat stat-amount">
      <div class="stat-label">Total to collect</div>
      <div class="stat-val" id="statAmount">—</div>
    </div>
  </div>

  <div class="toolbar">
    <label for="branchFilter">Branch</label>
    <select id="branchFilter">
      <option value="">All branches</option>
    </select>
    <label for="kindFilter">Type</label>
    <select id="kindFilter" style="min-width:140px">
      <option value="">All</option>
      <option value="attendee">Attendees</option>
      <option value="donor">Donors</option>
    </select>
    <label for="search">Search</label>
    <input type="text" id="search" placeholder="Name or WhatsApp…">
    <span class="count-pill" id="countPill"></span>
  </div>

  <table id="dataTable">
    <thead>
      <tr>
        <th data-key="name">Name <span class="arrow"></span></th>
        <th data-key="branch">Branch <span class="arrow"></span></th>
        <th data-key="kind">Type <span class="arrow"></span></th>
        <th data-key="amount" class="amount-th">Amount Pending <span class="arrow"></span></th>
        <th data-key="whatsapp">WhatsApp <span class="arrow"></span></th>
        <th data-key="days">Days Pending <span class="arrow"></span></th>
      </tr>
    </thead>
    <tbody id="tbody"></tbody>
  </table>
  <div class="empty-state" id="emptyState" style="display:none;">No matching registrations.</div>

  <footer>Source: registrations JOIN payments WHERE registrations.status = 'pending' · {count} records</footer>
</div>

<script>
const DATA = {data_json};

let sortKey = "amount";
let sortDir = -1;

const branchSet = [...new Set(DATA.map(d => d.branch))].sort();
const branchFilter = document.getElementById("branchFilter");
branchSet.forEach(b => {{
  const opt = document.createElement("option");
  opt.value = b;
  opt.textContent = b;
  branchFilter.appendChild(opt);
}});

function daysClass(d) {{
  if (d >= 14) return "days-warn";
  if (d >= 7) return "days-mid";
  return "days-ok";
}}

function waLink(num) {{
  const digits = num.replace(/[^\\d]/g, "");
  return `https://wa.me/${{digits}}`;
}}

function fmtINR(n) {{
  return "₹" + Number(n).toLocaleString("en-IN");
}}

function render() {{
  const branch = branchFilter.value;
  const kind = document.getElementById("kindFilter").value;
  const q = document.getElementById("search").value.trim().toLowerCase();

  let rows = DATA.filter(d => {{
    if (branch && d.branch !== branch) return false;
    if (kind && d.kind !== kind) return false;
    if (q && !(d.name.toLowerCase().includes(q) || d.whatsapp.toLowerCase().includes(q))) return false;
    return true;
  }});

  rows.sort((a, b) => {{
    let va = a[sortKey], vb = b[sortKey];
    if (typeof va === "string") {{ va = va.toLowerCase(); vb = vb.toLowerCase(); }}
    if (va < vb) return -1 * sortDir;
    if (va > vb) return 1 * sortDir;
    return 0;
  }});

  const tbody = document.getElementById("tbody");
  tbody.innerHTML = "";
  document.getElementById("emptyState").style.display = rows.length ? "none" : "block";
  document.getElementById("dataTable").style.display = rows.length ? "table" : "none";

  rows.forEach(d => {{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="name">${{d.name}}</td>
      <td class="branch">${{d.branch}}</td>
      <td><span class="kind-badge kind-${{d.kind}}">${{d.kind === "donor" ? "Donor" : "Attendee"}}</span></td>
      <td class="amount">${{fmtINR(d.amount)}}</td>
      <td><a class="wa" href="${{waLink(d.whatsapp)}}" target="_blank" rel="noopener">${{d.whatsapp}}</a></td>
      <td><span class="days-badge ${{daysClass(d.days)}}">${{d.days}}d</span></td>
    `;
    tbody.appendChild(tr);
  }});

  const totalPending = rows.reduce((s, d) => s + d.amount, 0);
  const donorPending = rows.reduce((s, d) => s + (d.kind === "donor" ? d.amount : 0), 0);
  const attPending = totalPending - donorPending;
  const donorCount = rows.filter(d => d.kind === "donor").length;
  const attCount = rows.length - donorCount;
  document.getElementById("statPeople").textContent = rows.length;
  document.getElementById("statAttendee").textContent = `${{fmtINR(attPending)}} · ${{attCount}}`;
  document.getElementById("statDonor").textContent = `${{fmtINR(donorPending)}} · ${{donorCount}}`;
  document.getElementById("statAmount").textContent = fmtINR(totalPending);
  document.getElementById("countPill").textContent = `${{rows.length}} of ${{DATA.length}}`;
}}

document.querySelectorAll("thead th").forEach(th => {{
  th.addEventListener("click", () => {{
    const key = th.dataset.key;
    if (sortKey === key) {{
      sortDir *= -1;
    }} else {{
      sortKey = key;
      sortDir = (key === "days" || key === "amount") ? -1 : 1;
    }}
    document.querySelectorAll("thead .arrow").forEach(a => a.textContent = "");
    th.querySelector(".arrow").textContent = sortDir === 1 ? "▲" : "▼";
    render();
  }});
}});

branchFilter.addEventListener("change", render);
document.getElementById("kindFilter").addEventListener("change", render);
document.getElementById("search").addEventListener("input", render);

render();
</script>
</body>
</html>
"""


def main():
    ap = argparse.ArgumentParser()
    add_env_argument(ap)
    ap.add_argument("--token", help="path to a file containing the CF token")
    ap.add_argument("--dry-run", action="store_true", help="print rows, don't write the file")
    args = ap.parse_args()

    token = preflight(args.env, args.token)
    rows = d1_query(token, args.env, QUERY)
    print(f"{len(rows)} pending-payment registrations pulled from {args.env}")

    now_ms = datetime.now(timezone.utc).timestamp() * 1000
    data = []
    for r in rows:
        wa = r["whatsapp"]
        if wa and not wa.startswith("+"):
            wa = "+" + wa
        days = int((now_ms - r["first_pending_at"]) / 86400000)
        is_donor = r["ptype"] == "donation_only"
        data.append({
            "name": r["name"].strip(),
            "branch": r["branch"],
            "whatsapp": wa,
            "days": days,
            "amount": int(r["pending_amount"] or 0),
            "kind": "donor" if is_donor else "attendee",
        })

    total_pending = sum(d["amount"] for d in data)
    donor_pending = sum(d["amount"] for d in data if d["kind"] == "donor")
    att_pending = total_pending - donor_pending
    for d in data:
        tag = "DONOR" if d["kind"] == "donor" else "attendee"
        print(f"  {d['days']:>3}d  ₹{d['amount']:>9,}  {tag:<8} {d['name']:<28} {d['branch']:<45} {d['whatsapp']}")
    print(f"\nAttendees pending: ₹{att_pending:,}  |  Donations pending: ₹{donor_pending:,}"
          f"  |  Total: ₹{total_pending:,} across {len(data)} registrations")

    if args.dry_run:
        print("--dry-run: not writing the report")
        return

    html = TEMPLATE.format(
        event_title=EVENT_TITLE,
        env_label="production" if args.env == "prod" else "staging",
        generated_date=datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        count=len(data),
        data_json=json.dumps(data, ensure_ascii=False),
    )
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    with open(REPORT, "w") as f:
        f.write(html)
    print(f"Wrote {REPORT}")


if __name__ == "__main__":
    main()
