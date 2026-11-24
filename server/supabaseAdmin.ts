import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface AuthenticatedCoach {
  id: string;
  email: string;
  fullName: string;
  organizationName: string;
  role: 'owner_coach';
}

export type CoachVerificationResult =
  | { ok: true; coach: AuthenticatedCoach }
  | { ok: false; status: 401 | 403 | 503; error: string };

let cachedAdminClient: SupabaseClient | null = null;
let cachedConfigKey = '';

export function isSupabaseServerConfigured(): boolean {
  return Boolean(
    process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  );
}

export function getSupabaseAdminClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) {
    return null;
  }

  const nextKey = `${url}::${serviceKey.slice(0, 8)}`;
  if (!cachedAdminClient || cachedConfigKey !== nextKey) {
    cachedAdminClient = createClient(url, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    cachedConfigKey = nextKey;
  }
  return cachedAdminClient;
}

/**
 * Performs a real read-only query against Supabase Postgres to determine if
 * the configured database is actually reachable and migrated.
 */
export async function checkSupabaseDatabaseReachable(): Promise<{
  configured: boolean;
  connected: boolean;
  detail: string;
}> {
  const client = getSupabaseAdminClient();
  if (!client) {
    return {
      configured: false,
      connected: false,
      detail: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured.',
    };
  }

  try {
    const { error } = await client.from('coaches').select('id').limit(1);
    if (error) {
      return {
        configured: true,
        connected: false,
        detail: `Supabase check failed: ${error.message}`,
      };
    }
    return {
      configured: true,
      connected: true,
      detail: 'Supabase Postgres connected and coaches schema reachable.',
    };
  } catch (err) {
    return {
      configured: true,
      connected: false,
      detail: err instanceof Error ? err.message : 'Unable to reach Supabase Postgres.',
    };
  }
}

export interface PagedQueryLike<T> extends PromiseLike<{
  data: T[] | null;
  error: { message: string } | null;
}> {
  range?: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
}

/**
 * Fetches all matching rows from Supabase PostgREST across 1,000-row page
 * boundaries while staying 100% compatible with unit-test query mocks that do
 * not implement `.range()`.
 */
export async function fetchAllPagedRows<T = Record<string, unknown>>(
  buildQuery: () => PagedQueryLike<T>,
  pageSize = 1000
): Promise<{ data: T[]; error: { message: string } | null }> {
  const firstQuery = buildQuery();
  if (typeof firstQuery.range !== 'function') {
    const res = await firstQuery;
    return {
      data: Array.isArray(res.data) ? res.data : [],
      error: res.error ?? null,
    };
  }

  const allRows: T[] = [];
  let offset = 0;
  for (let page = 0; page < 200; page++) {
    const q = page === 0 ? firstQuery : buildQuery();
    const res = await q.range!(offset, offset + pageSize - 1);
    if (res.error) {
      return { data: allRows, error: res.error };
    }
    const batch = Array.isArray(res.data) ? res.data : [];
    allRows.push(...batch);
    if (batch.length < pageSize) {
      break;
    }
    offset += pageSize;
  }

  return { data: allRows, error: null };
}

export async function upsertRowsInChunks(
  client: SupabaseClient,
  table: string,
  rows: Array<Record<string, unknown>>,
  onConflict: string,
  chunkSize = 500
): Promise<{ error: { message: string } | null }> {
  if (rows.length === 0) return { error: null };
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await client.from(table).upsert(chunk, { onConflict });
    if (error) {
      return { error };
    }
  }
  return { error: null };
}

function validateCoachRowForUser(
  row: {
    id: string;
    email: string;
    full_name: string;
    organization_name: string;
    role: string;
    is_active: boolean;
  } | null,
  expectedAuthUserId: string
): CoachVerificationResult {
  if (!row || row.id !== expectedAuthUserId) {
    return {
      ok: false,
      status: 403,
      error: 'Forbidden: an owner coach account is already provisioned.',
    };
  }
  if (!row.is_active || row.role !== 'owner_coach') {
    return {
      ok: false,
      status: 403,
      error: 'Coach account is inactive or lacks owner_coach authorization.',
    };
  }
  return {
    ok: true,
    coach: {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      organizationName: row.organization_name,
      role: 'owner_coach',
    },
  };
}

