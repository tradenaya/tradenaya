import crypto from "crypto";

const ALGO = "aes-256-gcm";

function getMasterKey() {
  const key = process.env.COINSWITCH_ENCRYPTION_KEY || process.env.TRADIAURA_AUTH_SECRET || process.env.JWT_SECRET || "fallback-secret-key-please-set";
  // Derive 32 byte key
  return crypto.createHash("sha256").update(key).digest();
}

export function encrypt(text: string) {
  const iv = crypto.randomBytes(12);
  const key = getMasterKey();
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("hex");
}

export function decrypt(dataHex: string) {
  const data = Buffer.from(dataHex, "hex");
  const iv = data.slice(0, 12);
  const tag = data.slice(12, 28);
  const encrypted = data.slice(28);
  const key = getMasterKey();
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

export default { encrypt, decrypt };
