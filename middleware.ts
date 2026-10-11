import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

const rateLimitMap = new Map<string, RateLimitRecord>();

function cleanupExpired() {
  const now = Date.now();
  rateLimitMap.forEach((record, ip) => {
    if (now > record.resetTime) {
      rateLimitMap.delete(ip);
    }
  });
}

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === '/api/chat' && request.method === 'POST') {
    cleanupExpired();

    const forwardedFor = request.headers.get('x-forwarded-for');
    const realIp = request.headers.get('x-real-ip');
    const ip = forwardedFor ? forwardedFor.split(',')[0].trim() : (realIp || request.ip || '127.0.0.1');

    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minute
    const limit = 20;

    let record = rateLimitMap.get(ip);

    if (!record || now > record.resetTime) {
      record = {
        count: 1,
        resetTime: now + windowMs,
      };
      rateLimitMap.set(ip, record);
    } else {
      record.count += 1;
    }

    const remaining = Math.max(0, limit - record.count);
    const retryAfter = Math.ceil((record.resetTime - now) / 1000);

    if (record.count > limit) {
      return NextResponse.json(
        { error: 'Terlalu banyak permintaan, coba lagi sebentar' },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': limit.toString(),
            'X-RateLimit-Remaining': '0',
            'Retry-After': retryAfter.toString(),
          },
        }
      );
    }

    const res = NextResponse.next();
    res.headers.set('X-RateLimit-Limit', limit.toString());
    res.headers.set('X-RateLimit-Remaining', remaining.toString());
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/chat',
};
