ALTER TABLE api_usage_daily
  ADD COLUMN analysis_succeeded INT UNSIGNED NOT NULL DEFAULT 0 AFTER analysis_requests,
  ADD COLUMN analysis_failed INT UNSIGNED NOT NULL DEFAULT 0 AFTER analysis_succeeded,
  ADD COLUMN image_succeeded INT UNSIGNED NOT NULL DEFAULT 0 AFTER image_requests,
  ADD COLUMN image_failed INT UNSIGNED NOT NULL DEFAULT 0 AFTER image_succeeded;
