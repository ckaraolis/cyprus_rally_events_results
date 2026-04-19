-- =============================================================================
-- Hosted Postgres (e.g. Supabase): what is SQL vs what is NOT
-- =============================================================================
-- Turning Postgres ON for your deployed site is done with environment variables
-- on the host (Vercel, Docker, etc.), NOT with SQL:
--
--   DATABASE_URL=postgresql://...your Supabase connection string...
--   RALLY_DB_READS=1
--   RALLY_DB_WRITES=1
--   RALLY_FILE_WRITES=1
--
-- After deploy, load your local admin data into the DB once (from project root):
--   set DATABASE_URL=...   (PowerShell: $env:DATABASE_URL="...")
--   npm run db:migrate:json
-- That reads data/rally-site.json and upserts via Prisma (preferred to hand SQL).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Schema (run once on an empty database)
-- -----------------------------------------------------------------------------
-- Use the checked-in file: prisma/init_rally.sql
-- Or from CI: npx prisma migrate deploy  (if you add migrations later)
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- 2) Optional: ensure a SiteSettings row exists (id = 1) if the table is empty
-- -----------------------------------------------------------------------------
INSERT INTO "SiteSettings" (
  "id",
  "resultsPageTitle",
  "resultsPageSubtitle",
  "resultsStatusLabel",
  "featuredEventId",
  "publicFooterNote",
  "updatedAt"
)
VALUES (
  1,
  'Cyprus Rally Championship',
  'National championship — live timing & results',
  'Setup',
  NULL,
  '',
  NOW()
)
ON CONFLICT ("id") DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3) Optional: bump config timestamp so merge logic prefers DB over older JSON
-- -----------------------------------------------------------------------------
-- UPDATE "SiteSettings" SET "updatedAt" = NOW() WHERE "id" = 1;

SELECT 1 AS ok;
