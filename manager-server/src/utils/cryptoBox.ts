import crypto from 'crypto';
import { config } from '../config.js';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * AES-256-GCM 加解密工具。
 * 加密格式：`{iv, tag, ciphertext}` 三段 hex，拼接存储。
 * 密钥来自环境变量 `ENCRYPTION_KEY`（base64 编码 32 字节）。
 */

function key(): Buffer {
  const raw = config.encryptionKey;
  // 优先当 base64 解码；不成功则当裸字符串 hash 到 32 字节
  try {
    const buf = Buffer.from(raw, 'base64');
    if (buf.length === 32) return buf;
  } catch { /* noop */ }
  return crypto.createHash('sha256').update(raw).digest();
}

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}

export function decrypt(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 3) throw new Error('cryptoBox: malformed payload');
  const [ivHex, tagHex, ctHex] = parts;
  const iv = Buffer.from(ivHex!, 'hex');
  const tag = Buffer.from(tagHex!, 'hex');
  const ct = Buffer.from(ctHex!, 'hex');
  const decipher = crypto.createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf-8');
}
