-- =============================================================================
-- Running Coach AI — Mythical Mile Coaching
-- Phase 1 / Milestone 1: Initial PostgreSQL & Supabase Schema + RLS Policies
--
-- Architecture:
--   * Single-coach ownership model (one owner coach for Mythical Mile Coaching;
--     no assistant coaches, team memberships, or shared-roster permissions).
--   * All production records are scoped to `coach_id` and protected by RLS.
--   * Composite foreign keys `(athlete_id, coach_id)` and
--     `(activity_id, athlete_id, coach_id)` guarantee cross-coach / cross-athlete
--     ownership checks cannot be bypassed at the database level.
--   * Sensitive provider credentials and OAuth CSRF state nonces live in
--     server-only tables with all `anon` and `authenticated` privileges revoked.
--   * Audit events are append-only and intentionally omit cascading FKs to
--     `athletes` so deletion records survive cascading athlete removal.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- Shared Trigger Functions
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'public.audit_events is append-only; % is not permitted.', TG_OP;
END;
$$;

-- -----------------------------------------------------------------------------
-- 1. Coaches (Single Owner-Coach Model)
-- -----------------------------------------------------------------------------

CREATE TABLE public.coaches (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  email text NOT NULL UNIQUE,
  full_name text NOT NULL,
  organization_name text NOT NULL DEFAULT 'Mythical Mile Coaching',
  role text NOT NULL DEFAULT 'owner_coach' CHECK (role = 'owner_coach'),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_coaches_updated_at
  BEFORE UPDATE ON public.coaches
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. Provider Connections (Non-Secret Metadata) & Server-Only Credentials
-- -----------------------------------------------------------------------------

CREATE TABLE public.provider_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL REFERENCES public.coaches(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('intervals_icu', 'final_surge')),
  auth_mode text NOT NULL DEFAULT 'unconfigured'
    CHECK (auth_mode IN ('api_key', 'oauth2', 'csv_manual', 'unconfigured')),
  connected boolean NOT NULL DEFAULT false,
  read_only_mode boolean NOT NULL DEFAULT true,
  pilot_test_succeeded boolean NOT NULL DEFAULT false,
  verified_pilot_athlete_id text,
  external_coach_id text,
  external_coach_name text,
  granted_scopes text[] NOT NULL DEFAULT '{}'::text[],
  last_verified_at timestamptz,
  last_synchronized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_connections_coach_provider_uniq UNIQUE (coach_id, provider),
  CONSTRAINT provider_connections_id_coach_uniq UNIQUE (id, coach_id)
);

CREATE INDEX idx_provider_connections_coach
  ON public.provider_connections (coach_id);

CREATE TRIGGER trg_provider_connections_updated_at
  BEFORE UPDATE ON public.provider_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Sensitive tokens/keys are isolated in a separate table with ZERO client access.
CREATE TABLE public.provider_connection_credentials (
  connection_id uuid PRIMARY KEY,
  coach_id uuid NOT NULL REFERENCES public.coaches(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('intervals_icu', 'final_surge')),
  encrypted_access_token text,
  encrypted_refresh_token text,
  encrypted_api_key text,
  token_scope text,
  token_expires_at timestamptz,
  key_version int NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_creds_connection_fk
    FOREIGN KEY (connection_id, coach_id)
    REFERENCES public.provider_connections(id, coach_id)
    ON DELETE CASCADE
);

