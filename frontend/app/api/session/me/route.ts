import { NextRequest, NextResponse } from 'next/server';
import { forwardToBackend } from '@/lib/server/backend';

export async function GET(req: NextRequest) {
  const token = req.cookies.get('docai_session')?.value;

  if (!token) {
    return NextResponse.json({ user: null }, { status: 200 });
  }

  try {
    const backendRes = await forwardToBackend('GET', '/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!backendRes.ok) {
      return NextResponse.json({ user: null }, { status: 200 });
    }

    const data = await backendRes.json();
    return NextResponse.json({ user: data.user || data.data || null });
  } catch {
    return NextResponse.json({ user: null }, { status: 200 });
  }
}
