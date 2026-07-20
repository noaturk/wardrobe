CREATE TABLE IF NOT EXISTS wardrobe_items (
  id CHAR(43) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  category VARCHAR(32) NOT NULL,
  primary_color CHAR(7) NOT NULL,
  secondary_color CHAR(7) NULL,
  tags JSON NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_wardrobe_items_category (category),
  INDEX idx_wardrobe_items_updated_at (updated_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS wardrobe_assets (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  wardrobe_item_id CHAR(43) NULL,
  asset_kind ENUM('original','crop','garment','modeled','reference') NOT NULL,
  storage_key VARCHAR(512) NOT NULL,
  mime_type VARCHAR(64) NOT NULL,
  byte_size BIGINT UNSIGNED NOT NULL,
  sha256 CHAR(64) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_wardrobe_assets_storage_key (storage_key),
  INDEX idx_wardrobe_assets_item_kind (wardrobe_item_id, asset_kind),
  CONSTRAINT fk_wardrobe_assets_item FOREIGN KEY (wardrobe_item_id) REFERENCES wardrobe_items(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS import_jobs (
  id CHAR(36) PRIMARY KEY,
  status VARCHAR(32) NOT NULL,
  state JSON NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_import_jobs_status_updated (status, updated_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS generation_jobs (
  id CHAR(36) PRIMARY KEY,
  import_job_id CHAR(36) NULL,
  generation_kind ENUM('garment','modeled') NOT NULL,
  status VARCHAR(32) NOT NULL,
  attempt_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  error_code VARCHAR(80) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_generation_jobs_status_updated (status, updated_at),
  CONSTRAINT fk_generation_jobs_import FOREIGN KEY (import_job_id) REFERENCES import_jobs(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS api_usage_daily (
  usage_date DATE PRIMARY KEY,
  analysis_requests INT UNSIGNED NOT NULL DEFAULT 0,
  image_requests INT UNSIGNED NOT NULL DEFAULT 0,
  failed_requests INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key VARCHAR(100) PRIMARY KEY,
  setting_value JSON NOT NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sessions (
  session_id VARCHAR(128) NOT NULL PRIMARY KEY,
  expires INT UNSIGNED NOT NULL,
  data MEDIUMTEXT,
  INDEX idx_sessions_expires (expires)
) ENGINE=InnoDB;
