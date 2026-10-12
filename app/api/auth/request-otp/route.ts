import { NextRequest, NextResponse } from 'next/server';
import { generateOtp, storeOtp, checkRateLimit, cleanupExpired } from '../../../../lib/otp-store';

export async function POST(request: NextRequest) {
  cleanupExpired();

  let identifier: string;
  try {
    const body = await request.json();
    identifier = body?.identifier?.trim();
  } catch {
    return NextResponse.json({ error: 'Body JSON tidak valid' }, { status: 400 });
  }

  if (!identifier) {
    return NextResponse.json({ error: 'Identifier wajib diisi' }, { status: 400 });
  }

  // Basic validation: phone, email, or telegram id format
  const isPhone = /^(\+?62|0)[0-9]{9,12}$/.test(identifier);
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
  const isTelegramId = /^[0-9]{5,}$/.test(identifier);

  if (!isPhone && !isEmail && !isTelegramId) {
    return NextResponse.json({ error: 'Format identifier tidak dikenal (harus nomor HP, email, atau Telegram ID)' }, { status: 400 });
  }

  // Rate limit per IP + identifier
  const forwardedFor = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  const ip = forwardedFor ? forwardedFor.split(',')[0].trim() : (realIp || '127.0.0.1');
  const rateKey = `${ip}:${identifier}`;

  const { allowed, remaining, retryAfterSec } = checkRateLimit(rateKey);
  if (!allowed) {
    return NextResponse.json(
      { error: 'Terlalu banyak permintaan OTP, coba lagi sebentar' },
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': '3',
          'X-RateLimit-Remaining': '0',
          'Retry-After': retryAfterSec.toString(),
        },
      }
    );
  }

  const otp = generateOtp();
  storeOtp(rateKey, otp);

  // Send via Telegram Bot
  let sent = false;
  let masked = '';
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const targetChatId = process.env.TELEGRAM_OWNER_CHAT_ID || '5070047968';
    
    if (botToken) {
      const message = `🔐 *Kode OTP Login Rancan*\n\nKode Anda: \`${otp}\`\n\nBerlaku 5 menit. Jangan bagikan kode ini ke siapapun.`;
      
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: targetChatId,
          text: message,
          parse_mode: 'Markdown',
        }),
      });
      
      if (response.ok) {
        sent = true;
      } else {
        const err = await response.json();
        console.error('[request-otp] Telegram send failed:', err);
      }
    }
  } catch (err) {
    console.error('[request-otp] Telegram error:', err);
  }

  // Mask identifier for response
  if (isPhone && identifier.length >= 4) {
    masked = identifier.slice(0, 3) + '***' + identifier.slice(-2);
  } else if (isEmail) {
    const [local, domain] = identifier.split('@');
    masked = local.slice(0, 2) + '***' + '@' + domain;
  } else if (isTelegramId) {
    masked = identifier.slice(0, 2) + '****';
  }

  return NextResponse.json({
    success: true,
    message: sent ? 'OTP berhasil dikirim ke Telegram' : 'OTP digenerate (Telegram gagal kirim, cek log server)',
    sent,
    masked,
    rateLimitRemaining: remaining,
  });
}