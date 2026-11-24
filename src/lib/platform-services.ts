import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import zlib from 'node:zlib';
import * as cheerio from 'cheerio';
import {
  createAdapterFromConfig,
  getActiveDatabaseConfig,
  getDb,
  reloadActiveDatabasePool,
  saveActiveDatabaseConfig,
  setWriteFrozen,
  testDatabaseConnection,
} from '@/db/adapter';
import { runMigrations } from '@/db/migrator';
import { writeAuditLog } from '@/lib/auth';
import { decryptSecret, encryptSecret, generateToken, generateUuid, sha256Hex } from '@/lib/security/crypto';
import { isReservedSlug, sanitizeRichText, toSlug } from '@/lib/validation/schemas';
import type {
  BackupMetadata,
  BuilderBlock,
  DatabaseConnectionConfig,
  MigrationStepReport,
  PlanLimits,
  StoreThemeConfig,
  VerifiedWebsiteAnalysis,
} from '@/types/platform';

const DEFAULT_THEME: StoreThemeConfig = {
  primaryColor: '#4f46e5',
  secondaryColor: '#0f172a',
  backgroundColor: '#ffffff',
  textColor: '#0f172a',
  fontFamily: 'noto-bengali',
  headerStyle: 'classic',
  footerText: 'Powered by BongoCommerce SaaS',
  showSearch: true,
  showCategories: true,
};

function defaultHomepageBlocks(storeName: string, tagline?: string): BuilderBlock[] {
  return [
    {
      id: 'hero-1',
      type: 'hero',
      enabled: true,
      title: `স্বাগতম ${storeName}-এ`,
      subtitle: tagline || 'আপনার বিশ্বস্ত অনলাইন শপ — সেরা মানের পণ্য এখন এক ক্লিকেই।',
      ctaText: 'পণ্য দেখুন',
      ctaUrl: '#products',
    },
    {
      id: 'products-1',
      type: 'product_grid',
      enabled: true,
      title: 'আমাদের জনপ্রিয় পণ্যসমূহ',
      columns: 4,
      limit: 12,
    },
    {
      id: 'contact-1',
      type: 'contact_info',
      enabled: true,
      title: 'যোগাযোগ করুন',
      subtitle: 'যেকোনো তথ্যের জন্য আমাদের সাথে যোগাযোগ করুন।',
    },
  ];
}

function boolVal(val: boolean): boolean | number {
  return getDb().engine === 'postgresql' ? val : val ? 1 : 0;
}

export async function generateUniqueStoreSlug(baseName: string): Promise<string> {
  const db = getDb();
  let base = toSlug(baseName);
  if (isReservedSlug(base)) base = `${base}-shop`;

  let candidate = base;
  let counter = 1;
  while (true) {
    const existing = await db.query<{ id: string }>('SELECT id FROM stores WHERE slug = ? LIMIT 1', [
      candidate,
    ]);
    if (existing.rows.length === 0 && !isReservedSlug(candidate)) {
      return candidate;
    }
    counter += 1;
    candidate = `${base}-${counter}`;
  }
}

export async function generateUniqueGlobalAlias(baseName: string): Promise<string> {
  const db = getDb();
  let base = toSlug(baseName);
  if (isReservedSlug(base)) base = `item-${base}`;
  let candidate = base;
  let counter = 1;
  while (true) {
    const [p, s] = await Promise.all([
      db.query<{ id: string }>('SELECT id FROM products WHERE global_alias = ? LIMIT 1', [candidate]),
      db.query<{ id: string }>('SELECT id FROM stores WHERE slug = ? LIMIT 1', [candidate]),
    ]);
    if (p.rows.length === 0 && s.rows.length === 0 && !isReservedSlug(candidate)) {
      return candidate;
    }
    counter += 1;
    candidate = `${base}-${counter}`;
  }
}

export async function getStorePlanLimits(storeId: string): Promise<PlanLimits> {
  const db = getDb();
  const res = await db.query<{ limits_json: string; status: string }>(
    `SELECT sp.limits_json, ss.status
     FROM store_subscriptions ss
     JOIN subscription_plans sp ON sp.id = ss.plan_id
     WHERE ss.store_id = ?
     ORDER BY ss.created_at DESC LIMIT 1`,
    [storeId]
  );
  if (res.rows[0]) {
    return JSON.parse(res.rows[0].limits_json) as PlanLimits;
  }
  return {
    maxProducts: 15,
    maxOrdersPerMonth: 50,
    maxStaff: 1,
    maxStorageMb: 100,
    maxCustomDomains: 0,
    allowAiAssistant: true,
    allowOfficialBkash: false,
  };
}

