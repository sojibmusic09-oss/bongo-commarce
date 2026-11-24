import 'dotenv/config';
import { getDb } from '../src/db/adapter';
import { runMigrations } from '../src/db/migrator';
import { generateUuid, hashPassword } from '../src/lib/security/crypto';

async function main() {
  const mig = await runMigrations();
  console.log('Migrations:', mig);

  const db = getDb();
  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@example.com').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || 'ChangeMeStrong!2026';

  const existing = await db.query('SELECT id FROM users WHERE email = ?', [email]);
  if (existing.rows.length === 0) {
    await db.execute(
      `INSERT INTO users (id, name, email, password_hash, platform_role, is_active) VALUES (?, 'Super Admin', ?, ?, 'SUPER_ADMIN', ?)`,
      [generateUuid(), email, hashPassword(password), db.engine === 'postgresql' ? true : 1]
    );
    console.log(`✅ Super Admin created: ${email}`);
  } else {
    console.log(`ℹ️ Super Admin already exists: ${email}`);
  }
  await db.close();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
