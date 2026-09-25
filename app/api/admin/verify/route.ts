import { NextRequest, NextResponse } from 'next/server';
import { isAdminSecret } from '@/app/lib/scores';
import { sameOrigin } from '../../_auth';

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Same-origin request required' }, { status: 403 });
  const secret = request.headers.get('x-admin-secret');
  if (!isAdminSecret(secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