export async function createStoreWithDefaults(params: {
  ownerId: string;
  name: string;
  slug?: string;
  tagline?: string;
  description?: string;
  contactEmail?: string;
  contactPhone?: string;
  isPublished?: boolean;
  approvedByAdmin?: boolean;
}): Promise<{ storeId: string; slug: string; storeUrl: string; adminUrl: string }> {
  const db = getDb();
  const storeId = generateUuid();
  const slug = params.slug
    ? await generateUniqueStoreSlug(params.slug)
    : await generateUniqueStoreSlug(params.name);
  const autoApprove =
    params.approvedByAdmin || String(process.env.SELF_SERVICE_AUTO_APPROVE || 'true') === 'true';
  const status = autoApprove ? 'ACTIVE' : 'PENDING';
  const isPublished = params.isPublished ?? true;

  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO stores (id, owner_id, name, slug, tagline, description, status, is_published, currency, contact_email, contact_phone, theme_config, homepage_blocks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'BDT', ?, ?, ?, ?)`,
      [
        storeId,
        params.ownerId,
        params.name,
        slug,
        params.tagline || `${params.name} - Official Online Shop`,
        params.description || `${params.name} online store built with BongoCommerce.`,
        status,
        db.engine === 'postgresql' ? isPublished : isPublished ? 1 : 0,
        params.contactEmail || null,
        params.contactPhone || null,
        JSON.stringify(DEFAULT_THEME),
        JSON.stringify(defaultHomepageBlocks(params.name, params.tagline)),
      ]
    );

    await tx.execute(
      `INSERT INTO store_members (id, store_id, user_id, role, permissions_json) VALUES (?, ?, ?, 'OWNER', '["*"]')`,
      [generateUuid(), storeId, params.ownerId]
    );

    const freePlan = await tx.query<{ id: string }>(
      `SELECT id FROM subscription_plans WHERE code = 'FREE' LIMIT 1`
    );
    if (freePlan.rows[0]) {
      await tx.execute(
        `INSERT INTO store_subscriptions (id, store_id, plan_id, status, billing_cycle, starts_at)
         VALUES (?, ?, ?, 'ACTIVE', 'MONTHLY', ?)`,
        [generateUuid(), storeId, freePlan.rows[0].id, new Date()]
      );
    }

    await tx.execute(
      `INSERT INTO store_pages (id, store_id, title, slug, blocks_json, is_published) VALUES (?, ?, 'About Us', 'about', ?, ?)`,
      [
        generateUuid(),
        storeId,
        JSON.stringify([
          {
            id: 'about-1',
            type: 'rich_text',
            enabled: true,
            title: 'আমাদের সম্পর্কে',
            content: `${params.name}-এ আপনাকে স্বাগতম।`,
          },
        ]),
        db.engine === 'postgresql' ? true : 1,
      ]
    );
  });

  await writeAuditLog({
    actorUserId: params.ownerId,
    storeId,
    action: 'STORE_CREATED',
    targetType: 'store',
    targetId: storeId,
    metadata: { slug, status },
  });

  return {
    storeId,
    slug,
    storeUrl: `/${slug}/`,
    adminUrl: `/dashboard?storeId=${storeId}`,
  };
}

export async function createOrUpdateProduct(params: {
  storeId: string;
  productId?: string;
  name: string;
  slug?: string;
  categoryId?: string | null;
  sku?: string;
  description: string;
  price: string | number;
  compareAtPrice?: string | number | null;
  stock: number;
  isDigital: boolean;
  digitalFileKey?: string | null;
  images: string[];
  seoTitle?: string;
  seoDescription?: string;
  isActive: boolean;
  createGlobalShortUrl?: boolean;
}): Promise<{ id: string; slug: string; globalAlias: string | null }> {
  const db = getDb();
  const limits = await getStorePlanLimits(params.storeId);

  if (!params.productId) {
    const countRes = await db.query<{ cnt: string | number }>(
      'SELECT COUNT(*) AS cnt FROM products WHERE store_id = ?',
      [params.storeId]
    );
    if (Number(countRes.rows[0]?.cnt || 0) >= limits.maxProducts) {
      throw new Error(`Plan limit reached: max ${limits.maxProducts} products allowed.`);
    }
  }

  const storeRes = await db.query<{ slug: string }>('SELECT slug FROM stores WHERE id = ? LIMIT 1', [
    params.storeId,
  ]);
  const storeSlug = storeRes.rows[0]?.slug || 'shop';
  let desiredSlug = toSlug(params.slug || params.name);

  if (params.productId) {
    const oldRes = await db.query<{ slug: string; global_alias: string | null }>(
      'SELECT slug, global_alias FROM products WHERE id = ? AND store_id = ? LIMIT 1',
      [params.productId, params.storeId]
    );
    const oldProd = oldRes.rows[0];
    if (!oldProd) throw new Error('Product not found in this store');

    if (oldProd.slug !== desiredSlug) {
      const clash = await db.query<{ id: string }>(
        'SELECT id FROM products WHERE store_id = ? AND slug = ? AND id <> ? LIMIT 1',
        [params.storeId, desiredSlug, params.productId]
      );
      if (clash.rows.length > 0) desiredSlug = `${desiredSlug}-${Date.now().toString().slice(-4)}`;

      await db.execute(
        `INSERT INTO url_redirects (id, store_id, old_path, new_path, status_code) VALUES (?, ?, ?, ?, 301)`,
        [generateUuid(), params.storeId, `/${storeSlug}/${oldProd.slug}`, `/${storeSlug}/${desiredSlug}`]
      );
    }

    await db.execute(
      `UPDATE products SET category_id=?, name=?, slug=?, sku=?, description=?, price=?, compare_at_price=?, stock=?, is_digital=?, digital_file_key=?, images_json=?, seo_title=?, seo_description=?, is_active=?, updated_at=?
       WHERE id = ? AND store_id = ?`,
      [
        params.categoryId || null,
        params.name,
        desiredSlug,
        params.sku || null,
        sanitizeRichText(params.description),
        Number(params.price).toFixed(2),
        params.compareAtPrice != null ? Number(params.compareAtPrice).toFixed(2) : null,
        params.stock,
        boolVal(params.isDigital),
        params.digitalFileKey || null,
        JSON.stringify(params.images),
        params.seoTitle || params.name,
        params.seoDescription || null,
        boolVal(params.isActive),
        new Date(),
        params.productId,
        params.storeId,
      ]
    );

    return { id: params.productId, slug: desiredSlug, globalAlias: oldProd.global_alias };
  }

  const clash = await db.query<{ id: string }>(
    'SELECT id FROM products WHERE store_id = ? AND slug = ? LIMIT 1',
    [params.storeId, desiredSlug]
  );
  if (clash.rows.length > 0) desiredSlug = `${desiredSlug}-${Date.now().toString().slice(-4)}`;

  const globalAlias =
    params.createGlobalShortUrl !== false ? await generateUniqueGlobalAlias(params.name) : null;
  const id = generateUuid();

  await db.execute(
    `INSERT INTO products (id, store_id, category_id, name, slug, global_alias, sku, description, price, compare_at_price, stock, is_digital, digital_file_key, images_json, seo_title, seo_description, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      params.storeId,
      params.categoryId || null,
      params.name,
      desiredSlug,
      globalAlias,
      params.sku || null,
      sanitizeRichText(params.description),
      Number(params.price).toFixed(2),
      params.compareAtPrice != null ? Number(params.compareAtPrice).toFixed(2) : null,
      params.stock,
      boolVal(params.isDigital),
      params.digitalFileKey || null,
      JSON.stringify(params.images),
      params.seoTitle || params.name,
      params.seoDescription || null,
      boolVal(params.isActive),
    ]
  );

  return { id, slug: desiredSlug, globalAlias };
}

