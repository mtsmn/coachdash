import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptSecret, encryptSecret, generateOAuthStateNonce } from './crypto.ts';
import { getSupabaseAdminClient } from './supabaseAdmin.ts';

export type ProviderId = 'intervals_icu' | 'final_surge';
export type ProviderAuthMode = 'api_key' | 'oauth2' | 'csv_manual' | 'unconfigured';

export interface PersistedProviderConnection {
  id?: string;
  coachId: string;
  provider: ProviderId;
  authMode: ProviderAuthMode;
  connected: boolean;
  readOnlyMode: boolean;
  pilotTestSucceeded: boolean;
  verifiedPilotAthleteId: string | null;
  externalCoachId: string | null;
  externalCoachName: string | null;
  grantedScopes: string[];
  lastVerifiedAt: string | null;
  lastSynchronizedAt: string | null;
  updatedAt?: string | null;
}

export interface UpsertProviderConnectionInput {
  coachId: string;
  provider: ProviderId;
  authMode: ProviderAuthMode;
  connected: boolean;
  readOnlyMode?: boolean;
  pilotTestSucceeded: boolean;
  verifiedPilotAthleteId: string | null;
  externalCoachId?: string | null;
  externalCoachName?: string | null;
  grantedScopes?: string[];
  lastVerifiedAt?: string | null;
  lastSynchronizedAt?: string | null;
}

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
  authMode?: ProviderAuthMode;
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

  getProviderConnection(
    coachId: string,
    provider: ProviderId
  ): Promise<PersistedProviderConnection | null>;
  listProviderConnections(provider: ProviderId): Promise<PersistedProviderConnection[]>;
  upsertProviderConnection(
    input: UpsertProviderConnectionInput
  ): Promise<{ connection: PersistedProviderConnection; persistedToDatabase: boolean }>;
}

interface ProviderConnectionRow {
  id?: string;
  coach_id: string;
  provider: ProviderId;
  auth_mode: ProviderAuthMode;
  connected: boolean;
  read_only_mode: boolean;
  pilot_test_succeeded: boolean;
  verified_pilot_athlete_id: string | null;
  external_coach_id: string | null;
  external_coach_name: string | null;
  granted_scopes: string[] | null;
  last_verified_at: string | null;
  last_synchronized_at: string | null;
  updated_at?: string | null;
}

