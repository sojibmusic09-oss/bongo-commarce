export type DatabaseEngine = 'postgresql' | 'mysql' | 'mariadb';

export type PlatformRole = 'SUPER_ADMIN' | 'PLATFORM_STAFF' | 'STORE_OWNER' | 'CUSTOMER';

export type StoreMemberRole = 'OWNER' | 'MANAGER' | 'EDITOR' | 'VIEWER';

export type StoreStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';

export type DomainStatus = 'PENDING_DNS' | 'VERIFIED' | 'FAILED' | 'DISABLED';

export type PaymentPurpose = 'STORE_ORDER' | 'STORE_SUBSCRIPTION';

export type PaymentMethod = 'MANUAL_BKASH' | 'OFFICIAL_BKASH' | 'CASH_ON_DELIVERY';

export type PaymentStatus =
  | 'PENDING'
  | 'PENDING_VERIFICATION'
  | 'PAID'
  | 'FAILED'
  | 'REJECTED'
  | 'REFUNDED';

export type OrderStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'REFUNDED';

export type SubscriptionPlanCode = 'FREE' | 'BASIC' | 'STANDARD' | 'PREMIUM' | 'ENTERPRISE';

export type SubscriptionStatus = 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' | 'CANCELLED';

export interface DatabaseConnectionConfig {
  id?: string;
  label?: string;
  engine: DatabaseEngine;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
}

export interface SafeDatabaseStatus {
  engine: DatabaseEngine;
  host: string;
  port: number;
  database: string;
  username: string;
  ssl: boolean;
  connected: boolean;
  version: string | null;
  writeFrozen: boolean;
  source: 'runtime_encrypted' | 'environment';
}

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  password_hash: string;
  platform_role: PlatformRole;
  is_active: boolean;
  email_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  platform_role: PlatformRole;
}

export interface StoreRecord {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  tagline: string | null;
  description: string | null;
  logo_url: string | null;
  banner_url: string | null;
  status: StoreStatus;
  is_published: boolean;
  currency: string;
  contact_email: string | null;
  contact_phone: string | null;
  theme_config: string;
  homepage_blocks: string;
  created_at: string;
  updated_at: string;
}

export interface StoreThemeConfig {
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: 'inter' | 'noto-bengali' | 'hind-siliguri';
  headerStyle: 'classic' | 'centered' | 'minimal';
  footerText: string;
  showSearch: boolean;
  showCategories: boolean;
}

export interface BuilderBlock {
  id: string;
  type:
    | 'hero'
    | 'product_grid'
    | 'category_strip'
    | 'banner'
    | 'rich_text'
    | 'gallery'
    | 'contact_info';
  enabled: boolean;
  title?: string;
  subtitle?: string;
  ctaText?: string;
  ctaUrl?: string;
  imageUrl?: string;
  content?: string;
  columns?: 2 | 3 | 4;
  limit?: number;
}

export interface DomainRecord {
  id: string;
  store_id: string;
  hostname: string;
  is_primary: boolean;
  status: DomainStatus;
  verification_token: string;
  verified_at: string | null;
  created_at: string;
}

export interface ProductRecord {
  id: string;
  store_id: string;
  category_id: string | null;
  name: string;
  slug: string;
  global_alias: string | null;
  sku: string | null;
  description: string;
  price: string;
  compare_at_price: string | null;
  stock: number;
  is_digital: boolean;
  digital_file_key: string | null;
  images_json: string;
  seo_title: string | null;
  seo_description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PlanLimits {
  maxProducts: number;
  maxOrdersPerMonth: number;
  maxStaff: number;
  maxStorageMb: number;
  maxCustomDomains: number;
  allowAiAssistant: boolean;
  allowOfficialBkash: boolean;
}

export interface VerifiedWebsiteAnalysis {
  url: string;
  finalUrl: string;
  accessible: boolean;
  statusCode: number;
  blockedReason?: string;
  websiteName: string | null;
  title: string | null;
  description: string | null;
  category: string | null;
  branding: {
    logoUrl: string | null;
    themeColor: string | null;
  };
  navigationLinks: Array<{ label: string; url: string }>;
  contactInfo: {
    emails: string[];
    phones: string[];
  };
  products: Array<{
    name: string;
    price: string | null;
    currency: string | null;
    description: string | null;
    imageUrl: string | null;
    productUrl: string;
    category: string | null;
    source: 'json-ld' | 'dom-heuristic' | 'opengraph';
  }>;
  seo: {
    canonical: string | null;
    ogTitle: string | null;
    ogDescription: string | null;
  };
  analyzedAt: string;
}

export interface MigrationStepReport {
  step: number;
  name: string;
  status: 'COMPLETED' | 'FAILED' | 'SKIPPED';
  detail: string;
  timestamp: string;
}

export interface BackupMetadata {
  id: string;
  filename: string;
  engine: DatabaseEngine;
  databaseName: string;
  sha256Checksum: string;
  encrypted: boolean;
  totalRows: number;
  sizeBytes: number;
  createdAt: string;
  createdBy: string;
}
