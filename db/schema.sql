-- Run only against the NEW NYC event database. No original tables are used.
begin;

create table if not exists nyc_score_submissions (
  submission_id uuid primary key,
  payload_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists nyc_scores (
  id uuid primary key references nyc_score_submissions(submission_id),
  name text not null check (char_length(name) between 2 and 20),
  score integer not null check (score >= 0),
  distance integer not null check (distance >= 0),
  date timestamptz not null default now(),
  archived boolean not null default false
);

create index if not exists nyc_scores_ranking on nyc_scores (score desc, date asc, id asc) where not archived;
commit;
