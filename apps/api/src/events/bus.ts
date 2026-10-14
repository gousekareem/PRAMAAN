import { EventEmitter } from 'node:events';

export type DashboardEvent =
  | { type: 'batch-ingested'; deviceId: string; officerId: string; accepted: number; at: string }
  | { type: 'flag-created'; flagId: string; flagType: string; severity: string; at: string }
  | { type: 'evidence-verified'; evidenceId: string; status: string; at: string }
  | { type: 'flag-updated'; flagId: string; status: string; at: string };

/**
 * In-process event bus feeding Server-Sent Events. A multi-instance deployment would need
 * a shared channel (e.g. PostgreSQL LISTEN/NOTIFY); see docs/limitations.md.
 */
export class EventBus {
  private readonly emitter = new EventEmitter();
  constructor() {
    this.emitter.setMaxListeners(500);
  }
  publish(e: DashboardEvent): void {
    this.emitter.emit('event', e);
  }
  subscribe(fn: (e: DashboardEvent) => void): () => void {
    this.emitter.on('event', fn);
    return () => this.emitter.off('event', fn);
  }
}
