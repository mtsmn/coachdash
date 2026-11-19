import { decryptSecret, encryptSecret, generateOAuthStateNonce } from './crypto.ts';
import { getSupabaseAdminClient } from './supabaseAdmin.ts';

export type ProviderId = 'intervals_icu' | 'final_surge';

export interface StoredOAuthStateRecord {
  state: string;
  coachId: string;
  provider: ProviderId;
  expiresAtIso: string;
  consumedAtIso: string | null;
}

export interface StoredOAuthCredentials {
  coachId: string;
  provider: ProviderId;
  accessToken: string;
  refreshToken?: string;
  scope?: string;
  expiresAtIso?: string;
  externalCoachId?: string;
  externalCoachName?: string;
}

export interface OAuthPersistenceStore {
  createOAuthState(params: {
    coachId: string;
    provider: ProviderId;
    ttlSeconds?: number;
  }): Promise<{ state: string; expiresAtIso: string; persistedToDatabase: boolean }>;

  consumeOAuthState(params: {
    state: string;
    provider: ProviderId;
    nowMs?: number;
  }): Promise<
    | { ok: true; coachId: string }
    | { ok: false; reason: 'missing' | 'unknown' | 'expired' | 'reused' | 'provider_mismatch' }
  >;

  saveEncryptedCredentials(creds: StoredOAuthCredentials): Promise<{ persistedToDatabase: boolean }>;
  getDecryptedCredentials(coachId: string, provider: ProviderId): Promise<StoredOAuthCredentials | null>;
  clearCredentials(coachId: string, provider: ProviderId): Promise<void>;
}

/**
 * In-memory AES-256-GCM encrypted store used when Supabase is not configured or
 * during isolated unit tests. Never persists across restarts.
 */
export class InMemoryEncryptedOAuthStore implements OAuthPersistenceStore {
  private states = new Map<string, StoredOAuthStateRecord>();
  private credentials = new Map<
    string,
    {
      coachId: string;
      provider: ProviderId;
      encryptedAccessToken: string;
      encryptedRefreshToken: string | null;
      scope?: string;
      expiresAtIso?: string;
      externalCoachId?: string;
      externalCoachName?: string;
    }
  >();

  constructor(private readonly encryptionKeyOverride?: string) {}

  async createOAuthState(params: {
    coachId: string;
    provider: ProviderId;
    ttlSeconds?: number;
  }): Promise<{ state: string; expiresAtIso: string; persistedToDatabase: boolean }> {
    const state = generateOAuthStateNonce();
    const ttlMs = (params.ttlSeconds ?? 600) * 1000;
    const expiresAtIso = new Date(Date.now() + ttlMs).toISOString();

    this.states.set(state, {
      state,
      coachId: params.coachId,
      provider: params.provider,
      expiresAtIso,
      consumedAtIso: null,
    });

    return { state, expiresAtIso, persistedToDatabase: false };
  }

  async consumeOAuthState(params: {
    state: string;
    provider: ProviderId;
    nowMs?: number;
  }): Promise<
    | { ok: true; coachId: string }
    | { ok: false; reason: 'missing' | 'unknown' | 'expired' | 'reused' | 'provider_mismatch' }
  > {
    const cleanState = params.state?.trim();
    if (!cleanState) {
      return { ok: false, reason: 'missing' };
    }

    const record = this.states.get(cleanState);
    if (!record) {
      return { ok: false, reason: 'unknown' };
    }
    if (record.provider !== params.provider) {
      return { ok: false, reason: 'provider_mismatch' };
    }
    if (record.consumedAtIso !== null) {
      return { ok: false, reason: 'reused' };
    }

    const nowMs = params.nowMs ?? Date.now();
    if (Date.parse(record.expiresAtIso) <= nowMs) {
      return { ok: false, reason: 'expired' };
    }

    record.consumedAtIso = new Date(nowMs).toISOString();
    return { ok: true, coachId: record.coachId };
  }

