import { NextRequest, NextResponse } from 'next/server';
import { addScore, getRankings, getTopScores, isAdminSecret, MAX_SCORE_VALUE, SubmissionConflict, UUID_PATTERN } from '@/app/lib/scores';
import { isStation, sameOrigin, unavailable } from '../_auth';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const pageText = params.get('page') ?? '1';
  const page = Number(pageText);
  const searchText = params.get('search') ?? '';
  const search = searchText.trim();
  if (!/^[1-9]\d*$/.test(pageText) || !Number.isSafeInteger(page) || page > 42949672 || searchText.length > 20) {
    return NextResponse.json({ error: 'Invalid page or search (maximum 20 characters)' }, { status: 400 });
  }
  try {
    const body = params.has('page') || params.has('search') ? await getRankings(page, search) : { scores: await getTopScores() };
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return unavailable(); }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Same-origin request required' }, { status: 403 });
  if (!isStation(request)) return NextResponse.json({ error: 'Unlock this station before saving' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const validInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_SCORE_VALUE;
  if (name.length < 2 || name.length > 20 || !validInteger(body?.score) || !validInteger(body?.distance) || typeof body?.submissionId !== 'string' || !UUID_PATTERN.test(body.submissionId)) {
    return NextResponse.json({ error: 'Invalid score payload' }, { status: 400 });
  }
  try {
    await addScore({ name, score: body.score, distance: body.distance, submissionId: body.submissionId });
    return NextResponse.json({ scores: await getTopScores() }, { status: 201 });
  } catch (error) {
    if (error instanceof SubmissionConflict) return NextResponse.json({ error: 'Submission ID already used for a different score' }, { status: 409 });
    return unavailable();
  }
}

export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Same-origin request required' }, { status: 403 });
  if (!isAdminSecret(request.headers.get('x-admin-secret'))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ error: 'Score id required' }, { status: 400 });
}
