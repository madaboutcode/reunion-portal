#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Generate the "Who's Coming" page: one self-contained HTML file.

Pulls every attending registrant (confirmed + pending) from D1, downloads their
face thumbnails from R2, and bakes them into a single self-contained HTML file with the
photos inlined as base64 (so the page needs NO auth to view; the private bucket
is never hit by the viewer).

READS: D1 (SELECT) and R2 (thumbnail GET) through the Cloudflare REST API.
WRITES: tmp/whos-coming-<date>.html (git-ignored; contains names and photos).
With --upload it also PUTS the file into the reports bucket (site.config.json, reports.bucket) through
.claude/skills/payment-reconcile/scripts/reconcile upload, which can make
personal data publicly readable. Upload only to a private bucket; never a public URL.

Needs --env stg|prod (no default) and a Cloudflare token with D1 read + R2 read
(--token <file>, or CLOUDFLARE_API_TOKEN in the process env or .env.ops). Account, D1 database
and photo bucket come from src/server/wrangler.toml; the report bucket for --upload comes
from site.config.json (reports.bucket).

Usage:
  uv run scripts/whos-coming.py --env prod                   # token from CLOUDFLARE_API_TOKEN
  uv run scripts/whos-coming.py --env prod --token tmp/cf-token.txt   # token from a file
  uv run scripts/whos-coming.py --env stg --out tmp/preview.html
  uv run scripts/whos-coming.py --env prod --country Australia --details
  uv run scripts/whos-coming.py --env prod --upload                     # opt-in: also upload (private bucket only; never a public URL)
"""
import argparse, base64, os, subprocess
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from ops_common import account_id, add_env_argument, cf_get, d1_query, preflight, r2_bucket, site_value  # noqa: E402

ACCOUNT_ID = ""  # set in main() once --env is known
EVENT_NAME = site_value("eventName")  # from site.config.json
HERE = os.path.dirname(os.path.abspath(__file__))
PORTAL = os.path.dirname(HERE)
RECONCILE = os.path.join(PORTAL, ".claude/skills/payment-reconcile/scripts/reconcile")

# Branch -> (short code, accent color tuned for a light background), order = headcount desc
BRANCH_META = {
    "Electrical & Electronics Engineering": ("EEE", "#C2891B"),
    "Civil Engineering":                    ("CIVIL", "#2C9088"),
    "Computer Science & Engineering":       ("CSE", "#4D79D6"),
    "Production Engineering":               ("PROD", "#D9591F"),
    "Mechanical Engineering":               ("MECH", "#C2466A"),
    "Chemical Engineering":                 ("CHEM", "#7361E8"),
    "Electronics & Communication Engineering": ("ECE", "#1F9E8F"),
}


def smartname(n):
    n = n.strip()
    return n.title() if (n.isupper() or n.islower()) else n


def fetch_thumb(args):
    key, token, bucket = args
    url = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/r2/buckets/{bucket}/objects/{key}"
    try:
        return key, base64.b64encode(cf_get(url, token, binary=True)).decode()
    except Exception:
        return key, None


def esc(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
             .replace('"', "&quot;"))


# ── HTML pieces ───────────────────────────────────────────────────────────────
CSS = """
:root{ --aqua:#B9DFE2; --terra:#D76B51; --char:#26313a; --muted:#8c857a; --paper:#FCF8F1; }
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:var(--char);
  background:var(--paper);overflow-x:hidden;-webkit-font-smoothing:antialiased}
