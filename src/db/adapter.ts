import fs from 'node:fs';
import path from 'node:path';
import { Pool as PgPool } from 'pg';
import mysql from 'mysql2/promise';
import { decryptSecret, encryptSecret } from '@/lib/security/crypto';
import type { DatabaseConnectionConfig, DatabaseEngine, SafeDatabaseStatus } from '@/types/platform';

export interface DbQueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

export interface DbExecutor {
  engine: DatabaseEngine;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<DbQueryResult<T>>;
  execute(sql: string, params?: unknown[]): Promise<{ affectedRows: number }>;
}

export interface DatabaseAdapter extends DbExecutor {
  transaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T>;
  getServerVersion(): Promise<string>;
  close(): Promise<void>;
}

type SqlPrimitive = string | number | boolean | null | Date | Buffer;

const RUNTIME_DB_CONFIG_PATH = path.resolve(
  process.cwd(),
  process.env.LOCAL_STORAGE_PATH || './storage',
  'config',
  'db-active.enc.json'
);

const WRITE_FREEZE_FILE = path.resolve(
  process.cwd(),
  process.env.LOCAL_STORAGE_PATH || './storage',
  'config',
  'write-freeze.lock'
);

export function convertPlaceholdersToPg(sql: string): string {
  let index = 0;
  let inSingleQuote = false;
  let result = '';

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" && sql[i - 1] !== '\\') {
      if (inSingleQuote && sql[i + 1] === "'") {
        result += "''";
        i++;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      result += ch;
    } else if (ch === '?' && !inSingleQuote) {
      index += 1;
      result += `$${index}`;
    } else {
      result += ch;
    }
  }
  return result;
}

function normalizeParams(params: unknown[] = []): SqlPrimitive[] {
  return params.map((p) => {
    if (p === undefined || p === null) return null;
    if (p instanceof Date) {
      return p.toISOString().slice(0, 23).replace('T', ' ');
    }
    if (
      typeof p === 'string' ||
      typeof p === 'number' ||
      typeof p === 'boolean' ||
      Buffer.isBuffer(p)
    ) {
      return p;
    }
    return String(p);
  });
}

export function createAdapterFromConfig(config: DatabaseConnectionConfig): DatabaseAdapter {
  if (config.engine === 'postgresql') {
    const pool = new PgPool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password: config.password,
      ssl: config.ssl ? { rejectUnauthorized: false } : false,
      max: 15,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    const runQuery = async <T = Record<string, unknown>>(
      client: { query: PgPool['query'] },
      sql: string,
      params: unknown[] = []
    ): Promise<DbQueryResult<T>> => {
      const pgSql = convertPlaceholdersToPg(sql);
      const res = await client.query(pgSql, normalizeParams(params));
      return {
        rows: (res.rows as T[]) || [],
        rowCount: res.rowCount ?? res.rows.length,
      };
    };

    return {
      engine: 'postgresql',
      query: (sql, params = []) => runQuery(pool, sql, params),
      execute: async (sql, params = []) => {
        const res = await runQuery(pool, sql, params);
        return { affectedRows: res.rowCount };
      },
      transaction: async <T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const tx: DbExecutor = {
            engine: 'postgresql',
            query: (sql, params = []) => runQuery(client, sql, params),
            execute: async (sql, params = []) => {
              const res = await runQuery(client, sql, params);
              return { affectedRows: res.rowCount };
            },
          };
          const out = await fn(tx);
          await client.query('COMMIT');
          return out;
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      },
      getServerVersion: async () => {
        const res = await pool.query('SELECT version() AS v');
        return String(res.rows[0]?.v || 'PostgreSQL');
      },
      close: () => pool.end(),
    };
  }

  const pool = mysql.createPool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    waitForConnections: true,
    connectionLimit: 15,
    connectTimeout: 10000,
    charset: 'utf8mb4',
    timezone: 'Z',
    decimalNumbers: false,
  });

  const runMysqlQuery = async <T = Record<string, unknown>>(
    conn: { query: mysql.Pool['query'] },
    sql: string,
    params: unknown[] = []
  ): Promise<DbQueryResult<T>> => {
    const [rows] = await conn.query(sql, normalizeParams(params));
    if (Array.isArray(rows)) {
      return { rows: rows as T[], rowCount: rows.length };
    }
    const header = rows as mysql.ResultSetHeader;
    return { rows: [], rowCount: header.affectedRows || 0 };
  };

  return {
    engine: config.engine,
    query: (sql, params = []) => runMysqlQuery(pool, sql, params),
    execute: async (sql, params = []) => {
      const [header] = await pool.execute(sql, normalizeParams(params));
      return { affectedRows: (header as mysql.ResultSetHeader).affectedRows || 0 };
    },
    transaction: async <T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> => {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const tx: DbExecutor = {
          engine: config.engine,
          query: (sql, params = []) => runMysqlQuery(conn, sql, params),
          execute: async (sql, params = []) => {
            const [header] = await conn.execute(sql, normalizeParams(params));
            return { affectedRows: (header as mysql.ResultSetHeader).affectedRows || 0 };
          },
        };
        const out = await fn(tx);
        await conn.commit();
        return out;
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
    },
    getServerVersion: async () => {
      const [rows] = await pool.query('SELECT VERSION() AS v');
      const list = rows as Array<{ v: string }>;
      return String(list[0]?.v || config.engine.toUpperCase());
    },
    close: () => pool.end(),
  };
}

