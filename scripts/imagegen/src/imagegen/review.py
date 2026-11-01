from __future__ import annotations

import json
from pathlib import Path


def _css() -> str:
    return """
body { font-family: system-ui, sans-serif; background: #1a1a1a; color: #e0e0e0;
       margin: 0; padding: 2rem; }
h1 { font-size: 1.5rem; margin-bottom: 1.5rem; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
        gap: 1.5rem; }
.card { background: #252525; border-radius: 8px; overflow: hidden; }
.card img { width: 100%; display: block; }
.meta { padding: 1rem; font-size: 0.85rem; line-height: 1.6; }
.meta dt { color: #888; display: inline; }
.meta dt::after { content: ": "; }
.meta dd { display: inline; margin: 0; }
.meta dd::after { content: "\\A"; white-space: pre; }
.label { font-weight: 600; color: #B9DFE2; margin-bottom: 0.5rem; }
"""


def render_contact_sheet(run_dir: Path, job_id: str) -> str:
    candidates = sorted(run_dir.glob(f"{job_id}-candidate-*.provenance.json"))

    cards = []
    for sc_path in candidates:
        try:
            sc = json.loads(sc_path.read_text())
        except (json.JSONDecodeError, OSError):
            continue

        cid = sc.get("candidateId", sc_path.stem)
        img_name = sc_path.name.replace(".provenance.json", "")
        output = sc.get("output", {})
        cost = sc.get("cost", {})
        req = sc.get("request", {})

        cards.append(f"""
<div class="card">
  <img src="{img_name}" alt="{cid}">
  <div class="meta">
    <div class="label">{cid}</div>
    <dl>
      <dt>Dimensions</dt><dd>{output.get('width', '?')}x{output.get('height', '?')}</dd>
      <dt>Format</dt><dd>{output.get('format', '?')} ({output.get('bytes', '?')} bytes)</dd>
      <dt>Cost</dt><dd>${cost.get('usd', '?')} ({cost.get('kind', '?')})</dd>
      <dt>Model</dt><dd>{sc.get('provider', {}).get('model', '?')}</dd>
      <dt>Output SHA</dt><dd><code>{output.get('sha256', '?')[:16]}...</code></dd>
      <dt>Request hash</dt><dd><code>{sc.get('requestHash', '?')[:24]}...</code></dd>
    </dl>
  </div>
</div>""")

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Contact Sheet: {job_id}</title>
<style>{_css()}</style>
</head>
<body>
<h1>Contact Sheet: {job_id}</h1>
<p>{len(cards)} candidate(s)</p>
<div class="grid">
{''.join(cards)}
</div>
</body>
</html>"""


def write_contact_sheet(run_dir: Path, job_id: str) -> Path:
    html = render_contact_sheet(run_dir, job_id)
    out = run_dir / f"{job_id}-contact-sheet.html"
    out.write_text(html)
    return out