export async function createOrderWithPayment(input: {
  storeId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  shippingAddress: string;
  couponCode?: string;
  paymentMethod: 'MANUAL_BKASH' | 'OFFICIAL_BKASH' | 'CASH_ON_DELIVERY';
  manualBkash?: { trxId: string; senderNumber: string };
  notes?: string;
  items: Array<{ productId: string; quantity: number }>;
}): Promise<{
  orderId: string;
  orderNumber: string;
  totalAmount: string;
  paymentId: string;
  paymentStatus: string;
  bkashRedirectUrl?: string;
}> {
  const db = getDb();

  if (
    input.paymentMethod === 'MANUAL_BKASH' &&
    (!input.manualBkash?.trxId || !input.manualBkash?.senderNumber)
  ) {
    throw new Error('Manual bKash requires Transaction ID and Sender Number');
  }

  return db.transaction(async (tx) => {
    let subtotal = 0;
    const resolvedItems: Array<{
      productId: string;
      name: string;
      price: number;
      quantity: number;
      isDigital: boolean;
    }> = [];

    for (const item of input.items) {
      const pRes = await tx.query<{
        id: string;
        name: string;
        price: string;
        stock: number;
        is_digital: boolean | number;
        is_active: boolean | number;
      }>(
        'SELECT id, name, price, stock, is_digital, is_active FROM products WHERE id = ? AND store_id = ? LIMIT 1',
        [item.productId, input.storeId]
      );
      const prod = pRes.rows[0];
      if (!prod || !prod.is_active) throw new Error('One or more products are unavailable');
      if (!prod.is_digital && prod.stock < item.quantity) {
        throw new Error(`Insufficient stock for ${prod.name}`);
      }
      const unit = Number(prod.price);
      subtotal += unit * item.quantity;
      resolvedItems.push({
        productId: prod.id,
        name: prod.name,
        price: unit,
        quantity: item.quantity,
        isDigital: Boolean(prod.is_digital),
      });

      if (!prod.is_digital) {
        await tx.execute('UPDATE products SET stock = stock - ? WHERE id = ? AND store_id = ?', [
          item.quantity,
          prod.id,
          input.storeId,
        ]);
      }
    }

    let discount = 0;
    if (input.couponCode) {
      const cRes = await tx.query<{
        id: string;
        discount_type: 'PERCENT' | 'FIXED';
        discount_value: string;
        min_order_amount: string;
        max_uses: number | null;
        used_count: number;
        expires_at: string | null;
        is_active: boolean | number;
      }>('SELECT * FROM coupons WHERE store_id = ? AND code = ? LIMIT 1', [
        input.storeId,
        input.couponCode.toUpperCase(),
      ]);
      const c = cRes.rows[0];
      if (c && c.is_active && subtotal >= Number(c.min_order_amount)) {
        if (
          (!c.expires_at || new Date(c.expires_at) > new Date()) &&
          (!c.max_uses || c.used_count < c.max_uses)
        ) {
          discount =
            c.discount_type === 'PERCENT'
              ? (subtotal * Number(c.discount_value)) / 100
              : Number(c.discount_value);
          discount = Math.min(discount, subtotal);
          await tx.execute('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?', [c.id]);
        }
      }
    }

    const total = Math.max(0, subtotal - discount);
    const orderId = generateUuid();
    const orderNumber = `ORD-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;

    let customerId: string;
    const custRes = await tx.query<{ id: string }>(
      'SELECT id FROM customers WHERE store_id = ? AND email = ? LIMIT 1',
      [input.storeId, input.customerEmail]
    );
    if (custRes.rows[0]) {
      customerId = custRes.rows[0].id;
    } else {
      customerId = generateUuid();
      await tx.execute(
        'INSERT INTO customers (id, store_id, name, email, phone, address) VALUES (?, ?, ?, ?, ?, ?)',
        [
          customerId,
          input.storeId,
          input.customerName,
          input.customerEmail,
          input.customerPhone,
          input.shippingAddress,
        ]
      );
    }

    const initialPayStatus =
      input.paymentMethod === 'MANUAL_BKASH' ? 'PENDING_VERIFICATION' : 'PENDING';

    await tx.execute(
      `INSERT INTO orders (id, store_id, customer_id, order_number, customer_name, customer_email, customer_phone, shipping_address, subtotal, discount_amount, shipping_fee, total_amount, currency, coupon_code, status, payment_status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.00, ?, 'BDT', ?, 'PENDING', ?, ?)`,
      [
        orderId,
        input.storeId,
        customerId,
        orderNumber,
        input.customerName,
        input.customerEmail,
        input.customerPhone,
        input.shippingAddress,
        subtotal.toFixed(2),
        discount.toFixed(2),
        total.toFixed(2),
        input.couponCode || null,
        initialPayStatus,
        input.notes || null,
      ]
    );

    for (const ri of resolvedItems) {
      await tx.execute(
        `INSERT INTO order_items (id, order_id, store_id, product_id, product_name, unit_price, quantity, line_total, is_digital, digital_download_token)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          generateUuid(),
          orderId,
          input.storeId,
          ri.productId,
          ri.name,
          ri.price.toFixed(2),
          ri.quantity,
          (ri.price * ri.quantity).toFixed(2),
          tx.engine === 'postgresql' ? ri.isDigital : ri.isDigital ? 1 : 0,
          ri.isDigital ? generateToken(24) : null,
        ]
      );
    }

    const paymentId = generateUuid();
    await tx.execute(
      `INSERT INTO payments (id, purpose, store_id, order_id, method, gateway, trx_id, sender_number, amount, currency, status, idempotency_key)
       VALUES (?, 'STORE_ORDER', ?, ?, ?, ?, ?, ?, ?, 'BDT', ?, ?)`,
      [
        paymentId,
        input.storeId,
        orderId,
        input.paymentMethod,
        input.paymentMethod === 'CASH_ON_DELIVERY' ? 'cod' : 'bkash',
        input.manualBkash?.trxId?.trim() || null,
        input.manualBkash?.senderNumber?.trim() || null,
        total.toFixed(2),
        initialPayStatus,
        `ord_${orderId}`,
      ]
    );

    return {
      orderId,
      orderNumber,
      totalAmount: total.toFixed(2),
      paymentId,
      paymentStatus: initialPayStatus,
    };
  });
}

