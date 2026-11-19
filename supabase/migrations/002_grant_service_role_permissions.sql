-- =============================================================================
-- Running Coach AI — Mythical Mile Coaching
-- Follow-up Migration 002: Grant Schema, Table & Sequence Privileges to service_role
--
-- Purpose:
--   `001_initial_schema.sql` granted privileges only to `authenticated` and
--   revoked defaults from `PUBLIC` and `anon`. Because `service_role` has
--   BYPASSRLS (not SUPERUSER), explicit GRANTs are required for server-side
--   `service_role` access while keeping `audit_events` strictly append-only and
--   without expanding privileges for `PUBLIC`, `anon`, or `authenticated`.
-- =============================================================================

BEGIN;

GRANT USAGE ON SCHEMA public TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE
ON ALL TABLES IN SCHEMA public
TO service_role;

REVOKE UPDATE, DELETE, TRUNCATE
ON TABLE public.audit_events
FROM service_role;

GRANT SELECT, INSERT
ON TABLE public.audit_events
TO service_role;

GRANT USAGE, SELECT
ON ALL SEQUENCES IN SCHEMA public
TO service_role;

COMMIT;
