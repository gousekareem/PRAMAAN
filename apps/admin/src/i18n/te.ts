import type { MessageKey } from './en';

/**
 * Telugu dictionary — intentionally empty in this prototype.
 *
 * The UI already resolves every operations-module label through `t()`, so Telugu can be added by
 * filling this map with reviewed translations (keys from ./en.ts). Untranslated keys fall back to
 * English. Translations should be prepared and checked by a fluent reviewer with the department's
 * preferred terminology rather than generated automatically.
 */
export const te: Partial<Record<MessageKey, string>> = {};
