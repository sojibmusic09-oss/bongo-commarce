import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { getDb, getSafeDatabaseStatus, testDatabaseConnection } from '@/db/adapter';
import { getMigrationHistory, runMigrations } from '@/db/migrator';
import {
  AuthError,
  attachSessionCookies,
  checkRateLimit,
  createUserSession,
  getClientIp,
  getSessionUser,
  guardWriteFreeze,
  requireAuth,
  requireStoreAccess,
  requireSuperAdmin,
  revokeCurrentSession,
  verifyCsrf,
  writeAuditLog,
} from '@/lib/auth';
import {
  analyzeWebsiteSafely,
  answerGroundedQuestion,
  createEncryptedDatabaseBackup,
  createOrderWithPayment,
  createOrUpdateProduct,
  createStoreWithDefaults,
  executeZeroDataLossDbSwitch,
  getStorePlanLimits,
  initiateOfficialBkashPayment,
  listBackups,
  restoreEncryptedBackup,
  verifyManualPayment,
} from '@/lib/platform-services';
import { generateToken, generateUuid, hashPassword, verifyPassword } from '@/lib/security/crypto';
import {
  aiAnalyzeSchema,
  aiChatSchema,
  builderBlockSchema,
  categorySchema,
  checkoutSchema,
  couponSchema,
  createStoreSchema,
  dbConfigSchema,
  dbSwitchRequestSchema,
  domainAddSchema,
  loginSchema,
  oneClickShopSchema,
  productSchema,
  registerSchema,
  storeThemeSchema,
  toSlug,
} from '@/lib/validation/schemas';
import { z } from 'zod';

type RouteContext = { params: Promise<{ path: string[] }> };

