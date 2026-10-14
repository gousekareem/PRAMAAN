export const config = {
  apiBaseUrl:
    (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ??
    'http://localhost:4000',
  tileUrl:
    (import.meta.env.VITE_MAP_TILE_URL as string | undefined) ??
    'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  tileAttribution:
    (import.meta.env.VITE_MAP_ATTRIBUTION as string | undefined) ??
    '&copy; OpenStreetMap contributors',
};