function mapConnectionRow(row: ProviderConnectionRow): PersistedProviderConnection {
  return {
    id: row.id,
    coachId: row.coach_id,
    provider: row.provider,
    authMode: row.auth_mode,
    connected: Boolean(row.connected),
    readOnlyMode: Boolean(row.read_only_mode),
    pilotTestSucceeded: Boolean(row.pilot_test_succeeded),
    verifiedPilotAthleteId: row.verified_pilot_athlete_id ?? null,
    externalCoachId: row.external_coach_id ?? null,
    externalCoachName: row.external_coach_name ?? null,
    grantedScopes: Array.isArray(row.granted_scopes) ? [...row.granted_scopes] : [],
    lastVerifiedAt: row.last_verified_at ?? null,
    lastSynchronizedAt: row.last_synchronized_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function cloneConnection(conn: PersistedProviderConnection): PersistedProviderConnection {
  return {
    ...conn,
    grantedScopes: [...conn.grantedScopes],
  };
}

/**
 * In-memory AES-256-GCM encrypted store used when Supabase is not configured or
 * during isolated unit tests. Can be shared across simulated server restarts in tests.
 */
export class InMemoryEncryptedOAuthStore implements OAuthPersistenceStore {
  private states = new Map<string, StoredOAuthStateRecord>();
  private connections = new Map<string, PersistedProviderConnection>();
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

  private readonly encryptionKeyOverride?: string;

  constructor(encryptionKeyOverride?: string) {
    this.encryptionKeyOverride = encryptionKeyOverride;
  }

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

    const existing = this.connections.get(key);
    const coachChanged = Boolean(
      existing?.externalCoachId &&
        (!creds.externalCoachId || existing.externalCoachId !== creds.externalCoachId)
    );
    const nowIso = new Date().toISOString();

    await this.upsertProviderConnection({
      coachId: creds.coachId,
      provider: creds.provider,
      authMode: creds.authMode ?? 'oauth2',
      connected: true,
      readOnlyMode: true,
      pilotTestSucceeded: coachChanged ? false : existing?.pilotTestSucceeded ?? false,
      verifiedPilotAthleteId: coachChanged ? null : existing?.verifiedPilotAthleteId ?? null,
      externalCoachId: creds.externalCoachId ?? existing?.externalCoachId ?? null,
      externalCoachName: creds.externalCoachName ?? existing?.externalCoachName ?? null,
      grantedScopes: creds.scope ? creds.scope.split(/[,\s]+/).filter(Boolean) : [],
      lastVerifiedAt: coachChanged ? nowIso : existing?.lastVerifiedAt ?? nowIso,
      lastSynchronizedAt: existing?.lastSynchronizedAt ?? null,
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
    const key = `${coachId}::${provider}`;
    this.credentials.delete(key);

    const existing = this.connections.get(key);
    await this.upsertProviderConnection({
      coachId,
      provider,
      authMode: 'unconfigured',
      connected: false,
      readOnlyMode: true,
      pilotTestSucceeded: false,
      verifiedPilotAthleteId: null,
      externalCoachId: null,
      externalCoachName: null,
      grantedScopes: [],
      lastVerifiedAt: new Date().toISOString(),
      lastSynchronizedAt: existing?.lastSynchronizedAt ?? null,
    });
  }

  async getProviderConnection(
    coachId: string,
    provider: ProviderId
  ): Promise<PersistedProviderConnection | null> {
    const found = this.connections.get(`${coachId}::${provider}`);
    return found ? cloneConnection(found) : null;
  }

  async listProviderConnections(provider: ProviderId): Promise<PersistedProviderConnection[]> {
    const out: PersistedProviderConnection[] = [];
    for (const conn of this.connections.values()) {
      if (conn.provider === provider) {
        out.push(cloneConnection(conn));
      }
    }
    return out;
  }

  async upsertProviderConnection(
    input: UpsertProviderConnectionInput
  ): Promise<{ connection: PersistedProviderConnection; persistedToDatabase: boolean }> {
    const key = `${input.coachId}::${input.provider}`;
    const existing = this.connections.get(key);
    const nowIso = new Date().toISOString();

    const record: PersistedProviderConnection = {
      id: existing?.id ?? `mem-conn-${input.provider}-${input.coachId}`,
      coachId: input.coachId,
      provider: input.provider,
      authMode: input.authMode,
      connected: input.connected,
      readOnlyMode: input.readOnlyMode ?? true,
      pilotTestSucceeded: input.pilotTestSucceeded,
      verifiedPilotAthleteId: input.verifiedPilotAthleteId,
      externalCoachId:
        input.externalCoachId !== undefined
          ? input.externalCoachId
          : existing?.externalCoachId ?? null,
      externalCoachName:
        input.externalCoachName !== undefined
          ? input.externalCoachName
          : existing?.externalCoachName ?? null,
      grantedScopes: input.grantedScopes
        ? [...input.grantedScopes]
        : existing?.grantedScopes
        ? [...existing.grantedScopes]
        : [],
      lastVerifiedAt:
        input.lastVerifiedAt !== undefined
          ? input.lastVerifiedAt
          : existing?.lastVerifiedAt ?? null,
      lastSynchronizedAt:
        input.lastSynchronizedAt !== undefined
          ? input.lastSynchronizedAt
          : existing?.lastSynchronizedAt ?? null,
      updatedAt: nowIso,
    };

    this.connections.set(key, record);
    return { connection: cloneConnection(record), persistedToDatabase: false };
  }

  /** Test helper to inspect raw encrypted envelope without decrypting. */
  getRawStoredEnvelopeForTesting(coachId: string, provider: ProviderId) {
    return this.credentials.get(`${coachId}::${provider}`) ?? null;
  }
}

const PROVIDER_CONNECTION_SELECT =
  'id, coach_id, provider, auth_mode, connected, read_only_mode, pilot_test_succeeded, verified_pilot_athlete_id, external_coach_id, external_coach_name, granted_scopes, last_verified_at, last_synchronized_at, updated_at';

/**
 * Supabase-backed persistence store using Milestone 1 tables:
 * `public.oauth_states`, `public.provider_connections`, and
 * `public.provider_connection_credentials` via server-side `service_role`.
 */
export class SupabaseOAuthStore implements OAuthPersistenceStore {
  private readonly clientProvider: () => SupabaseClient | null;

  constructor(clientProvider: () => SupabaseClient | null = getSupabaseAdminClient) {
    this.clientProvider = clientProvider;
  }

  async createOAuthState(params: {
    coachId: string;
    provider: ProviderId;
    ttlSeconds?: number;
  }): Promise<{ state: string; expiresAtIso: string; persistedToDatabase: boolean }> {
    const client = this.clientProvider();
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

    const client = this.clientProvider();
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

  async getProviderConnection(
    coachId: string,
    provider: ProviderId
  ): Promise<PersistedProviderConnection | null> {
    const client = this.clientProvider();
    if (!client) {
      throw new Error('Supabase admin client is not configured.');
    }

    const { data, error } = await client
      .from('provider_connections')
      .select(PROVIDER_CONNECTION_SELECT)
      .eq('coach_id', coachId)
      .eq('provider', provider)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load provider connection: ${error.message}`);
    }

    return data ? mapConnectionRow(data as ProviderConnectionRow) : null;
  }

  async listProviderConnections(provider: ProviderId): Promise<PersistedProviderConnection[]> {
    const client = this.clientProvider();
    if (!client) {
      throw new Error('Supabase admin client is not configured.');
    }

    const { data, error } = await client
      .from('provider_connections')
      .select(PROVIDER_CONNECTION_SELECT)
      .eq('provider', provider);

    if (error) {
      throw new Error(`Failed to list provider connections: ${error.message}`);
    }

    return Array.isArray(data)
      ? (data as ProviderConnectionRow[]).map(mapConnectionRow)
      : [];
  }

  async upsertProviderConnection(
    input: UpsertProviderConnectionInput
  ): Promise<{ connection: PersistedProviderConnection; persistedToDatabase: boolean }> {
    const client = this.clientProvider();
    if (!client) {
      throw new Error('Supabase admin client is not configured.');
    }

    const payload: Record<string, unknown> = {
      coach_id: input.coachId,
      provider: input.provider,
      auth_mode: input.authMode,
      connected: input.connected,
      read_only_mode: input.readOnlyMode ?? true,
      pilot_test_succeeded: input.pilotTestSucceeded,
      verified_pilot_athlete_id: input.verifiedPilotAthleteId,
    };

    if (input.externalCoachId !== undefined) {
      payload.external_coach_id = input.externalCoachId;
    }
    if (input.externalCoachName !== undefined) {
      payload.external_coach_name = input.externalCoachName;
    }
    if (input.grantedScopes !== undefined) {
      payload.granted_scopes = input.grantedScopes;
    }
    if (input.lastVerifiedAt !== undefined) {
      payload.last_verified_at = input.lastVerifiedAt;
    }
    if (input.lastSynchronizedAt !== undefined) {
      payload.last_synchronized_at = input.lastSynchronizedAt;
    }

    const { data, error } = await client
      .from('provider_connections')
      .upsert(payload, { onConflict: 'coach_id,provider' })
      .select(PROVIDER_CONNECTION_SELECT)
      .single();

    if (error || !data) {
      throw new Error(`Failed to persist provider connection: ${error?.message ?? 'Unknown error'}`);
    }

    return {
      connection: mapConnectionRow(data as ProviderConnectionRow),
      persistedToDatabase: true,
    };
  }

  async saveEncryptedCredentials(
    creds: StoredOAuthCredentials
  ): Promise<{ persistedToDatabase: boolean }> {
    const client = this.clientProvider();
    if (!client) {
      throw new Error('Supabase admin client is not configured.');
    }

    const encryptedAccess = encryptSecret(creds.accessToken);
    const encryptedRefresh = creds.refreshToken ? encryptSecret(creds.refreshToken) : null;
    const nowIso = new Date().toISOString();

    const existing = await this.getProviderConnection(creds.coachId, creds.provider);
    const coachChanged = Boolean(
      existing?.externalCoachId &&
        (!creds.externalCoachId || existing.externalCoachId !== creds.externalCoachId)
    );

    const { connection } = await this.upsertProviderConnection({
      coachId: creds.coachId,
      provider: creds.provider,
      authMode: creds.authMode ?? 'oauth2',
      connected: true,
      readOnlyMode: true,
      pilotTestSucceeded: coachChanged ? false : existing?.pilotTestSucceeded ?? false,
      verifiedPilotAthleteId: coachChanged ? null : existing?.verifiedPilotAthleteId ?? null,
      externalCoachId: creds.externalCoachId ?? existing?.externalCoachId ?? null,
      externalCoachName: creds.externalCoachName ?? existing?.externalCoachName ?? null,
      grantedScopes: creds.scope ? creds.scope.split(/[,\s]+/).filter(Boolean) : [],
      lastVerifiedAt: coachChanged ? nowIso : existing?.lastVerifiedAt ?? nowIso,
      lastSynchronizedAt: existing?.lastSynchronizedAt ?? null,
    });

    const { error: credErr } = await client.from('provider_connection_credentials').upsert(
      {
        connection_id: connection.id,
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
    const client = this.clientProvider();
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
    const client = this.clientProvider();
    if (!client) {
      throw new Error('Supabase admin client is not configured.');
    }

    const { error: credErr } = await client
      .from('provider_connection_credentials')
      .delete()
      .eq('coach_id', coachId)
      .eq('provider', provider);

    if (credErr) {
      throw new Error(`Failed to delete provider credentials: ${credErr.message}`);
    }

    const existing = await this.getProviderConnection(coachId, provider);
    await this.upsertProviderConnection({
      coachId,
      provider,
      authMode: 'unconfigured',
      connected: false,
      readOnlyMode: true,
      pilotTestSucceeded: false,
      verifiedPilotAthleteId: null,
      externalCoachId: null,
      externalCoachName: null,
      grantedScopes: [],
      lastVerifiedAt: new Date().toISOString(),
      lastSynchronizedAt: existing?.lastSynchronizedAt ?? null,
    });
  }
}

const fallbackMemoryStore = new InMemoryEncryptedOAuthStore();
const supabaseOAuthStore = new SupabaseOAuthStore();

export function getOAuthPersistenceStore(): OAuthPersistenceStore {
  return getSupabaseAdminClient() ? supabaseOAuthStore : fallbackMemoryStore;
}
