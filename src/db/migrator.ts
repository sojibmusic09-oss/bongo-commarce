import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseAdapter } from '@/db/adapter';
import { getDb } from '@/db/adapter';
import { generateUuid } from '@/lib/security/crypto';
import type { PlanLimits, SubscriptionPlanCode } from '@/types/platform';

export function splitSqlStatements(sql: string): string[] {
  const cleanedLines = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  const statements: string[] = [];
  let current = '';
  let inSingleQuote = false;

  for (let i = 0; i < cleanedLines.length; i++) {
    const ch = cleanedLines[i];
    if (ch === "'" && cleanedLines[i - 1] !== '\\') {
      if (inSingleQuote && cleanedLines[i + 1] === "'") {
        current += "''";
        i++;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      current += ch;
    } else if (ch === ';' && !inSingleQuote) {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
      current = '';
    } else {
      current += ch;
    }
  }

  const tail = current.trim();
  if (tail.length > 0) {
    statements.push(tail);
  }
  return statements;
}

export async function runMigrations(targetAdapter?: DatabaseAdapter): Promise<{
  applied: string[];
  alreadyApplied: string[];
}> {
  const db = targetAdapter || getDb();
  const folder = db.engine === 'postgresql' ? 'postgres' : 'mysql';
  const migrationsDir = path.resolve(process.cwd(), 'src', 'db', 'migrations', folder);

  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found: ${migrationsDir}`);
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  // Ensure schema_migrations exists first by running 001 statements if needed
  let appliedVersions = new Set<string>();
  try {
    const existing = await db.query<{ version: string }>('SELECT version FROM schema_migrations');
    appliedVersions = new Set(existing.rows.map((r) => r.version));
  } catch {
    // Table does not exist yet; will be created by 001_init.sql
  }

  const applied: string[] = [];
  const alreadyApplied: string[] = [];

  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (appliedVersions.has(version)) {
      alreadyApplied.push(version);
      continue;
    }

    const sqlContent = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const statements = splitSqlStatements(sqlContent);

    for (const stmt of statements) {
      // Skip SET NAMES on postgres if ever encountered, though mysql folder is separate
      await db.execute(stmt);
    }

    await db.execute('INSERT INTO schema_migrations (version, name) VALUES (?, ?)', [
      version,
      file,
    ]);
    applied.push(version);
  }

  await seedDefaultSubscriptionPlans(db);

  return { applied, alreadyApplied };
}

export const DEFAULT_SUBSCRIPTION_PLANS: Array<{
  code: SubscriptionPlanCode;
  name: string;
  priceMonthly: string;
  priceYearly: string;
  limits: PlanLimits;
}> = [
  {
    code: 'FREE',
    name: 'Free Starter',
    priceMonthly: '0.00',
    priceYearly: '0.00',
    limits: {
      maxProducts: 15,
      maxOrdersPerMonth: 50,
      maxStaff: 1,
      maxStorageMb: 100,
      maxCustomDomains: 0,
      allowAiAssistant: true,
      allowOfficialBkash: false,
    },
  },
  {
    code: 'BASIC',
    name: 'Basic Shop',
    priceMonthly: '499.00',
    priceYearly: '4990.00',
    limits: {
      maxProducts: 100,
      maxOrdersPerMonth: 500,
      maxStaff: 3,
      maxStorageMb: 500,
      maxCustomDomains: 1,
      allowAiAssistant: true,
      allowOfficialBkash: true,
    },
  },
  {
    code: 'STANDARD',
    name: 'Standard Business',
    priceMonthly: '1299.00',
    priceYearly: '12990.00',
    limits: {
      maxProducts: 500,
      maxOrdersPerMonth: 3000,
      maxStaff: 8,
      maxStorageMb: 2048,
      maxCustomDomains: 3,
      allowAiAssistant: true,
      allowOfficialBkash: true,
    },
  },
  {
    code: 'PREMIUM',
    name: 'Premium Brand',
    priceMonthly: '2999.00',
    priceYearly: '29990.00',
    limits: {
      maxProducts: 5000,
      maxOrdersPerMonth: 25000,
      maxStaff: 25,
      maxStorageMb: 10240,
      maxCustomDomains: 10,
      allowAiAssistant: true,
      allowOfficialBkash: true,
    },
  },
  {
    code: 'ENTERPRISE',
    name: 'Enterprise Unlimited',
    priceMonthly: '7999.00',
    priceYearly: '79990.00',
    limits: {
      maxProducts: 100000,
      maxOrdersPerMonth: 500000,
      maxStaff: 100,
      maxStorageMb: 102400,
      maxCustomDomains: 50,
      allowAiAssistant: true,
      allowOfficialBkash: true,
    },
  },
];

export async function seedDefaultSubscriptionPlans(db: DatabaseAdapter): Promise<void> {
  for (const plan of DEFAULT_SUBSCRIPTION_PLANS) {
    const existing = await db.query<{ id: string }>(
      'SELECT id FROM subscription_plans WHERE code = ?',
      [plan.code]
    );
    if (existing.rows.length === 0) {
      await db.execute(
        'INSERT INTO subscription_plans (id, code, name, price_monthly, price_yearly, currency, limits_json, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [
          generateUuid(),
          plan.code,
          plan.name,
          plan.priceMonthly,
          plan.priceYearly,
          'BDT',
          JSON.stringify(plan.limits),
          db.engine === 'postgresql' ? true : 1,
        ]
      );
    }
  }
}

export async function getMigrationHistory(): Promise<
  Array<{ version: string; name: string; applied_at: string }>
> {
  const db = getDb();
  const res = await db.query<{ version: string; name: string; applied_at: string }>(
    'SELECT version, name, applied_at FROM schema_migrations ORDER BY applied_at DESC'
  );
  return res.rows;
}