  async saveEncryptedCredentials(
    creds: StoredOAuthCredentials
  ): Promise<{ persistedToDatabase: boolean }> {
    const key = `${creds.coachId}::${creds.provider}`;
    this.credentials.set(key, {
      coachId: creds.coachId,
      provider: creds.provider,
      encryptedAccessToken: encryptSecret(creds.accessToken, this.encryptionKeyOverride),
      encryptedRefreshToken: creds.refreshToken
        ? encryptSecret(creds.refreshToken, this.encryptionKeyOverride)
        : null,
      scope: creds.scope,
      expiresAtIso: creds.expiresAtIso,
      externalCoachId: creds.externalCoachId,
      externalCoachName: creds.externalCoachName,
    });
    return { persistedToDatabase: false };
  }

  async getDecryptedCredentials(
    coachId: string,
    provider: ProviderId
  ): Promise<StoredOAuthCredentials | null> {
    const stored = this.credentials.get(`${coachId}::${provider}`);
    if (!stored) return null;

    return {
      coachId: stored.coachId,
      provider: stored.provider,
      accessToken: decryptSecret(stored.encryptedAccessToken, this.encryptionKeyOverride),
      refreshToken: stored.encryptedRefreshToken
        ? decryptSecret(stored.encryptedRefreshToken, this.encryptionKeyOverride)
        : undefined,
      scope: stored.scope,
      expiresAtIso: stored.expiresAtIso,
      externalCoachId: stored.externalCoachId,
      externalCoachName: stored.externalCoachName,
    };
  }

  async clearCredentials(coachId: string, provider: ProviderId): Promise<void> {
    this.credentials.delete(`${coachId}::${provider}`);
  }

  /** Test helper to inspect raw encrypted envelope without decrypting. */
  getRawStoredEnvelopeForTesting(coachId: string, provider: ProviderId) {
    return this.credentials.get(`${coachId}::${provider}`) ?? null;
  }
}

/**
 * Supabase-backed OAuth persistence store using Milestone 1 tables:
 * `public.oauth_states`, `public.provider_connections`, and
 * `public.provider_connection_credentials`.
 */
export class SupabaseOAuthStore implements OAuthPersistenceStore {
  async createOAuthState(params: {
    coachId: string;
    provider: ProviderId;
    ttlSeconds?: number;
  }): Promise<{ state: string; expiresAtIso: string; persistedToDatabase: boolean }> {
    const client = getSupabaseAdminClient();
    if (!client) {
      throw new Error('Supabase admin client is not configured.');
    }

    const state = generateOAuthStateNonce();
    const expiresAtIso = new Date(Date.now() + (params.ttlSeconds ?? 600) * 1000).toISOString();

    const { error } = await client.from('oauth_states').insert({
      state,
      coach_id: params.coachId,
      provider: params.provider,
      expires_at: expiresAtIso,
    });

    if (error) {
      throw new Error(`Failed to persist OAuth state: ${error.message}`);
    }

    return { state, expiresAtIso, persistedToDatabase: true };
  }

  async consumeOAuthState(params: {
    state: string;
    provider: ProviderId;
    nowMs?: number;
  }): Promise<
    | { ok: true; coachId: string }
    | { ok: false; reason: 'missing' | 'unknown' | 'expired' | 'reused' | 'provider_mismatch' }
  > {
    const cleanState = params.state?.trim();
    if (!cleanState) {
      return { ok: false, reason: 'missing' };
    }

    const client = getSupabaseAdminClient();
    if (!client) {
      return { ok: false, reason: 'unknown' };
    }

    const nowIso = new Date(params.nowMs ?? Date.now()).toISOString();

    // Atomic single-use claim: only matches unconsumed, unexpired state for this provider.
    const { data: claimed, error: updateError } = await client
      .from('oauth_states')
      .update({ consumed_at: nowIso })
      .eq('state', cleanState)
      .eq('provider', params.provider)
      .is('consumed_at', null)
      .gt('expires_at', nowIso)
      .select('coach_id')
      .maybeSingle();

    if (!updateError && claimed?.coach_id) {
      return { ok: true, coachId: claimed.coach_id };
    }

    const { data: existing } = await client
      .from('oauth_states')
      .select('provider, expires_at, consumed_at')
      .eq('state', cleanState)
      .maybeSingle();

    if (!existing) return { ok: false, reason: 'unknown' };
    if (existing.provider !== params.provider) return { ok: false, reason: 'provider_mismatch' };
    if (existing.consumed_at !== null) return { ok: false, reason: 'reused' };
    return { ok: false, reason: 'expired' };
  }

