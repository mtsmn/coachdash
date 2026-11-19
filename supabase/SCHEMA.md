# Running Coach AI — Supabase Database Schema (Phase 1 / Milestone 1)

This document describes the PostgreSQL / Supabase schema defined in `supabase/migrations/001_initial_schema.sql` for **Running Coach AI Dashboard — Mythical Mile Coaching**.

> **Status**: Migration file created locally. **Not yet applied** to a live Supabase project; server authentication and Express persistence endpoints belong to subsequent Phase 1 milestones.

---

## 1. Architecture & Single-Coach Ownership

- **Single Owner Coach (`coaches`)**: Designed for a single owner-coach account (`role = 'owner_coach'`, referencing `auth.users(id)`). There are no assistant coaches, team membership tables, or shared-roster permissions.
- **Composite Foreign-Key Ownership Lock**:
  - `athletes` exposes `UNIQUE (id, coach_id)`.
  - `completed_activities`, `planned_workouts`, and `athlete_thresholds` expose `UNIQUE (id, athlete_id, coach_id)`.
  - Every athlete-owned child table enforces composite foreign keys `(athlete_id, coach_id)` and/or `(activity_id, athlete_id, coach_id)` with `ON DELETE CASCADE`.
  - Result: A caller cannot associate a child record with an `athlete_id` or `activity_id` belonging to another `coach_id` even at the raw SQL level.
- **Row-Level Security (RLS)**:
  - Enabled across all 22 tables.
  - All `PUBLIC` and `anon` privileges are revoked; anonymous callers have zero table access.
  - Every coach-facing policy checks `public.is_active_owner_coach(coach_id)` (`auth.uid() = coach_id` + active `owner_coach` row) and verifies `athlete_id` belongs to `auth.uid()`.
  - RLS is treated as defense-in-depth and does **not** replace Express server-side JWT verification planned in subsequent milestones.

---

## 2. Table Inventory (22 Tables)

### Auth, Provider Status & Server-Only Secrets
1. **`coaches`** — Authenticated owner coach profile (`id` -> `auth.users(id)`). `SELECT`-only for `authenticated`.
2. **`provider_connections`** — Non-secret provider connection state (`intervals_icu`, `final_surge`), pilot gate flag, granted scopes, and sync timestamps.
3. **`provider_connection_credentials`** *(server-only)* — Encrypted OAuth tokens / API keys linked to `provider_connections`. `PUBLIC`, `anon`, and `authenticated` privileges revoked; zero client RLS policies (`service_role` only).
4. **`oauth_states`** *(server-only)* — Ephemeral CSRF `state` nonces and PKCE verifier hashes for OAuth callbacks. Zero client RLS policies (`service_role` only).

### Roster, Identity & Raw Provenance
5. **`athletes`** — Core roster athlete identity, threshold snapshot, goal race, coach notes, and explicit `data_origin` (`live`, `csv_import`, `manual`).
6. **`provider_athlete_mappings`** — Links internal `athletes` to `intervals_icu` / `final_surge` IDs with explicit `authorization_status` and `match_method` (blocks unreviewed name-only auto-merges).
7. **`raw_provider_payloads`** — Immutable JSON payloads (`payload_sha256` deduplicated) preserving verbatim upstream responses and ingestion provenance.

### Training Plans, Completed Runs & Telemetry
8. **`planned_workouts`** — Prescribed sessions from `final_surge_api`, `final_surge_csv`, or `coach_entry`.
9. **`completed_activities`** — Normalized completed activities (`intervals_icu`, `final_surge_csv`, `coach_entry`). Enforces `hr_data_state` (`valid`, `missing`, `invalid`, `rest_zero`) consistency checks so missing HR stays SQL `NULL` and never masquerades as `0`.
10. **`heart_rate_streams`** — Verified HR time-series arrays (`int[]`) linked 1:1 to `completed_activities`. `CHECK (sample_count > 0 AND cardinality(hr_bpm_stream) = sample_count)` prevents storing empty or synthetic placeholder streams.

### Thresholds, Zones & Three Isolated Load Systems
11. **`athlete_thresholds`** — Versioned LTHR records (`version`, `recorded_date`, `effective_date`, `source`, `approval_status`, `is_active` partial unique index).
12. **`heart_rate_zones`** — Z1–Z5 zone methodology (`friel_running`, `coggan_endurance`, `polarized_seiler`, `custom`) anchored to `athlete_thresholds`.
13. **`threshold_recalculation_logs`** — Audit snapshots whenever coach threshold changes recalculate historical stress.
14. **`provider_training_metrics`** *(System A)* — Supports **multiple dated native provider metrics per activity** (`UNIQUE (activity_id, provider, metric_date)`) with `original_values_preserved = true`.
15. **`independent_stress_metrics`** *(System B)* — Supports **multiple independent stress methodologies per activity** (`hr_derived_stress`, `running_tss_pace`, `running_power_stress`, `session_rpe_stress`) and **historical threshold versions** (`UNIQUE (activity_id, methodology, threshold_version_used)`), enforcing `is_tss_equivalent = false`.
16. **`daily_load_histories`** *(System C)* — Isolated daily 42-day CTL / 7-day ATL / TSB series per methodology.
17. **`wellness_records`** — Nullable daily HRV, resting HR, sleep hours, and native `icu_ctl`/`icu_atl` records (`intervals_icu_wellness` or `coach_manual`).

### Coaching Intelligence, Reporting, Sync & Audit
18. **`workout_matches`** — Planned-vs-completed match scores, deltas, status, and coach review tracking.
19. **`coaching_alerts`** — Explainable alerts with classification, `supporting_data` evidence JSON, and `data_origin`.
20. **`weekly_reports`** — Draft/Approved weekly summaries with `CHECK (email_dispatch_blocked = true)` gating outbound emails.
21. **`synchronization_logs`** — Import/sync execution history, attempt counts, and duplicate metrics.
22. **`audit_events`** — Strictly **append-only** (`UPDATE`/`DELETE` revoked + `trg_audit_events_immutable` trigger). Stores `target_id` and `athlete_id_snapshot` without a foreign key to `athletes` so deletion audit logs persist permanently after `athletes` rows cascade-delete.
