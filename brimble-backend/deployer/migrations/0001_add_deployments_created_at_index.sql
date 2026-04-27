-- Migration: create index to speed up deployments list ordered by created_at
CREATE INDEX IF NOT EXISTS idx_deployments_created_at ON deployments (created_at DESC);
