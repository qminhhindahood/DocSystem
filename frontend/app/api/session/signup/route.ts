import { NextRequest, NextResponse } from 'next/server';
import { forwardToBackend } from '@/lib/server/backend';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/server/session';
import { enforceMutationOrigin } from '@/lib/server/request-security';
import { deriveClientIp } from '@/lib/server/client-ip';

export async function POST(req: NextRequest) {
  const originError = enforceMutationOrigin(req);
  if (originError) return originError;

  try {
    const body = await req.json();
    const { username, email, password, passwordConfirmation, turnstileToken } = body;

    if (!username || !email || !password || !passwordConfirmation) {
      return NextResponse.json(
        { error: 'Username, email, password, and password confirmation are required' },
        { status: 400 },
      );
    }

    if (password !== passwordConfirmation) {
      return NextResponse.json({ error: 'Passwords do not match' }, { status: 400 });
    }
    if (typeof turnstileToken !== 'string' || !turnstileToken || turnstileToken.length > 2_048) {
      return NextResponse.json(
        { code: 'TURNSTILE_REQUIRED', error: 'Vui lòng hoàn tất bước xác minh.' },
        { status: 400 },
      );
    }
    const normalizedEmail = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return NextResponse.json({ error: 'Email is invalid' }, { status: 400 });
    }

    const clientIp = deriveClientIp(req);
    const backendRes = await forwardToBackend('POST', '/api/auth/register', {
      body: JSON.stringify({ username, email: normalizedEmail, password, turnstileToken }),
      headers: {
        'Content-Type': 'application/json',
        ...(clientIp ? { 'X-DocAI-Client-IP': clientIp } : {}),
      },
      signal: req.signal,
    });

    const data = await backendRes.json();

    if (!backendRes.ok) {
      return NextResponse.json(
        { error: data.error || 'Registration failed' },
        { status: backendRes.status },
      );
    }

    const response = NextResponse.json({
      success: true,
      user: data.user,
    });

    response.cookies.set(SESSION_COOKIE, data.token, sessionCookieOptions());

    return response;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Registration failed: ${message}` }, { status: 502 });
  }
}
