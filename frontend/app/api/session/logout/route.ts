import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/server/session';
import { enforceMutationOrigin } from '@/lib/server/request-security';

export async function POST(request: NextRequest) {
  const originError = enforceMutationOrigin(request);
  if (originError) return originError;

  const response = NextResponse.json({ success: true, message: 'Logged out' });

  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV !== 'development',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });

  return response;
}
