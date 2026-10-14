# @pramaan/admin — supervisory dashboard

React 19 + Vite 7 + Tailwind CSS 3 + React-Leaflet 5. `pnpm dev` (port 5173), `pnpm build`, `pnpm test`.

- `auth/` — in-memory access token, httpOnly refresh cookie, route guard with role checks
- `components/layout/AppLayout.tsx` — shared layout; renders `AppFooter` once for every route
- `components/layout/AppFooter.tsx` — © 2026 SHAIK GOUSE KAREEM notice and LinkedIn attribution
- `pages/` — Overview, Map, Officers, Officer detail, Duties, Evidence (list/detail), Alerts, Devices, Audit
- `map/ObservationMap.tsx` — zones (GeoJSON), last-known observations, accuracy circles, freshness colours
- `hooks/useLiveStream.ts` — Server-Sent Events via fetch streaming (token never in URLs)

Build-time variables (public): `VITE_API_BASE_URL`, `VITE_MAP_TILE_URL`, `VITE_MAP_ATTRIBUTION`.