  async saveEncryptedCredentials(
    creds: StoredOAuthCredentials
  ): Promise<{ persistedToDatabase: boolean }> {
    const client = getSupabaseAdminClient();
    if (!client) {
      throw new Error('Supabase admin client is not configured.');
    }

    const encryptedAccess = encryptSecret(creds.accessToken);
    const encryptedRefresh = creds.refreshToken ? encryptSecret(creds.refreshToken) : null;
    const nowIso = new Date().toISOString();

    const { data: conn, error: connErr } = await client
      .from('provider_connections')
      .upsert(
        {
          coach_id: creds.coachId,
          provider: creds.provider,
          auth_mode: 'oauth2',
          connected: true,
          read_only_mode: true,
          external_coach_id: creds.externalCoachId ?? null,
          external_coach_name: creds.externalCoachName ?? null,
          granted_scopes: creds.scope ? creds.scope.split(/[,\s]+/).filter(Boolean) : [],
          last_verified_at: nowIso,
        },
        { onConflict: 'coach_id,provider' }
      )
      .select('id')
      .single();

    if (connErr || !conn) {
      throw new Error(`Failed to upsert provider connection: ${connErr?.message ?? 'Unknown error'}`);
    }

    const { error: credErr } = await client.from('provider_connection_credentials').upsert(
      {
        connection_id: conn.id,
        coach_id: creds.coachId,
        provider: creds.provider,
        encrypted_access_token: encryptedAccess,
        encrypted_refresh_token: encryptedRefresh,
        token_scope: creds.scope ?? null,
        token_expires_at: creds.expiresAtIso ?? null,
        key_version: 1,
      },
      { onConflict: 'connection_id' }
    );

    if (credErr) {
      throw new Error(`Failed to persist encrypted credentials: ${credErr.message}`);
    }

    return { persistedToDatabase: true };
  }

  async getDecryptedCredentials(
    coachId: string,
    provider: ProviderId
  ): Promise<StoredOAuthCredentials | null> {
    const client = getSupabaseAdminClient();
    if (!client) return null;

    const { data: row } = await client
      .from('provider_connection_credentials')
      .select('encrypted_access_token, encrypted_refresh_token, token_scope, token_expires_at')
      .eq('coach_id', coachId)
      .eq('provider', provider)
      .maybeSingle();

    if (!row?.encrypted_access_token) return null;

    return {
      coachId,
      provider,
      accessToken: decryptSecret(row.encrypted_access_token),
      refreshToken: row.encrypted_refresh_token
        ? decryptSecret(row.encrypted_refresh_token)
        : undefined,
      scope: row.token_scope ?? undefined,
      expiresAtIso: row.token_expires_at ?? undefined,
    };
  }

  async clearCredentials(coachId: string, provider: ProviderId): Promise<void> {
    const client = getSupabaseAdminClient();
    if (!client) return;

    await client
      .from('provider_connection_credentials')
      .delete()
      .eq('coach_id', coachId)
      .eq('provider', provider);

    await client
      .from('provider_connections')
      .update({
        connected: false,
        auth_mode: 'unconfigured',
        pilot_test_succeeded: false,
        verified_pilot_athlete_id: null,
      })
      .eq('coach_id', coachId)
      .eq('provider', provider);
  }
}

const fallbackMemoryStore = new InMemoryEncryptedOAuthStore();
const supabaseOAuthStore = new SupabaseOAuthStore();

export function getOAuthPersistenceStore(): OAuthPersistenceStore {
  return getSupabaseAdminClient() ? supabaseOAuthStore : fallbackMemoryStore;
}
