import { loadEnv, type Env } from './config/env.js';
import type { AppContext } from './context.js';
import { createPool } from './database/pool.js';
import { EvidenceStorage } from './evidence/storage.js';
import { EventBus } from './events/bus.js';
import { TokenService } from './security/tokens.js';

export function createContext(env: Env = loadEnv()): AppContext {
  return {
    env,
    pool: createPool(env),
    tokens: new TokenService(env),
    bus: new EventBus(),
    storage: new EvidenceStorage(env.EVIDENCE_STORAGE_DIR),
  };
}
