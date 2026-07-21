ALTER TABLE wardrobe_items
  ADD COLUMN subcategory VARCHAR(60) NOT NULL DEFAULT '' AFTER category,
  ADD COLUMN brand VARCHAR(80) NOT NULL DEFAULT '' AFTER subcategory;

ALTER TABLE wardrobe_assets
  MODIFY COLUMN asset_kind ENUM('original','crop','garment','thumbnail','modeled','reference') NOT NULL;
