import { NextRequest, NextResponse } from 'next/server';
import { verifyOtp, deleteOtp } from '../../../../lib/otp-store';
import jwt from 'jsonwebtoken';

export async function POST(request: NextRequest) {
  let identifier: string;
  let otp: string;
  try {
    const body = await request.json();
    identifier = body?.identifier?.trim();
    otp = body?.otp?.trim();
  } catch {
    return NextResponse.json({ error: 'Body JSON tidak valid' }, { status: 400 });
  }

  if (!identifier || !otp) {
    return NextResponse.json({ error: 'Identifier dan OTP wajib diisi' }, { status: 400 });
  }

  if (!/^\d{6}$/.test(otp)) {
    return NextResponse.json({ error: 'OTP harus 6 digit numerik' }, { status: 400 });
  }

  const forwardedFor = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  const ip = forwardedFor ? forwardedFor.split(',')[0].trim() : (realIp || '127.0.0.1');
  const rateKey = `${ip}:${identifier}`;

  const ok = verifyOtp(rateKey, otp);
  if (!ok) {
    return NextResponse.json({ error: 'OTP tidak valid atau sudah kedaluwarsa' }, { status: 400 });
  }

  // Buat user ID sederhana (hash identifier) — untuk Fasa 1, user ID = identifier itu sendiri
  const userId = Buffer.from(identifier).toString('base64url').slice(0, 32);
  const jwtSecret = process.env.AUTH_JWT_SECRET;
  if (!jwtSecret) {
    console.error('[verify-otp] AUTH_JWT_SECRET tidak ter-set');
    return NextResponse.json({ error: 'Konfigurasi server tidak lengkap' }, { status: 500 });
  }

  const token = jwt.sign(
    { sub: userId, identifier, role: 'customer' },
    jwtSecret,
    { expiresIn: '7d' }
  );

  // Chatwoot HMAC
  const chatwootSecretKeyBase = process.env.CHATWOOT_SECRET_KEY_BASE;
  let identifierHash = '';
  if (chatwootSecretKeyBase) {
    const crypto = await import('crypto');
    identifierHash = crypto.createHmac('sha256', chatwootSecretKeyBase).update(userId).digest('hex');
  }

  // Set httpOnly cookie
  const response = NextResponse.json({
    success: true,
    authenticated: true,
    user: { id: userId, identifier },
    chatwoot_hmac: identifierHash,
  });

  response.cookies.set('rancan_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });

  // Fire-and-forget Odoo sync via NATS publish
  const natsUrl = process.env.NATS_URL || 'nats://nats:404c576ee79678c4510a7e4e8d68b980@127.0.0.1:4222';
  const { NatsError, NATS_MAX_PAYLOAD } = {};
  try {
    (async () => {
      const nats = await import('nats');
      const nc = await nats.connect({ servers: natsUrl });
      await nc.publish(
        'hermes.command.partner.upsert',
        Buffer.from(JSON.stringify({ identifier, user_id: userId, source: 'rancan-website', role: 'customer' }))
      );
      await nc.drain();
      console.log('[verify-otp] Odoo sync NATS published OK');
    })().catch(err => {
      console.error('[verify-otp] NATS sync gagal (diabaikan):', err);
    });
  } catch (e) {
    console.error('[verify-otp] NATS publish error (diabaikan):', e);
  }

  return response;
}