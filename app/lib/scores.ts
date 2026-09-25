import { createHash, timingSafeEqual } from 'node:crypto';
import postgres from 'postgres';

export interface StoredScore {
  id: string;
  name: string;
  score: number;
  distance: number;
  date: string;
  rank: number;
}

export const MAX_SCORE_VALUE = 2147483647;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let client: postgres.Sql | null = null;

function sql() {
  if (!process.env.NYC_POSTGRES_URL) throw new Error('NYC database is not configured');
  client ??= postgres(process.env.NYC_POSTGRES_URL, { ssl: 'require' });
  return client;
}

export async function getRankings(page = 1, search = '', pageSize = 50) {
  const [result] = await sql()<Array<{ scores: StoredScore[]; total: number }>>`
    with ranked as (
      select id, name, score, distance, date,
        (row_number() over (order by score desc, date asc, id asc))::integer as rank
      from nyc_scores
      where not archived
    ), filtered as (
      select * from ranked where strpos(lower(name), lower(${search})) > 0
    ), paged as (
      select * from filtered order by rank limit ${pageSize} offset ${(page - 1) * pageSize}
    )
    select coalesce((select json_agg(paged order by rank) from paged), '[]'::json) as scores,
      (select count(*)::integer from filtered) as total
  `;
  return { ...result, page, pageSize };
}

export async function getTopScores() {
  return (await getRankings(1, '', 10)).scores;
}

export class SubmissionConflict extends Error {}

export async function addScore(input: { submissionId: string; name: string; score: number; distance: number }) {
  const hash = createHash('sha256').update(JSON.stringify([input.name, input.score, input.distance])).digest('hex');
  await sql().begin(async (tx) => {
    const inserted = await tx`
      insert into nyc_score_submissions (submission_id, payload_hash)
      values (${input.submissionId}, ${hash}) on conflict do nothing returning submission_id
    `;
    if (!inserted.length) {
      const [existing] = await tx`select payload_hash from nyc_score_submissions where submission_id = ${input.submissionId}`;
      if (existing.payload_hash !== hash) throw new SubmissionConflict();
      return;
    }
    await tx`
      insert into nyc_scores (id, name, score, distance)
      values (${input.submissionId}, ${input.name}, ${input.score}, ${input.distance})
    `;
  });
}

export async function deleteScore(id: string) {
  const rows = await sql()`delete from nyc_scores where id = ${id} and not archived returning id`;
  return rows.length > 0;
}

export async function archiveCurrentScores() {
  await sql()`update nyc_scores set archived = true where not archived`;
}

export async function purgeAllScores() {
  // Retain idempotency receipts so delayed retries cannot resurrect purged scores.
  await sql()`delete from nyc_scores`;
}

export function secretsMatch(value: string | null, expected: string | undefined) {
  if (!value || !expected) return false;
  const hash = (text: string) => createHash('sha256').update(text).digest();
  return timingSafeEqual(hash(value), hash(expected));
}

export function isAdminSecret(secret: string | null) {
  return secretsMatch(secret, process.env.NYC_ADMIN_SECRET);
}
