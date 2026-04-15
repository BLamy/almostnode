import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

export interface EncryptedValue {
  iv: string;
  ciphertext: string;
}

export function encryptString(
  key: Buffer,
  value: string,
): EncryptedValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    iv: iv.toString("base64"),
    ciphertext: Buffer.concat([ciphertext, authTag]).toString("base64"),
  };
}

export function decryptString(
  key: Buffer,
  encrypted: EncryptedValue,
): string {
  const payload = Buffer.from(encrypted.ciphertext, "base64");
  const iv = Buffer.from(encrypted.iv, "base64");
  const ciphertext = payload.subarray(0, payload.length - 16);
  const authTag = payload.subarray(payload.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