export async function verifyManualPayment(params: {
  paymentId: string;
  actorUserId: string;
  decision: 'APPROVE' | 'REJECT';
  reason?: string;
}): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const pRes = await tx.query<{
      id: string;
      purpose: 'STORE_ORDER' | 'STORE_SUBSCRIPTION';
      store_id: string;
      order_id: string | null;
      invoice_id: string | null;
      status: string;
    }>('SELECT id, purpose, store_id, order_id, invoice_id, status FROM payments WHERE id = ? LIMIT 1', [
      params.paymentId,
    ]);
    const pay = pRes.rows[0];
    if (!pay) throw new Error('Payment not found');
    if (pay.status === 'PAID') throw new Error('Payment already verified as PAID');

    const newStatus = params.decision === 'APPROVE' ? 'PAID' : 'REJECTED';
    await tx.execute(
      'UPDATE payments SET status = ?, verified_by = ?, verified_at = ?, rejection_reason = ?, updated_at = ? WHERE id = ?',
      [newStatus, params.actorUserId, new Date(), params.reason || null, new Date(), pay.id]
    );

    if (pay.purpose === 'STORE_ORDER' && pay.order_id) {
      await tx.execute(
        'UPDATE orders SET payment_status = ?, status = ?, updated_at = ? WHERE id = ? AND store_id = ?',
        [
          newStatus,
          params.decision === 'APPROVE' ? 'CONFIRMED' : 'PENDING',
          new Date(),
          pay.order_id,
          pay.store_id,
        ]
      );
    } else if (pay.purpose === 'STORE_SUBSCRIPTION' && pay.invoice_id) {
      if (params.decision === 'APPROVE') {
        await tx.execute("UPDATE subscription_invoices SET status = 'PAID', paid_at = ? WHERE id = ?", [
          new Date(),
          pay.invoice_id,
        ]);
        const inv = await tx.query<{ subscription_id: string }>(
          'SELECT subscription_id FROM subscription_invoices WHERE id = ?',
          [pay.invoice_id]
        );
        if (inv.rows[0]) {
          const nextMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
          await tx.execute(
            "UPDATE store_subscriptions SET status = 'ACTIVE', ends_at = ?, updated_at = ? WHERE id = ?",
            [nextMonth, new Date(), inv.rows[0].subscription_id]
          );
        }
      }
    }
  });

  await writeAuditLog({
    actorUserId: params.actorUserId,
    action: `PAYMENT_${params.decision}`,
    targetType: 'payment',
    targetId: params.paymentId,
    metadata: { reason: params.reason },
  });
}