/**
 * Verifies a Supabase Bearer JWT on the server, then verifies that the user maps
 * to the single active owner coach in `public.coaches`.
 *
 * Initial owner provisioning is strictly limited:
 *   1. `public.coaches` must currently contain 0 rows, AND
 *   2. `OWNER_COACH_EMAIL` must be set on the server and match the verified email, AND
 *   3. `authUser.email_confirmed_at` must be present (confirmed email).
 * Any other authenticated Supabase user is rejected with HTTP 403.
 */
export async function verifySupabaseJwtAndCoach(
  accessToken: string,
  adminClient?: SupabaseClient | null
): Promise<CoachVerificationResult> {
  const client = adminClient === undefined ? getSupabaseAdminClient() : adminClient;
  if (!client) {
    return {
      ok: false,
      status: 503,
      error: 'Supabase authentication is not configured on this server.',
    };
  }

  const { data: userData, error: userError } = await client.auth.getUser(accessToken);
  if (userError || !userData?.user) {
    return {
      ok: false,
      status: 401,
      error: 'Invalid or expired authentication session.',
    };
  }

  const authUser = userData.user;
  const authEmail = authUser.email?.trim().toLowerCase() ?? '';

  const { data: existingCoach, error: coachQueryError } = await client
    .from('coaches')
    .select('id, email, full_name, organization_name, role, is_active')
    .eq('id', authUser.id)
    .maybeSingle();

  if (coachQueryError) {
    return {
      ok: false,
      status: 503,
      error: 'Unable to verify coach profile against database.',
    };
  }

  if (existingCoach) {
    return validateCoachRowForUser(existingCoach, authUser.id);
  }

  // No coach row for this auth.users.id: check if single-owner auto-bootstrap is allowed.
  const ownerEmail = process.env.OWNER_COACH_EMAIL?.trim().toLowerCase();
  if (!ownerEmail || !authEmail || authEmail !== ownerEmail) {
    return {
      ok: false,
      status: 403,
      error:
        'Forbidden: authenticated user is not authorized as the Mythical Mile Coaching owner.',
    };
  }

  const hasConfirmedEmail =
    typeof authUser.email_confirmed_at === 'string' &&
    authUser.email_confirmed_at.trim().length > 0;
  if (!hasConfirmedEmail) {
    return {
      ok: false,
      status: 403,
      error:
        'Forbidden: owner coach email address must be confirmed before initial provisioning.',
    };
  }

  const { count: existingCount, error: countError } = await client
    .from('coaches')
    .select('id', { count: 'exact', head: true });

  if (countError) {
    return {
      ok: false,
      status: 403,
      error: 'Forbidden: an owner coach account is already provisioned.',
    };
  }

  if ((existingCount ?? 0) > 0) {
    const { data: raceCoach, error: raceQueryError } = await client
      .from('coaches')
      .select('id, email, full_name, organization_name, role, is_active')
      .eq('id', authUser.id)
      .maybeSingle();

    if (raceQueryError) {
      return {
        ok: false,
        status: 503,
        error: 'Unable to verify coach profile against database.',
      };
    }

    return validateCoachRowForUser(raceCoach, authUser.id);
  }

  const fullName =
    typeof authUser.user_metadata?.full_name === 'string' && authUser.user_metadata.full_name.trim()
      ? authUser.user_metadata.full_name.trim()
      : 'Mythical Mile Coach';

  const { data: inserted, error: insertError } = await client
    .from('coaches')
    .insert({
      id: authUser.id,
      email: authEmail,
      full_name: fullName,
      organization_name: 'Mythical Mile Coaching',
      role: 'owner_coach',
      is_active: true,
    })
    .select('id, email, full_name, organization_name, role, is_active')
    .single();

  if (insertError) {
    if (insertError.code === '23505') {
      const { data: conflictedCoach, error: requeryError } = await client
        .from('coaches')
        .select('id, email, full_name, organization_name, role, is_active')
        .eq('id', authUser.id)
        .maybeSingle();

      if (requeryError) {
        return {
          ok: false,
          status: 503,
          error: 'Unable to verify coach profile against database.',
        };
      }

      return validateCoachRowForUser(conflictedCoach, authUser.id);
    }

    return {
      ok: false,
      status: 403,
      error: 'Unable to provision initial owner coach profile.',
    };
  }

  if (!inserted) {
    return {
      ok: false,
      status: 403,
      error: 'Unable to provision initial owner coach profile.',
    };
  }

  return validateCoachRowForUser(inserted, authUser.id);
}