CREATE TRIGGER trg_provider_connection_credentials_updated_at
  BEFORE UPDATE ON public.provider_connection_credentials
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Ephemeral server-only OAuth state & PKCE verifier storage for CSRF protection.
CREATE TABLE public.oauth_states (
  state text PRIMARY KEY,
  coach_id uuid NOT NULL REFERENCES public.coaches(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('intervals_icu', 'final_surge')),
  code_verifier_hash text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_oauth_states_expires
  ON public.oauth_states (expires_at);

-- -----------------------------------------------------------------------------
-- 3. Athletes & Provider Athlete Mappings
-- -----------------------------------------------------------------------------

CREATE TABLE public.athletes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL REFERENCES public.coaches(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  email text,
  age int CHECK (age IS NULL OR (age BETWEEN 12 AND 110)),
  gender text CHECK (gender IS NULL OR gender IN ('F', 'M', 'NB')),
  location text,
  training_group text NOT NULL DEFAULT 'Marathon'
    CHECK (training_group IN ('Marathon', 'Half Marathon', '10K / 5K Track', 'Ultra / Trail', 'Base / Return')),
  current_phase text NOT NULL DEFAULT 'Build'
    CHECK (current_phase IN ('Base', 'Build', 'Peak', 'Taper', 'Recovery')),
  experience_years int CHECK (experience_years IS NULL OR experience_years >= 0),
  resting_hr_bpm int CHECK (resting_hr_bpm IS NULL OR (resting_hr_bpm BETWEEN 28 AND 120)),
  max_hr_bpm int CHECK (max_hr_bpm IS NULL OR (max_hr_bpm BETWEEN 110 AND 235)),
  active_lthr_bpm int CHECK (active_lthr_bpm IS NULL OR (active_lthr_bpm BETWEEN 90 AND 220)),
  active_threshold_version int NOT NULL DEFAULT 1 CHECK (active_threshold_version >= 1),
  threshold_pace_sec_per_mile int CHECK (threshold_pace_sec_per_mile IS NULL OR threshold_pace_sec_per_mile > 0),
  optional_threshold_power_watts int CHECK (optional_threshold_power_watts IS NULL OR optional_threshold_power_watts > 0),
  sport_specialization text,
  goal_race_name text,
  goal_race_date date,
  goal_distance_label text CHECK (goal_distance_label IS NULL OR goal_distance_label IN ('5K', '10K', 'Half Marathon', 'Marathon', '50K')),
  goal_distance_miles numeric(5,2) CHECK (goal_distance_miles IS NULL OR goal_distance_miles > 0),
  goal_target_time_sec int CHECK (goal_target_time_sec IS NULL OR goal_target_time_sec > 0),
  goal_priority text DEFAULT 'A' CHECK (goal_priority IS NULL OR goal_priority IN ('A', 'B')),
  coach_notes text NOT NULL DEFAULT '',
  data_origin text NOT NULL DEFAULT 'live'
    CHECK (data_origin IN ('live', 'csv_import', 'manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT athletes_id_coach_uniq UNIQUE (id, coach_id)
);

CREATE UNIQUE INDEX idx_athletes_coach_email_uniq
  ON public.athletes (coach_id, lower(email))
  WHERE email IS NOT NULL;

CREATE INDEX idx_athletes_coach_group
  ON public.athletes (coach_id, training_group);

CREATE TRIGGER trg_athletes_updated_at
  BEFORE UPDATE ON public.athletes
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.provider_athlete_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL REFERENCES public.coaches(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('intervals_icu', 'final_surge')),
  external_athlete_id text,
  authorization_status text NOT NULL DEFAULT 'Unlinked'
    CHECK (authorization_status IN (
      'Authorized (Read-Only)',
      'Pending Athlete Opt-In',
      'Coach View Only (No API Scope)',
      'Permission Denied',
      'Unlinked'
    )),
  match_status text NOT NULL DEFAULT 'Unmapped'
    CHECK (match_status IN ('Verified Match', 'Candidate Review Required', 'Unmapped')),
  match_method text NOT NULL DEFAULT 'Unmatched'
    CHECK (match_method IN (
      'Exact Email Match',
      'External ID Match',
      'Coach Manual Match',
      'Name-Only Blocked (Manual Review Required)',
      'Unmatched'
    )),
  match_confidence_pct int NOT NULL DEFAULT 0 CHECK (match_confidence_pct BETWEEN 0 AND 100),
  candidate_profile_snapshot jsonb,
  reviewed_at timestamptz,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mappings_athlete_owner_fk
    FOREIGN KEY (athlete_id, coach_id)
    REFERENCES public.athletes(id, coach_id)
    ON DELETE CASCADE,
  CONSTRAINT mappings_athlete_provider_uniq UNIQUE (athlete_id, provider)
);

CREATE UNIQUE INDEX idx_mappings_coach_provider_ext_uniq
  ON public.provider_athlete_mappings (coach_id, provider, external_athlete_id)
  WHERE external_athlete_id IS NOT NULL;

CREATE INDEX idx_mappings_coach_status
  ON public.provider_athlete_mappings (coach_id, match_status, authorization_status);

CREATE TRIGGER trg_provider_athlete_mappings_updated_at
  BEFORE UPDATE ON public.provider_athlete_mappings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. Raw Provider Payloads (Immutable Traceability & Provenance)
-- -----------------------------------------------------------------------------

CREATE TABLE public.raw_provider_payloads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL REFERENCES public.coaches(id) ON DELETE CASCADE,
  athlete_id uuid,
  provider text NOT NULL CHECK (provider IN ('intervals_icu', 'final_surge_csv', 'final_surge_api')),
  entity_type text NOT NULL CHECK (
    entity_type IN ('athlete_profile', 'activity', 'streams', 'wellness', 'planned_workout', 'csv_batch')
  ),
  external_id text NOT NULL,
  source_device text,
  payload jsonb NOT NULL,
  payload_sha256 text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT raw_payloads_id_coach_uniq UNIQUE (id, coach_id),
  CONSTRAINT raw_payloads_athlete_owner_fk
    FOREIGN KEY (athlete_id, coach_id)
    REFERENCES public.athletes(id, coach_id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_raw_payloads_dedupe_uniq
  ON public.raw_provider_payloads (coach_id, provider, entity_type, external_id, payload_sha256);

CREATE INDEX idx_raw_payloads_athlete_fetched
  ON public.raw_provider_payloads (athlete_id, fetched_at DESC)
  WHERE athlete_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 5. Planned Workouts (Final Surge / Coach Entry)
-- -----------------------------------------------------------------------------

CREATE TABLE public.planned_workouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL REFERENCES public.coaches(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL,
  source_provider text NOT NULL CHECK (source_provider IN ('final_surge_api', 'final_surge_csv', 'coach_entry')),
  external_workout_id text,
  workout_date date NOT NULL,
  planned_start_time time,
  title text NOT NULL,
  workout_type text NOT NULL
    CHECK (workout_type IN ('Easy', 'Long Run', 'Tempo', 'Intervals', 'Recovery', 'Race', 'Rest')),
  planned_miles numeric(6,2) NOT NULL DEFAULT 0 CHECK (planned_miles >= 0),
  planned_duration_min numeric(7,2) NOT NULL DEFAULT 0 CHECK (planned_duration_min >= 0),
  target_pace_sec_per_mile int CHECK (target_pace_sec_per_mile IS NULL OR target_pace_sec_per_mile > 0),
  target_zone text CHECK (target_zone IS NULL OR target_zone IN ('Z1', 'Z2', 'Z3', 'Z4', 'Z5')),
  raw_payload_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT planned_workouts_id_athlete_coach_uniq UNIQUE (id, athlete_id, coach_id),
  CONSTRAINT planned_workouts_athlete_owner_fk
    FOREIGN KEY (athlete_id, coach_id)
    REFERENCES public.athletes(id, coach_id)
    ON DELETE CASCADE,
  CONSTRAINT planned_workouts_raw_payload_fk
    FOREIGN KEY (raw_payload_id, coach_id)
    REFERENCES public.raw_provider_payloads(id, coach_id)
    ON DELETE SET NULL (raw_payload_id)
);

CREATE UNIQUE INDEX idx_planned_workouts_ext_uniq
  ON public.planned_workouts (athlete_id, source_provider, external_workout_id)
  WHERE external_workout_id IS NOT NULL;

CREATE INDEX idx_planned_workouts_athlete_date
  ON public.planned_workouts (athlete_id, workout_date DESC);

CREATE TRIGGER trg_planned_workouts_updated_at
  BEFORE UPDATE ON public.planned_workouts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 6. Completed Activities & Real Heart-Rate Streams
-- -----------------------------------------------------------------------------

CREATE TABLE public.completed_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL REFERENCES public.coaches(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('intervals_icu', 'final_surge_csv', 'coach_entry')),
  external_activity_id text NOT NULL,
  source_device text,
  activity_date date NOT NULL,
  start_time_local time,
  title text NOT NULL,
  activity_type text NOT NULL
    CHECK (activity_type IN ('Easy', 'Long Run', 'Tempo', 'Intervals', 'Recovery', 'Race', 'Rest')),
  status text NOT NULL DEFAULT 'Completed'
    CHECK (status IN ('Completed', 'Modified', 'Rest')),
  duration_minutes numeric(7,2) NOT NULL CHECK (duration_minutes >= 0),
  distance_miles numeric(7,3) NOT NULL CHECK (distance_miles >= 0),
  avg_pace_sec_per_mile int CHECK (avg_pace_sec_per_mile IS NULL OR avg_pace_sec_per_mile > 0),
  avg_hr_bpm int CHECK (avg_hr_bpm IS NULL OR (avg_hr_bpm BETWEEN 25 AND 250)),
  max_hr_bpm int CHECK (max_hr_bpm IS NULL OR (max_hr_bpm BETWEEN 25 AND 255)),
  avg_power_watts int CHECK (avg_power_watts IS NULL OR avg_power_watts >= 0),
  elevation_gain_ft int CHECK (elevation_gain_ft IS NULL OR elevation_gain_ft >= 0),
  rpe int CHECK (rpe IS NULL OR (rpe BETWEEN 1 AND 10)),
  -- Distinguishes genuine rest/zero sessions from missing or invalid HR telemetry.
  hr_data_state text NOT NULL CHECK (hr_data_state IN ('valid', 'missing', 'invalid', 'rest_zero')),
  hr_validation_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_payload_id uuid,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT completed_activities_id_athlete_coach_uniq UNIQUE (id, athlete_id, coach_id),
  CONSTRAINT completed_activities_ext_uniq UNIQUE (athlete_id, provider, external_activity_id),
  CONSTRAINT completed_activities_athlete_owner_fk
    FOREIGN KEY (athlete_id, coach_id)
    REFERENCES public.athletes(id, coach_id)
    ON DELETE CASCADE,
  CONSTRAINT completed_activities_raw_payload_fk
    FOREIGN KEY (raw_payload_id, coach_id)
    REFERENCES public.raw_provider_payloads(id, coach_id)
    ON DELETE SET NULL (raw_payload_id),
  CONSTRAINT completed_activities_hr_state_consistency_chk CHECK (
    (hr_data_state = 'valid' AND avg_hr_bpm IS NOT NULL AND avg_hr_bpm > 0)
    OR (hr_data_state = 'missing' AND avg_hr_bpm IS NULL)
    OR (hr_data_state = 'rest_zero' AND duration_minutes = 0 AND distance_miles = 0 AND avg_hr_bpm IS NULL)
    OR (hr_data_state = 'invalid')
  )
);

CREATE INDEX idx_completed_activities_athlete_date
  ON public.completed_activities (athlete_id, activity_date DESC);

CREATE INDEX idx_completed_activities_coach_date
  ON public.completed_activities (coach_id, activity_date DESC);

CREATE TRIGGER trg_completed_activities_updated_at
  BEFORE UPDATE ON public.completed_activities
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Stores only verified real streams (never fabricated averages).
CREATE TABLE public.heart_rate_streams (
  activity_id uuid PRIMARY KEY,
  coach_id uuid NOT NULL REFERENCES public.coaches(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL,
  sample_interval_sec int NOT NULL CHECK (sample_interval_sec > 0),
  hr_bpm_stream int[] NOT NULL,
  sample_count int NOT NULL CHECK (sample_count > 0),
  valid_sample_pct numeric(5,2) CHECK (valid_sample_pct IS NULL OR (valid_sample_pct BETWEEN 0 AND 100)),
  dropout_count int NOT NULL DEFAULT 0 CHECK (dropout_count >= 0),
  spike_count int NOT NULL DEFAULT 0 CHECK (spike_count >= 0),
  raw_payload_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_streams_activity_owner_fk
    FOREIGN KEY (activity_id, athlete_id, coach_id)
    REFERENCES public.completed_activities(id, athlete_id, coach_id)
    ON DELETE CASCADE,
  CONSTRAINT hr_streams_raw_payload_fk
    FOREIGN KEY (raw_payload_id, coach_id)
    REFERENCES public.raw_provider_payloads(id, coach_id)
    ON DELETE SET NULL (raw_payload_id),
  CONSTRAINT hr_streams_count_matches_array_chk CHECK (
    cardinality(hr_bpm_stream) = sample_count
  )
);

CREATE INDEX idx_hr_streams_athlete
  ON public.heart_rate_streams (athlete_id);

-- -----------------------------------------------------------------------------
-- 7. Historical Athlete Thresholds, HR Zones & Recalculation Snapshots
-- -----------------------------------------------------------------------------

CREATE TABLE public.athlete_thresholds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL REFERENCES public.coaches(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL,
  version int NOT NULL CHECK (version >= 1),
  lthr_bpm int NOT NULL CHECK (lthr_bpm BETWEEN 90 AND 220),
  recorded_date date NOT NULL,
  effective_date date NOT NULL,
  source text NOT NULL
    CHECK (source IN ('Garmin Auto-Detected', 'Intervals.icu Detected', 'Coach-Approved Manual Fallback')),
  device_label text,
  approval_status text NOT NULL DEFAULT 'Pending Coach Approval'
    CHECK (approval_status IN ('Pending Coach Approval', 'Approved', 'Rejected')),
  coach_verified boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  is_active boolean NOT NULL DEFAULT false,
  optional_threshold_pace_sec_per_mile int
    CHECK (optional_threshold_pace_sec_per_mile IS NULL OR optional_threshold_pace_sec_per_mile > 0),
  optional_threshold_power_watts int
    CHECK (optional_threshold_power_watts IS NULL OR optional_threshold_power_watts > 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT thresholds_id_athlete_coach_uniq UNIQUE (id, athlete_id, coach_id),
  CONSTRAINT thresholds_athlete_version_uniq UNIQUE (athlete_id, version),
  CONSTRAINT thresholds_athlete_owner_fk
    FOREIGN KEY (athlete_id, coach_id)
    REFERENCES public.athletes(id, coach_id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_thresholds_one_active_per_athlete_uniq
  ON public.athlete_thresholds (athlete_id)
  WHERE is_active = true;

CREATE INDEX idx_thresholds_athlete_effective_date
  ON public.athlete_thresholds (athlete_id, effective_date DESC, version DESC);

CREATE TABLE public.heart_rate_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL REFERENCES public.coaches(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL,
  threshold_id uuid NOT NULL,
  threshold_version int NOT NULL CHECK (threshold_version >= 1),
  methodology text NOT NULL
    CHECK (methodology IN ('friel_running', 'coggan_endurance', 'polarized_seiler', 'custom')),
  boundaries jsonb NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_zones_athlete_threshold_uniq UNIQUE (athlete_id, threshold_id),
  CONSTRAINT hr_zones_athlete_owner_fk
    FOREIGN KEY (athlete_id, coach_id)
    REFERENCES public.athletes(id, coach_id)
    ON DELETE CASCADE,
  CONSTRAINT hr_zones_threshold_owner_fk
    FOREIGN KEY (threshold_id, athlete_id, coach_id)
    REFERENCES public.athlete_thresholds(id, athlete_id, coach_id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_hr_zones_one_active_per_athlete_uniq
  ON public.heart_rate_zones (athlete_id)
  WHERE is_active = true;

CREATE TRIGGER trg_heart_rate_zones_updated_at
  BEFORE UPDATE ON public.heart_rate_zones
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.threshold_recalculation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL REFERENCES public.coaches(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL,
  previous_threshold_version int NOT NULL,
  new_threshold_version int NOT NULL,
  previous_lthr_bpm int NOT NULL,
  new_lthr_bpm int NOT NULL,
  scope text NOT NULL CHECK (scope IN ('all_history', 'from_effective_date')),
  effective_from_date date NOT NULL,
  affected_workouts int NOT NULL DEFAULT 0 CHECK (affected_workouts >= 0),
  previous_last_full_week_stress numeric(8,2),
  new_last_full_week_stress numeric(8,2),
  note text NOT NULL DEFAULT '',
  recalculated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT threshold_recalc_athlete_owner_fk
    FOREIGN KEY (athlete_id, coach_id)
    REFERENCES public.athletes(id, coach_id)
    ON DELETE CASCADE
);

CREATE INDEX idx_threshold_recalc_athlete_time
  ON public.threshold_recalculation_logs (athlete_id, recalculated_at DESC);

-- -----------------------------------------------------------------------------
-- 8. Training Load Isolation (System A, System B, System C) & Wellness
-- -----------------------------------------------------------------------------

-- System A: Multiple dated native provider training metrics preserved verbatim per activity.
CREATE TABLE public.provider_training_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL REFERENCES public.coaches(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL,
  activity_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('intervals_icu', 'garmin_via_intervals', 'final_surge')),
  metric_date date NOT NULL,
  icu_training_load numeric(7,2),
  icu_fitness numeric(7,2),
  icu_fatigue numeric(7,2),
  icu_form numeric(7,2),
  garmin_training_load numeric(7,2),
  aerobic_training_effect numeric(4,2),
  anaerobic_training_effect numeric(4,2),
  vo2_max_estimate numeric(5,2),
  recovery_time_hours int,
  raw_payload_id uuid,
  original_values_preserved boolean NOT NULL DEFAULT true
    CHECK (original_values_preserved = true),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_metrics_activity_provider_date_uniq
    UNIQUE (activity_id, provider, metric_date),
  CONSTRAINT provider_metrics_activity_owner_fk
    FOREIGN KEY (activity_id, athlete_id, coach_id)
    REFERENCES public.completed_activities(id, athlete_id, coach_id)
    ON DELETE CASCADE,
  CONSTRAINT provider_metrics_raw_payload_fk
    FOREIGN KEY (raw_payload_id, coach_id)
    REFERENCES public.raw_provider_payloads(id, coach_id)
    ON DELETE SET NULL (raw_payload_id)
);

CREATE INDEX idx_provider_metrics_athlete_date
  ON public.provider_training_metrics (athlete_id, metric_date DESC);

-- System B: Multiple independent stress methodologies per activity, anchored to threshold version.
CREATE TABLE public.independent_stress_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL REFERENCES public.coaches(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL,
  activity_id uuid NOT NULL,
  metric_date date NOT NULL,
  methodology text NOT NULL
    CHECK (methodology IN ('hr_derived_stress', 'running_tss_pace', 'running_power_stress', 'session_rpe_stress')),
  stress_value numeric(7,2) CHECK (stress_value IS NULL OR stress_value >= 0),
  intensity_factor numeric(6,4) CHECK (intensity_factor IS NULL OR intensity_factor >= 0),
  is_zero_rest boolean NOT NULL DEFAULT false,
  threshold_id uuid,
  threshold_version_used int NOT NULL CHECK (threshold_version_used >= 1),
  lthr_bpm_used int CHECK (lthr_bpm_used IS NULL OR (lthr_bpm_used BETWEEN 90 AND 220)),
  threshold_pace_sec_used int CHECK (threshold_pace_sec_used IS NULL OR threshold_pace_sec_used > 0),
  threshold_power_watts_used int CHECK (threshold_power_watts_used IS NULL OR threshold_power_watts_used > 0),
  methodology_label text NOT NULL,
  is_tss_equivalent boolean NOT NULL DEFAULT false CHECK (is_tss_equivalent = false),
  calculated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT independent_stress_activity_method_ver_uniq
    UNIQUE (activity_id, methodology, threshold_version_used),
  CONSTRAINT independent_stress_activity_owner_fk
    FOREIGN KEY (activity_id, athlete_id, coach_id)
    REFERENCES public.completed_activities(id, athlete_id, coach_id)
    ON DELETE CASCADE,
  CONSTRAINT independent_stress_threshold_owner_fk
    FOREIGN KEY (threshold_id, athlete_id, coach_id)
    REFERENCES public.athlete_thresholds(id, athlete_id, coach_id)
    ON DELETE CASCADE,
  CONSTRAINT independent_stress_zero_rest_chk CHECK (
    (is_zero_rest = true AND stress_value = 0)
    OR (is_zero_rest = false)
  )
);

CREATE INDEX idx_independent_stress_athlete_method_date
  ON public.independent_stress_metrics (athlete_id, methodology, metric_date DESC);

-- System C: Isolated daily EWMA load histories per methodology (42d CTL / 7d ATL / TSB).
CREATE TABLE public.daily_load_histories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL REFERENCES public.coaches(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL,
  methodology text NOT NULL
    CHECK (methodology IN ('hr_derived_stress', 'running_tss_pace', 'running_power_stress', 'session_rpe_stress')),
  load_date date NOT NULL,
  daily_stress numeric(7,2) NOT NULL DEFAULT 0 CHECK (daily_stress >= 0),
  ctl numeric(7,2) NOT NULL,
  atl numeric(7,2) NOT NULL,
  tsb numeric(7,2) NOT NULL,
  ctl_time_constant_days int NOT NULL DEFAULT 42 CHECK (ctl_time_constant_days > 0),
  atl_time_constant_days int NOT NULL DEFAULT 7 CHECK (atl_time_constant_days > 0),
  threshold_version_used int CHECK (threshold_version_used IS NULL OR threshold_version_used >= 1),
  has_missing_or_invalid_hr boolean NOT NULL DEFAULT false,
  computed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_load_athlete_method_date_uniq UNIQUE (athlete_id, methodology, load_date),
  CONSTRAINT daily_load_athlete_owner_fk
    FOREIGN KEY (athlete_id, coach_id)
    REFERENCES public.athletes(id, coach_id)
    ON DELETE CASCADE
);

CREATE INDEX idx_daily_load_athlete_method_date
  ON public.daily_load_histories (athlete_id, methodology, load_date DESC);

CREATE TABLE public.wellness_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL REFERENCES public.coaches(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL,
  record_date date NOT NULL,
  source text NOT NULL CHECK (source IN ('intervals_icu_wellness', 'coach_manual')),
  hrv_rmssd numeric(6,2) CHECK (hrv_rmssd IS NULL OR hrv_rmssd > 0),
  hrv_status text,
  resting_hr_bpm int CHECK (resting_hr_bpm IS NULL OR (resting_hr_bpm BETWEEN 28 AND 130)),
  sleep_hours numeric(4,2) CHECK (sleep_hours IS NULL OR (sleep_hours BETWEEN 0 AND 24)),
  icu_ctl numeric(7,2),
  icu_atl numeric(7,2),
  raw_payload_id uuid,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wellness_athlete_source_date_uniq UNIQUE (athlete_id, source, record_date),
  CONSTRAINT wellness_athlete_owner_fk
    FOREIGN KEY (athlete_id, coach_id)
    REFERENCES public.athletes(id, coach_id)
    ON DELETE CASCADE,
  CONSTRAINT wellness_raw_payload_fk
    FOREIGN KEY (raw_payload_id, coach_id)
    REFERENCES public.raw_provider_payloads(id, coach_id)
    ON DELETE SET NULL (raw_payload_id)
);

CREATE INDEX idx_wellness_athlete_date
  ON public.wellness_records (athlete_id, record_date DESC);

-- -----------------------------------------------------------------------------
-- 9. Workout Matching, Coaching Alerts, Weekly Reports, Sync Logs & Audit
-- -----------------------------------------------------------------------------

CREATE TABLE public.workout_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL REFERENCES public.coaches(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL,
  match_date date NOT NULL,
  planned_workout_id uuid,
  completed_activity_id uuid,
  match_status text NOT NULL CHECK (
    match_status IN ('Auto-Matched', 'Needs Coach Review', 'Missed Workout', 'Missing Telemetry', 'Unplanned Activity')
  ),
  match_score int NOT NULL DEFAULT 0 CHECK (match_score BETWEEN 0 AND 100),
  match_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  distance_delta_miles numeric(6,2),
  duration_delta_min numeric(6,2),
  pace_delta_sec_per_mile int,
  hr_delta_from_target_zone_bpm int,
  intensity_comparison text,
  coach_reviewed boolean NOT NULL DEFAULT false,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workout_matches_target_present_chk
    CHECK (planned_workout_id IS NOT NULL OR completed_activity_id IS NOT NULL),
  CONSTRAINT workout_matches_athlete_owner_fk
    FOREIGN KEY (athlete_id, coach_id)
    REFERENCES public.athletes(id, coach_id)
    ON DELETE CASCADE,
  CONSTRAINT workout_matches_planned_owner_fk
    FOREIGN KEY (planned_workout_id, athlete_id, coach_id)
    REFERENCES public.planned_workouts(id, athlete_id, coach_id)
    ON DELETE CASCADE,
  CONSTRAINT workout_matches_completed_owner_fk
    FOREIGN KEY (completed_activity_id, athlete_id, coach_id)
    REFERENCES public.completed_activities(id, athlete_id, coach_id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_workout_matches_pair_uniq
  ON public.workout_matches (
    athlete_id,
    COALESCE(planned_workout_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(completed_activity_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE INDEX idx_workout_matches_athlete_date
  ON public.workout_matches (athlete_id, match_date DESC);

CREATE TRIGGER trg_workout_matches_updated_at
  BEFORE UPDATE ON public.workout_matches
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.coaching_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL REFERENCES public.coaches(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL,
  category text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('high', 'moderate', 'low')),
  classification text NOT NULL CHECK (
    classification IN (
      'High priority: Coach review recommended',
      'Moderate priority: Monitor',
      'Positive development',
      'Insufficient data'
    )
  ),
  domain text,
  title text NOT NULL,
  explanation text NOT NULL,
  supporting_data jsonb NOT NULL DEFAULT '[]'::jsonb,
  data_origin text NOT NULL DEFAULT 'live'
    CHECK (data_origin IN ('live', 'csv_import', 'mixed')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'acknowledged', 'resolved')),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coaching_alerts_athlete_owner_fk
    FOREIGN KEY (athlete_id, coach_id)
    REFERENCES public.athletes(id, coach_id)
    ON DELETE CASCADE
);

CREATE INDEX idx_coaching_alerts_coach_status_created
  ON public.coaching_alerts (coach_id, status, created_at DESC);

CREATE TABLE public.weekly_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL REFERENCES public.coaches(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL,
  week_start_date date NOT NULL,
  week_label text NOT NULL,
  compliance_pct numeric(5,2) CHECK (compliance_pct IS NULL OR (compliance_pct BETWEEN 0 AND 200)),
  actual_miles numeric(6,2) CHECK (actual_miles IS NULL OR actual_miles >= 0),
  planned_miles numeric(6,2) CHECK (planned_miles IS NULL OR planned_miles >= 0),
  weekly_hr_stress numeric(7,2) CHECK (weekly_hr_stress IS NULL OR weekly_hr_stress >= 0),
  ctl numeric(7,2),
  atl numeric(7,2),
  tsb numeric(7,2),
  ai_summary text NOT NULL,
  coach_note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Approved', 'Blocked')),
  approved_at timestamptz,
  email_dispatch_blocked boolean NOT NULL DEFAULT true CHECK (email_dispatch_blocked = true),
  email_delivery_note text NOT NULL DEFAULT 'Coach approval required before athlete email dispatch.',
  data_origin text NOT NULL DEFAULT 'live'
    CHECK (data_origin IN ('live', 'csv_import', 'mixed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT weekly_reports_athlete_week_uniq UNIQUE (athlete_id, week_start_date),
  CONSTRAINT weekly_reports_athlete_owner_fk
    FOREIGN KEY (athlete_id, coach_id)
    REFERENCES public.athletes(id, coach_id)
    ON DELETE CASCADE
);

CREATE INDEX idx_weekly_reports_coach_status
  ON public.weekly_reports (coach_id, status, week_start_date DESC);

CREATE TRIGGER trg_weekly_reports_updated_at
  BEFORE UPDATE ON public.weekly_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.synchronization_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL REFERENCES public.coaches(id) ON DELETE CASCADE,
  job_type text NOT NULL CHECK (
    job_type IN ('daily_activity_import', 'daily_metric_update', 'backfill_12w', 'retry_sync', 'finalsurge_csv_import')
  ),
  provider text NOT NULL CHECK (provider IN ('intervals_icu', 'final_surge')),
  status text NOT NULL CHECK (
    status IN ('Queued', 'Running', 'Succeeded', 'Partial', 'Retried & Queued', 'Blocked (Unauthorized)', 'Failed')
  ),
  attempt_number int NOT NULL DEFAULT 1 CHECK (attempt_number >= 1),
  records_processed int NOT NULL DEFAULT 0 CHECK (records_processed >= 0),
  duplicates_skipped int NOT NULL DEFAULT 0 CHECK (duplicates_skipped >= 0),
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX idx_synchronization_logs_coach_started
  ON public.synchronization_logs (coach_id, started_at DESC);

-- Append-only audit trail. Intentionally omits any FK to `athletes` so deletion
-- audit records remain intact after cascading athlete deletion.
CREATE TABLE public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL REFERENCES public.coaches(id) ON DELETE RESTRICT,
  actor_role text NOT NULL DEFAULT 'owner_coach' CHECK (actor_role = 'owner_coach'),
  action text NOT NULL,
  target_entity text NOT NULL,
  target_id text,
  athlete_id_snapshot uuid,
  detail text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_events_coach_created
  ON public.audit_events (coach_id, created_at DESC);

CREATE INDEX idx_audit_events_athlete_snapshot
  ON public.audit_events (athlete_id_snapshot, created_at DESC)
  WHERE athlete_id_snapshot IS NOT NULL;

CREATE TRIGGER trg_audit_events_immutable
  BEFORE UPDATE OR DELETE ON public.audit_events
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_audit_event_mutation();

-- -----------------------------------------------------------------------------
-- 10. Privilege Lockdown & Row-Level Security (Single-Coach Ownership)
-- -----------------------------------------------------------------------------

-- Revoke default public/anon access across all tables first.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon;

-- Grant authenticated role standard DML only on coach-facing tables (RLS still filters).
GRANT SELECT ON public.coaches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.provider_connections,
  public.athletes,
  public.provider_athlete_mappings,
  public.raw_provider_payloads,
  public.planned_workouts,
  public.completed_activities,
  public.heart_rate_streams,
  public.athlete_thresholds,
  public.heart_rate_zones,
  public.threshold_recalculation_logs,
  public.provider_training_metrics,
  public.independent_stress_metrics,
  public.daily_load_histories,
  public.wellness_records,
  public.workout_matches,
  public.coaching_alerts,
  public.weekly_reports,
  public.synchronization_logs
TO authenticated;

-- Audit events are strictly append-only (SELECT + INSERT only; UPDATE/DELETE revoked).
GRANT SELECT, INSERT ON public.audit_events TO authenticated;

-- Server-only secret/CSRF tables: zero access for anon or authenticated roles.
REVOKE ALL ON public.provider_connection_credentials FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.oauth_states FROM PUBLIC, anon, authenticated;

-- Enable Row-Level Security on every production table.
ALTER TABLE public.coaches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_connection_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.athletes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_athlete_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_provider_payloads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planned_workouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.completed_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.heart_rate_streams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.athlete_thresholds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.heart_rate_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.threshold_recalculation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_training_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.independent_stress_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_load_histories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wellness_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coaching_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.synchronization_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

-- Helper used in RLS policies so every policy verifies both `coach_id = auth.uid()`
-- and an active single-owner coach record in `public.coaches`.
CREATE OR REPLACE FUNCTION public.is_active_owner_coach(target_coach_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND target_coach_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.coaches c
      WHERE c.id = auth.uid()
        AND c.is_active = true
        AND c.role = 'owner_coach'
    );
$$;

-- Coaches: authenticated owner can read own active profile only.
CREATE POLICY coaches_owner_select
  ON public.coaches
  FOR SELECT
  TO authenticated
  USING (id = auth.uid() AND is_active = true AND role = 'owner_coach');

-- Provider connections (non-secret metadata): scoped to active owner coach.
CREATE POLICY provider_connections_owner_all
  ON public.provider_connections
  FOR ALL
  TO authenticated
  USING (public.is_active_owner_coach(coach_id))
  WITH CHECK (public.is_active_owner_coach(coach_id));

-- Note: provider_connection_credentials and oauth_states intentionally have
-- NO policies for `anon` or `authenticated` (deny-by-default; service_role only).

-- Athletes: scoped strictly to active owner coach.
CREATE POLICY athletes_owner_all
  ON public.athletes
  FOR ALL
  TO authenticated
  USING (public.is_active_owner_coach(coach_id))
  WITH CHECK (public.is_active_owner_coach(coach_id));

-- Raw payloads: coach-scoped and (if athlete_id present) athlete-ownership verified.
CREATE POLICY raw_payloads_owner_all
  ON public.raw_provider_payloads
  FOR ALL
  TO authenticated
  USING (
    public.is_active_owner_coach(coach_id)
    AND (
      athlete_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.athletes a
        WHERE a.id = athlete_id AND a.coach_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    public.is_active_owner_coach(coach_id)
    AND (
      athlete_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.athletes a
        WHERE a.id = athlete_id AND a.coach_id = auth.uid()
      )
    )
  );

-- Athlete-owned child tables: enforce both coach_id AND athlete ownership.
CREATE POLICY mappings_owner_all
  ON public.provider_athlete_mappings
  FOR ALL
  TO authenticated
  USING (
    public.is_active_owner_coach(coach_id)
    AND EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = athlete_id AND a.coach_id = auth.uid())
  )
  WITH CHECK (
    public.is_active_owner_coach(coach_id)
    AND EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = athlete_id AND a.coach_id = auth.uid())
  );

CREATE POLICY planned_workouts_owner_all
  ON public.planned_workouts
  FOR ALL
  TO authenticated
  USING (
    public.is_active_owner_coach(coach_id)
    AND EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = athlete_id AND a.coach_id = auth.uid())
  )
  WITH CHECK (
    public.is_active_owner_coach(coach_id)
    AND EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = athlete_id AND a.coach_id = auth.uid())
  );

CREATE POLICY completed_activities_owner_all
  ON public.completed_activities
  FOR ALL
  TO authenticated
  USING (
    public.is_active_owner_coach(coach_id)
    AND EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = athlete_id AND a.coach_id = auth.uid())
  )
  WITH CHECK (
    public.is_active_owner_coach(coach_id)
    AND EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = athlete_id AND a.coach_id = auth.uid())
  );

CREATE POLICY hr_streams_owner_all
  ON public.heart_rate_streams
  FOR ALL
  TO authenticated
  USING (
    public.is_active_owner_coach(coach_id)
    AND EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = athlete_id AND a.coach_id = auth.uid())
  )
  WITH CHECK (
    public.is_active_owner_coach(coach_id)
    AND EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = athlete_id AND a.coach_id = auth.uid())
  );

CREATE POLICY thresholds_owner_all
  ON public.athlete_thresholds
  FOR ALL
  TO authenticated
  USING (
    public.is_active_owner_coach(coach_id)
    AND EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = athlete_id AND a.coach_id = auth.uid())
  )
  WITH CHECK (
    public.is_active_owner_coach(coach_id)
    AND EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = athlete_id AND a.coach_id = auth.uid())
  );

CREATE POLICY hr_zones_owner_all
  ON public.heart_rate_zones
  FOR ALL
  TO authenticated
  USING (
    public.is_active_owner_coach(coach_id)
    AND EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = athlete_id AND a.coach_id = auth.uid())
  )
  WITH CHECK (
    public.is_active_owner_coach(coach_id)
    AND EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = athlete_id AND a.coach_id = auth.uid())
  );

