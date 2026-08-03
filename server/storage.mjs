import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectsCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

function safeKey(key) {
  const normalized = String(key || "").replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0") || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Invalid private storage key");
  }
  return normalized;
}

export class StorageAdapter {
  async put() { throw new Error("Not implemented"); }
  async get() { throw new Error("Not implemented"); }
  async delete() { throw new Error("Not implemented"); }
  async exists() { throw new Error("Not implemented"); }
  async deletePrefix() { throw new Error("Not implemented"); }
}

export class LocalPrivateStorage extends StorageAdapter {
  constructor(root, fallbackRoots = []) {
    super();
    this.root = path.resolve(root);
    this.roots = [...new Set([this.root, ...fallbackRoots.map((candidate) => path.resolve(candidate))])];
  }

  resolve(key, root = this.root) {
    const resolvedRoot = path.resolve(root);
    const target = path.resolve(resolvedRoot, safeKey(key));
    if (!target.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error("Storage path escaped its root");
    return target;
  }

  async put(key, bytes) {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, bytes, { mode: 0o600 });
    return key;
  }

  async get(key) {
    let missingError;
    for (const root of this.roots) {
      try { return await readFile(this.resolve(key, root)); }
      catch (error) {
        if (error.code !== "ENOENT") throw error;
        missingError = error;
      }
    }
    throw missingError;
  }

  createReadStream(key) {
    const existing = this.roots.map((root) => this.resolve(key, root)).find((target) => existsSync(target));
    return createReadStream(existing || this.resolve(key));
  }

  async delete(key) {
    await rm(this.resolve(key), { force: true });
  }

  async exists(key) {
    for (const root of this.roots) {
      try { if ((await stat(this.resolve(key, root))).isFile()) return true; }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    return false;
  }

  async deletePrefix(prefix) {
    const directory = this.resolve(`${safeKey(prefix).replace(/\/$/, "")}/placeholder`);
    await rm(path.dirname(directory), { recursive: true, force: true });
  }
}

export class S3CompatiblePrivateStorage extends StorageAdapter {
  constructor(options) {
    super();
    this.bucket = options.bucket;
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: options.forcePathStyle,
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    });
  }

  async put(key, bytes, contentType = "application/octet-stream") {
    const Key = safeKey(key);
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key,
      Body: bytes,
      ContentType: contentType,
      CacheControl: "private, no-store",
    }));
    return Key;
  }

  async get(key) {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }));
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async delete(key) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }));
  }

  async exists(key) {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }));
      return true;
    } catch (error) {
      if (error.$metadata?.httpStatusCode === 404 || error.name === "NotFound") return false;
      throw error;
    }
  }

  async deletePrefix(prefix) {
    const Prefix = `${safeKey(prefix).replace(/\/$/, "")}/`;
    let ContinuationToken;
    do {
      const listed = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix, ContinuationToken }));
      const objects = (listed.Contents || []).map(({ Key }) => ({ Key }));
      if (objects.length) await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: objects, Quiet: true } }));
      ContinuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (ContinuationToken);
  }
}

export function createStorage(config) {
  return config.storageDriver === "s3"
    ? new S3CompatiblePrivateStorage(config.s3)
    : new LocalPrivateStorage(config.localStorageDir, config.localStorageFallbackDirs);
}

export { safeKey };
