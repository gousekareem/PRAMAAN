import type { SqlDatabase } from '../storage/db';
import type { HttpClient } from '../sync/http';
import type { AuthSession } from '../sync/syncEngine';

export interface OfficerIdentity {
  userId: string;
  officerId: string;
  displayName: string;
  isDemo: boolean;
}

/**
 * Officer session. Access token in memory only; refresh token persisted inside the
 * SQLCipher database (never in AsyncStorage or plain files). Rotation on every refresh.
 */
export class Session implements AuthSession {
  private access: string | null = null;
  constructor(
    private readonly db: SqlDatabase,
    private readonly http: HttpClient,
  ) {}

  accessToken(): string | null {
    return this.access;
  }

  async identity(): Promise<OfficerIdentity | null> {
    const r = (await this.db.execute("SELECT value FROM secure_kv WHERE key = 'identity'")).rows[0];
    return r ? (JSON.parse(String(r.value)) as OfficerIdentity) : null;
  }

  private async put(key: string, value: string) {
    await this.db.execute(
      'INSERT INTO secure_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value],
    );
  }

  async login(email: string, password: string, deviceId: string): Promise<OfficerIdentity> {
    const r = await this.http.send({
      method: 'POST',
      path: '/api/v1/auth/login',
      json: { email, password, client: 'mobile', deviceId },
    });
    const b = r.json as {
      accessToken?: string;
      refreshToken?: string;
      user?: { id: string; officerId: string; displayName: string; isDemo: boolean };
      error?: { message: string };
    };
    if (r.status !== 200 || !b.accessToken || !b.refreshToken || !b.user?.officerId)
      throw new Error(b.error?.message ?? `Sign-in failed (HTTP ${r.status})`);
    this.access = b.accessToken;
    const id: OfficerIdentity = {
      userId: b.user.id,
      officerId: b.user.officerId,
      displayName: b.user.displayName,
      isDemo: b.user.isDemo,
    };
    await this.put('refresh_token', b.refreshToken);
    await this.put('identity', JSON.stringify(id));
    return id;
  }

  async refresh(): Promise<boolean> {
    const row = (await this.db.execute("SELECT value FROM secure_kv WHERE key = 'refresh_token'"))
      .rows[0];
    if (!row) return false;
    try {
      const r = await this.http.send({
        method: 'POST',
        path: '/api/v1/auth/refresh',
        json: { refreshToken: String(row.value) },
      });
      const b = r.json as { accessToken?: string; refreshToken?: string };
      if (r.status !== 200 || !b.accessToken || !b.refreshToken) {
        if (r.status === 401)
          await this.db.execute("DELETE FROM secure_kv WHERE key = 'refresh_token'");
        return false;
      }
      this.access = b.accessToken;
      await this.put('refresh_token', b.refreshToken);
      return true;
    } catch {
      return false; // offline: keep the refresh token and keep recording locally
    }
  }

  async logout(): Promise<void> {
    if (this.access)
      await this.http
        .send({ method: 'POST', path: '/api/v1/auth/logout', token: this.access })
        .catch(() => undefined);
    this.access = null;
    await this.db.execute("DELETE FROM secure_kv WHERE key IN ('refresh_token')");
  }
}
