import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/auth/login-oidc
 * Memulai Authorization Code Flow ke Authentik (oidc.agusramdan.web.id).
 * Redirect 302 ke authorize endpoint dengan state (CSRF) ber-TTL 10 menit.
 */
const STATE_TTL_MS = 10 * 60 * 1000;

// In-memory state store (single-instance deployment)
const stateStore = new Map<string, { createdAt: number }>();

function getIssuer(): string {
  const iss = process.env.AUTH_OIDC_ISSUER;
  if (!iss) throw new Error('AUTH_OIDC_ISSUER tidak ter-set');
  return iss.replace(/\/$/, '');
}

/** Origin publik: prioritas APP_URL env, lalu x-forwarded-* dari Caddy */
function getPublicOrigin(request: NextRequest): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'rancan.biz.id';
  return `${proto}://${host}`;
}

// Bersihkan state kadaluarsa
function pruneStates() {
  const now = Date.now();
  Array.from(stateStore.entries()).forEach(([k, v]) => {
    if (now - v.createdAt > STATE_TTL_MS) stateStore.delete(k);
  });
}

export async function GET(request: NextRequest) {
  try {
    const clientId = process.env.AUTH_OIDC_CLIENT_ID;
    const issuer = getIssuer();
    if (!clientId) {
      return NextResponse.json({ error: 'Konfigurasi OIDC tidak lengkap' }, { status: 500 });
    }

    pruneStates();

    const state = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
    stateStore.set(state, { createdAt: Date.now() });

    const origin = getPublicOrigin(request);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: `${origin}/api/auth/callback/oidc`,
      scope: 'openid email profile',
      state,
    });

    const authorizeUrl = `${issuer}/authorize?${params.toString()}`;
    const response = NextResponse.redirect(authorizeUrl, 302);
    response.cookies.set('oidc_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600,
      path: '/',
    });
    return response;
  } catch (err) {
    console.error('[login-oidc]', err);
    return NextResponse.json({ error: 'Gagal memulai login SSO' }, { status: 500 });
  }
}
