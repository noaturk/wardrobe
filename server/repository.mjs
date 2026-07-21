import crypto from "node:crypto";
import mysql from "mysql2/promise";

function json(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") return JSON.parse(value);
  return value;
}

export class MySqlWardrobeRepository {
  constructor(connectionOptions) {
    this.pool = mysql.createPool(connectionOptions);
  }

  async loadJob(id) {
    const [rows] = await this.pool.execute("SELECT state FROM import_jobs WHERE id = ? LIMIT 1", [id]);
    return rows[0] ? json(rows[0].state, null) : null;
  }

  async saveJob(job) {
    await this.pool.execute(
      "INSERT INTO import_jobs (id, status, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE status=VALUES(status), state=VALUES(state), updated_at=VALUES(updated_at)",
      [job.id, job.status, JSON.stringify(job), job.createdAt, job.updatedAt],
    );
  }

  async listJobIds() {
    const [rows] = await this.pool.query("SELECT id FROM import_jobs ORDER BY created_at");
    return rows.map((row) => row.id);
  }

  async deleteJob(id) {
    await this.pool.execute("DELETE FROM import_jobs WHERE id = ?", [id]);
  }

  async oldJobIds(cutoff) {
    const [rows] = await this.pool.execute("SELECT id FROM import_jobs WHERE updated_at < ?", [cutoff]);
    return rows.map((row) => row.id);
  }

  async loadImported() {
    const [items] = await this.pool.query("SELECT id, name, category, subcategory, brand, primary_color, secondary_color, tags FROM wardrobe_items ORDER BY created_at");
    if (!items.length) return [];
    const [assets] = await this.pool.query("SELECT wardrobe_item_id, asset_kind, storage_key FROM wardrobe_assets WHERE wardrobe_item_id IS NOT NULL");
    const byItem = new Map();
    for (const asset of assets) {
      if (!byItem.has(asset.wardrobe_item_id)) byItem.set(asset.wardrobe_item_id, {});
      byItem.get(asset.wardrobe_item_id)[asset.asset_kind] = asset.storage_key;
    }
    return items.map((item) => {
      const owned = byItem.get(item.id) || {};
      const assetUrl = (key) => key ? `/api/import/library/${encodeURIComponent(key.split("/").at(-1))}` : null;
      return {
        id: item.id,
        name: item.name,
        part: item.category,
        subcategory: item.subcategory || "",
        brand: item.brand || "",
        color: item.primary_color,
        secondaryColor: item.secondary_color,
        palette: [item.primary_color, item.secondary_color].filter(Boolean),
        tags: json(item.tags, []),
        image: assetUrl(owned.garment),
        thumbnail: assetUrl(owned.thumbnail || owned.garment),
        modeledImage: assetUrl(owned.modeled),
        importJobId: item.id.replace(/^import-/, ""),
      };
    });
  }

  async saveImported(record, assets) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        "INSERT INTO wardrobe_items (id, name, category, subcategory, brand, primary_color, secondary_color, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name=VALUES(name), category=VALUES(category), subcategory=VALUES(subcategory), brand=VALUES(brand), primary_color=VALUES(primary_color), secondary_color=VALUES(secondary_color), tags=VALUES(tags)",
        [record.id, record.name, record.part, record.subcategory || "", record.brand || "", record.color, record.secondaryColor, JSON.stringify(record.tags || [])],
      );
      for (const [kind, asset] of Object.entries(assets)) {
        if (!asset) continue;
        await connection.execute("DELETE FROM wardrobe_assets WHERE wardrobe_item_id = ? AND asset_kind = ?", [record.id, kind]);
        await connection.execute(
          "INSERT INTO wardrobe_assets (wardrobe_item_id, asset_kind, storage_key, mime_type, byte_size, sha256) VALUES (?, ?, ?, ?, ?, ?)",
          [record.id, kind, asset.key, asset.mime, asset.bytes.length, crypto.createHash("sha256").update(asset.bytes).digest("hex")],
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async deleteImported(id) {
    const [rows] = await this.pool.execute("SELECT storage_key FROM wardrobe_assets WHERE wardrobe_item_id = ?", [id]);
    await this.pool.execute("DELETE FROM wardrobe_items WHERE id = ?", [id]);
    return rows.map((row) => row.storage_key);
  }

  async deleteModeled(id) {
    const [rows] = await this.pool.execute("SELECT storage_key FROM wardrobe_assets WHERE wardrobe_item_id = ? AND asset_kind = 'modeled'", [id]);
    await this.pool.execute("DELETE FROM wardrobe_assets WHERE wardrobe_item_id = ? AND asset_kind = 'modeled'", [id]);
    return rows[0]?.storage_key || null;
  }

  async deleteAll() {
    const [rows] = await this.pool.query("SELECT storage_key FROM wardrobe_assets");
    const outfits = await this.loadOutfits();
    await this.pool.query("DELETE FROM wardrobe_items");
    await this.pool.query("DELETE FROM import_jobs");
    await this.pool.execute("DELETE FROM app_settings WHERE setting_key = 'outfit_gallery'");
    return [...rows.map((row) => row.storage_key), ...outfits.map((outfit) => outfit.storageKey).filter(Boolean)];
  }

  async loadOutfits() {
    const [rows] = await this.pool.execute("SELECT setting_value FROM app_settings WHERE setting_key = 'outfit_gallery' LIMIT 1");
    return rows[0] ? json(rows[0].setting_value, []) : [];
  }

  async saveOutfit(record) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute("SELECT setting_value FROM app_settings WHERE setting_key = 'outfit_gallery' FOR UPDATE");
      const current = rows[0] ? json(rows[0].setting_value, []) : [];
      const next = [...current.filter((item) => item.id !== record.id), record];
      await connection.execute(
        "INSERT INTO app_settings (setting_key, setting_value) VALUES ('outfit_gallery', ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)",
        [JSON.stringify(next)],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async deleteOutfit(id) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute("SELECT setting_value FROM app_settings WHERE setting_key = 'outfit_gallery' FOR UPDATE");
      const current = rows[0] ? json(rows[0].setting_value, []) : [];
      const removed = current.find((item) => item.id === id) || null;
      const next = current.filter((item) => item.id !== id);
      await connection.execute(
        "INSERT INTO app_settings (setting_key, setting_value) VALUES ('outfit_gallery', ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)",
        [JSON.stringify(next)],
      );
      await connection.commit();
      return removed;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}