export async function initiateOfficialBkashPayment(params: {
  paymentId: string;
  amount: string;
  merchantInvoiceNumber: string;
  callbackUrl: string;
}): Promise<{ configured: boolean; bkashURL?: string; paymentID?: string; message: string }> {
  const appKey = process.env.BKASH_APP_KEY;
  const appSecret = process.env.BKASH_APP_SECRET;
  const username = process.env.BKASH_USERNAME;
  const password = process.env.BKASH_PASSWORD;
  const baseUrl = process.env.BKASH_BASE_URL || 'https://tokenized.sandbox.bka.sh/v1.2.0-beta';

  if (!appKey || !appSecret || !username || !password) {
    return {
      configured: false,
      message:
        'Official bKash credentials are not configured in .env. Please set BKASH_APP_KEY, BKASH_APP_SECRET, BKASH_USERNAME, and BKASH_PASSWORD or use Manual bKash.',
    };
  }

  const tokenRes = await fetch(`${baseUrl}/tokenized/checkout/token/grant`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      username,
      password,
    },
    body: JSON.stringify({ app_key: appKey, app_secret: appSecret }),
  });

  const tokenData = (await tokenRes.json()) as { id_token?: string; statusMessage?: string };
  if (!tokenData.id_token) {
    throw new Error(`bKash token grant failed: ${tokenData.statusMessage || 'Unknown error'}`);
  }

  const createRes = await fetch(`${baseUrl}/tokenized/checkout/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: tokenData.id_token,
      'X-APP-Key': appKey,
    },
    body: JSON.stringify({
      mode: '0011',
      payerReference: params.merchantInvoiceNumber,
      callbackURL: params.callbackUrl,
      amount: params.amount,
      currency: 'BDT',
      intent: 'sale',
      merchantInvoiceNumber: params.merchantInvoiceNumber,
    }),
  });

  const createData = (await createRes.json()) as {
    bkashURL?: string;
    paymentID?: string;
    statusMessage?: string;
  };
  if (!createData.bkashURL || !createData.paymentID) {
    throw new Error(`bKash create payment failed: ${createData.statusMessage || 'Unknown error'}`);
  }

  const db = getDb();
  await db.execute('UPDATE payments SET gateway_payment_id = ?, raw_payload_json = ? WHERE id = ?', [
    createData.paymentID,
    JSON.stringify(createData),
    params.paymentId,
  ]);

  return {
    configured: true,
    bkashURL: createData.bkashURL,
    paymentID: createData.paymentID,
    message: 'Redirect user to bkashURL to complete payment.',
  };
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    return (
      lower === '::1' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      lower.startsWith('fe80') ||
      lower.startsWith('::ffff:127.') ||
      lower.startsWith('::ffff:10.') ||
      lower.startsWith('::ffff:192.168.')
    );
  }
  return true;
}

async function assertSafePublicUrl(rawUrl: string): Promise<URL> {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS protocols are permitted');
  }
  const hostname = parsed.hostname;
  if (!hostname || hostname === 'localhost') {
    throw new Error('Localhost and internal addresses are blocked');
  }
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error('Private/internal IP addresses are blocked (SSRF protection)');
    }
    return parsed;
  }
  const records = await dns.lookup(hostname, { all: true });
  if (records.length === 0) throw new Error('Hostname could not be resolved');
  for (const r of records) {
    if (isPrivateIp(r.address)) {
      throw new Error('Resolved IP belongs to a private or reserved network (SSRF protection)');
    }
  }
  return parsed;
}

export async function analyzeWebsiteSafely(rawUrl: string, userId?: string | null): Promise<{
  analysisId: string;
  analysis: VerifiedWebsiteAnalysis;
}> {
  let currentUrl = (await assertSafePublicUrl(rawUrl)).toString();
  let response: Response | null = null;

  for (let hop = 0; hop < 3; hop++) {
    await assertSafePublicUrl(currentUrl);
    response = await fetch(currentUrl, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
      headers: {
        'User-Agent': 'BongoCommerce-Analyzer/1.0 (Public-Metadata-Reader)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const loc = response.headers.get('location');
      if (!loc) break;
      currentUrl = new URL(loc, currentUrl).toString();
      continue;
    }
    break;
  }

  const analysisId = generateUuid();
  if (!response || !response.ok) {
    const blocked: VerifiedWebsiteAnalysis = {
      url: rawUrl,
      finalUrl: currentUrl,
      accessible: false,
      statusCode: response?.status || 0,
      blockedReason: `Website returned HTTP ${response?.status || 'Network Error'}. Protected or inaccessible sites are never bypassed.`,
      websiteName: null,
      title: null,
      description: null,
      category: null,
      branding: { logoUrl: null, themeColor: null },
      navigationLinks: [],
      contactInfo: { emails: [], phones: [] },
      products: [],
      seo: { canonical: null, ogTitle: null, ogDescription: null },
      analyzedAt: new Date().toISOString(),
    };
    await getDb().execute(
      `INSERT INTO ai_website_analyses (id, user_id, target_url, final_url, accessible, status_code, verified_data_json, ai_summary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        analysisId,
        userId || null,
        rawUrl,
        currentUrl,
        boolVal(false),
        blocked.statusCode,
        JSON.stringify(blocked),
        blocked.blockedReason,
      ]
    );
    return { analysisId, analysis: blocked };
  }

  const text = (await response.text()).slice(0, 1_500_000);
  const $ = cheerio.load(text);
  $('script:not([type="application/ld+json"]), style, noscript').remove();

  const title = $('title').first().text().trim() || null;
  const ogTitle = $('meta[property="og:title"]').attr('content')?.trim() || null;
  const ogDesc =
    $('meta[property="og:description"]').attr('content')?.trim() ||
    $('meta[name="description"]').attr('content')?.trim() ||
    null;
  const siteName = $('meta[property="og:site_name"]').attr('content')?.trim() || title;
  const themeColor = $('meta[name="theme-color"]').attr('content')?.trim() || null;
  const canonical = $('link[rel="canonical"]').attr('href')?.trim() || null;
  const logoRaw =
    $('meta[property="og:image"]').attr('content') ||
    $('link[rel="icon"]').attr('href') ||
    $('img[alt*="logo" i]').first().attr('src') ||
    null;
  const logoUrl = logoRaw ? new URL(logoRaw, currentUrl).toString() : null;

  const navigationLinks: Array<{ label: string; url: string }> = [];
  $('header a, nav a')
    .slice(0, 15)
    .each((_, el) => {
      const label = $(el).text().trim();
      const href = $(el).attr('href');
      if (label && href && !href.startsWith('javascript:')) {
        try {
          navigationLinks.push({
            label: label.slice(0, 60),
            url: new URL(href, currentUrl).toString(),
          });
        } catch {
          // ignore invalid link
        }
      }
    });

  const bodyText = $('body').text();
  const emails = Array.from(
    new Set(bodyText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [])
  ).slice(0, 5);
  const phones = Array.from(new Set(bodyText.match(/(?:\+?880|0)1[3-9]\d{8}/g) || [])).slice(0, 5);

  const products: VerifiedWebsiteAnalysis['products'] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).html() || '{}');
      const items = Array.isArray(json) ? json : json['@graph'] ? json['@graph'] : [json];
      for (const item of items) {
        if (item?.['@type'] === 'Product' && item?.name) {
          const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
          products.push({
            name: String(item.name).slice(0, 160),
            price: offer?.price != null ? String(offer.price) : null,
            currency: offer?.priceCurrency || null,
            description: item.description ? String(item.description).slice(0, 300) : null,
            imageUrl:
              typeof item.image === 'string'
                ? item.image
                : Array.isArray(item.image)
                ? item.image[0]
                : null,
            productUrl: item.url ? new URL(item.url, currentUrl).toString() : currentUrl,
            category: item.category ? String(item.category) : null,
            source: 'json-ld',
          });
        }
      }
    } catch {
      // ignore invalid json-ld
    }
  });

  if (products.length === 0) {
    $('[class*="product" i], article')
      .slice(0, 12)
      .each((_, el) => {
        const name = $(el).find('h2, h3, h4, [class*="title" i]').first().text().trim();
        const priceMatch = $(el).text().match(/(?:৳|BDT|Tk\.?|USD|\$)\s?[\d,]+(?:\.\d{1,2})?/i);
        const href = $(el).find('a').first().attr('href');
        const img = $(el).find('img').first().attr('src');
        if (name && name.length >= 3) {
          products.push({
            name: name.slice(0, 140),
            price: priceMatch ? priceMatch[0] : null,
            currency: null,
            description: null,
            imageUrl: img ? new URL(img, currentUrl).toString() : null,
            productUrl: href ? new URL(href, currentUrl).toString() : currentUrl,
            category: null,
            source: 'dom-heuristic',
          });
        }
      });
  }

  const analysis: VerifiedWebsiteAnalysis = {
    url: rawUrl,
    finalUrl: currentUrl,
    accessible: true,
    statusCode: response.status,
    websiteName: siteName,
    title,
    description: ogDesc,
    category: products.length > 0 ? 'E-Commerce / Online Store' : 'General Website',
    branding: { logoUrl, themeColor },
    navigationLinks,
    contactInfo: { emails, phones },
    products: products.slice(0, 20),
    seo: { canonical, ogTitle, ogDescription: ogDesc },
    analyzedAt: new Date().toISOString(),
  };

  await getDb().execute(
    `INSERT INTO ai_website_analyses (id, user_id, target_url, final_url, accessible, status_code, verified_data_json, ai_summary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      analysisId,
      userId || null,
      rawUrl,
      currentUrl,
      boolVal(true),
      response.status,
      JSON.stringify(analysis),
      `Verified ${analysis.products.length} product(s) from ${currentUrl}`,
    ]
  );

  return { analysisId, analysis };
}

export async function answerGroundedQuestion(params: {
  analysisId?: string;
  storeId?: string;
  question: string;
  language: 'bn' | 'en';
}): Promise<{ answer: string; sourceType: 'VERIFIED_DATA' | 'AI_WITH_VERIFIED_DATA'; hasWebsite: boolean }> {
  const db = getDb();
  let contextData: Record<string, unknown> = {};

  if (params.analysisId) {
    const res = await db.query<{ verified_data_json: string; accessible: boolean | number }>(
      'SELECT verified_data_json, accessible FROM ai_website_analyses WHERE id = ? LIMIT 1',
      [params.analysisId]
    );
    if (res.rows[0]) {
      contextData = JSON.parse(res.rows[0].verified_data_json);
    }
  } else if (params.storeId) {
    const [storeRes, prodRes] = await Promise.all([
      db.query('SELECT id, name, slug, contact_email, contact_phone FROM stores WHERE id = ? LIMIT 1', [
        params.storeId,
      ]),
      db.query(
        'SELECT name, slug, price, stock FROM products WHERE store_id = ? AND is_active = ? LIMIT 30',
        [params.storeId, boolVal(true)]
      ),
    ]);
    contextData = { store: storeRes.rows[0], products: prodRes.rows };
  }

  const aiKey = process.env.AI_API_KEY;
  if (!aiKey || process.env.AI_PROVIDER === 'none') {
    const analysis = contextData as Partial<VerifiedWebsiteAnalysis>;
    if (params.analysisId && analysis.accessible === false) {
      return {
        sourceType: 'VERIFIED_DATA',
        hasWebsite: false,
        answer:
          params.language === 'bn'
            ? `এই ওয়েবসাইটটি অ্যাক্সেস করা যায়নি (${analysis.blockedReason || 'Blocked'})। আপনার নিজের কোনো Website নেই? চিন্তা নেই! আপনার নাম দিয়ে এক ক্লিকেই নিজের Online Shop তৈরি করুন ("CREATE MY SHOP" বাটনে ক্লিক করে)।`
            : `This website could not be accessed. Don't have a website? Click "CREATE MY SHOP" to launch your own store in one click!`,
      };
    }

    const prods: Array<{ name: string; price?: string | null }> =
      analysis.products ||
      (contextData.products as Array<{ name: string; price?: string | null }>) ||
      [];

    const listText =
      prods.length > 0
        ? prods
            .slice(0, 8)
            .map((p, idx) => `${idx + 1}. ${p.name} — দাম: ${p.price || 'উল্লেখ নেই'}`)
            .join('\n')
        : params.language === 'bn'
        ? 'এই পেজে সরাসরি যাচাইযোগ্য কোনো প্রোডাক্ট পাওয়া যায়নি।'
        : 'No verifiable products found on this page.';

    return {
      sourceType: 'VERIFIED_DATA',
      hasWebsite: true,
      answer:
        params.language === 'bn'
          ? `যাচাইকৃত তথ্য (${analysis.finalUrl || 'Store DB'}):\n${listText}\n\n(শপ লিংক: ${analysis.finalUrl || '/'})`
          : `Verified Data:\n${listText}`,
    };
  }

  const baseUrl = process.env.AI_BASE_URL || 'https://api.openai.com/v1';
  const model = process.env.AI_MODEL || 'gpt-4o-mini';
  const llmRes = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content: `You are BongoCommerce Assistant. Reply in ${params.language === 'bn' ? 'Bangla' : 'English'}. ONLY state prices, products, and links present in the VERIFIED_JSON below. Never guess or fabricate prices or stock.`,
        },
        {
          role: 'user',
          content: `VERIFIED_JSON:\n${JSON.stringify(contextData).slice(0, 12000)}\n\nQUESTION: ${params.question}`,
        },
      ],
    }),
  });
  const llmJson = (await llmRes.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return {
    sourceType: 'AI_WITH_VERIFIED_DATA',
    hasWebsite: true,
    answer: llmJson.choices?.[0]?.message?.content || 'Unable to generate response.',
  };
}

