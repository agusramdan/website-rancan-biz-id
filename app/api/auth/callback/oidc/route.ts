import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';

/**
 * GET /api/auth/callback/oidc
 * Callback Authorization Code Flow dari Authentik:
 * validasi state → tukar code → validasi id_token → terbitkan JWT session (sama dgn OTP).
 */
function getIssuer(): string {
  const iss = process.env.AUTH_OIDC_ISSUER;
  if (!iss) throw new Error('AUTH_OIDC_ISSUER tidak ter-set');
  return iss.replace(/\/$/, '');
}

function getPublicOrigin(request: NextRequest): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'rancan.biz.id';
  return `${proto}://${host}`;
}

export async function GET(request: NextRequest) {
  try {
    const issuer = getIssuer();
    const clientId = process.env.AUTH_OIDC_CLIENT_ID!;
    const clientSecret = process.env.AUTH_OIDC_CLIENT_SECRET!;
    const jwtSecret = process.env.AUTH_JWT_SECRET;
    if (!clientId || !clientSecret || !jwtSecret) {
      return NextResponse.json({ error: 'Konfigurasi OIDC/JWT tidak lengkap' }, { status: 500 });
    }

    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const origin = getPublicOrigin(request);
    const redirectUri = `${origin}/api/auth/callback/oidc`;

    if (!code || !state) {
      return NextResponse.redirect(`${origin}/login?error=oidc_missing_params`, 302);
    }

    // 1. Validasi state (query vs cookie)
    const cookieState = request.cookies.get('oidc_state')?.value;
    if (!cookieState || cookieState !== state) {
      return NextResponse.redirect(`${origin}/login?error=oidc_state_mismatch`, 302);
    }

    // 2. Discovery → token endpoint
    const discovery = await fetch(`${issuer}/.well-known/openid-configuration`, { cache: 'no-store' });
    if (!discovery.ok) {
      return NextResponse.redirect(`${origin}/login?error=oidc_discovery_failed`, 302);
    }
    const discoveryDoc = await discovery.json();
    const tokenEndpoint = discoveryDoc.token_endpoint;

    // 3. Tukar code → token
    const tokenResp = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    if (!tokenResp.ok) {
      console.error('[callback-oidc] token exchange gagal:', tokenResp.status, (await tokenResp.text()).slice(0, 200));
      return NextResponse.redirect(`${origin}/login?error=oidc_token_exchange`, 302);
    }
    const tokens = await tokenResp.json();
    const idToken: string = tokens.id_token;

    // 4. Decode & validasi claims
    const decoded = jwt.decode(idToken, { complete: true });
    if (!decoded || typeof decoded.payload === 'string') {
      return NextResponse.redirect(`${origin}/login?error=oidc_invalid_token`, 302);
    }
    const payload = decoded.payload as { iss?: string; exp?: number; aud?: string | string[]; email?: string; sub?: string; preferred_username?: string };
    const aud = Array.isArray(payload.aud) ? payload.aud[0] : payload.aud;
    if (payload.iss !== issuer || aud !== clientId) {
      return NextResponse.redirect(`${origin}/login?error=oidc_claim_mismatch`, 302);
    }
    if (!payload.exp || payload.exp * 1000 < Date.now()) {
      return NextResponse.redirect(`${origin}/login?error=oidc_token_expired`, 302);
    }

    // 5. Identitas user
    const email = payload.email || payload.preferred_username || `${payload.sub}@oidc.local`;
    const userId = Buffer.from(`oidc:${email}`).toString('base64url').slice(0, 32);

    // 6. JWT session internal (sama dgn OTP)
    const sessionToken = jwt.sign(
      { sub: userId, identifier: email, role: 'customer', via: 'oidc' },
      jwtSecret,
      { expiresIn: '7d' }
    );

    // 7. Chatwoot HMAC
    const chatwootSecretKeyBase = process.env.CHATWOOT_SECRET_KEY_BASE;
    let identifierHash = '';
    if (chatwootSecretKeyBase) {
      const crypto = await import('crypto');
      identifierHash = crypto.createHmac('sha256', chatwootSecretKeyBase).update(userId).digest('hex');
    }

    // 8. Cookie + redirect
    const response = NextResponse.redirect(`${origin}/login?sso=success`, 302);
    response.cookies.set('rancan_session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    // 9. Odoo sync fire-and-forget
    const natsUrl = process.env.NATS_URL || 'nats://nats:404c576ee79678c4510a7e4e8d68b980@127.0.0.1:4222';
    (async () => {
      const nats = await import('nats');
      const nc = await nats.connect({ servers: natsUrl });
      await nc.publish(
        'hermes.command.partner.upsert',
        Buffer.from(JSON.stringify({ identifier: email, user_id: userId, source: 'rancan-website-oidc', role: 'customer' }))
      );
      await nc.drain();
    })().catch(err => console.error('[callback-oidc] NATS sync gagal (diabaikan):', err));

    return response;
  } catch (err) {
    console.error('[callback-oidc]', err);
    const origin = new URL(request.url).origin;
    return NextResponse.redirect(`${origin}/login?error=oidc_internal`, 302);
  }
}
