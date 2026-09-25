import { createHmac } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { secretsMatch } from '@/app/lib/scores';

export const STATION_COOKIE = 'nyc_station';
export const STATION_TTL = 12 * 60 * 60;

export function sameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  return origin === request.nextUrl.origin && !['cross-site', 'same-site'].includes(request.headers.get('sec-fetch-site') ?? '');
}

export function stationToken(expires: number) {
  const secret = process.env.NYC_STATION_SECRET;
  if (!secret) throw new Error('Station is not configured');
  const signature = createHmac('sha256', secret).update(`nyc-station:${expires}`).digest('hex');
  return `${expires}.${signature}`;
}

export function isStation(request: NextRequest) {
  if (!process.env.NYC_STATION_SECRET) return false;
  const token = request.cookies.get(STATION_COOKIE)?.value;
  if (!token || !/^\d{10}\.[a-f0-9]{64}$/.test(token)) return false;
  const expires = Number(token.split('.')[0]);
  const now = Math.floor(Date.now() / 1000);
  return expires > now && expires <= now + STATION_TTL && secretsMatch(token, stationToken(expires));
}

export function unavailable() {
  return NextResponse.json({ error: 'Score storage is temporarily unavailable. Please retry.' }, { status: 503 });
}