export function getEnvDatabaseConfig(): DatabaseConnectionConfig {
  const rawEngine = (process.env.DB_ENGINE || 'postgresql').toLowerCase();
  const engine: DatabaseEngine =
    rawEngine === 'mysql' || rawEngine === 'mariadb' ? rawEngine : 'postgresql';
  const defaultPort = engine === 'postgresql' ? 5432 : 3306;

  return {
    engine,
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || defaultPort),
    database: process.env.DB_NAME || 'bongo_saas',
    username: process.env.DB_USER || (engine === 'postgresql' ? 'postgres' : 'root'),
    password: process.env.DB_PASSWORD || '',
    ssl: String(process.env.DB_SSL || 'false').toLowerCase() === 'true',
  };
}

export function getActiveDatabaseConfig(): {
  config: DatabaseConnectionConfig;
  source: 'runtime_encrypted' | 'environment';
} {
  try {
    if (fs.existsSync(RUNTIME_DB_CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(RUNTIME_DB_CONFIG_PATH, 'utf8'));
      const decryptedPassword = decryptSecret(raw.encryptedPassword);
      return {
        source: 'runtime_encrypted',
        config: {
          engine: raw.engine,
          host: raw.host,
          port: Number(raw.port),
          database: raw.database,
          username: raw.username,
          password: decryptedPassword,
          ssl: Boolean(raw.ssl),
        },
      };
    }
  } catch (err) {
    console.error('Failed to read runtime encrypted DB config, falling back to env:', err);
  }
  return { config: getEnvDatabaseConfig(), source: 'environment' };
}

export function saveActiveDatabaseConfig(config: DatabaseConnectionConfig): void {
  fs.mkdirSync(path.dirname(RUNTIME_DB_CONFIG_PATH), { recursive: true });
  const payload = {
    engine: config.engine,
    host: config.host,
    port: config.port,
    database: config.database,
    username: config.username,
    encryptedPassword: encryptSecret(config.password),
    ssl: config.ssl,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(RUNTIME_DB_CONFIG_PATH, JSON.stringify(payload, null, 2), { mode: 0o600 });
}

export function isWriteFrozen(): boolean {
  return fs.existsSync(WRITE_FREEZE_FILE);
}

export function setWriteFrozen(frozen: boolean): void {
  fs.mkdirSync(path.dirname(WRITE_FREEZE_FILE), { recursive: true });
  if (frozen) {
    fs.writeFileSync(WRITE_FREEZE_FILE, new Date().toISOString(), { mode: 0o600 });
  } else if (fs.existsSync(WRITE_FREEZE_FILE)) {
    fs.unlinkSync(WRITE_FREEZE_FILE);
  }
}

let cachedAdapter: DatabaseAdapter | null = null;

export function getDb(): DatabaseAdapter {
  if (!cachedAdapter) {
    const { config } = getActiveDatabaseConfig();
    cachedAdapter = createAdapterFromConfig(config);
  }
  return cachedAdapter;
}

export async function reloadActiveDatabasePool(): Promise<DatabaseAdapter> {
  if (cachedAdapter) {
    await cachedAdapter.close().catch(() => undefined);
    cachedAdapter = null;
  }
  return getDb();
}

export async function testDatabaseConnection(config: DatabaseConnectionConfig): Promise<{
  ok: boolean;
  version: string | null;
  error?: string;
}> {
  const tempAdapter = createAdapterFromConfig(config);
  try {
    const version = await tempAdapter.getServerVersion();
    return { ok: true, version };
  } catch (err) {
    return {
      ok: false,
      version: null,
      error: err instanceof Error ? err.message : 'Unknown connection error',
    };
  } finally {
    await tempAdapter.close().catch(() => undefined);
  }
}

export async function getSafeDatabaseStatus(): Promise<SafeDatabaseStatus> {
  const { config, source } = getActiveDatabaseConfig();
  const db = getDb();
  try {
    const version = await db.getServerVersion();
    return {
      engine: config.engine,
      host: config.host,
      port: config.port,
      database: config.database,
      username: config.username,
      ssl: config.ssl,
      connected: true,
      version,
      writeFrozen: isWriteFrozen(),
      source,
    };
  } catch {
    return {
      engine: config.engine,
      host: config.host,
      port: config.port,
      database: config.database,
      username: config.username,
      ssl: config.ssl,
      connected: false,
      version: null,
      writeFrozen: isWriteFrozen(),
      source,
    };
  }
}
