import { NextRequest, NextResponse } from 'next/server';
import { forwardToBackend } from '@/lib/server/backend';
import {
  SESSION_COOKIE,
  sessionCookieOptions,
} from '@/lib/server/session';
import { enforceMutationOrigin } from '@/lib/server/request-security';

export async function DELETE(request: NextRequest) {
  const originError = enforceMutationOrigin(request);
  if (originError) return originError;

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  let password: unknown;
  try {
    ({ password } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 100) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 400 });
  }

  try {
    const backendResponse = await forwardToBackend('DELETE', '/api/auth/me', {
      body: JSON.stringify({ password }),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    if (!backendResponse.ok) {
      const body = await backendResponse.json().catch(() => ({})) as { error?: string };
      return NextResponse.json(
        { error: body.error || 'Unable to delete account' },
        { status: backendResponse.status },
      );
    }

    const response = new NextResponse(null, { status: 204 });
    response.cookies.set(SESSION_COOKIE, '', {
      ...sessionCookieOptions(),
      maxAge: 0,
    });
    return response;
  } catch {
    return NextResponse.json({ error: 'Unable to delete account' }, { status: 502 });
  }
}
