import { NextRequest, NextResponse } from 'next/server';
import { deleteScore, getTopScores, isAdminSecret, UUID_PATTERN } from '@/app/lib/scores';
import { sameOrigin, unavailable } from '../../_auth';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Same-origin request required' }, { status: 403 });
  const secret = request.headers.get('x-admin-secret');
  if (!isAdminSecret(secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: 'Invalid score id' }, { status: 400 });
  try {
    const deleted = await deleteScore(id);
    if (!deleted) {
      return NextResponse.json({ error: 'Score not found' }, { status: 404 });
    }

    return NextResponse.json({ scores: await getTopScores() });
  } catch { return unavailable(); }
}
