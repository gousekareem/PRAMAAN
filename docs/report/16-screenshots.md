# Dashboard screenshots

Real screenshots captured with Playwright (Chromium). They were taken from the production build (`vite build`
+ `vite preview`) connected to the running API after `pnpm db:reset-demo` and the scenario run (`pnpm scenarios`,
simulated devices), using `tools/docs/capture_screenshots.py`. All data shown is synthetic.

The authoring environment had no internet access, so OpenStreetMap basemap tiles could not load. The map page
renders zones and markers from the API.

![Sign-in page (no credentials displayed)](../screenshots/01-login.png)

![Overview as SI — scoped counts, duties by category, exceptions](../screenshots/02-overview-si.png)

![Duty assignments list (all categories) with personnel classes](../screenshots/03-duty-assignments.png)

![Train beat detail — device vs server start time, check-ins, versioned instructions, append-only history](../screenshots/04-duty-detail-train-beat.png)

![Station watch detail — shift staffing and recorded handover](../screenshots/05-duty-detail-station-watch.png)

![New VIP escort form — synthetic label only, flexible staffing](../screenshots/06-duty-form-vip.png)

![Weekly duty roster — categories, leave (hatched) and conflicts (red outline)](../screenshots/07-roster-week.png)

![Monthly duty roster](../screenshots/08-roster-month.png)

![Check-ins & presence — person, duty, device/server times, location provenance](../screenshots/09-checkins.png)

![Exceptions with inputs, investigation notes and audited action history](../screenshots/10-exceptions.png)

![Evidence verification — verified and failed (tampered) items linked to duties](../screenshots/11-evidence.png)

![Personnel directory — rank / classification, unit, open duties](../screenshots/12-personnel.png)

![Personnel detail — duty history, unavailability, exceptions](../screenshots/13-personnel-detail.png)

![Audited corrections — original kept beside the approved value](../screenshots/14-corrections.png)

![Reports — CSV/PDF exports (audited)](../screenshots/15-reports.png)

![Overview as DSP — sub-division scope](../screenshots/16-overview-dsp.png)

![VIP escorts as DSP — restricted details withheld](../screenshots/17-vip-escorts-dsp-restricted.png)

![My duties as HG — personal view only](../screenshots/18-my-duties-hg.png)

![Duty policy and role–permission matrix (prototype defaults)](../screenshots/19-policy-roles.png)

![Login accounts (separate from personnel records)](../screenshots/20-accounts.png)

![Protected system status — measured values; backup shown from a real drill result](../screenshots/21-system-status.png)

![Audit history](../screenshots/22-audit.png)

![Account & sessions — permissions and session management](../screenshots/23-account-sessions.png)

![Phone-width layout as PC — Armed Reserve (accept / acknowledge)](../screenshots/24-mobile-width-my-duties-pc-ar.png)

