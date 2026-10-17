-- Fleet migrations: which shop-schema version each account's database is on.
-- schema_version is the last applied shop migration name; schema_error holds the
-- last failed attempt (the shop stays on its old version — batches are atomic).
ALTER TABLE tenant_databases ADD COLUMN schema_version TEXT;
ALTER TABLE tenant_databases ADD COLUMN schema_checked_at INTEGER;
ALTER TABLE tenant_databases ADD COLUMN schema_error TEXT;