CREATE POLICY threshold_recalc_owner_all
  ON public.threshold_recalculation_logs
  FOR ALL
  TO authenticated
  USING (
    public.is_active_owner_coach(coach_id)
    AND EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = athlete_id AND a.coach_id = auth.uid())
  )
  WITH CHECK (
    public.is_active_owner_coach(coach_id)
    AND EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = athlete_id AND a.coach_id = auth.uid())
  );

CREATE POLICY provider_metrics_owner_all
  ON public.provider_training_metrics
  FOR ALL
  TO authenticated
  USING (
    public.is_active_owner_coach(coach_id)
    AND EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = athlete_id AND a.coach_id = auth.uid())
  )
  WITH CHECK (
    public.is_active_owner_coach(coach_id)
    AND EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = athlete_id AND a.coach_id = auth.uid())
  );

CREATE POLICY independent_stress_owner_all
  ON public.independent_stress_metrics
  FOR ALL
  TO authenticated
  USING (
    public.is_active_owner_coach(coach_id)
    AND EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = athlete_id AND a.coach_id = auth.uid())
  )
  WITH CHECK (
    public.is_active_owner_coach(coach_id)
    AND EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = athlete_id AND a.coach_id = auth.uid())
  );

CREATE POLICY daily_load_owner_all
  ON public.daily_load_histories
  FOR ALL
  TO authenticated
  USING (
    public.is_active_owner_coach(coach_id)
    AND EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = athlete_id AND a.coach_id = auth.uid())
  )
  WITH CHECK (
    public.is_active_owner_coach(coach_id)
    AND EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = athlete_id AND a.coach_id = auth.uid())
  );

