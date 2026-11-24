import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { getDb, isWriteFrozen } from '@/db/adapter';
import { generateToken, generateUuid, sha256Hex, signHmac, verifyHmac } from '@/lib/security/crypto';
import type { PlatformRole, SessionUser, StoreMemberRole } from '@/types/platform';

export const SESSION_COOKIE = 'bongo_session';
export const CSRF_COOKIE = 'bongo_csrf';

// Simple sliding-window in-memory rate limiter
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, maxRequests = 30, windowMs = 60_000): boolean {
  const now = Date.now();
  const entry = rateBuckets.get(key);
  if (!entry || entry.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= maxRequests) return false;
  entry.count += 1;
  return true;
}

export async function getClientIp(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || '127.0.0.1';
}

export async function createUserSession(userId: string): Promise<{
  rawCookieValue: string;
  csrfToken: string;
  expiresAt: Date;
}> {
  const db = getDb();
  const rawToken = generateToken(32);
  const tokenHash = sha256Hex(rawToken);
  const sessionId = generateUuid();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const ip = await getClientIp();
  const ua = (await headers()).get('user-agent') || '';

  await db.execute(
    'INSERT INTO sessions (id, user_id, token_hash, ip_address, user_agent, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    [sessionId, userId, tokenHash, ip, ua.slice(0, 500), expiresAt]
  );

  const sig = signHmac(rawToken);
  return {
    rawCookieValue: `${rawToken}.${sig}`,
    csrfToken: generateToken(16),
    expiresAt,
  };
}

export function attachSessionCookies(
  res: NextResponse,
  rawCookieValue: string,
  csrfToken: string,
  expiresAt: Date
): void {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookies.set(SESSION_COOKIE, rawCookieValue, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
    expires: expiresAt,
  });
  res.cookies.set(CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
    expires: expiresAt,
  });
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE)?.value;
  if (!raw || !raw.includes('.')) return null;

  const [token, sig] = raw.split('.');
  if (!token || !sig || !verifyHmac(token, sig)) return null;

  const db = getDb();
  const tokenHash = sha256Hex(token);
  const res = await db.query<{
    id: string;
    name: string;
    email: string;
    platform_role: PlatformRole;
    is_active: boolean | number;
    expires_at: string;
    revoked_at: string | null;
  }>(
    `SELECT u.id, u.name, u.email, u.platform_role, u.is_active, s.expires_at, s.revoked_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? LIMIT 1`,
    [tokenHash]
  );

  const row = res.rows[0];
  if (!row || !row.is_active || row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    platform_role: row.platform_role,
  };
}

export async function revokeCurrentSession(): Promise<void> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE)?.value;
  if (!raw || !raw.includes('.')) return;
  const [token] = raw.split('.');
  const db = getDb();
  await db.execute('UPDATE sessions SET revoked_at = ? WHERE token_hash = ?', [
    new Date(),
    sha256Hex(token),
  ]);
}

export async function verifyCsrf(req: Request): Promise<boolean> {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  const cookieStore = await cookies();
  const cookieToken = cookieStore.get(CSRF_COOKIE)?.value;
  const headerToken = req.headers.get('x-csrf-token');
  // Allow API calls without cookie-based session (e.g. initial login/register/webhook)
  if (!cookieStore.get(SESSION_COOKIE)?.value) return true;
  return Boolean(cookieToken && headerToken && cookieToken === headerToken);
}

export function guardWriteFreeze(user: SessionUser | null): NextResponse | null {
  if (isWriteFrozen() && user?.platform_role !== 'SUPER_ADMIN') {
    return NextResponse.json(
      { error: 'Platform database maintenance in progress. Please retry in a few seconds.' },
      { status: 503, headers: { 'Retry-After': '10' } }
    );
  }
  return null;
}

export async function requireAuth(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthError('Authentication required', 401);
  return user;
}

export async function requireSuperAdmin(): Promise<SessionUser> {
  const user = await requireAuth();
  if (user.platform_role !== 'SUPER_ADMIN') {
    throw new AuthError('Super Admin access required', 403);
  }
  return user;
}

export async function requireStoreAccess(
  user: SessionUser,
  storeId: string,
  allowedRoles: StoreMemberRole[] = ['OWNER', 'MANAGER', 'EDITOR', 'VIEWER']
): Promise<StoreMemberRole | 'SUPER_ADMIN'> {
  if (user.platform_role === 'SUPER_ADMIN') return 'SUPER_ADMIN';
  const db = getDb();
  const res = await db.query<{ role: StoreMemberRole }>(
    'SELECT role FROM store_members WHERE store_id = ? AND user_id = ? LIMIT 1',
    [storeId, user.id]
  );
  const member = res.rows[0];
  if (!member || !allowedRoles.includes(member.role)) {
    throw new AuthError('Forbidden: You do not have permission for this store', 403);
  }
  return member.role;
}

export async function writeAuditLog(params: {
  actorUserId?: string | null;
  storeId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const db = getDb();
    const ip = await getClientIp();
    await db.execute(
      `INSERT INTO audit_logs (id, actor_user_id, store_id, action, target_type, target_id, metadata_json, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        generateUuid(),
        params.actorUserId || null,
        params.storeId || null,
        params.action,
        params.targetType,
        params.targetId || null,
        params.metadata ? JSON.stringify(params.metadata) : null,
        ip,
      ]
    );
  } catch (err) {
    console.error('Audit log write failed:', err);
  }
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}
