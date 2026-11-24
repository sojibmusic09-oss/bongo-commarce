-- ============================================================================
-- BongoCommerce SaaS - PostgreSQL Initial Schema (001_init.sql)
-- Engine: PostgreSQL 14+
-- ============================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  phone VARCHAR(40),
  password_hash TEXT NOT NULL,
  platform_role VARCHAR(32) NOT NULL DEFAULT 'STORE_OWNER'
    CHECK (platform_role IN ('SUPER_ADMIN', 'PLATFORM_STAFF', 'STORE_OWNER', 'CUSTOMER')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  email_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  ip_address VARCHAR(64),
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

CREATE TABLE IF NOT EXISTS subscription_plans (
  id VARCHAR(36) PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE
    CHECK (code IN ('FREE', 'BASIC', 'STANDARD', 'PREMIUM', 'ENTERPRISE')),
  name VARCHAR(100) NOT NULL,
  price_monthly DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  price_yearly DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  currency VARCHAR(10) NOT NULL DEFAULT 'BDT',
  limits_json TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stores (
  id VARCHAR(36) PRIMARY KEY,
  owner_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name VARCHAR(160) NOT NULL,
  slug VARCHAR(120) NOT NULL UNIQUE,
  tagline VARCHAR(255),
  description TEXT,
  logo_url TEXT,
  banner_url TEXT,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'ARCHIVED')),
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  currency VARCHAR(10) NOT NULL DEFAULT 'BDT',
  contact_email VARCHAR(190),
  contact_phone VARCHAR(40),
  theme_config TEXT NOT NULL,
  homepage_blocks TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stores_owner_id ON stores(owner_id);

CREATE TABLE IF NOT EXISTS store_members (
  id VARCHAR(36) PRIMARY KEY,
  store_id VARCHAR(36) NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(24) NOT NULL DEFAULT 'MANAGER'
    CHECK (role IN ('OWNER', 'MANAGER', 'EDITOR', 'VIEWER')),
  permissions_json TEXT NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, user_id)
);

