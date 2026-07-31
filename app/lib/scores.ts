import postgres from 'postgres';

export interface StoredScore {
  id: string;
  name: string;
  score: number;
  distance: number;
  date: string;
}

let client: postgres.Sql | null = null;

function sql() {
  if (!process.env.POSTGRES_URL) {
    throw new Error('POSTGRES_URL is required for persistent score storage');
  }

  client ??= postgres(process.env.POSTGRES_URL, { ssl: 'require' });
  return client;
}

function normalizeScore(row: {
  id: string;
  name: string;
  score: number;
  distance: number;
  date: Date | string;
}): StoredScore {
  return {
    id: row.id,
    name: row.name,
    score: row.score,
    distance: row.distance,
    date: row.date instanceof Date ? row.date.toISOString() : row.date,
  };
}

export async function getTopScores() {
  const rows = await sql()<StoredScore[]>`
    select id, name, score, distance, date
    from scores
    order by score desc, date asc
    limit 10
  `;
  return rows.map(normalizeScore);
}

export async function addScore(input: { name: string; score: number; distance: number }) {
  const rows = await sql()<StoredScore[]>`
    insert into scores (name, score, distance)
    values (${input.name.slice(0, 20)}, ${input.score}, ${input.distance})
    returning id, name, score, distance, date
  `;
  return normalizeScore(rows[0]);
}

export async function deleteScore(id: string) {
  const rows = await sql()<Array<{ id: string }>>`
    delete from scores
    where id = ${id}
    returning id
  `;
  return rows.length > 0;
}

export async function archiveCurrentScores() {
  const client = sql();
  await client.begin(async (tx) => {
    await tx`
      insert into score_archives (original_id, name, score, distance, date)
      select id, name, score, distance, date from scores
    `;
    await tx`delete from scores`;
  });
}

export async function purgeAllScores() {
  const client = sql();
  await client.begin(async (tx) => {
    await tx`delete from scores`;
    await tx`delete from score_archives`;
  });
}

export function isAdminSecret(secret: string | null) {
  return Boolean(process.env.ADMIN_SECRET) && secret === process.env.ADMIN_SECRET;
}
