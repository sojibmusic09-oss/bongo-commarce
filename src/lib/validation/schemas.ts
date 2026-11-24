import { z } from 'zod';
import sanitizeHtml from 'sanitize-html';

export const RESERVED_SLUGS = new Set([
  'api',
  'super-admin',
  'dashboard',
  'auth',
  'login',
  'register',
  'logout',
  'ai-analyzer',
  'checkout',
  'cart',
  'account',
  'admin',
  'uploads',
  'storage',
  'health',
  '_next',
  'favicon.ico',
  'robots.txt',
  'sitemap.xml',
  'static',
  'assets',
  'pricing',
  'docs',
]);

export function toSlug(input: string): string {
  const normalized = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || 'shop';
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase());
}

export function sanitizeRichText(dirty: string): string {
  return sanitizeHtml(dirty, {
    allowedTags: ['b', 'i', 'em', 'strong', 'p', 'br', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'a'],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer nofollow' }),
    },
  });
}

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(190).toLowerCase(),
  phone: z.string().trim().min(6).max(30).optional().or(z.literal('')),
  password: z.string().min(8).max(128),
});

export const loginSchema = z.object({
  email: z.string().trim().email().max(190).toLowerCase(),
  password: z.string().min(1).max(128),
});

export const oneClickShopSchema = z.object({
  ownerName: z.string().trim().min(2).max(100),
  preferredStoreName: z.string().trim().min(2).max(140).optional(),
  tagline: z.string().trim().max(200).optional(),
  publishImmediately: z.boolean().optional().default(true),
});

export const createStoreSchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug may only contain lowercase letters, numbers, and hyphens')
    .refine((s) => !isReservedSlug(s), 'This slug is reserved by the platform'),
  tagline: z.string().trim().max(255).optional(),
  description: z.string().trim().max(3000).optional(),
  contactEmail: z.string().trim().email().optional().or(z.literal('')),
  contactPhone: z.string().trim().max(40).optional(),
});

export const storeThemeSchema = z.object({
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  fontFamily: z.enum(['inter', 'noto-bengali', 'hind-siliguri']),
  headerStyle: z.enum(['classic', 'centered', 'minimal']),
  footerText: z.string().trim().max(300),
  showSearch: z.boolean(),
  showCategories: z.boolean(),
});

export const builderBlockSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum([
    'hero',
    'product_grid',
    'category_strip',
    'banner',
    'rich_text',
    'gallery',
    'contact_info',
  ]),
  enabled: z.boolean(),
  title: z.string().trim().max(200).optional(),
  subtitle: z.string().trim().max(400).optional(),
  ctaText: z.string().trim().max(80).optional(),
  ctaUrl: z
    .string()
    .trim()
    .max(300)
    .refine((u) => !u || u.startsWith('/') || u.startsWith('https://') || u.startsWith('http://'), {
      message: 'Unsafe URL scheme',
    })
    .optional(),
  imageUrl: z
    .string()
    .trim()
    .max(500)
    .refine((u) => !u || u.startsWith('/') || u.startsWith('https://') || u.startsWith('http://'), {
      message: 'Unsafe image URL scheme',
    })
    .optional(),
  content: z.string().max(5000).optional(),
  columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export const productSchema = z.object({
  name: z.string().trim().min(2).max(220),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(150)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  categoryId: z.string().uuid().nullable().optional(),
  sku: z.string().trim().max(80).optional(),
  description: z.string().max(15000).default(''),
  price: z.union([z.number().nonnegative(), z.string().regex(/^\d+(\.\d{1,2})?$/)]),
  compareAtPrice: z
    .union([z.number().nonnegative(), z.string().regex(/^\d+(\.\d{1,2})?$/)])
    .nullable()
    .optional(),
  stock: z.number().int().min(0).max(1000000).default(0),
  isDigital: z.boolean().default(false),
  digitalFileKey: z.string().trim().max(300).nullable().optional(),
  images: z.array(z.string().trim().max(500)).max(12).default([]),
  seoTitle: z.string().trim().max(255).optional(),
  seoDescription: z.string().trim().max(500).optional(),
  isActive: z.boolean().default(true),
  createGlobalShortUrl: z.boolean().default(true),
});

export const categorySchema = z.object({
  name: z.string().trim().min(2).max(150),
  slug: z.string().trim().min(2).max(150).regex(/^[a-z0-9-]+$/).optional(),
  description: z.string().trim().max(1000).optional(),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
});

export const couponSchema = z.object({
  code: z.string().trim().min(2).max(40).toUpperCase(),
  discountType: z.enum(['PERCENT', 'FIXED']),
  discountValue: z.number().positive().max(1000000),
  minOrderAmount: z.number().nonnegative().default(0),
  maxUses: z.number().int().positive().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  isActive: z.boolean().default(true),
});

export const checkoutSchema = z.object({
  storeId: z.string().uuid(),
  customerName: z.string().trim().min(2).max(150),
  customerEmail: z.string().trim().email().max(190).toLowerCase(),
  customerPhone: z.string().trim().min(6).max(30),
  shippingAddress: z.string().trim().min(5).max(1000),
  couponCode: z.string().trim().max(40).optional(),
  paymentMethod: z.enum(['MANUAL_BKASH', 'OFFICIAL_BKASH', 'CASH_ON_DELIVERY']),
  manualBkash: z
    .object({
      trxId: z.string().trim().min(5).max(80),
      senderNumber: z.string().trim().min(8).max(20),
    })
    .optional(),
  notes: z.string().trim().max(500).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1).max(100),
      })
    )
    .min(1)
    .max(50),
});

export const domainAddSchema = z.object({
  storeId: z.string().uuid(),
  hostname: z
    .string()
    .trim()
    .toLowerCase()
    .min(4)
    .max(190)
    .regex(
      /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/,
      'Must be a valid domain hostname without protocol or path (e.g. shop.example.com)'
    ),
  isPrimary: z.boolean().default(false),
});

export const dbConfigSchema = z.object({
  engine: z.enum(['postgresql', 'mysql', 'mariadb']),
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  database: z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9_$-]+$/),
  username: z.string().trim().min(1).max(120),
  password: z.string().max(255),
  ssl: z.boolean().default(false),
});

export const dbSwitchRequestSchema = dbConfigSchema.extend({
  reauthPassword: z.string().min(1),
  confirmZeroDataLossAck: z.literal(true),
});

export const aiAnalyzeSchema = z.object({
  url: z.string().trim().url().max(1000),
});

export const aiChatSchema = z.object({
  analysisId: z.string().uuid().optional(),
  storeId: z.string().uuid().optional(),
  question: z.string().trim().min(2).max(1000),
  language: z.enum(['bn', 'en']).default('bn'),
});
