import { NextRequest, NextResponse } from 'next/server';
import { addScore, getTopScores, isAdminSecret } from '@/app/lib/scores';

export async function GET() {
  return NextResponse.json({ scores: await getTopScores() });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { name?: unknown; score?: unknown; distance?: unknown } | null;
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const score = typeof body?.score === 'number' ? Math.floor(body.score) : NaN;
  const distance = typeof body?.distance === 'number' ? Math.floor(body.distance) : NaN;

  if (name.length < 2 || name.length > 20 || !Number.isFinite(score) || score < 0 || !Number.isFinite(distance) || distance < 0) {
    return NextResponse.json({ error: 'Invalid score payload' }, { status: 400 });
  }

  await addScore({ name, score, distance });
  return NextResponse.json({ scores: await getTopScores() }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const secret = request.headers.get('x-admin-secret');
  if (!isAdminSecret(secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json({ error: 'Score id required' }, { status: 400 });
}
