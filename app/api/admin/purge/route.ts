import { NextRequest, NextResponse } from 'next/server';
import { getTopScores, isAdminSecret, purgeAllScores } from '@/app/lib/scores';

export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-admin-secret');
  if (!isAdminSecret(secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await purgeAllScores();
  return NextResponse.json({ scores: await getTopScores() });
}