function handleError(err: unknown) {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof z.ZodError) {
    const firstIssue = err.issues[0]?.message || 'Validation failed';
    return NextResponse.json({ error: firstIssue, details: err.flatten() }, { status: 400 });
  }
  const message = err instanceof Error ? err.message : 'Internal server error';
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET(req: Request, context: RouteContext) {
  try {
    const { path: segs } = await context.params;
    const route = segs.join('/');
    const url = new URL(req.url);
    const db = getDb();

    if (route === 'health') {
      const dbStatus = await getSafeDatabaseStatus();
      return NextResponse.json({ ok: dbStatus.connected, dbStatus });
    }

    if (route === 'auth/me') {
      const user = await getSessionUser();
      return NextResponse.json({ user });
    }

    if (route === 'stores/public') {
      const slug = url.searchParams.get('slug');
      const productSlug = url.searchParams.get('productSlug');
      if (slug) {
        const sRes = await db.query(
          `SELECT id, name, slug, tagline, description, logo_url, banner_url, currency, contact_email, contact_phone, theme_config, homepage_blocks, status, is_published
           FROM stores WHERE slug = ? AND status = 'ACTIVE' LIMIT 1`,
          [slug]
        );
        const store = sRes.rows[0] as Record<string, unknown> | undefined;
        if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 });

        const [productsRes, catsRes] = await Promise.all([
          db.query(
            `SELECT id, name, slug, global_alias, description, price, compare_at_price, stock, is_digital, images_json, seo_title, seo_description
             FROM products WHERE store_id = ? AND is_active = ? ORDER BY created_at DESC`,
            [store.id, db.engine === 'postgresql' ? true : 1]
          ),
          db.query('SELECT id, name, slug FROM categories WHERE store_id = ? ORDER BY sort_order ASC', [
            store.id,
          ]),
        ]);

        let selectedProduct = null;
        if (productSlug) {
          selectedProduct =
            (productsRes.rows as Array<{ slug: string }>).find((p) => p.slug === productSlug) || null;
        }

        return NextResponse.json({
          store,
          products: productsRes.rows,
          categories: catsRes.rows,
          selectedProduct,
        });
      }

      const listRes = await db.query(
        `SELECT id, name, slug, tagline, logo_url FROM stores WHERE status = 'ACTIVE' AND is_published = ? ORDER BY created_at DESC LIMIT 30`,
        [db.engine === 'postgresql' ? true : 1]
      );
      return NextResponse.json({ stores: listRes.rows });
    }

    if (route === 'orders/track') {
      const orderNumber = url.searchParams.get('orderNumber')?.trim();
      const email = url.searchParams.get('email')?.trim().toLowerCase();
      if (!orderNumber || !email) {
        return NextResponse.json({ error: 'orderNumber and email are required' }, { status: 400 });
      }
      const oRes = await db.query(
        'SELECT id, order_number, status, payment_status, total_amount, currency, created_at FROM orders WHERE order_number = ? AND customer_email = ? LIMIT 1',
        [orderNumber, email]
      );
      if (!oRes.rows[0]) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
      return NextResponse.json({ order: oRes.rows[0] });
    }

    if (route === 'my/stores') {
      const user = await requireAuth();
      const [storesRes, plansRes, invoicesRes] = await Promise.all([
        db.query(
          `SELECT s.*, sm.role AS member_role
           FROM stores s JOIN store_members sm ON sm.store_id = s.id
           WHERE sm.user_id = ? ORDER BY s.created_at DESC`,
          [user.id]
        ),
        db.query(
          'SELECT id, code, name, price_monthly, price_yearly, limits_json FROM subscription_plans ORDER BY price_monthly ASC'
        ),
        db.query(
          `SELECT si.* FROM subscription_invoices si
           JOIN store_members sm ON sm.store_id = si.store_id
           WHERE sm.user_id = ? ORDER BY si.created_at DESC LIMIT 30`,
          [user.id]
        ),
      ]);
      return NextResponse.json({ stores: storesRes.rows, plans: plansRes.rows, invoices: invoicesRes.rows });
    }

    if (segs[0] === 'stores' && segs[2] === 'manage' && segs[1]) {
      const user = await requireAuth();
      const storeId = segs[1];
      await requireStoreAccess(user, storeId);

      const [storeRes, productsRes, categoriesRes, couponsRes, ordersRes, paymentsRes, domainsRes, staffRes, customersRes] =
        await Promise.all([
          db.query('SELECT * FROM stores WHERE id = ? LIMIT 1', [storeId]),
          db.query('SELECT * FROM products WHERE store_id = ? ORDER BY created_at DESC', [storeId]),
          db.query('SELECT * FROM categories WHERE store_id = ? ORDER BY sort_order ASC', [storeId]),
          db.query('SELECT * FROM coupons WHERE store_id = ? ORDER BY created_at DESC', [storeId]),
          db.query('SELECT * FROM orders WHERE store_id = ? ORDER BY created_at DESC LIMIT 100', [storeId]),
          db.query('SELECT * FROM payments WHERE store_id = ? ORDER BY created_at DESC LIMIT 100', [storeId]),
          db.query('SELECT * FROM domains WHERE store_id = ? ORDER BY created_at DESC', [storeId]),
          db.query(
            'SELECT sm.id, sm.role, u.name, u.email FROM store_members sm JOIN users u ON u.id = sm.user_id WHERE sm.store_id = ?',
            [storeId]
          ),
          db.query('SELECT * FROM customers WHERE store_id = ? ORDER BY created_at DESC LIMIT 100', [storeId]),
        ]);

      return NextResponse.json({
        store: storeRes.rows[0],
        products: productsRes.rows,
        categories: categoriesRes.rows,
        coupons: couponsRes.rows,
        orders: ordersRes.rows,
        payments: paymentsRes.rows,
        domains: domainsRes.rows,
        staff: staffRes.rows,
        customers: customersRes.rows,
      });
    }

    if (route === 'super-admin/overview') {
      await requireSuperAdmin();
      const [storesRes, usersRes, domainsRes, ordersRes, paymentsRes, plansRes, auditRes, dbStatus, migrations] =
        await Promise.all([
          db.query(
            'SELECT s.*, u.email AS owner_email FROM stores s JOIN users u ON u.id = s.owner_id ORDER BY s.created_at DESC LIMIT 100'
          ),
          db.query(
            'SELECT id, name, email, phone, platform_role, is_active, created_at FROM users ORDER BY created_at DESC LIMIT 100'
          ),
          db.query(
            'SELECT d.*, s.name AS store_name FROM domains d JOIN stores s ON s.id = d.store_id ORDER BY d.created_at DESC LIMIT 100'
          ),
          db.query(
            'SELECT o.*, s.name AS store_name FROM orders o JOIN stores s ON s.id = o.store_id ORDER BY o.created_at DESC LIMIT 100'
          ),
          db.query('SELECT * FROM payments ORDER BY created_at DESC LIMIT 100'),
          db.query('SELECT * FROM subscription_plans ORDER BY price_monthly ASC'),
          db.query('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 80'),
          getSafeDatabaseStatus(),
          getMigrationHistory().catch(() => []),
        ]);

      return NextResponse.json({
        stores: storesRes.rows,
        users: usersRes.rows,
        domains: domainsRes.rows,
        orders: ordersRes.rows,
        payments: paymentsRes.rows,
        plans: plansRes.rows,
        auditLogs: auditRes.rows,
        dbStatus,
        migrations,
        backups: listBackups(),
        phpMyAdminUrl: process.env.PHPMYADMIN_EXTERNAL_URL || null,
      });
    }

    if (segs[0] === 'super-admin' && segs[1] === 'backups' && segs[2]) {
      await requireSuperAdmin();
      const safeName = path.basename(segs[2]);
      const fullPath = path.resolve(
        process.cwd(),
        process.env.LOCAL_STORAGE_PATH || './storage',
        'backups',
        safeName
      );
      if (!fs.existsSync(fullPath)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      const data = fs.readFileSync(fullPath);
      return new NextResponse(data, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${safeName}"`,
        },
      });
    }

    return NextResponse.json({ error: 'Endpoint not found' }, { status: 404 });
  } catch (err) {
    return handleError(err);
  }
}

