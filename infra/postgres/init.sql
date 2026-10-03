-- Dev bootstrap. Runs once on an empty volume.
-- grids_owner: owns schemas/tables, runs migrations (bypasses RLS as table owner).
-- grids_app:   runtime role used by API/worker; NOT an owner, so RLS always applies (ADR 0001).
CREATE ROLE grids_owner LOGIN PASSWORD 'grids_owner';
CREATE ROLE grids_app   LOGIN PASSWORD 'grids_app';

CREATE DATABASE grids_platform OWNER grids_owner;
CREATE DATABASE grids_cell_1   OWNER grids_owner;
CREATE DATABASE grids_identity OWNER grids_owner;

\connect grids_platform
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
GRANT CONNECT ON DATABASE grids_platform TO grids_app;
ALTER DEFAULT PRIVILEGES FOR ROLE grids_owner GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO grids_app;
ALTER DEFAULT PRIVILEGES FOR ROLE grids_owner GRANT USAGE, SELECT ON SEQUENCES TO grids_app;

\connect grids_cell_1
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS ltree;
CREATE EXTENSION IF NOT EXISTS postgis;
GRANT CONNECT ON DATABASE grids_cell_1 TO grids_app;
ALTER DEFAULT PRIVILEGES FOR ROLE grids_owner GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO grids_app;
ALTER DEFAULT PRIVILEGES FOR ROLE grids_owner GRANT USAGE, SELECT ON SEQUENCES TO grids_app;

\connect grids_identity
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
GRANT CONNECT ON DATABASE grids_identity TO grids_app;
ALTER DEFAULT PRIVILEGES FOR ROLE grids_owner GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO grids_app;
ALTER DEFAULT PRIVILEGES FOR ROLE grids_owner GRANT USAGE, SELECT ON SEQUENCES TO grids_app;
