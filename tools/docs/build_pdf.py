"""Builds the PRAMAAN PDF deliverables from the Markdown sources in docs/.

Usage (from the repository root, after `npm install` in tools/docs and `pip install markdown playwright`):
    python tools/docs/build_pdf.py --out-dir ..            # writes both PDFs and docs/diagrams/*.svg

Pipeline: Markdown (python-markdown: tables, fenced code, attr_list) -> HTML with print CSS -> Mermaid
rendered in Chromium -> PDF via Playwright (A4, running footer, page numbers).
"""
import argparse
import html
import re
from datetime import date
from pathlib import Path

import markdown
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs"
MERMAID = Path(__file__).resolve().parent / "node_modules" / "mermaid" / "dist" / "mermaid.min.js"

FONTS = ROOT / "apps" / "admin" / "node_modules" / "@fontsource"


def font_faces() -> str:
    out = ""
    for fam, d, w in [("IBM Plex Sans", "ibm-plex-sans", 400), ("IBM Plex Sans", "ibm-plex-sans", 600), ("IBM Plex Mono", "ibm-plex-mono", 400)]:
        f = FONTS / d / "files" / f"{d}-latin-{w}-normal.woff2"
        if f.exists():
            out += f"@font-face {{ font-family: '{fam}'; font-weight: {w}; src: url('{f.as_uri()}') format('woff2'); }}\n"
    return out


CSS = """
@page { size: A4; margin: 18mm 15mm 18mm 15mm; }
* { box-sizing: border-box; }
body { font-family: 'IBM Plex Sans', 'DejaVu Sans', Arial, sans-serif; font-size: 9.6pt; line-height: 1.45; color: #13212f; }
h1 { font-size: 18pt; color: #0f2133; border-bottom: 2px solid #0f2133; padding-bottom: 4px; margin: 0 0 10px; page-break-before: always; }
h1.nobreak { page-break-before: avoid; }
h2 { font-size: 12.5pt; color: #16304a; margin: 16px 0 6px; page-break-after: avoid; }
h3 { font-size: 10.8pt; color: #1f4263; margin: 12px 0 4px; page-break-after: avoid; }
p, li { orphans: 3; widows: 3; }
table { border-collapse: collapse; width: 100%; margin: 6px 0 10px; font-size: 8.2pt; page-break-inside: auto; }
tr { page-break-inside: avoid; }
th { background: #e9eef3; color: #0f2133; text-align: left; font-weight: 600; }
th, td { border: 1px solid #c9d2db; padding: 3px 5px; vertical-align: top; }
code { font-family: 'IBM Plex Mono', 'DejaVu Sans Mono', monospace; font-size: 8.2pt; background: #f1f3f5; padding: 0 2px; border-radius: 2px; word-break: break-word; }
pre { background: #f5f6f7; border: 1px solid #dde2e6; border-radius: 4px; padding: 6px 8px; white-space: pre-wrap; word-break: break-word; font-size: 7.9pt; page-break-inside: avoid; }
pre code { background: none; padding: 0; }
blockquote { border-left: 3px solid #a86100; background: #fff7ea; margin: 8px 0; padding: 4px 10px; }
img { display: block; max-width: 100%; max-height: 225mm; width: auto; height: auto; margin: 6px auto 12px; border: 1px solid #ccd3da; page-break-inside: avoid; }
.mermaid { text-align: center; margin: 8px 0 12px; page-break-inside: avoid; }
.mermaid svg { max-width: 100%; height: auto; }
.cover { height: 250mm; display: flex; flex-direction: column; justify-content: space-between; page-break-after: always; }
.cover .band { background: #0f2133; color: #f7f6f2; padding: 28mm 14mm 16mm; border-radius: 4px; }
.cover .band h1 { color: #fff; border: 0; font-size: 34pt; letter-spacing: 6px; margin: 0; page-break-before: avoid; }
.cover .band .sub { font-size: 14pt; margin-top: 6px; }
.cover .meta { font-size: 10pt; }
.cover .meta td { border: 0; padding: 2px 8px 2px 0; }
.disclaimer { border: 1px solid #a86100; background: #fff7ea; padding: 8px 10px; font-size: 8.8pt; }
.toc { page-break-after: always; }
.toc h1 { page-break-before: avoid; }
.toc ol { columns: 2; column-gap: 10mm; font-size: 9.2pt; padding-left: 18px; }
.toc li { margin: 1px 0; }
.small table { font-size: 7.2pt; }
.small th, .small td { padding: 2px 3px; }
"""