const MIGRATION_TABLE_ORDER = [
  'users',
  'sessions',
  'subscription_plans',
  'stores',
  'store_members',
  'store_subscriptions',
  'subscription_invoices',
  'domains',
  'categories',
  'products',
  'url_redirects',
  'store_pages',
  'coupons',
  'customers',
  'orders',
  'order_items',
  'payments',
  'product_reviews',
  'wishlists',
  'notifications',
  'ai_website_analyses',
  'system_settings',
  'audit_logs',
  'background_jobs',
] as const;

const BACKUPS_DIR = path.resolve(
  process.cwd(),
  process.env.LOCAL_STORAGE_PATH || './storage',
  'backups'
);

export async function createEncryptedDatabaseBackup(createdBy: string): Promise<BackupMetadata> {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  const db = getDb();
  const { config } = getActiveDatabaseConfig();
  const snapshot: Record<string, Record<string, unknown>[]> = {};
  let totalRows = 0;

  for (const table of MIGRATION_TABLE_ORDER) {
    const res = await db.query(`SELECT * FROM ${table}`);
    snapshot[table] = res.rows;
    totalRows += res.rows.length;
  }

  const jsonBytes = Buffer.from(
    JSON.stringify({ engine: db.engine, exportedAt: new Date().toISOString(), tables: snapshot })
  );
  const compressed = zlib.gzipSync(jsonBytes);
  const sha256Checksum = sha256Hex(compressed);
  const encryptedPayload = encryptSecret(compressed.toString('base64'));

  const id = generateUuid();
  const filename = `backup-${db.engine}-${Date.now()}.bongo.enc`;
  const envelope = JSON.stringify({
    id,
    filename,
    engine: db.engine,
    databaseName: config.database,
    sha256Checksum,
    totalRows,
    createdAt: new Date().toISOString(),
    createdBy,
    payload: encryptedPayload,
  });
  fs.writeFileSync(path.join(BACKUPS_DIR, filename), envelope, { mode: 0o600 });

  await writeAuditLog({
    actorUserId: createdBy,
    action: 'BACKUP_CREATED',
    targetType: 'backup',
    targetId: filename,
    metadata: { totalRows, sha256Checksum },
  });

  return {
    id,
    filename,
    engine: db.engine,
    databaseName: config.database,
    sha256Checksum,
    encrypted: true,
    totalRows,
    sizeBytes: Buffer.byteLength(envelope),
    createdAt: new Date().toISOString(),
    createdBy,
  };
}

