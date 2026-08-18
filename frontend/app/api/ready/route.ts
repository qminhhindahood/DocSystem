import { NextResponse } from 'next/server';
import { forwardToBackend } from '@/lib/server/backend';

export async function GET(): Promise<NextResponse> {
  try {
    const response = await forwardToBackend('GET', '/ready');
    if (response.ok) return NextResponse.json({ status: 'ready' });
  } catch {
    // The public readiness response deliberately omits private topology and errors.
  }
  return NextResponse.json({ status: 'not_ready' }, { status: 503 });
}
