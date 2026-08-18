import { NextRequest, NextResponse } from 'next/server';
import { forwardToBackend } from '@/lib/server/backend';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/server/session';
import { enforceMutationOrigin } from '@/lib/server/request-security';

export async function POST(req: NextRequest) {
  const originError = enforceMutationOrigin(req);
  if (originError) return originError;

  try {
    const body = await req.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password are required' }, { status: 400 });
    }

    const backendRes = await forwardToBackend('POST', '/api/auth/login', {
      body: JSON.stringify({ username, password }),
      headers: { 'Content-Type': 'application/json' },
      signal: req.signal,
    });

    const data = await backendRes.json();

    if (!backendRes.ok) {
      return NextResponse.json(
        { error: data.error || 'Invalid username or password' },
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
    return NextResponse.json({ error: `Login failed: ${message}` }, { status: 502 });
  }
}