export function listBackups(): BackupMetadata[] {
  if (!fs.existsSync(BACKUPS_DIR)) return [];
  return fs
    .readdirSync(BACKUPS_DIR)
    .filter((f) => f.endsWith('.bongo.enc'))
    .map((file) => {
      const raw = JSON.parse(fs.readFileSync(path.join(BACKUPS_DIR, file), 'utf8'));
      return {
        id: raw.id,
        filename: raw.filename,
        engine: raw.engine,
        databaseName: raw.databaseName,
        sha256Checksum: raw.sha256Checksum,
        encrypted: true,
        totalRows: raw.totalRows,
        sizeBytes: fs.statSync(path.join(BACKUPS_DIR, file)).size,
        createdAt: raw.createdAt,
        createdBy: raw.createdBy,
      } as BackupMetadata;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function restoreEncryptedBackup(
  filename: string,
  actorUserId: string
): Promise<{ restoredRows: number }> {
  const safeName = path.basename(filename);
  const fullPath = path.join(BACKUPS_DIR, safeName);
  if (!fs.existsSync(fullPath)) throw new Error('Backup file not found');

  const envelope = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  const compressed = Buffer.from(decryptSecret(envelope.payload), 'base64');
  if (sha256Hex(compressed) !== envelope.sha256Checksum) {
    throw new Error('Backup integrity verification failed: SHA-256 checksum mismatch!');
  }

  await createEncryptedDatabaseBackup(actorUserId);

  const parsed = JSON.parse(zlib.gunzipSync(compressed).toString('utf8')) as {
    tables: Record<string, Record<string, unknown>[]>;
  };

  const db = getDb();
  let restoredRows = 0;

  setWriteFrozen(true);
  try {
    await db.transaction(async (tx) => {
      for (const table of [...MIGRATION_TABLE_ORDER].reverse()) {
        await tx.execute(`DELETE FROM ${table}`);
      }
      for (const table of MIGRATION_TABLE_ORDER) {
        const rows = parsed.tables[table] || [];
        for (const row of rows) {
          const cols = Object.keys(row);
          if (cols.length === 0) continue;
          const placeholders = cols.map(() => '?').join(', ');
          const vals = cols.map((c) => {
            const v = row[c];
            if (typeof v === 'boolean' && tx.engine !== 'postgresql') return v ? 1 : 0;
            return v;
          });
          await tx.execute(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`, vals);
          restoredRows += 1;
        }
      }
    });
  } finally {
    setWriteFrozen(false);
  }

  await writeAuditLog({
    actorUserId,
    action: 'BACKUP_RESTORED',
    targetType: 'backup',
    targetId: safeName,
    metadata: { restoredRows },
  });
  return { restoredRows };
}

export async function executeZeroDataLossDbSwitch(
  targetConfig: DatabaseConnectionConfig,
  actorUserId: string
): Promise<{ success: boolean; steps: MigrationStepReport[]; error?: string }> {
  const steps: MigrationStepReport[] = [];
  const logStep = (
    step: number,
    name: string,
    status: MigrationStepReport['status'],
    detail: string
  ) => {
    steps.push({ step, name, status, detail, timestamp: new Date().toISOString() });
  };

  const sourceDb = getDb();
  const targetDb = createAdapterFromConfig(targetConfig);

  try {
    const backup = await createEncryptedDatabaseBackup(actorUserId);
    logStep(1, 'Existing Database Backup', 'COMPLETED', `Backup ${backup.filename} (${backup.totalRows} rows)`);

    const connTest = await testDatabaseConnection(targetConfig);
    if (!connTest.ok) throw new Error(`Target connection failed: ${connTest.error}`);
    logStep(2, 'Target Connection Test', 'COMPLETED', `Connected to ${targetConfig.engine} (${connTest.version})`);

    await runMigrations(targetDb);
    logStep(3, 'Target Schema Preparation', 'COMPLETED', 'DDL migrations and plans verified on target');

    let copiedRows = 0;
    await targetDb.transaction(async (tx) => {
      for (const table of [...MIGRATION_TABLE_ORDER].reverse()) {
        await tx.execute(`DELETE FROM ${table}`);
      }
      for (const table of MIGRATION_TABLE_ORDER) {
        const srcRows = await sourceDb.query(`SELECT * FROM ${table}`);
        for (const row of srcRows.rows) {
          const cols = Object.keys(row);
          if (cols.length === 0) continue;
          const placeholders = cols.map(() => '?').join(', ');
          const vals = cols.map((c) => {
            const v = row[c];
            if (typeof v === 'boolean' && tx.engine !== 'postgresql') return v ? 1 : 0;
            if (
              (c === 'is_active' ||
                c === 'is_published' ||
                c === 'is_digital' ||
                c === 'is_primary' ||
                c === 'is_read' ||
                c === 'is_approved' ||
                c === 'accessible' ||
                c === 'is_secret' ||
                c === 'auto_renew') &&
              tx.engine === 'postgresql'
            ) {
              return Boolean(v);
            }
            return v;
          });
          await tx.execute(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`, vals);
          copiedRows += 1;
        }
      }
    });
    logStep(4, 'Initial Data Migration', 'COMPLETED', `Copied ${copiedRows} rows in FK order`);

    for (const table of MIGRATION_TABLE_ORDER) {
      const [sCnt, tCnt] = await Promise.all([
        sourceDb.query<{ c: string | number }>(`SELECT COUNT(*) AS c FROM ${table}`),
        targetDb.query<{ c: string | number }>(`SELECT COUNT(*) AS c FROM ${table}`),
      ]);
      if (Number(sCnt.rows[0]?.c || 0) !== Number(tCnt.rows[0]?.c || 0)) {
        throw new Error(`Row count mismatch on table ${table}`);
      }
    }
    const [sPaySum, tPaySum] = await Promise.all([
      sourceDb.query<{ s: string | null }>('SELECT COALESCE(SUM(amount), 0) AS s FROM payments'),
      targetDb.query<{ s: string | null }>('SELECT COALESCE(SUM(amount), 0) AS s FROM payments'),
    ]);
    if (Number(sPaySum.rows[0]?.s || 0).toFixed(2) !== Number(tPaySum.rows[0]?.s || 0).toFixed(2)) {
      throw new Error('Payment decimal sum verification failed!');
    }
    logStep(5, 'Integrity & Payment Verification', 'COMPLETED', 'All table counts and payment totals matched 100%');

    setWriteFrozen(true);
    try {
      saveActiveDatabaseConfig(targetConfig);
      await reloadActiveDatabasePool();
      const health = await getDb().getServerVersion();
      logStep(6, 'Controlled Write Freeze & Cutover', 'COMPLETED', `Activated ${targetConfig.engine} (${health})`);
    } finally {
      setWriteFrozen(false);
    }

    await writeAuditLog({
      actorUserId,
      action: 'DATABASE_SWITCHED',
      targetType: 'database',
      targetId: targetConfig.database,
      metadata: { targetEngine: targetConfig.engine, targetHost: targetConfig.host },
    });

    return { success: true, steps };
  } catch (err) {
    setWriteFrozen(false);
    logStep(99, 'Switch Aborted — Old Database Retained', 'FAILED', err instanceof Error ? err.message : 'Unknown error');
    return {
      success: false,
      steps,
      error: err instanceof Error ? err.message : 'Migration failed; active database unchanged.',
    };
  } finally {
    await targetDb.close().catch(() => undefined);
  }
}
