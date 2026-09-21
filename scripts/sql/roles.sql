-- Separating the role the app uses from the role a person uses.
--
--   psql "$DATABASE_URL" -f scripts/sql/roles.sql
--
-- Be clear about what this does and does not buy.
--
-- It does NOT hide secrets from the application. The app must read
-- users.password_hash to check a sign-in and broker_connections to refresh a
-- token; there is no configuration where it works and cannot see them. What
-- protects the token is that it is encrypted with TOKEN_ENCRYPTION_KEY, which
-- lives in the deployment environment and not in the database.
--
-- What it DOES buy: when you connect by hand — psql, a GUI, a one-off script —
-- you connect as `analyst`, which cannot read either. That stops an accident
-- and stops casual browsing. It does not stop you, because you can always
-- reach for the owner role. It is a speed bump with your name on it, and most
-- damage is accidental.
--
-- Change the password before running this, and store it where you keep the
-- other one.

\set analyst_password 'CHANGE-ME-BEFORE-RUNNING'

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'analyst') THEN
    CREATE ROLE analyst LOGIN;
  END IF;
END
$$;

ALTER ROLE analyst PASSWORD :'analyst_password';

GRANT CONNECT ON DATABASE neondb TO analyst;
GRANT USAGE ON SCHEMA public TO analyst;

-- Read everything by default...
GRANT SELECT ON ALL TABLES IN SCHEMA public TO analyst;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO analyst;

-- ...then take back the two places a live secret actually lives.
REVOKE ALL ON broker_connections FROM analyst;
REVOKE SELECT (password_hash) ON users FROM analyst;

-- Session tokens are stored as SHA-256 digests and cannot be reversed into a
-- usable cookie, but there is no reason to read them either.
REVOKE SELECT (token_hash) ON sessions FROM analyst;

-- Analyst is read-only. Anything that writes goes through the app.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM analyst;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM analyst;