def md_to_html(text: str, base: Path) -> str:
    # Mermaid fences -> <div class="mermaid">
    def mer(m):
        return f'<div class="mermaid">{html.escape(m.group(1))}</div>'

    text = re.sub(r"```mermaid\n(.*?)```", mer, text, flags=re.S)
    out = markdown.markdown(text, extensions=["tables", "fenced_code", "attr_list", "sane_lists", "md_in_html"])
    # Resolve relative image paths
    out = re.sub(r'src="(?!https?:|file:)([^"]+)"', lambda m: f'src="{(base / m.group(1)).resolve().as_uri()}"', out)
    return out


def section(path: Path, demote_title: str | None = None, extra_class: str = "") -> str:
    text = path.read_text(encoding="utf-8")
    if demote_title:
        text = re.sub(r"^# .*$", f"# {demote_title}", text, count=1, flags=re.M)
    body = md_to_html(text, path.parent)
    return f'<section class="{extra_class}">{body}</section>' if extra_class else body


def cover(title: str, subtitle: str, doc_type: str) -> str:
    today = date.today().isoformat()
    return f"""
<div class="cover">
  <div class="band">
    <h1>PRAMAAN</h1>
    <div class="sub">Cryptographic Proof-of-Presence Engine for Guntur Railway Police</div>
    <div style="margin-top:18mm;font-size:16pt;font-weight:600">{html.escape(title)}</div>
    <div style="font-size:11pt;margin-top:4px">{html.escape(subtitle)}</div>
  </div>
  <div class="meta">
    <table>
      <tr><td><b>Document</b></td><td>{html.escape(doc_type)}</td></tr>
      <tr><td><b>Version</b></td><td>1.0 · {today}</td></tr>
      <tr><td><b>Developer</b></td><td>SHAIK GOUSE KAREEM · https://www.linkedin.com/in/gousekareem/</td></tr>
      <tr><td><b>Context</b></td><td>B.Tech final-year capstone project (academic prototype)</td></tr>
    </table>
    <p class="disclaimer"><b>Disclaimer.</b> PRAMAAN is an academic prototype. It has not been commissioned, approved,
    certified or deployed by Guntur Railway Police, Indian Railways or any government authority. All data shown is
    synthetic. Cryptographic integrity checks do not establish legal admissibility or that an event occurred.</p>
    <p style="font-size:9pt">© 2026 SHAIK GOUSE KAREEM. All Rights Reserved.</p>
  </div>
</div>"""


def toc(html_body: str) -> str:
    titles = re.findall(r"<h1[^>]*>(.*?)</h1>", html_body)
    items = "".join(f"<li>{t}</li>" for t in titles)
    return f'<div class="toc"><h1 class="nobreak">Contents</h1><ol>{items}</ol></div>'


def render(page_html: str, out_pdf: Path, footer_title: str, diagrams_dir: Path | None, prefix: str):
    tmp = ROOT / "out" / f"{prefix}.html"
    tmp.parent.mkdir(parents=True, exist_ok=True)
    tmp.write_text(page_html, encoding="utf-8")
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        p = b.new_page()
        p.goto(tmp.as_uri())
        p.wait_for_function("window.__mermaidDone === true", timeout=120_000)
        if diagrams_dir:
            diagrams_dir.mkdir(parents=True, exist_ok=True)
            svgs = p.eval_on_selector_all(".mermaid svg", "els => els.map(e => e.outerHTML)")
            for i, s in enumerate(svgs, 1):
                (diagrams_dir / f"{prefix}-diagram-{i:02d}.svg").write_text(s, encoding="utf-8")
        footer = (
            '<div style="font-size:7pt;width:100%;padding:0 15mm;color:#55606b;display:flex;justify-content:space-between">'
            f"<span>PRAMAAN — {html.escape(footer_title)} · © 2026 SHAIK GOUSE KAREEM</span>"
            '<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>'
        )
        p.pdf(path=str(out_pdf), format="A4", print_background=True, display_header_footer=True,
              header_template="<div></div>", footer_template=footer,
              margin={"top": "16mm", "bottom": "16mm", "left": "14mm", "right": "14mm"})
        b.close()


