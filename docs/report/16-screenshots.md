# Dashboard screenshots

Real screenshots captured with Playwright (Chromium) from the production build (`vite build` + `vite preview`)
connected to the running API after the simulated end-to-end demo (`tools/docs/capture_screenshots.py`).
The authoring environment had no internet access, so **OpenStreetMap basemap tiles could not load**; zone
polygons, markers, accuracy circles and labels are rendered from the PRAMAAN API.

![Sign-in page](../screenshots/01-login.png)

![Overview (supervisor)](../screenshots/02-overview.png)

![Map with last-known observation and freshness label](../screenshots/03-map.png)

![Alerts and review flags](../screenshots/04-alerts.png)

![Evidence list with SHA-256 prefixes and experimental screen-risk scores](../screenshots/05-evidence-list.png)

![Evidence detail: integrity, separated times, ledger neighbours, chain of custody](../screenshots/06-evidence-detail.png)

![Officer detail: duty, devices, check-in history](../screenshots/07-officer.png)

![Registered devices with key fingerprints and chain heads](../screenshots/08-devices.png)

![Audit history with checkpoint](../screenshots/09-audit.png)

![Phone-width layout as read-only reviewer, footer attribution](../screenshots/10-mobile-overview-reviewer.png)
