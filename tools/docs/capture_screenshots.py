"""Captures REAL screenshots of the running dashboard (API + `vite preview` must be running,
demo data seeded with `pnpm db:reset-demo` and, for richer screens, `pnpm scenarios` executed).

Usage: python tools/docs/capture_screenshots.py --base http://localhost:4173 --out docs/screenshots
Note: without internet access the OpenStreetMap basemap tiles cannot load; zones, markers and
labels are still rendered from the PRAMAAN API.
"""
import argparse
from playwright.sync_api import sync_playwright

p = argparse.ArgumentParser()
p.add_argument("--base", default="http://localhost:4173")
p.add_argument("--out", default="docs/screenshots")
a = p.parse_args()

ACCOUNTS = {k: (f"{k}@parmaan.demo", f"{k}-parmaan.demo") for k in ["hg", "pc", "pc.ar", "hc", "asi", "si", "ci", "dsp", "admin"]}


def login(page, key):
    email, pw = ACCOUNTS[key]
    page.goto(f"{a.base}/login")
    page.wait_for_selector("#email")
    page.fill("#email", email)
    page.fill("#password", pw)
    page.click("button[type=submit]")
    page.wait_for_selector("main#main")
    page.wait_for_timeout(900)


def shot(page, name, full=True):
    page.wait_for_timeout(700)
    page.screenshot(path=f"{a.out}/{name}.png", full_page=full)


def nav(page, label):
    page.click(f"aside nav[aria-label=Primary] >> text='{label}'")
    page.wait_for_timeout(1000)


with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = lambda: b.new_context(viewport={"width": 1440, "height": 960}, device_scale_factor=1)

    c = ctx()
    page = c.new_page()
    page.goto(f"{a.base}/login")
    page.wait_for_selector("#email")
    shot(page, "01-login", full=False)

    # SI: operational supervisor of the Guntur station
    login(page, "si")
    page.wait_for_selector("text=Active personnel")
    shot(page, "02-overview-si")
    nav(page, "Duty assignments")
    page.wait_for_selector("table")
    shot(page, "03-duty-assignments")
    nav(page, "Train beats")
    page.wait_for_selector("table")
    page.locator("table tbody tr:has-text('SCENARIO train beat') a").first.click()
    page.wait_for_selector("text=Assignment history (append-only)")
    shot(page, "04-duty-detail-train-beat")
    nav(page, "Station watches")
    page.wait_for_selector("table")
    page.locator("table tbody tr:has-text('morning shift') a").first.click()
    page.wait_for_selector("text=Handovers")
    shot(page, "05-duty-detail-station-watch")
    page.goto(f"{a.base}/duties/new?category=VIP_ESCORT")
    page.wait_for_selector("text=Escort label")
    shot(page, "06-duty-form-vip")
    nav(page, "Duty roster")
    page.wait_for_selector("table")
    shot(page, "07-roster-week")
    page.click("button[aria-pressed=false] >> text=Monthly")
    page.wait_for_timeout(900)
    shot(page, "08-roster-month")
    nav(page, "Check-ins & presence")
    page.wait_for_selector("table")
    shot(page, "09-checkins")
    nav(page, "Exceptions")
    page.wait_for_selector("text=Exceptions")
    page.locator("button:has-text('Inputs, notes & history')").first.click()
    page.wait_for_timeout(900)
    shot(page, "10-exceptions")
    nav(page, "Evidence verification")
    page.wait_for_selector("table")
    shot(page, "11-evidence")
    nav(page, "Personnel")
    page.wait_for_selector("table")
    shot(page, "12-personnel")
    page.locator("table tbody tr:has-text('Vemuri Anil Kumar') a").first.click()
    page.wait_for_selector("text=Duty history")
    shot(page, "13-personnel-detail")
    nav(page, "Corrections")
    page.wait_for_timeout(800)
    shot(page, "14-corrections")
    nav(page, "Reports")
    page.wait_for_selector("text=Duty completion")
    shot(page, "15-reports")
    c.close()

    # DSP: aggregated overview; restricted VIP details withheld
    c = ctx()
    page = c.new_page()
    login(page, "dsp")
    page.wait_for_selector("text=Active personnel")
    shot(page, "16-overview-dsp")
    nav(page, "VIP escorts")
    page.wait_for_selector("table")
    shot(page, "17-vip-escorts-dsp-restricted")
    c.close()

    # HG: personal view only
    c = ctx()
    page = c.new_page()
    login(page, "hg")
    page.wait_for_selector("text=Assigned duties")
    shot(page, "18-my-duties-hg")
    c.close()

    # ADMIN: policy, accounts, system status
    c = ctx()
    page = c.new_page()
    login(page, "admin")
    nav(page, "Duty policy & roles")
    page.wait_for_selector("text=Roles and permissions")
    shot(page, "19-policy-roles")
    nav(page, "Login accounts")
    page.wait_for_selector("table")
    shot(page, "20-accounts")
    nav(page, "System status")
    page.wait_for_selector("text=Backup verification")
    shot(page, "21-system-status")
    nav(page, "Audit history")
    page.wait_for_selector("table")
    shot(page, "22-audit")
    nav(page, "Account & sessions")
    page.wait_for_selector("text=Permissions")
    shot(page, "23-account-sessions")
    c.close()

    # Phone width: PC (AR) personal view
    c = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2)
    page = c.new_page()
    login(page, "pc.ar")
    page.wait_for_selector("text=Assigned duties")
    shot(page, "24-mobile-width-my-duties-pc-ar")
    c.close()
    b.close()
print("screenshots written to", a.out)
