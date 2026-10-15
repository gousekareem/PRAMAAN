import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        ink: { 950: '#0b1622', 900: '#0f2133', 800: '#16304a', 700: '#1f4263', 600: '#2c5a85' },
        paper: { 50: '#f7f6f2', 100: '#efede6', 200: '#e2dfd4' },
        signal: { ok: '#1f7a4d', warn: '#a86100', bad: '#b42318', info: '#285e9e', stale: '#6b7280' },
      },
    },
  },
  plugins: [],
} satisfies Config;