.bg{position:fixed;inset:0;z-index:0;overflow:hidden;
  background:linear-gradient(180deg,#FDFAF4 0%,#F7F0E4 55%,#F3EADB 100%)}
.blob{position:absolute;border-radius:50%;filter:blur(90px);animation:drift 26s ease-in-out infinite}
.blob.a{width:520px;height:520px;background:rgba(185,223,226,.55);top:-140px;left:-120px}
.blob.b{width:480px;height:480px;background:rgba(215,107,81,.30);bottom:-160px;right:-120px;animation-delay:-9s}
.blob.c{width:360px;height:360px;background:rgba(185,223,226,.30);top:45%;left:60%;animation-delay:-15s}
@keyframes drift{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(60px,-44px) scale(1.12)}}
.wrap{position:relative;z-index:2;max-width:1160px;margin:0 auto;padding:0 22px 96px}
.hero{min-height:90vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:14px}
.kicker{font-family:'Caveat',cursive;font-size:clamp(24px,3.6vw,38px);color:var(--terra);transform:rotate(-2.5deg);
  opacity:0;animation:rise .8s .1s forwards}
.titlewrap{position:relative;opacity:0;animation:rise .9s .28s forwards}
.title{font-family:'Playfair Display',serif;font-weight:800;font-size:clamp(54px,11vw,140px);line-height:.92;
  letter-spacing:-3px;color:var(--char)}
.title em{font-style:italic;color:var(--terra)}
.swash{display:block;width:min(420px,72vw);height:26px;margin:2px auto 0}
.swash path{stroke:var(--terra);stroke-width:5;fill:none;stroke-linecap:round;
  stroke-dasharray:600;stroke-dashoffset:600;animation:draw 1.1s 1s forwards cubic-bezier(.6,0,.2,1)}
@keyframes draw{to{stroke-dashoffset:0}}
.sub{font-size:clamp(15px,2.2vw,20px);max-width:560px;color:#73695d;opacity:0;animation:rise .9s .5s forwards}
.stats{display:flex;gap:34px;flex-wrap:wrap;justify-content:center;margin-top:26px;opacity:0;animation:rise .9s .7s forwards}
.stat .num{font-family:'Playfair Display',serif;font-size:clamp(30px,5vw,46px);font-weight:800;line-height:1;color:var(--char)}
.stat .lbl{font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);margin-top:5px}
@keyframes rise{from{opacity:0;transform:translateY(26px)}to{opacity:1;transform:translateY(0)}}
.filterbar{position:sticky;top:0;z-index:30;margin:6px -22px 14px;padding:14px 22px;
  background:rgba(252,248,241,.78);backdrop-filter:blur(14px) saturate(1.1);border-bottom:1px solid rgba(38,49,58,.07)}
.filters{display:flex;gap:9px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.filters::-webkit-scrollbar{display:none}
@media(min-width:780px){.filters{justify-content:center;flex-wrap:wrap;overflow:visible}}
.fbtn{flex:0 0 auto;min-height:44px;display:inline-flex;align-items:center;gap:8px;cursor:pointer;
  font-family:'DM Sans';font-weight:600;font-size:14px;color:var(--char);background:#fff;
  border:1px solid rgba(38,49,58,.12);border-radius:999px;padding:9px 18px;box-shadow:0 2px 10px rgba(38,49,58,.05);
  transition:transform .18s cubic-bezier(.2,.7,.2,1), background .25s, color .25s, box-shadow .25s, border-color .25s}
.fbtn:hover{transform:translateY(-2px);box-shadow:0 8px 22px rgba(38,49,58,.12)}
.fbtn .c{font-size:12px;opacity:.55;font-weight:700}
.fbtn .dot{width:9px;height:9px;border-radius:50%}
.fbtn[aria-pressed="true"]{color:#fff;background:var(--act,#26313a);border-color:transparent;
  box-shadow:0 10px 26px color-mix(in srgb, var(--act,#26313a) 40%, transparent)}
.fbtn[aria-pressed="true"] .c{opacity:.8;color:#fff}
.fbtn[aria-pressed="true"] .dot{background:rgba(255,255,255,.85)!important}
.fbtn:focus-visible{outline:3px solid var(--terra);outline-offset:2px}
.branch{margin:64px 0 0}
.branch[hidden]{display:none}
.branch-head{display:flex;align-items:baseline;gap:16px;margin-bottom:36px;flex-wrap:wrap;
  opacity:0;transform:translateY(18px);transition:.65s cubic-bezier(.2,.7,.2,1)}
.branch.in .branch-head{opacity:1;transform:none}
.branch-name{font-family:'Playfair Display',serif;font-size:clamp(23px,3.4vw,36px);font-weight:800;color:var(--char)}
.branch-count{font-family:'Caveat',cursive;font-size:29px;color:var(--c)}
.line{flex:1;min-width:40px;height:2px;border-radius:2px;background:linear-gradient(90deg,var(--c),transparent)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:46px 24px}
@media(min-width:780px){.grid{grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:54px 30px}}
.person{display:flex;flex-direction:column;align-items:center;text-align:center;gap:12px;
  opacity:0;transform:translateY(30px) scale(.94);transition:.6s cubic-bezier(.2,.7,.2,1)}
.branch.in .person{opacity:1;transform:none;transition-delay:calc(var(--i) * 50ms)}
.bob{animation:bob 7s ease-in-out infinite;animation-delay:var(--d)}
@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-9px)}}
.avatar{position:relative;width:clamp(120px,15vw,150px);aspect-ratio:1;border-radius:50%;background:#fff;padding:5px;
  box-shadow:0 14px 30px rgba(38,49,58,.16);transition:transform .4s cubic-bezier(.2,.7,.2,1), box-shadow .4s}
.avatar::after{content:"";position:absolute;inset:0;border-radius:50%;box-shadow:0 0 0 0 transparent;transition:box-shadow .4s}
.avatar img{width:100%;height:100%;object-fit:cover;border-radius:50%;display:block}
.avatar .ini{width:100%;height:100%;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-family:'Playfair Display',serif;font-weight:800;font-size:34px;color:#fff;
  background:linear-gradient(135deg, color-mix(in srgb,var(--c) 85%,#000) 0%, var(--c) 100%)}
.person:hover .avatar{transform:scale(1.07)}
.person:hover .avatar::after{box-shadow:0 0 0 4px color-mix(in srgb, var(--c) 70%, transparent)}
.person:hover{transform:translateY(-4px)}
.pname{font-family:'Caveat',cursive;font-weight:700;font-size:23px;line-height:1.04;color:var(--char)}
.ploc{font-size:11.5px;letter-spacing:.2px;color:var(--muted);margin-top:-4px}
.campus{display:inline-block;margin-top:5px;font-size:9px;letter-spacing:1px;text-transform:uppercase;color:var(--c);
  background:color-mix(in srgb, var(--c) 12%, #fff);border:1px solid color-mix(in srgb, var(--c) 28%, #fff);padding:2px 8px;border-radius:999px}
.detail-mode .grid{grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px}
.detail-person{align-items:stretch;text-align:left;background:rgba(255,255,255,.72);border:1px solid rgba(38,49,58,.10);
  border-radius:20px;padding:20px;box-shadow:0 8px 24px rgba(38,49,58,.07)}
.detail-person .bob{align-self:center}
.detail-person .pname{text-align:center}
.detail-data{font-family:'DM Sans',sans-serif;font-size:12px;font-weight:400;line-height:1.35;margin-top:14px;color:var(--char)}
.detail-row{display:grid;grid-template-columns:88px minmax(0,1fr);gap:10px;padding:8px 0;border-top:1px solid rgba(38,49,58,.09)}
.detail-row span{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding-top:1px}
.detail-row strong{font-weight:600;overflow-wrap:anywhere}
.detail-row a{color:var(--char);text-decoration:underline;text-decoration-color:rgba(215,107,81,.55);text-underline-offset:2px}
.detail-mode .title{font-size:clamp(44px,9vw,108px)}
@media(max-width:560px){.detail-person{padding:16px}.detail-row{grid-template-columns:78px minmax(0,1fr)}}
footer{text-align:center;margin-top:96px;padding-top:34px;border-top:1px solid rgba(38,49,58,.1);color:var(--muted);font-size:13px}
footer .big{font-family:'Playfair Display',serif;font-size:clamp(26px,4.5vw,44px);color:var(--char);margin-bottom:8px;font-weight:800}
footer .hand{font-family:'Caveat',cursive;font-size:26px;color:var(--terra);margin-top:10px}
"""

ROT_D = [0.0, 0.45, 0.9, 1.35, 1.8, 2.25, 2.7]


def display(value, fallback="-"):
    if value is None or str(value).strip() == "":
        return fallback
    return str(value).strip()


def pretty(value):
    return display(value).replace("_", " ").title()


def person_html(r, i, thumb_b64, detail_mode=False):
    loc = r["city"] or r["country"] or ""
    if r["country"] and r["country"] != "India" and r["city"]:
        loc = f"{r['city']}, {r['country']}"
    nm = esc(smartname(r["full_name"]))
    loc = esc(loc.strip())
    campus = '<div class="campus">Campus Day</div>' if r.get("participation_type") == "campus_only" else ""
    d = f"{(i % 7) * 0.45:.2f}s"
    if thumb_b64:
        face = f'<img loading="lazy" src="data:image/jpeg;base64,{thumb_b64}" alt="{nm}">'
    else:
        initials = "".join(w[0] for w in smartname(r["full_name"]).split()[:2]).upper()
        face = f'<div class="ini">{esc(initials)}</div>'
    details = ""
    if detail_mode:
        whatsapp = display(r.get("whatsapp"))
        alternate = display(r.get("mobile_alternate"))
        phone = whatsapp if alternate == "-" else f"{whatsapp} / {alternate}"
        check_in = display(r.get("check_in"))
        check_out = display(r.get("check_out"))
        stay = f"{check_in} to {check_out}" if check_in != "-" and check_out != "-" else "-"
        companions = r.get("companions", [])
        companion_text = ""
        if companions:
            people = []
            for companion in companions:
                name = display(companion.get("name"))
                age = f", age {companion['age']}" if companion.get("age") is not None else ""
                people.append(f"{pretty(companion.get('type'))}: {name}{age}")
            companion_text = f'<div class="detail-row"><span>Companions</span><strong>{esc("; ".join(people))}</strong></div>'
        details = (
            '<div class="detail-data">'
            f'<div class="detail-row"><span>Branch</span><strong>{esc(display(r.get("branch")))}</strong></div>'
            f'<div class="detail-row"><span>Contact</span><strong><a href="mailto:{esc(display(r.get("email"), ""))}">{esc(display(r.get("email")))}</a><br>{esc(phone)}</strong></div>'
            f'<div class="detail-row"><span>Travel</span><strong>{esc(display(r.get("city")))}, {esc(display(r.get("country")))}</strong></div>'
            f'<div class="detail-row"><span>Attending</span><strong>{esc(pretty(r.get("participation_type")))}</strong></div>'
            f'<div class="detail-row"><span>Stay</span><strong>{esc(pretty(r.get("accommodation")))}{(" · " + esc(stay)) if stay != "-" else ""}</strong></div>'
            f'<div class="detail-row"><span>Meal / shirt</span><strong>{esc(pretty(r.get("alumni_meal")))} / {esc(display(r.get("tshirt_size")))}</strong></div>'
            f'<div class="detail-row"><span>Gender</span><strong>{esc(pretty(r.get("gender")))}</strong></div>'
            f'<div class="detail-row"><span>Total</span><strong>INR {int(r.get("total_amount") or 0):,}</strong></div>'
            f'<div class="detail-row"><span>Status</span><strong>{esc(pretty(r.get("status")))}</strong></div>'
            f'<div class="detail-row"><span>Reg. code</span><strong>{esc(display(r.get("reg_code")))}</strong></div>'
            f'{companion_text}'
            '</div>'
        )
    person_class = "person detail-person" if detail_mode else "person"
    return (f'        <figure class="{person_class}" style="--i:{i}">\n'
            f'          <div class="bob" style="--d:{d}"><div class="avatar">{face}</div></div>\n'
            f'          <figcaption class="pname">{nm}<div class="ploc">{loc}</div>{campus}{details}</figcaption>\n'
            f'        </figure>')


def build_html(rows, thumbs, country_filter=None, detail_mode=False):
    groups = {}
    for r in rows:
        groups.setdefault(r["branch"], []).append(r)
    countries = sorted({r["country"] for r in rows if r["country"]})
    cities = sorted({(r["city"] or "").strip() for r in rows if (r["city"] or "").strip()})

    sections, buttons = [], []
    buttons.append(f'<button class="fbtn" data-target="all" aria-pressed="true" style="--act:#26313a">All <span class="c">{len(rows)}</span></button>')
    for br in BRANCH_META:
        if br not in groups:
            continue
        short, color = BRANCH_META[br]
        sid = "sec-" + short
        people = sorted(groups[br], key=lambda r: smartname(r["full_name"]))
        cards = "\n".join(person_html(r, i, thumbs.get(r["photo_thumb_key"]), detail_mode) for i, r in enumerate(people))
        sections.append(
            f'  <section class="branch" id="{sid}" data-branch="{short}" style="--c:{color}">\n'
            f'    <div class="branch-head">\n'
            f'      <span class="branch-name">{esc(br)}</span>\n'
            f'      <span class="branch-count">{len(people)} coming</span>\n'
            f'      <span class="line"></span>\n'
            f'    </div>\n    <div class="grid">\n{cards}\n    </div>\n  </section>')
        buttons.append(f'<button class="fbtn" data-target="{sid}" aria-pressed="false" style="--act:{color}">'
                       f'<span class="dot" style="background:{color}"></span>{short} <span class="c">{len(people)}</span></button>')

    js = """
function countUp(el){const to=+el.dataset.to;let n=0;const step=Math.max(1,Math.ceil(to/38));
  const t=setInterval(()=>{n+=step;if(n>=to){n=to;clearInterval(t)}el.textContent=n;},26);}
const io=new IntersectionObserver((es)=>{es.forEach(e=>{if(e.isIntersecting)e.target.classList.add('in');});},{threshold:.08});
document.querySelectorAll('.branch').forEach(b=>io.observe(b));
const btns=[...document.querySelectorAll('.fbtn')], secs=[...document.querySelectorAll('.branch')];
btns.forEach(btn=>btn.addEventListener('click',()=>{
  btns.forEach(b=>b.setAttribute('aria-pressed', b===btn ? 'true':'false'));
  const t=btn.dataset.target;
  secs.forEach(s=>{const show=(t==='all'||s.id===t); s.hidden=!show;
    if(show){ s.classList.remove('in'); void s.offsetWidth; s.classList.add('in'); }});
  document.querySelector('.filterbar').scrollIntoView({behavior:'smooth',block:'start'});
}));
window.addEventListener('load',()=>document.querySelectorAll('.num').forEach(countUp));
"""
    report_title = f"Who's Coming from {country_filter}" if country_filter else "Who's Coming"
    report_subtitle = (
        f"Everyone joining us at {esc(EVENT_NAME)} from {esc(country_filter)} — with contact, travel, stay, and registration details."
        if country_filter else
        f"Everyone joining us at {esc(EVENT_NAME)} — and the cities they're travelling from. Browse the whole batch, or just your branch."
    )
    wrap_class = "wrap detail-mode" if detail_mode else "wrap"
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{esc(EVENT_NAME)} — {esc(report_title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,800;1,800&family=DM+Sans:wght@400;500;600;700&family=Caveat:wght@500;700&display=swap" rel="stylesheet">
<style>{CSS}</style>
</head>
<body>
<div class="bg"><div class="blob a"></div><div class="blob b"></div><div class="blob c"></div></div>
<div class="{wrap_class}">
  <header class="hero">
    <div class="kicker">twenty years on, the batch of 2006 comes home</div>
    <div class="titlewrap">
      <h1 class="title">{esc(report_title).replace(" ", "<br>", 1) if country_filter else "Who's <em>Coming</em>"}</h1>
      <svg class="swash" viewBox="0 0 420 26" preserveAspectRatio="none" aria-hidden="true"><path d="M6 17 C 90 6, 150 22, 220 12 S 360 6, 414 14"/></svg>
    </div>
    <p class="sub">{report_subtitle}</p>
    <div class="stats">
      <div class="stat"><div class="num" data-to="{len(rows)}">0</div><div class="lbl">Alumni</div></div>
      <div class="stat"><div class="num" data-to="{len(groups)}">0</div><div class="lbl">Branches</div></div>
      <div class="stat"><div class="num" data-to="{len(countries)}">0</div><div class="lbl">Countries</div></div>
      <div class="stat"><div class="num" data-to="{len(cities)}">0</div><div class="lbl">Cities</div></div>
    </div>
  </header>
  <nav class="filterbar" aria-label="Filter by branch"><div class="filters">{"".join(buttons)}</div></nav>
{chr(10).join(sections)}
  <footer>
    <div class="big">See you on campus ✨</div>
    <div>{len(rows)} alumni · {len(groups)} branches · flying in from {", ".join(countries)}</div>
    <div class="hand">some friendships don't need a reminder — just a date</div>
  </footer>
</div>
<script>{js}</script>
</body>
</html>"""


def main():
    ap = argparse.ArgumentParser(description="Generate the Who's Coming page (reads D1 + R2, writes tmp/whos-coming-<date>.html).")
    ap.add_argument("--token", help="File with a Cloudflare token (D1+R2 read). Defaults to $CLOUDFLARE_API_TOKEN.")
    add_env_argument(ap)
    ap.add_argument("--country", help="Only include this country, matched case-insensitively.")
    ap.add_argument("--details", action="store_true", help="Include contact and registration details in each card.")
    ap.add_argument("--out", help="Output HTML path. Default: tmp/whos-coming-<date>.html")
    ap.add_argument("--yes", action="store_true", help="Skip the confirmation prompt for --upload.")
    ap.add_argument("--upload", action="store_true", help="Opt-in: also upload the file to the reports bucket (site.config.json reports.bucket) via reconcile upload. The page has names and photos: private bucket only, never a public URL.")
    args = ap.parse_args()

    global ACCOUNT_ID
    token = preflight(args.env, args.token)
    ACCOUNT_ID = account_id(args.env)
    cfg = {"db": args.env, "bucket": r2_bucket(args.env)}  # d1_query takes the environment name
    slug = "whos-coming"
    if args.country:
        slug += "-" + "-".join(args.country.strip().lower().split())
    out = args.out or os.path.join(PORTAL, "tmp", f"{slug}-{datetime.now().strftime('%d%b%Y').lower()}.html")
    os.makedirs(os.path.dirname(out), exist_ok=True)

    print(f"[1/4] Querying {args.env} D1 for attending registrants…")
    country_clause = ""
    if args.country:
        country = args.country.strip().replace("'", "''")
        country_clause = f"AND lower(trim(country)) = lower(trim('{country}')) "
    sql = ("SELECT id, reg_code, full_name, branch, email, whatsapp, mobile_alternate, city, country, status, "
           "participation_type, gender, tshirt_size, alumni_meal, accommodation, check_in, check_out, "
           "total_amount, photo_thumb_key FROM registrations WHERE status IN ('confirmed','pending') "
           + country_clause + "ORDER BY branch, full_name")
    rows = d1_query(token, cfg["db"], sql)
    print(f"      {len(rows)} people (confirmed + pending).")

    if args.details and rows:
        ids = ",".join(str(r["id"]) for r in rows)
        companion_rows = d1_query(
            token,
            cfg["db"],
            "SELECT registration_id, type, name, age, relationship, meal FROM attendees "
            f"WHERE registration_id IN ({ids}) ORDER BY registration_id, id",
        )
        companions = {}
        for companion in companion_rows:
            companions.setdefault(companion["registration_id"], []).append(companion)
        for row in rows:
            row["companions"] = companions.get(row["id"], [])
        print(f"      {len(companion_rows)} accompanying attendees.")

    keys = [r["photo_thumb_key"] for r in rows if r["photo_thumb_key"]]
    print(f"[2/4] Downloading {len(keys)} thumbnails from R2 ({cfg['bucket']})…")
    thumbs = {}
    with ThreadPoolExecutor(max_workers=10) as ex:
        for key, b in ex.map(fetch_thumb, [(k, token, cfg["bucket"]) for k in keys]):
            thumbs[key] = b
    missing = [k for k, v in thumbs.items() if v is None]
    if missing:
        print(f"      WARNING: {len(missing)} thumbnails failed — those show initials.")

    print("[3/4] Building HTML…")
    html = build_html(rows, thumbs, args.country, args.details)
    with open(out, "w") as f:
        f.write(html)
    print(f"      Wrote {out} ({round(len(html)/1024)} KB).")

    if args.upload:
        print("[4/4] Uploading to R2…")
        if not args.yes:
            print("      This page contains names and face photos of registrants. Whoever can read")
            print("      your reports bucket object URL can read it. Upload only to a private bucket; never a public URL.")
            try:
                answer = input("      Type 'upload' to continue: ").strip()
            except EOFError:
                answer = ""
            if answer != "upload":
                raise SystemExit("      Upload cancelled. The local file was kept.")
        subprocess.run([RECONCILE, "upload", args.env, out], check=True)
    else:
        print("[4/4] Kept local (no upload). --upload is opt-in, private bucket only.")


if __name__ == "__main__":
    main()
