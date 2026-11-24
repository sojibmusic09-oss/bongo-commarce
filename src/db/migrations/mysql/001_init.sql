-- ============================================================================
-- BongoCommerce SaaS - MySQL 8.0+ / MariaDB 10.6+ Initial Schema (001_init.sql)
-- Engine: InnoDB | Charset: utf8mb4 (Full Bangla & Emoji Support)
-- ============================================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(190) NOT NULL,
  phone VARCHAR(40) NULL,
  password_hash TEXT NOT NULL,
  platform_role VARCHAR(32) NOT NULL DEFAULT 'STORE_OWNER',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  email_verified_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_users_email (email),
  CHECK (platform_role IN ('SUPER_ADMIN', 'PLATFORM_STAFF', 'STORE_OWNER', 'CUSTOMER'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  token_hash VARCHAR(128) NOT NULL,
  ip_address VARCHAR(64) NULL,
  user_agent TEXT NULL,
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_sessions_token_hash (token_hash),
  INDEX idx_sessions_user_id (user_id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscription_plans (
  id VARCHAR(36) PRIMARY KEY,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(100) NOT NULL,
  price_monthly DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  price_yearly DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  currency VARCHAR(10) NOT NULL DEFAULT 'BDT',
  limits_json TEXT NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_plans_code (code),
  CHECK (code IN ('FREE', 'BASIC', 'STANDARD', 'PREMIUM', 'ENTERPRISE'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stores (
  id VARCHAR(36) PRIMARY KEY,
  owner_id VARCHAR(36) NOT NULL,
  name VARCHAR(160) NOT NULL,
  slug VARCHAR(120) NOT NULL,
  tagline VARCHAR(255) NULL,
  description TEXT NULL,
  logo_url TEXT NULL,
  banner_url TEXT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  is_published TINYINT(1) NOT NULL DEFAULT 1,
  currency VARCHAR(10) NOT NULL DEFAULT 'BDT',
  contact_email VARCHAR(190) NULL,
  contact_phone VARCHAR(40) NULL,
  theme_config TEXT NOT NULL,
  homepage_blocks TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_stores_slug (slug),
  INDEX idx_stores_owner_id (owner_id),
  CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'ARCHIVED')),
  CONSTRAINT fk_stores_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS store_members (
  id VARCHAR(36) PRIMARY KEY,
  store_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  role VARCHAR(24) NOT NULL DEFAULT 'MANAGER',
  permissions_json TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_store_members_store_user (store_id, user_id),
  CHECK (role IN ('OWNER', 'MANAGER', 'EDITOR', 'VIEWER')),
  CONSTRAINT fk_store_members_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_store_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS store_subscriptions (
  id VARCHAR(36) PRIMARY KEY,
  store_id VARCHAR(36) NOT NULL,
  plan_id VARCHAR(36) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
  billing_cycle VARCHAR(16) NOT NULL DEFAULT 'MONTHLY',
  starts_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ends_at DATETIME(3) NULL,
  grace_ends_at DATETIME(3) NULL,
  auto_renew TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_store_subs_store_id (store_id),
  CHECK (status IN ('PENDING', 'ACTIVE', 'EXPIRED', 'SUSPENDED', 'CANCELLED')),
  CHECK (billing_cycle IN ('MONTHLY', 'YEARLY')),
  CONSTRAINT fk_store_subs_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_store_subs_plan FOREIGN KEY (plan_id) REFERENCES subscription_plans(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscription_invoices (
  id VARCHAR(36) PRIMARY KEY,
  store_id VARCHAR(36) NOT NULL,
  subscription_id VARCHAR(36) NOT NULL,
  invoice_number VARCHAR(64) NOT NULL,
  amount DECIMAL(14, 2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'BDT',
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  due_at DATETIME(3) NOT NULL,
  paid_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_sub_invoices_number (invoice_number),
  INDEX idx_sub_invoices_store_id (store_id),
  CHECK (status IN ('PENDING', 'PAID', 'CANCELLED', 'REFUNDED')),
  CONSTRAINT fk_sub_invoices_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_sub_invoices_sub FOREIGN KEY (subscription_id) REFERENCES store_subscriptions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS domains (
  id VARCHAR(36) PRIMARY KEY,
  store_id VARCHAR(36) NOT NULL,
  hostname VARCHAR(191) NOT NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING_DNS',
  verification_token VARCHAR(128) NOT NULL,
  verified_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_domains_hostname (hostname),
  INDEX idx_domains_store_id (store_id),
  CHECK (status IN ('PENDING_DNS', 'VERIFIED', 'FAILED', 'DISABLED')),
  CONSTRAINT fk_domains_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS categories (
  id VARCHAR(36) PRIMARY KEY,
  store_id VARCHAR(36) NOT NULL,
  name VARCHAR(150) NOT NULL,
  slug VARCHAR(150) NOT NULL,
  description TEXT NULL,
  parent_id VARCHAR(36) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_categories_store_slug (store_id, slug),
  INDEX idx_categories_store_id (store_id),
  CONSTRAINT fk_categories_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_categories_parent FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS products (
  id VARCHAR(36) PRIMARY KEY,
  store_id VARCHAR(36) NOT NULL,
  category_id VARCHAR(36) NULL,
  name VARCHAR(220) NOT NULL,
  slug VARCHAR(150) NOT NULL,
  global_alias VARCHAR(180) NULL,
  sku VARCHAR(80) NULL,
  description TEXT NOT NULL,
  price DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  compare_at_price DECIMAL(14, 2) NULL,
  stock INT NOT NULL DEFAULT 0,
  is_digital TINYINT(1) NOT NULL DEFAULT 0,
  digital_file_key TEXT NULL,
  images_json TEXT NOT NULL,
  seo_title VARCHAR(255) NULL,
  seo_description VARCHAR(500) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_products_store_slug (store_id, slug),
  UNIQUE KEY uq_products_global_alias (global_alias),
  INDEX idx_products_store_id (store_id),
  CONSTRAINT fk_products_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS url_redirects (
  id VARCHAR(36) PRIMARY KEY,
  store_id VARCHAR(36) NULL,
  old_path VARCHAR(191) NOT NULL,
  new_path VARCHAR(300) NOT NULL,
  status_code INT NOT NULL DEFAULT 301,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_redirects_store_old (store_id, old_path),
  CONSTRAINT fk_redirects_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS store_pages (
  id VARCHAR(36) PRIMARY KEY,
  store_id VARCHAR(36) NOT NULL,
  title VARCHAR(180) NOT NULL,
  slug VARCHAR(120) NOT NULL,
  blocks_json TEXT NOT NULL,
  is_published TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_store_pages_slug (store_id, slug),
  CONSTRAINT fk_store_pages_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS coupons (
  id VARCHAR(36) PRIMARY KEY,
  store_id VARCHAR(36) NOT NULL,
  code VARCHAR(64) NOT NULL,
  discount_type VARCHAR(16) NOT NULL DEFAULT 'PERCENT',
  discount_value DECIMAL(14, 2) NOT NULL,
  min_order_amount DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  max_uses INT NULL,
  used_count INT NOT NULL DEFAULT 0,
  expires_at DATETIME(3) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_coupons_store_code (store_id, code),
  CHECK (discount_type IN ('PERCENT', 'FIXED')),
  CONSTRAINT fk_coupons_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customers (
  id VARCHAR(36) PRIMARY KEY,
  store_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NULL,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(190) NOT NULL,
  phone VARCHAR(40) NULL,
  address TEXT NULL,
  city VARCHAR(100) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_customers_store_email (store_id, email),
  CONSTRAINT fk_customers_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_customers_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orders (
  id VARCHAR(36) PRIMARY KEY,
  store_id VARCHAR(36) NOT NULL,
  customer_id VARCHAR(36) NULL,
  order_number VARCHAR(64) NOT NULL,
  customer_name VARCHAR(150) NOT NULL,
  customer_email VARCHAR(190) NOT NULL,
  customer_phone VARCHAR(40) NOT NULL,
  shipping_address TEXT NOT NULL,
  subtotal DECIMAL(14, 2) NOT NULL,
  discount_amount DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  shipping_fee DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  total_amount DECIMAL(14, 2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'BDT',
  coupon_code VARCHAR(64) NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  payment_status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  notes TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_orders_number (order_number),
  INDEX idx_orders_store_id (store_id),
  CHECK (status IN ('PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED')),
  CHECK (payment_status IN ('PENDING', 'PENDING_VERIFICATION', 'PAID', 'FAILED', 'REJECTED', 'REFUNDED')),
  CONSTRAINT fk_orders_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_items (
  id VARCHAR(36) PRIMARY KEY,
  order_id VARCHAR(36) NOT NULL,
  store_id VARCHAR(36) NOT NULL,
  product_id VARCHAR(36) NULL,
  product_name VARCHAR(220) NOT NULL,
  unit_price DECIMAL(14, 2) NOT NULL,
  quantity INT NOT NULL,
  line_total DECIMAL(14, 2) NOT NULL,
  is_digital TINYINT(1) NOT NULL DEFAULT 0,
  digital_download_token VARCHAR(128) NULL,
  INDEX idx_order_items_order_id (order_id),
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_order_items_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payments (
  id VARCHAR(36) PRIMARY KEY,
  purpose VARCHAR(32) NOT NULL,
  store_id VARCHAR(36) NOT NULL,
  order_id VARCHAR(36) NULL,
  invoice_id VARCHAR(36) NULL,
  method VARCHAR(32) NOT NULL,
  gateway VARCHAR(40) NOT NULL DEFAULT 'bkash',
  trx_id VARCHAR(100) NULL,
  sender_number VARCHAR(40) NULL,
  amount DECIMAL(14, 2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'BDT',
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  idempotency_key VARCHAR(128) NULL,
  gateway_payment_id VARCHAR(128) NULL,
  raw_payload_json TEXT NULL,
  verified_by VARCHAR(36) NULL,
  verified_at DATETIME(3) NULL,
  rejection_reason TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_payments_idempotency (idempotency_key),
  UNIQUE KEY uq_payments_gateway_trx (gateway, trx_id),
  INDEX idx_payments_store_id (store_id),
  INDEX idx_payments_purpose (purpose),
  CHECK (purpose IN ('STORE_ORDER', 'STORE_SUBSCRIPTION')),
  CHECK (method IN ('MANUAL_BKASH', 'OFFICIAL_BKASH', 'CASH_ON_DELIVERY')),
  CHECK (status IN ('PENDING', 'PENDING_VERIFICATION', 'PAID', 'FAILED', 'REJECTED', 'REFUNDED')),
  CONSTRAINT fk_payments_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_payments_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
  CONSTRAINT fk_payments_invoice FOREIGN KEY (invoice_id) REFERENCES subscription_invoices(id) ON DELETE SET NULL,
  CONSTRAINT fk_payments_verifier FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_reviews (
  id VARCHAR(36) PRIMARY KEY,
  store_id VARCHAR(36) NOT NULL,
  product_id VARCHAR(36) NOT NULL,
  customer_name VARCHAR(150) NOT NULL,
  rating INT NOT NULL,
  comment TEXT NOT NULL,
  is_approved TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT fk_reviews_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_reviews_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wishlists (
  id VARCHAR(36) PRIMARY KEY,
  store_id VARCHAR(36) NOT NULL,
  customer_email VARCHAR(190) NOT NULL,
  product_id VARCHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_wishlists_unique (store_id, customer_email, product_id),
  CONSTRAINT fk_wishlists_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_wishlists_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(36) PRIMARY KEY,
  store_id VARCHAR(36) NULL,
  user_id VARCHAR(36) NULL,
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  type VARCHAR(40) NOT NULL DEFAULT 'INFO',
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_notifications_store FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_website_analyses (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NULL,
  target_url TEXT NOT NULL,
  final_url TEXT NULL,
  accessible TINYINT(1) NOT NULL DEFAULT 0,
  status_code INT NOT NULL DEFAULT 0,
  verified_data_json TEXT NOT NULL,
  ai_summary TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_ai_analyses_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS system_settings (
  setting_key VARCHAR(120) PRIMARY KEY,
  setting_value TEXT NOT NULL,
  is_secret TINYINT(1) NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(36) PRIMARY KEY,
  actor_user_id VARCHAR(36) NULL,
  store_id VARCHAR(36) NULL,
  action VARCHAR(120) NOT NULL,
  target_type VARCHAR(80) NOT NULL,
  target_id VARCHAR(120) NULL,
  metadata_json TEXT NULL,
  ip_address VARCHAR(64) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_audit_logs_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS database_migration_runs (
  id VARCHAR(36) PRIMARY KEY,
  source_engine VARCHAR(32) NOT NULL,
  target_engine VARCHAR(32) NOT NULL,
  target_host VARCHAR(255) NOT NULL,
  target_database VARCHAR(120) NOT NULL,
  status VARCHAR(32) NOT NULL,
  steps_json TEXT NOT NULL,
  started_by VARCHAR(36) NULL,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS background_jobs (
  id VARCHAR(36) PRIMARY KEY,
  job_type VARCHAR(80) NOT NULL,
  payload_json TEXT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  last_error TEXT NULL,
  run_after DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
