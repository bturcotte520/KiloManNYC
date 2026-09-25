import { NextRequest, NextResponse } from 'next/server';
import { archiveCurrentScores, getTopScores, isAdminSecret } from '@/app/lib/scores';
import { sameOrigin, unavailable } from '../../_auth';

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Same-origin request required' }, { status: 403 });
  const secret = request.headers.get('x-admin-secret');
  if (!isAdminSecret(secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await archiveCurrentScores();
    return NextResponse.json({ scores: await getTopScores() });
  } catch { return unavailable(); }
}
