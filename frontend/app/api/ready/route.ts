import { NextResponse } from 'next/server';
import { forwardToBackend } from '@/lib/server/backend';
import { passwordResetEnabled } from '@/lib/server/password-reset-mode';
import { isPublicRegistrationEnabled } from '@/lib/server/public-registration-mode';

export async function GET(): Promise<NextResponse> {
  try {
    passwordResetEnabled();
    if (
      isPublicRegistrationEnabled()
      && !process.env.TURNSTILE_SITE_KEY?.trim()
    ) {
      return NextResponse.json({ status: 'not_ready' }, { status: 503 });
    }
    const response = await forwardToBackend('GET', '/ready');
    if (response.ok) return NextResponse.json({ status: 'ready' });
  } catch {
    // The public readiness response deliberately omits private topology and errors.
  }
  return NextResponse.json({ status: 'not_ready' }, { status: 503 });
}
