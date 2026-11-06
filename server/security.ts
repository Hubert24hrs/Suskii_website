/**
 * Cryptographic helpers built on node:crypto only.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { centralSecret } from './config.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number, opts: object) => Promise<Buffer>;

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');
export const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');
export const hmacHex = (key: string, data: string): string => createHmac('sha256', key).update(data).digest('hex');

export function safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) {
        timingSafeEqual(ab, ab); // keep timing roughly constant
        return false;
    }
    return timingSafeEqual(ab, bb);
}

// ─── Passwords (scrypt, N=2^15) ───
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64 };

export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const key = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 128 * SCRYPT.N * SCRYPT.r * 2 });
    return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, n, r, p, saltB64, keyB64] = parts;
    const N = Number(n), R = Number(r), P = Number(p);
    const expected = Buffer.from(keyB64, 'base64url');
    const key = await scrypt(password, Buffer.from(saltB64, 'base64url'), expected.length, { N, r: R, p: P, maxmem: 128 * N * R * 2 });
    return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A pre-computed hash used to keep login timing constant when the email does not exist. */
let dummyHash: Promise<string> | undefined;
export function dummyPasswordHash(): Promise<string> {
    dummyHash ??= hashPassword(randomToken(18));
    return dummyHash;
}

export function passwordProblems(password: string, email?: string): string[] {
    const problems: string[] = [];
    if (password.length < 12) problems.push('Use at least 12 characters.');
    if (password.length > 256) problems.push('Use at most 256 characters.');
    const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
    if (classes < 3) problems.push('Mix at least three of: lowercase, uppercase, numbers, symbols.');
    if (email && password.toLowerCase().includes(email.split('@')[0].toLowerCase())) problems.push('Do not include your email name in the password.');
    if (/^(.)\1+$/.test(password) || /password|suskii|123456|qwerty/i.test(password)) problems.push('Avoid common words and repeated characters.');
    return problems;
}

// ─── Encryption at rest (AES-256-GCM, key derived from CENTRAL_ADMIN_SECRET) ───
function key(purpose: string): Buffer {
    return Buffer.from(hkdfSync('sha256', centralSecret(), 'suskii-admin', purpose, 32));
}

export function encrypt(plaintext: string, purpose = 'credentials'): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key(purpose), iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${enc.toString('base64url')}`;
}

export function decrypt(payload: string, purpose = 'credentials'): string {
    const [v, ivB, tagB, encB] = payload.split('.');
    if (v !== 'v1' || !ivB || !tagB || encB === undefined) throw new Error('Unsupported ciphertext');
    const decipher = createDecipheriv('aes-256-gcm', key(purpose), Buffer.from(ivB, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(encB, 'base64url')), decipher.final()]).toString('utf8');
}

const BYTES_MAGIC = Buffer.from('SKE1');

/** Encrypts a file for storage (used for CVs): magic | iv | tag | ciphertext. */
export function encryptBytes(data: Uint8Array, purpose = 'documents'): Uint8Array {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key(purpose), iv);
    const enc = Buffer.concat([cipher.update(data), cipher.final()]);
    return new Uint8Array(Buffer.concat([BYTES_MAGIC, iv, cipher.getAuthTag(), enc]));
}

export const isEncryptedBytes = (data: Uint8Array): boolean => data.byteLength > 32 && Buffer.from(data.subarray(0, 4)).equals(BYTES_MAGIC);

export function decryptBytes(data: Uint8Array, purpose = 'documents'): Uint8Array {
    const b = Buffer.from(data);
    if (!isEncryptedBytes(b)) throw new Error('Not an encrypted file');
    const decipher = createDecipheriv('aes-256-gcm', key(purpose), b.subarray(4, 16));
    decipher.setAuthTag(b.subarray(16, 32));
    return new Uint8Array(Buffer.concat([decipher.update(b.subarray(32)), decipher.final()]));
}

// ─── TOTP (RFC 6238, SHA-1, 6 digits, 30 s) ───
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
    let bits = 0, value = 0, out = '';
    for (const byte of buf) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
    }
    if (bits > 0) out += B32[(value << (5 - bits)) & 31];
    return out;
}

export function base32Decode(s: string): Buffer {
    const clean = s.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
    let bits = 0, value = 0;
    const out: number[] = [];
    for (const ch of clean) {
        const idx = B32.indexOf(ch);
        if (idx < 0) throw new Error('Invalid base32');
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
    }
    return Buffer.from(out);
}

export const newTotpSecret = (): string => base32Encode(randomBytes(20));

export function totp(secret: string, at = Date.now(), step = 30): string {
    const counter = Math.floor(at / 1000 / step);
    const msg = Buffer.alloc(8);
    msg.writeBigUInt64BE(BigInt(counter));
    const h = createHmac('sha1', base32Decode(secret)).update(msg).digest();
    const offset = h[h.length - 1] & 15;
    const code = ((h.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
    return code;
}

/** Accepts the current code and one step either side for clock drift. */
export function verifyTotp(secret: string, code: string, at = Date.now()): boolean {
    const clean = code.replace(/\s/g, '');
    if (!/^\d{6}$/.test(clean)) return false;
    return [-1, 0, 1].some((d) => safeEqual(totp(secret, at + d * 30_000), clean));
}

export const totpUri = (secret: string, email: string): string =>
    `otpauth://totp/${encodeURIComponent('SUSKII Admin')}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent('SUSKII Admin')}&algorithm=SHA1&digits=6&period=30`;

export function newRecoveryCodes(n = 10): string[] {
    return Array.from({ length: n }, () => {
        const raw = randomBytes(5).toString('hex').toUpperCase();
        return `${raw.slice(0, 5)}-${raw.slice(5)}`;
    });
}

/** Stable, non-reversible fingerprint for IPs stored alongside public submissions. */
export const ipFingerprint = (ip: string): string => hmacHex(centralSecret(), `ip:${ip}`).slice(0, 32);

export function maskEmail(email: string | undefined | null): string | null {
    if (!email) return null;
    const [user, domain] = email.split('@');
    if (!domain) return null;
    return `${user.slice(0, 1)}${'•'.repeat(Math.max(2, Math.min(6, user.length - 1)))}@${domain}`;
}
