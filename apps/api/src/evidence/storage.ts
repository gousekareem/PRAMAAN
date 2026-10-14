import { randomBytes, randomUUID } from 'node:crypto';
import { createWriteStream, mkdirSync } from 'node:fs';
import { readFile, rename, rm, stat } from 'node:fs/promises';
import { isAbsolute, join, normalize, resolve, sep } from 'node:path';
import type { Writable } from 'node:stream';

/**
 * Local-filesystem evidence store. On Render this directory MUST be on a persistent disk
 * (or replaced by an object-storage driver): the default service filesystem is ephemeral.
 * File names are random (non-predictable) and never derived from user input.
 */
export class EvidenceStorage {
  readonly root: string;
  constructor(dir: string) {
    this.root = isAbsolute(dir) ? dir : resolve(process.cwd(), dir);
    for (const d of ['tmp', 'verified', 'quarantine'])
      mkdirSync(join(this.root, d), { recursive: true });
  }

  createTemp(): { path: string; stream: Writable } {
    const path = join(this.root, 'tmp', `${randomUUID()}.part`);
    return { path, stream: createWriteStream(path, { flags: 'wx', mode: 0o600 }) };
  }

  async promote(tempPath: string, area: 'verified' | 'quarantine'): Promise<string> {
    const shard = randomBytes(1).toString('hex');
    mkdirSync(join(this.root, area, shard), { recursive: true });
    const ref = `${area}/${shard}/${randomBytes(16).toString('hex')}.bin`;
    await rename(tempPath, join(this.root, ref));
    return ref;
  }

  private resolveRef(ref: string): string {
    if (!/^(verified|quarantine)\/[0-9a-f]{2}\/[0-9a-f]{32}\.bin$/.test(ref))
      throw new Error('invalid storage reference');
    const p = normalize(join(this.root, ref));
    if (!p.startsWith(this.root + sep)) throw new Error('invalid storage reference');
    return p;
  }

  async read(ref: string, maxBytes: number): Promise<Buffer> {
    const p = this.resolveRef(ref);
    const s = await stat(p);
    if (s.size > maxBytes) throw new Error('stored object exceeds size limit');
    return readFile(p);
  }

  async discard(tempPath: string): Promise<void> {
    await rm(tempPath, { force: true });
  }
}
