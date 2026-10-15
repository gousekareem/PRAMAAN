import { en, type MessageKey } from './en';
import { te } from './te';

export type Locale = 'en' | 'te';
const dictionaries: Record<Locale, Partial<Record<MessageKey, string>>> = { en, te };

let current: Locale = 'en';

/** Sets the UI language. Missing translations fall back to English, so logic never forks per language. */
export function setLocale(l: Locale): void {
  current = l;
}

export function locale(): Locale {
  return current;
}

/** Translates a key, interpolating `{name}` placeholders. */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  let s = dictionaries[current][key] ?? en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Label for a dynamic code family, e.g. tCode('category', 'TRAIN_BEAT'). Unknown codes are humanised. */
export function tCode(prefix: 'category' | 'status' | 'class' | 'transition', code: string | null | undefined): string {
  if (!code) return '—';
  const key = `${prefix}.${code}` as MessageKey;
  if (key in en) return t(key);
  return code
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
}

export const CATEGORY_SLUGS: Record<string, 'TRAIN_BEAT' | 'STATION_WATCH' | 'VIP_ESCORT' | 'TRACK_INCIDENT'> = {
  'train-beats': 'TRAIN_BEAT',
  'station-watches': 'STATION_WATCH',
  'vip-escorts': 'VIP_ESCORT',
  'track-incidents': 'TRACK_INCIDENT',
};
