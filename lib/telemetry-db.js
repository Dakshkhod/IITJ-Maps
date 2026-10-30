/** Shared Neon Postgres connection + schema for telemetry serverless functions. */
const { neon } = require('@neondatabase/serverless');

let cachedUrl = null;
let cachedSql = null;
let schemaPromise = null;

function connectionString() {
  return process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.NEON_DATABASE_URL ||
    '';
}

function configured() {
  return !!connectionString();
}

function sql() {
  const url = connectionString();
  if (!url) return null;
  if (!cachedSql || cachedUrl !== url) {
    cachedUrl = url;
    cachedSql = neon(url);
    schemaPromise = null;
  }
  return cachedSql;
}

async function ensureSchema() {
  const client = sql();
  if (!client) {
    const error = new Error('Live analytics is not configured. Connect a Neon Postgres database.');
    error.status = 503;
    throw error;
  }
  if (!schemaPromise) {
    schemaPromise = client`
      CREATE TABLE IF NOT EXISTS iitj_telemetry_sessions (
        session_id VARCHAR(64) PRIMARY KEY,
        started_at BIGINT NOT NULL,
        last_seen BIGINT NOT NULL,
        ended_at BIGINT,
        visible BOOLEAN NOT NULL DEFAULT TRUE,
        approximate JSONB NOT NULL DEFAULT '{}'::jsonb,
        precise_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
        precise JSONB,
        path JSONB NOT NULL DEFAULT '[]'::jsonb,
        routes JSONB NOT NULL DEFAULT '[]'::jsonb,
        route_calculations INTEGER NOT NULL DEFAULT 0
      )
    `.then(async () => {
      await client`
        CREATE INDEX IF NOT EXISTS iitj_telemetry_last_seen_idx
        ON iitj_telemetry_sessions (last_seen DESC)
      `;
    }).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

module.exports = { configured, sql, ensureSchema };
