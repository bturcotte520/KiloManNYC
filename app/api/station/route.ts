import { NextRequest, NextResponse } from 'next/server';
import { secretsMatch } from '@/app/lib/scores';
import { isStation, sameOrigin, STATION_COOKIE, STATION_TTL, stationToken } from '../_auth';

export async function GET(request: NextRequest) {
  return NextResponse.json({ unlocked: isStation(request) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Same-origin request required' }, { status: 403 });
  if (!process.env.NYC_STATION_SECRET) return NextResponse.json({ error: 'Station access is not configured' }, { status: 503 });
  const body = await request.json().catch(() => null);
  if (typeof body?.secret !== 'string' || !secretsMatch(body.secret, process.env.NYC_STATION_SECRET)) {
    return NextResponse.json({ error: 'Invalid station secret' }, { status: 401 });
  }
  const response = NextResponse.json({ unlocked: true });
  response.cookies.set(STATION_COOKIE, stationToken(Math.floor(Date.now() / 1000) + STATION_TTL), {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: STATION_TTL,
  });
  return response;
}

export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Same-origin request required' }, { status: 403 });
  const response = NextResponse.json({ unlocked: false });
  response.cookies.set(STATION_COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 0 });
  return response;
}