CREATE TABLE IF NOT EXISTS store_subscriptions (
  id VARCHAR(36) PRIMARY KEY,
  store_id VARCHAR(36) NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  plan_id VARCHAR(36) NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('PENDING', 'ACTIVE', 'EXPIRED', 'SUSPENDED', 'CANCELLED')),
  billing_cycle VARCHAR(16) NOT NULL DEFAULT 'MONTHLY'
    CHECK (billing_cycle IN ('MONTHLY', 'YEARLY')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  grace_ends_at TIMESTAMPTZ,
  auto_renew BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_store_subs_store_id ON store_subscriptions(store_id);

CREATE TABLE IF NOT EXISTS subscription_invoices (
  id VARCHAR(36) PRIMARY KEY,
  store_id VARCHAR(36) NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  subscription_id VARCHAR(36) NOT NULL REFERENCES store_subscriptions(id) ON DELETE CASCADE,
  invoice_number VARCHAR(64) NOT NULL UNIQUE,
  amount DECIMAL(14, 2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'BDT',
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PAID', 'CANCELLED', 'REFUNDED')),
  due_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sub_invoices_store_id ON subscription_invoices(store_id);

CREATE TABLE IF NOT EXISTS domains (
  id VARCHAR(36) PRIMARY KEY,
  store_id VARCHAR(36) NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  hostname VARCHAR(255) NOT NULL UNIQUE,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING_DNS'
    CHECK (status IN ('PENDING_DNS', 'VERIFIED', 'FAILED', 'DISABLED')),
  verification_token VARCHAR(128) NOT NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_domains_store_id ON domains(store_id);

CREATE TABLE IF NOT EXISTS categories (
  id VARCHAR(36) PRIMARY KEY,
  store_id VARCHAR(36) NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,
  slug VARCHAR(150) NOT NULL,
  description TEXT,
  parent_id VARCHAR(36) REFERENCES categories(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_categories_store_id ON categories(store_id);

CREATE TABLE IF NOT EXISTS products (
  id VARCHAR(36) PRIMARY KEY,
  store_id VARCHAR(36) NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  category_id VARCHAR(36) REFERENCES categories(id) ON DELETE SET NULL,
  name VARCHAR(220) NOT NULL,
  slug VARCHAR(160) NOT NULL,
  global_alias VARCHAR(180) UNIQUE,
  sku VARCHAR(80),
  description TEXT NOT NULL DEFAULT '',
  price DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  compare_at_price DECIMAL(14, 2),
  stock INTEGER NOT NULL DEFAULT 0,
  is_digital BOOLEAN NOT NULL DEFAULT FALSE,
  digital_file_key TEXT,
  images_json TEXT NOT NULL DEFAULT '[]',
  seo_title VARCHAR(255),
  seo_description VARCHAR(500),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_products_store_id ON products(store_id);
CREATE INDEX IF NOT EXISTS idx_products_global_alias ON products(global_alias);

CREATE TABLE IF NOT EXISTS url_redirects (
  id VARCHAR(36) PRIMARY KEY,
  store_id VARCHAR(36) REFERENCES stores(id) ON DELETE CASCADE,
  old_path VARCHAR(300) NOT NULL,
  new_path VARCHAR(300) NOT NULL,
  status_code INTEGER NOT NULL DEFAULT 301,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, old_path)
);

CREATE TABLE IF NOT EXISTS store_pages (
  id VARCHAR(36) PRIMARY KEY,
  store_id VARCHAR(36) NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  title VARCHAR(180) NOT NULL,
  slug VARCHAR(120) NOT NULL,
  blocks_json TEXT NOT NULL DEFAULT '[]',
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, slug)
);

CREATE TABLE IF NOT EXISTS coupons (
  id VARCHAR(36) PRIMARY KEY,
  store_id VARCHAR(36) NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  code VARCHAR(64) NOT NULL,
  discount_type VARCHAR(16) NOT NULL DEFAULT 'PERCENT'
    CHECK (discount_type IN ('PERCENT', 'FIXED')),
  discount_value DECIMAL(14, 2) NOT NULL,
  min_order_amount DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  max_uses INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, code)
);

CREATE TABLE IF NOT EXISTS customers (
  id VARCHAR(36) PRIMARY KEY,
  store_id VARCHAR(36) NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(190) NOT NULL,
  phone VARCHAR(40),
  address TEXT,
  city VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, email)
);

CREATE TABLE IF NOT EXISTS orders (
  id VARCHAR(36) PRIMARY KEY,
  store_id VARCHAR(36) NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_id VARCHAR(36) REFERENCES customers(id) ON DELETE SET NULL,
  order_number VARCHAR(64) NOT NULL UNIQUE,
  customer_name VARCHAR(150) NOT NULL,
  customer_email VARCHAR(190) NOT NULL,
  customer_phone VARCHAR(40) NOT NULL,
  shipping_address TEXT NOT NULL,
  subtotal DECIMAL(14, 2) NOT NULL,
  discount_amount DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  shipping_fee DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  total_amount DECIMAL(14, 2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'BDT',
  coupon_code VARCHAR(64),
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED')),
  payment_status VARCHAR(32) NOT NULL DEFAULT 'PENDING'
    CHECK (payment_status IN ('PENDING', 'PENDING_VERIFICATION', 'PAID', 'FAILED', 'REJECTED', 'REFUNDED')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_orders_store_id ON orders(store_id);

CREATE TABLE IF NOT EXISTS order_items (
  id VARCHAR(36) PRIMARY KEY,
  order_id VARCHAR(36) NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  store_id VARCHAR(36) NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id VARCHAR(36) REFERENCES products(id) ON DELETE SET NULL,
  product_name VARCHAR(220) NOT NULL,
  unit_price DECIMAL(14, 2) NOT NULL,
  quantity INTEGER NOT NULL,
  line_total DECIMAL(14, 2) NOT NULL,
  is_digital BOOLEAN NOT NULL DEFAULT FALSE,
  digital_download_token VARCHAR(128)
);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

CREATE TABLE IF NOT EXISTS payments (
  id VARCHAR(36) PRIMARY KEY,
  purpose VARCHAR(32) NOT NULL
    CHECK (purpose IN ('STORE_ORDER', 'STORE_SUBSCRIPTION')),
  store_id VARCHAR(36) NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  order_id VARCHAR(36) REFERENCES orders(id) ON DELETE SET NULL,
  invoice_id VARCHAR(36) REFERENCES subscription_invoices(id) ON DELETE SET NULL,
  method VARCHAR(32) NOT NULL
    CHECK (method IN ('MANUAL_BKASH', 'OFFICIAL_BKASH', 'CASH_ON_DELIVERY')),
  gateway VARCHAR(40) NOT NULL DEFAULT 'bkash',
  trx_id VARCHAR(100),
  sender_number VARCHAR(40),
  amount DECIMAL(14, 2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'BDT',
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PENDING_VERIFICATION', 'PAID', 'FAILED', 'REJECTED', 'REFUNDED')),
  idempotency_key VARCHAR(128) UNIQUE,
  gateway_payment_id VARCHAR(128),
  raw_payload_json TEXT,
  verified_by VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (gateway, trx_id)
);
CREATE INDEX IF NOT EXISTS idx_payments_store_id ON payments(store_id);
CREATE INDEX IF NOT EXISTS idx_payments_purpose ON payments(purpose);

CREATE TABLE IF NOT EXISTS product_reviews (
  id VARCHAR(36) PRIMARY KEY,
  store_id VARCHAR(36) NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id VARCHAR(36) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  customer_name VARCHAR(150) NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL,
  is_approved BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wishlists (
  id VARCHAR(36) PRIMARY KEY,
  store_id VARCHAR(36) NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_email VARCHAR(190) NOT NULL,
  product_id VARCHAR(36) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (store_id, customer_email, product_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(36) PRIMARY KEY,
  store_id VARCHAR(36) REFERENCES stores(id) ON DELETE CASCADE,
  user_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  type VARCHAR(40) NOT NULL DEFAULT 'INFO',
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_website_analyses (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
  target_url TEXT NOT NULL,
  final_url TEXT,
  accessible BOOLEAN NOT NULL DEFAULT FALSE,
  status_code INTEGER NOT NULL DEFAULT 0,
  verified_data_json TEXT NOT NULL,
  ai_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS system_settings (
  setting_key VARCHAR(120) PRIMARY KEY,
  setting_value TEXT NOT NULL,
  is_secret BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(36) PRIMARY KEY,
  actor_user_id VARCHAR(36),
  store_id VARCHAR(36),
  action VARCHAR(120) NOT NULL,
  target_type VARCHAR(80) NOT NULL,
  target_id VARCHAR(120),
  metadata_json TEXT,
  ip_address VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS database_migration_runs (
  id VARCHAR(36) PRIMARY KEY,
  source_engine VARCHAR(32) NOT NULL,
  target_engine VARCHAR(32) NOT NULL,
  target_host VARCHAR(255) NOT NULL,
  target_database VARCHAR(120) NOT NULL,
  status VARCHAR(32) NOT NULL,
  steps_json TEXT NOT NULL,
  started_by VARCHAR(36),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS background_jobs (
  id VARCHAR(36) PRIMARY KEY,
  job_type VARCHAR(80) NOT NULL,
  payload_json TEXT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_error TEXT,
  run_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
