import type pg from 'pg';
import type { Env } from './config/env.js';
import type { TokenService } from './security/tokens.js';
import type { EventBus } from './events/bus.js';
import type { EvidenceStorage } from './evidence/storage.js';

export interface AppContext {
  env: Env;
  pool: pg.Pool;
  tokens: TokenService;
  bus: EventBus;
  storage: EvidenceStorage;
}
