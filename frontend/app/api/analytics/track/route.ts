import { NextRequest, NextResponse } from 'next/server';
import { forwardToBackend } from '@/lib/server/backend';
import { enforceMutationOrigin } from '@/lib/server/request-security';

const MAX_EVENTS = 50;
const MAX_BODY_CHARS = 64 * 1024;

function isOptionalString(value: unknown, maxLength: number): boolean {
  return value === undefined || (typeof value === 'string' && value.length <= maxLength);
}

function isValidEvent(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  if (typeof event.event !== 'string' || event.event.trim().length === 0 || event.event.length > 100) return false;
  if (!isOptionalString(event.category, 100) || !isOptionalString(event.label, 200)) return false;
  if (event.timestamp !== undefined && (typeof event.timestamp !== 'number' || !Number.isFinite(event.timestamp))) return false;
  if (event.value !== undefined && (typeof event.value !== 'number' || !Number.isFinite(event.value))) return false;
  if (event.metadata !== undefined) {
    if (!event.metadata || typeof event.metadata !== 'object' || Array.isArray(event.metadata)) return false;
    if (JSON.stringify(event.metadata).length > 4096) return false;
  }
  return true;
}

/**
 * Analytics tracking endpoint.
 * Receives batched events, logs for now (will integrate DB later).
 */
export async function POST(request: NextRequest) {
  const originError = enforceMutationOrigin(request);
  if (originError) return originError;

  if (!request.cookies.get('docai_session')?.value) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_CHARS) {
      return NextResponse.json({ ok: false, error: 'Payload too large' }, { status: 413 });
    }
    const body = JSON.parse(raw) as { events?: unknown };
    const events = body.events;

    if (!Array.isArray(events) || events.length === 0 || events.length > MAX_EVENTS || !events.every(isValidEvent)) {
      return NextResponse.json({ ok: false, error: 'Invalid events' }, { status: 400 });
    }

    const authResponse = await forwardToBackend('GET', '/api/auth/me', {
      headers: { Authorization: `Bearer ${request.cookies.get('docai_session')!.value}` },
      signal: request.signal,
    });
    if (!authResponse.ok) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Validated telemetry is intentionally not logged because labels and metadata may contain user content.
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[Analytics] Failed:', error);
    return NextResponse.json({ ok: false, error: 'Invalid payload' }, { status: 400 });
  }
}
