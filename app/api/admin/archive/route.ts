import { NextRequest, NextResponse } from 'next/server';
import { archiveCurrentScores, getTopScores, isAdminSecret } from '@/app/lib/scores';

export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-admin-secret');
  if (!isAdminSecret(secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await archiveCurrentScores();
  return NextResponse.json({ scores: await getTopScores() });
}
