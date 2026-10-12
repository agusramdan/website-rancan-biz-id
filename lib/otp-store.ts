/**
 * OTP Store — in-memory TTL store untuk Fasa 1 Telegram OTP Login.
 * Kunci: `${ip}:${identifier}` → { otp, expiresAt, attempts }
 * TTL: 5 menit. One-time use (dihapus setelah verify sukses).
 * Rate limit: maks 3 request per menit per kunci.
 */

interface OtpRecord {
  otp: string;
  expiresAt: number;
  attempts: number;
}

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

const otpStore = new Map<string, OtpRecord>();
const rateLimitStore = new Map<string, RateLimitRecord>();

const OTP_TTL_MS = 5 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 3;

/** Generate 6-digit numeric OTP acak. */
export function generateOtp(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  // 6 digit: 100000..999999
  return String(100000 + (bytes[0] % 900000));
}

/** Simpan OTP dengan TTL. */
export function storeOtp(key: string, otp: string): void {
  otpStore.set(key, {
    otp,
    expiresAt: Date.now() + OTP_TTL_MS,
    attempts: 0,
  });
}

/** Ambil & validasi OTP. Return true bila cocok dan belum期满. */
export function verifyOtp(key: string, otp: string): boolean {
  const rec = otpStore.get(key);
  if (!rec) return false;
  if (Date.now() > rec.expiresAt) {
    otpStore.delete(key);
    return false;
  }
  rec.attempts += 1;
  if (rec.attempts > 5) {
    otpStore.delete(key);
    return false;
  }
  if (rec.otp !== otp) return false;
  otpStore.delete(key); // one-time use
  return true;
}

/** Hapus OTP (misal setelah expired atau terlalu banyak percobaan). */
export function deleteOtp(key: string): void {
  otpStore.delete(key);
}

/** Cek rate limit. Return { allowed, remaining, retryAfterSec }. */
export function checkRateLimit(key: string): { allowed: boolean; remaining: number; retryAfterSec: number } {
  const now = Date.now();
  let rec = rateLimitStore.get(key);
  if (!rec || now > rec.resetTime) {
    rec = { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS };
    rateLimitStore.set(key, rec);
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1, retryAfterSec: 0 };
  }
  rec.count += 1;
  if (rec.count > RATE_LIMIT_MAX) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.ceil((rec.resetTime - now) / 1000),
    };
  }
  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX - rec.count,
    retryAfterSec: 0,
  };
}

/** Bersihkan record expired (dipanggil sesekali). */
export function cleanupExpired(): void {
  const now = Date.now();
  for (const [k, v] of Array.from(otpStore.entries())) {
    if (now > v.expiresAt) otpStore.delete(k);
  }
  for (const [k, v] of Array.from(rateLimitStore.entries())) {
    if (now > v.resetTime) rateLimitStore.delete(k);
  }
}