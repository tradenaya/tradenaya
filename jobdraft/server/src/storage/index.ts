import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { v2 as cloudinary } from "cloudinary";
import { config, features } from "../config/env.js";
import { NotConfiguredError } from "../lib/errors.js";

export interface StoredFile {
  publicId: string;
  url: string;
}

export interface ResumeStorage {
  upload(userId: number, content: Buffer): Promise<StoredFile>;
  remove(publicId: string): Promise<void>;
  /** Short-lived URL the owner's browser can open (null = stream through the API). */
  signedUrl(publicId: string, fileName: string): Promise<string | null>;
  download(publicId: string): Promise<Buffer>;
}

const RAW = { resource_type: "raw" as const, type: "authenticated" as const };
const SIGNED_URL_TTL_SECONDS = 300;

function configureCloudinary() {
  const c = config().cloudinary;
  cloudinary.config({ cloud_name: c.cloudName, api_key: c.apiKey, api_secret: c.apiSecret, secure: true });
}

const cloudinaryStorage: ResumeStorage = {
  async upload(userId, content) {
    configureCloudinary();
    const publicId = `resume-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.pdf`;
    const result = await new Promise<{ public_id: string; secure_url: string }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { ...RAW, folder: `jobdraft/resumes/${userId}`, public_id: publicId, overwrite: false, use_filename: false },
        (err, res) => (err || !res ? reject(err ?? new Error("Upload failed")) : resolve(res as { public_id: string; secure_url: string })),
      );
      stream.end(content);
    });
    return { publicId: result.public_id, url: result.secure_url };
  },
  async remove(publicId) {
    configureCloudinary();
    await cloudinary.uploader.destroy(publicId, { ...RAW, invalidate: true });
  },
  async signedUrl(publicId) {
    configureCloudinary();
    // Raw public ids keep their extension, so format is "".
    return cloudinary.utils.private_download_url(publicId, "", {
      ...RAW,
      expires_at: Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS,
    });
  },
  async download(publicId) {
    const url = await this.signedUrl(publicId, "resume.pdf");
    const res = await fetch(url!, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Resume download failed (HTTP ${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  },
};

// Mock: files on local disk (server/.mock-storage), same public-id layout.
function mockPath(publicId: string) {
  const safe = publicId.replace(/[^A-Za-z0-9/_.-]/g, "_").replace(/\.\.+/g, ".");
  return path.join(config().mockStorageDir, safe);
}

export const mockStorage: ResumeStorage & { exists(publicId: string): Promise<boolean>; failNextUpload: boolean } = {
  failNextUpload: false,
  async upload(userId, content) {
    if (this.failNextUpload) {
      this.failNextUpload = false;
      throw new Error("Simulated upload failure");
    }
    const publicId = `jobdraft/resumes/${userId}/resume-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.pdf`;
    const file = mockPath(publicId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
    return { publicId, url: `mock://${publicId}` };
  },
  async remove(publicId) {
    await fs.rm(mockPath(publicId), { force: true });
  },
  async signedUrl() {
    return null;
  },
  async download(publicId) {
    return fs.readFile(mockPath(publicId));
  },
  async exists(publicId) {
    try {
      await fs.access(mockPath(publicId));
      return true;
    } catch {
      return false;
    }
  },
};

export function storage(): ResumeStorage {
  if (config().mockExternal) return mockStorage;
  if (!features().cloudinary) throw new NotConfiguredError("Resume storage (Cloudinary)");
  return cloudinaryStorage;
}