CREATE POLICY wellness_owner_all
  ON public.wellness_records
  FOR ALL
  TO authenticated
  USING (
    public.is_active_owner_coach(coach_id)
    AND EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = athlete_id AND a.coach_id = auth.uid())
  )
  WITH CHECK (
    public.is_active_owner_coach(coach_id)
    AND EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = athlete_id AND a.coach_id = auth.uid())
  );

CREATE POLICY workout_matches_owner_all
  ON public.workout_matches
  FOR ALL
  TO authenticated
  USING (
    public.is_active_owner_coach(coach_id)
    AND EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = athlete_id AND a.coach_id = auth.uid())
  )
  WITH CHECK (
    public.is_active_owner_coach(coach_id)
    AND EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = athlete_id AND a.coach_id = auth.uid())
  );

CREATE POLICY coaching_alerts_owner_all
  ON public.coaching_alerts
  FOR ALL
  TO authenticated
  USING (
    public.is_active_owner_coach(coach_id)
    AND EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = athlete_id AND a.coach_id = auth.uid())
  )
  WITH CHECK (
    public.is_active_owner_coach(coach_id)
    AND EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = athlete_id AND a.coach_id = auth.uid())
  );

CREATE POLICY weekly_reports_owner_all
  ON public.weekly_reports
  FOR ALL
  TO authenticated
  USING (
    public.is_active_owner_coach(coach_id)
    AND EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = athlete_id AND a.coach_id = auth.uid())
  )
  WITH CHECK (
    public.is_active_owner_coach(coach_id)
    AND EXISTS (SELECT 1 FROM public.athletes a WHERE a.id = athlete_id AND a.coach_id = auth.uid())
  );

-- Coach-level operational logs
CREATE POLICY sync_logs_owner_all
  ON public.synchronization_logs
  FOR ALL
  TO authenticated
  USING (public.is_active_owner_coach(coach_id))
  WITH CHECK (public.is_active_owner_coach(coach_id));

-- Append-only audit events: SELECT + INSERT only (no UPDATE or DELETE policies)
CREATE POLICY audit_events_owner_select
  ON public.audit_events
  FOR SELECT
  TO authenticated
  USING (public.is_active_owner_coach(coach_id));

CREATE POLICY audit_events_owner_insert
  ON public.audit_events
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_active_owner_coach(coach_id));

COMMIT;
