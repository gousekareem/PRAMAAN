"""Captures REAL screenshots of the running dashboard (API + `vite preview` must be running).

Usage: python tools/docs/capture_screenshots.py --base http://localhost:4173 --password <SEED_DEMO_PASSWORD> --out docs/screenshots
Note: in an environment without internet access the OpenStreetMap basemap tiles cannot load;
zones, markers and labels are still rendered from the PRAMAAN API.
"""
import argparse
from playwright.sync_api import sync_playwright

p = argparse.ArgumentParser()
p.add_argument("--base", default="http://localhost:4173")
p.add_argument("--password", required=True)
p.add_argument("--out", default="docs/screenshots")
a = p.parse_args()

with sync_playwright() as pw:
    b = pw.chromium.launch()
    page = b.new_page(viewport={"width": 1440, "height": 960}, device_scale_factor=1)
    page.goto(f"{a.base}/login")
    page.wait_for_selector("text=Supervisor sign-in")
    page.screenshot(path=f"{a.out}/01-login.png")
    page.fill("#email", "supervisor@pramaan.demo")
    page.fill("#password", a.password)
    page.click("button[type=submit]")
    page.wait_for_selector("text=Active duty sessions")
    page.wait_for_timeout(800)
    page.screenshot(path=f"{a.out}/02-overview.png", full_page=True)
    page.click("nav[aria-label=Primary] >> text=Map")
    page.wait_for_selector(".leaflet-container")
    page.wait_for_timeout(1500)
    marker = page.locator("path.leaflet-interactive").last
    try:
        marker.click(timeout=3000, force=True)
        page.wait_for_timeout(500)
    except Exception:
        pass
    page.screenshot(path=f"{a.out}/03-map.png", full_page=True)
    page.click("nav[aria-label=Primary] >> text=Alerts")
    page.wait_for_selector("text=Alerts and review flags")
    page.wait_for_timeout(800)
    page.screenshot(path=f"{a.out}/04-alerts.png", full_page=True)
    page.click("nav[aria-label=Primary] >> text=Evidence")
    page.wait_for_selector("table")
    page.wait_for_timeout(500)
    page.screenshot(path=f"{a.out}/05-evidence-list.png", full_page=True)
    page.locator("table tbody tr:has-text('Evidence verified') a").first.click()
    page.wait_for_selector("text=Integrity verified")
    page.click("text=Show evidence image")
    page.wait_for_selector("img[alt^='Evidence capture']")
    page.wait_for_timeout(500)
    page.screenshot(path=f"{a.out}/06-evidence-detail.png", full_page=True)
    page.click("nav[aria-label=Primary] >> text=Officers")
    page.wait_for_selector("table")
    page.locator("table tbody tr a").first.click()
    page.wait_for_selector("text=Check-in history")
    page.wait_for_timeout(500)
    page.screenshot(path=f"{a.out}/07-officer.png", full_page=True)
    page.click("nav[aria-label=Primary] >> text=Devices")
    page.wait_for_selector("table")
    page.screenshot(path=f"{a.out}/08-devices.png", full_page=True)
    page.click("nav[aria-label=Primary] >> text=Audit history")
    page.wait_for_selector("table")
    page.wait_for_timeout(500)
    page.screenshot(path=f"{a.out}/09-audit.png", full_page=True)
    mobile = b.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
    mobile.goto(f"{a.base}/login")
    mobile.fill("#email", "reviewer@pramaan.demo")
    mobile.fill("#password", a.password)
    mobile.click("button[type=submit]")
    mobile.wait_for_selector("text=Active duty sessions")
    mobile.wait_for_timeout(800)
    mobile.screenshot(path=f"{a.out}/10-mobile-overview-reviewer.png", full_page=True)
    b.close()
print("screenshots written to", a.out)