async function handleMutation(req: Request, context: RouteContext) {
  try {
    const { path: segs } = await context.params;
    const route = segs.join('/');
    const ip = await getClientIp();
    const db = getDb();

    // Auth login/register/checkout/ai public endpoints skip CSRF check; protected mutations enforce CSRF
    const isPublicAuth = route === 'auth/login' || route === 'auth/register' || route === 'checkout' || route === 'ai/analyze' || route === 'ai/chat';
    if (!isPublicAuth && !(await verifyCsrf(req))) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }

    const currentUser = await getSessionUser();
    const freezeResp = guardWriteFreeze(currentUser);
    if (freezeResp && !route.startsWith('auth/')) return freezeResp;

    const body = await req.json().catch(() => ({}));

    if (route === 'auth/register') {
      if (!checkRateLimit(`reg:${ip}`, 10, 60_000)) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
      }
      const data = registerSchema.parse(body);
      const exists = await db.query('SELECT id FROM users WHERE email = ? LIMIT 1', [data.email]);
      if (exists.rows.length > 0) {
        return NextResponse.json({ error: 'এই ইমেইল দিয়ে আগেই অ্যাকাউন্ট খোলা আছে' }, { status: 409 });
      }

      const userId = generateUuid();
      await db.execute(
        `INSERT INTO users (id, name, email, phone, password_hash, platform_role, is_active) VALUES (?, ?, ?, ?, ?, 'STORE_OWNER', ?)`,
        [
          userId,
          data.name,
          data.email,
          data.phone || null,
          hashPassword(data.password),
          db.engine === 'postgresql' ? true : 1,
        ]
      );

      const sess = await createUserSession(userId);
      const res = NextResponse.json(
        { user: { id: userId, name: data.name, email: data.email, platform_role: 'STORE_OWNER' } },
        { status: 201 }
      );
      attachSessionCookies(res, sess.rawCookieValue, sess.csrfToken, sess.expiresAt);
      return res;
    }

    if (route === 'auth/login') {
      if (!checkRateLimit(`login:${ip}`, 15, 60_000)) {
        return NextResponse.json({ error: 'Too many login attempts' }, { status: 429 });
      }
      const data = loginSchema.parse(body);
      const resUser = await db.query<{
        id: string;
        name: string;
        email: string;
        password_hash: string;
        platform_role: string;
        is_active: boolean | number;
      }>(
        'SELECT id, name, email, password_hash, platform_role, is_active FROM users WHERE email = ? LIMIT 1',
        [data.email]
      );
      const u = resUser.rows[0];
      if (!u || !u.is_active || !verifyPassword(data.password, u.password_hash)) {
        await writeAuditLog({ action: 'LOGIN_FAILED', targetType: 'user', metadata: { email: data.email } });
        return NextResponse.json({ error: 'ইমেইল বা পাসওয়ার্ড ভুল হয়েছে' }, { status: 401 });
      }
      const sess = await createUserSession(u.id);
      const res = NextResponse.json({
        user: { id: u.id, name: u.name, email: u.email, platform_role: u.platform_role },
      });
      attachSessionCookies(res, sess.rawCookieValue, sess.csrfToken, sess.expiresAt);
      return res;
    }

    if (route === 'auth/logout') {
      await revokeCurrentSession();
      const res = NextResponse.json({ ok: true });
      res.cookies.delete('bongo_session');
      return res;
    }

    if (route === 'stores/one-click') {
      const user = await requireAuth();
      const data = oneClickShopSchema.parse(body);
      const shopName = data.preferredStoreName || `${data.ownerName} Store`;
      const created = await createStoreWithDefaults({
        ownerId: user.id,
        name: shopName,
        tagline: data.tagline,
        contactEmail: user.email,
        isPublished: data.publishImmediately,
      });
      return NextResponse.json(created, { status: 201 });
    }

    if (route === 'stores') {
      const user = await requireAuth();
      const data = createStoreSchema.parse(body);
      const targetOwner =
        user.platform_role === 'SUPER_ADMIN' && body.ownerId ? String(body.ownerId) : user.id;
      const created = await createStoreWithDefaults({
        ownerId: targetOwner,
        name: data.name,
        slug: data.slug,
        tagline: data.tagline,
        description: data.description,
        contactEmail: data.contactEmail || user.email,
        contactPhone: data.contactPhone,
        approvedByAdmin: user.platform_role === 'SUPER_ADMIN',
      });
      return NextResponse.json(created, { status: 201 });
    }

    if (segs[0] === 'stores' && segs[2] === 'builder' && segs[1]) {
      const user = await requireAuth();
      const storeId = segs[1];
      await requireStoreAccess(user, storeId, ['OWNER', 'MANAGER', 'EDITOR']);

      const theme = body.theme ? storeThemeSchema.parse(body.theme) : null;
      const blocks = body.blocks ? z.array(builderBlockSchema).max(20).parse(body.blocks) : null;
      const updates: string[] = [];
      const params: unknown[] = [];

      if (body.name) {
        updates.push('name = ?');
        params.push(String(body.name).slice(0, 160));
      }
      if (body.tagline !== undefined) {
        updates.push('tagline = ?');
        params.push(String(body.tagline).slice(0, 255));
      }
      if (body.logoUrl !== undefined) {
        updates.push('logo_url = ?');
        params.push(String(body.logoUrl).slice(0, 500));
      }
      if (body.bannerUrl !== undefined) {
        updates.push('banner_url = ?');
        params.push(String(body.bannerUrl).slice(0, 500));
      }
      if (body.isPublished !== undefined) {
        updates.push('is_published = ?');
        params.push(db.engine === 'postgresql' ? Boolean(body.isPublished) : body.isPublished ? 1 : 0);
      }
      if (theme) {
        updates.push('theme_config = ?');
        params.push(JSON.stringify(theme));
      }
      if (blocks) {
        updates.push('homepage_blocks = ?');
        params.push(JSON.stringify(blocks));
      }

      if (updates.length > 0) {
        updates.push('updated_at = ?');
        params.push(new Date(), storeId);
        await db.execute(`UPDATE stores SET ${updates.join(', ')} WHERE id = ?`, params);
      }
      return NextResponse.json({ ok: true });
    }

    if (segs[0] === 'stores' && segs[2] === 'products' && segs[1]) {
      const user = await requireAuth();
      const storeId = segs[1];
      await requireStoreAccess(user, storeId, ['OWNER', 'MANAGER', 'EDITOR']);

      if (req.method === 'DELETE' && segs[3]) {
        await db.execute('DELETE FROM products WHERE id = ? AND store_id = ?', [segs[3], storeId]);
        return NextResponse.json({ ok: true });
      }
      const data = productSchema.parse(body);
      const saved = await createOrUpdateProduct({
        storeId,
        productId: body.id ? String(body.id) : undefined,
        ...data,
      });
      return NextResponse.json(saved, { status: 201 });
    }

    if (segs[0] === 'stores' && segs[2] === 'categories' && segs[1]) {
      const user = await requireAuth();
      const storeId = segs[1];
      await requireStoreAccess(user, storeId, ['OWNER', 'MANAGER', 'EDITOR']);
      const data = categorySchema.parse(body);
      const id = generateUuid();
      await db.execute(
        'INSERT INTO categories (id, store_id, name, slug, description, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          id,
          storeId,
          data.name,
          data.slug || toSlug(data.name),
          data.description || null,
          data.sortOrder,
          db.engine === 'postgresql' ? data.isActive : data.isActive ? 1 : 0,
        ]
      );
      return NextResponse.json({ id }, { status: 201 });
    }

    if (segs[0] === 'stores' && segs[2] === 'coupons' && segs[1]) {
      const user = await requireAuth();
      const storeId = segs[1];
      await requireStoreAccess(user, storeId, ['OWNER', 'MANAGER']);
      const data = couponSchema.parse(body);
      const id = generateUuid();
      await db.execute(
        'INSERT INTO coupons (id, store_id, code, discount_type, discount_value, min_order_amount, max_uses, expires_at, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          id,
          storeId,
          data.code,
          data.discountType,
          data.discountValue.toFixed(2),
          data.minOrderAmount.toFixed(2),
          data.maxUses || null,
          data.expiresAt ? new Date(data.expiresAt) : null,
          db.engine === 'postgresql' ? data.isActive : data.isActive ? 1 : 0,
        ]
      );
      return NextResponse.json({ id }, { status: 201 });
    }

    if (segs[0] === 'stores' && segs[2] === 'domains' && segs[1]) {
      const user = await requireAuth();
      const storeId = segs[1];
      await requireStoreAccess(user, storeId, ['OWNER', 'MANAGER']);
      const data = domainAddSchema.parse({ ...body, storeId });
      const limits = await getStorePlanLimits(storeId);
      const cnt = await db.query<{ c: string | number }>(
        'SELECT COUNT(*) AS c FROM domains WHERE store_id = ?',
        [storeId]
      );
      if (Number(cnt.rows[0]?.c || 0) >= limits.maxCustomDomains && user.platform_role !== 'SUPER_ADMIN') {
        return NextResponse.json(
          { error: `Custom domain limit (${limits.maxCustomDomains}) reached for your plan.` },
          { status: 403 }
        );
      }
      const id = generateUuid();
      const token = `bongo-verify=${generateToken(16)}`;
      await db.execute(
        'INSERT INTO domains (id, store_id, hostname, is_primary, status, verification_token) VALUES (?, ?, ?, ?, ?, ?)',
        [
          id,
          storeId,
          data.hostname,
          db.engine === 'postgresql' ? data.isPrimary : data.isPrimary ? 1 : 0,
          'PENDING_DNS',
          token,
        ]
      );
      return NextResponse.json({ id, hostname: data.hostname, verificationToken: token }, { status: 201 });
    }

    if (segs[0] === 'stores' && segs[2] === 'orders' && segs[3]) {
      const user = await requireAuth();
      const storeId = segs[1];
      await requireStoreAccess(user, storeId, ['OWNER', 'MANAGER']);
      const allowed = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED'];
      if (!allowed.includes(body.status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
      }
      await db.execute('UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND store_id = ?', [
        body.status,
        new Date(),
        segs[3],
        storeId,
      ]);
      return NextResponse.json({ ok: true });
    }

    if (route === 'checkout') {
      if (!checkRateLimit(`checkout:${ip}`, 20, 60_000)) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
      }
      const data = checkoutSchema.parse(body);
      const order = await createOrderWithPayment(data);
      if (data.paymentMethod === 'OFFICIAL_BKASH') {
        const bkash = await initiateOfficialBkashPayment({
          paymentId: order.paymentId,
          amount: order.totalAmount,
          merchantInvoiceNumber: order.orderNumber,
          callbackUrl: `${process.env.APP_URL || 'http://localhost:3000'}/api/v1/payments/bkash-callback`,
        });
        return NextResponse.json({ ...order, bkash }, { status: 201 });
      }
      return NextResponse.json(order, { status: 201 });
    }

    if (segs[0] === 'payments' && segs[2] === 'verify' && segs[1]) {
      const user = await requireAuth();
      const payRes = await db.query<{ purpose: string; store_id: string }>(
        'SELECT purpose, store_id FROM payments WHERE id = ?',
        [segs[1]]
      );
      const pay = payRes.rows[0];
      if (!pay) return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
      if (pay.purpose === 'STORE_SUBSCRIPTION') {
        await requireSuperAdmin();
      } else {
        await requireStoreAccess(user, pay.store_id, ['OWNER', 'MANAGER']);
      }
      await verifyManualPayment({
        paymentId: segs[1],
        actorUserId: user.id,
        decision: body.decision === 'REJECT' ? 'REJECT' : 'APPROVE',
        reason: body.reason,
      });
      return NextResponse.json({ ok: true });
    }

    if (route === 'subscriptions/upgrade') {
      const user = await requireAuth();
      const storeId = String(body.storeId || '');
      const planCode = String(body.planCode || '');
      await requireStoreAccess(user, storeId, ['OWNER']);

      const planRes = await db.query<{ id: string; price_monthly: string }>(
        'SELECT id, price_monthly FROM subscription_plans WHERE code = ? LIMIT 1',
        [planCode]
      );
      const plan = planRes.rows[0];
      if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

      const subId = generateUuid();
      const invId = generateUuid();
      const payId = generateUuid();
      const invNumber = `INV-${Date.now()}`;

      await db.transaction(async (tx) => {
        await tx.execute(
          `INSERT INTO store_subscriptions (id, store_id, plan_id, status, billing_cycle) VALUES (?, ?, ?, 'PENDING', 'MONTHLY')`,
          [subId, storeId, plan.id]
        );
        await tx.execute(
          `INSERT INTO subscription_invoices (id, store_id, subscription_id, invoice_number, amount, currency, status, due_at) VALUES (?, ?, ?, ?, ?, 'BDT', 'PENDING', ?)`,
          [invId, storeId, subId, invNumber, plan.price_monthly, new Date(Date.now() + 3 * 86400_000)]
        );
        await tx.execute(
          `INSERT INTO payments (id, purpose, store_id, invoice_id, method, gateway, trx_id, sender_number, amount, currency, status) VALUES (?, 'STORE_SUBSCRIPTION', ?, ?, 'MANUAL_BKASH', 'bkash', ?, ?, ?, 'BDT', 'PENDING_VERIFICATION')`,
          [
            payId,
            storeId,
            invId,
            String(body.trxId || '').trim(),
            String(body.senderNumber || '').trim(),
            plan.price_monthly,
          ]
        );
      });

      return NextResponse.json({ subscriptionId: subId, invoiceNumber: invNumber, paymentId: payId }, { status: 201 });
    }

    if (route === 'ai/analyze') {
      if (!checkRateLimit(`ai:${ip}`, 12, 60_000)) {
        return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
      }
      const data = aiAnalyzeSchema.parse(body);
      const result = await analyzeWebsiteSafely(data.url, currentUser?.id);
      return NextResponse.json(result);
    }

    if (route === 'ai/chat') {
      const data = aiChatSchema.parse(body);
      const reply = await answerGroundedQuestion(data);
      return NextResponse.json(reply);
    }

    if (segs[0] === 'super-admin' && segs[1] === 'stores' && segs[3] === 'status') {
      const admin = await requireSuperAdmin();
      const status = String(body.status || 'ACTIVE');
      if (!['ACTIVE', 'SUSPENDED', 'PENDING', 'ARCHIVED'].includes(status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
      }
      await db.execute('UPDATE stores SET status = ?, updated_at = ? WHERE id = ?', [
        status,
        new Date(),
        segs[2],
      ]);
      await writeAuditLog({
        actorUserId: admin.id,
        storeId: segs[2],
        action: `STORE_${status}`,
        targetType: 'store',
        targetId: segs[2],
      });
      return NextResponse.json({ ok: true });
    }

    if (segs[0] === 'super-admin' && segs[1] === 'domains' && segs[3] === 'verify') {
      const admin = await requireSuperAdmin();
      const status = body.status === 'FAILED' ? 'FAILED' : 'VERIFIED';
      await db.execute('UPDATE domains SET status = ?, verified_at = ? WHERE id = ?', [
        status,
        status === 'VERIFIED' ? new Date() : null,
        segs[2],
      ]);
      await writeAuditLog({
        actorUserId: admin.id,
        action: `DOMAIN_${status}`,
        targetType: 'domain',
        targetId: segs[2],
      });
      return NextResponse.json({ ok: true });
    }

    if (route === 'super-admin/database/test') {
      await requireSuperAdmin();
      const cfg = dbConfigSchema.parse(body);
      const result = await testDatabaseConnection(cfg);
      return NextResponse.json(result);
    }

    if (route === 'super-admin/database/migrate') {
      const admin = await requireSuperAdmin();
      const res = await runMigrations();
      await writeAuditLog({
        actorUserId: admin.id,
        action: 'DB_MIGRATION_RUN',
        targetType: 'database',
        metadata: res,
      });
      return NextResponse.json(res);
    }

    if (route === 'super-admin/database/switch') {
      if (!checkRateLimit(`dbswitch:${ip}`, 3, 300_000)) {
        return NextResponse.json({ error: 'Too many switch attempts' }, { status: 429 });
      }
      const admin = await requireSuperAdmin();
      const data = dbSwitchRequestSchema.parse(body);

      const adminRow = await db.query<{ password_hash: string }>(
        'SELECT password_hash FROM users WHERE id = ? LIMIT 1',
        [admin.id]
      );
      if (!adminRow.rows[0] || !verifyPassword(data.reauthPassword, adminRow.rows[0].password_hash)) {
        return NextResponse.json({ error: 'Re-authentication password is incorrect' }, { status: 403 });
      }

      const result = await executeZeroDataLossDbSwitch(
        {
          engine: data.engine,
          host: data.host,
          port: data.port,
          database: data.database,
          username: data.username,
          password: data.password,
          ssl: data.ssl,
        },
        admin.id
      );
      return NextResponse.json(result, { status: result.success ? 200 : 500 });
    }

    if (route === 'super-admin/backups') {
      const admin = await requireSuperAdmin();
      const backup = await createEncryptedDatabaseBackup(admin.id);
      return NextResponse.json(backup, { status: 201 });
    }

    if (route === 'super-admin/backups/restore') {
      const admin = await requireSuperAdmin();
      const result = await restoreEncryptedBackup(String(body.filename || ''), admin.id);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: 'Endpoint not found' }, { status: 404 });
  } catch (err) {
    return handleError(err);
  }
}

export const POST = handleMutation;
export const PATCH = handleMutation;
export const DELETE = handleMutation;