def page(body: str, title: str) -> str:
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>{html.escape(title)}</title>
<meta name="author" content="SHAIK GOUSE KAREEM"><style>{font_faces()}{CSS}</style>
<script src="{MERMAID.as_uri()}"></script></head><body>{body}
<script>
mermaid.initialize({{ startOnLoad: false, theme: 'neutral', securityLevel: 'strict', flowchart: {{ htmlLabels: true, useMaxWidth: true }}, sequence: {{ useMaxWidth: true }} }});
mermaid.run({{ querySelector: '.mermaid' }}).then(() => {{ window.__mermaidDone = true; }}).catch(e => {{ document.body.insertAdjacentHTML('afterbegin', '<pre>Mermaid error: ' + e + '</pre>'); window.__mermaidDone = true; }});
</script></body></html>"""


def build_documentation(out: Path):
    r = DOCS / "report"
    parts = [
        (r / "01-introduction.md", None, ""),
        (r / "02-requirements.md", None, ""),
        (DOCS / "architecture.md", "System architecture", ""),
        (DOCS / "data-flow.md", "Data flow, offline synchronisation and time", ""),
        (r / "05-mobile.md", None, ""),
        (r / "06-backend.md", None, ""),
        (DOCS / "database-design.md", None, ""),
        (DOCS / "api-reference.md", "API design", ""),
        (DOCS / "security-model.md", "Cryptographic integrity, authentication and security model", ""),
        (DOCS / "threat-matrix.md", "Security threat matrix", "small"),
        (DOCS / "privacy-governance.md", None, ""),
        (DOCS / "testing.md", "Testing strategy", ""),
        (DOCS / "results" / "test-results-summary.md", "Test execution results", ""),
        (DOCS / "performance.md", None, ""),
        (r / "14-deployment.md", None, ""),
        (DOCS / "demo-script.md", None, ""),
        (r / "16-screenshots.md", None, ""),
        (DOCS / "requirement-traceability.md", "Requirement traceability and feature completion", "small"),
        (r / "18-conclusion.md", None, ""),
        (r / "19-appendix.md", None, ""),
    ]
    body = "".join(section(p, t, c) for p, t, c in parts)
    full = cover("Project Documentation", "Architecture · Design · Security · Testing · Deployment", "Technical project report") + toc(body) + body
    render(page(full, "PRAMAAN Project Documentation"), out, "Project Documentation", DOCS / "diagrams", "documentation")


def build_guide(out: Path):
    g = DOCS / "PRAMAAN_WINDOWS_AND_RENDER_DEPLOYMENT_GUIDE.md"
    text = g.read_text(encoding="utf-8")
    text = re.sub(r"^# .*\n", "", text, count=1)
    text = re.sub(r"^## (Part [A-E].*)$", r"# \1", text, flags=re.M)
    text = re.sub(r"^### ", "## ", text, flags=re.M)
    intro, rest = text.split("# Part A", 1)
    body = f'<section>{md_to_html(intro, g.parent)}</section>' + md_to_html("# Part A" + rest, g.parent)
    full = cover("Windows Development and Render Deployment Guide", "Exact, ordered PowerShell commands", "Deployment guide") + toc(body) + body
    render(page(full, "PRAMAAN Deployment Guide"), out, "Windows & Render Deployment Guide", None, "guide")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", default=str(ROOT / "out"))
    a = ap.parse_args()
    od = Path(a.out_dir).resolve()
    od.mkdir(parents=True, exist_ok=True)
    build_documentation(od / "PRAMAAN_PROJECT_DOCUMENTATION.pdf")
    build_guide(od / "PRAMAAN_DEPLOYMENT_GUIDE.pdf")
    print("PDFs written to", od)
