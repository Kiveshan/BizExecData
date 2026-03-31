import crypto from "crypto";
import { ENCRYPTION_KEY, IV_LENGTH } from "../config/env.js";

// Validate encryption key length
const keyBuffer = Buffer.from(ENCRYPTION_KEY);
if (keyBuffer.length !== 32) {
  throw new Error(`ENCRYPTION_KEY must be exactly 32 bytes for AES-256-CBC. Current key length: ${keyBuffer.length} bytes. Key content: "${ENCRYPTION_KEY}"`);
}

export function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    keyBuffer,
    iv
  );
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

export function decrypt(text) {
  const textParts = text.split(":");
  const iv = Buffer.from(textParts.shift(), "hex");
  const encryptedText = Buffer.from(textParts.join(":"), "hex");
  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    keyBuffer,
    iv
  );
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}
