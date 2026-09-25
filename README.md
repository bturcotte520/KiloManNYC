# Kiloman NYC Event

NYC event clone with a public leaderboard and staff-unlocked game stations. The original deployment and database must remain untouched.

## Isolation Rules

- Create a **new Vercel project** and a **new PostgreSQL database** for NYC. Do not import/link this directory to the existing game's Vercel project, reuse its database credentials, or attach its database integration.
- If this checkout has an existing `.vercel` project link, do not use it. Use a fresh checkout without that link and create the new project explicitly in the Vercel dashboard.
- This app reads only `NYC_POSTGRES_URL`. There is deliberately no fallback to `POSTGRES_URL` or other original database variables.
- Every database operation targets `nyc_scores` or `nyc_score_submissions`. No original score table is read, migrated, or modified.
- Nothing in these instructions requires modifying, redeploying, or linking the original project.
- Publish the NYC version to a **new Git repository** before connecting Vercel. This clone still points to the original Git remote; do not push these changes to its production branch, which could trigger the original deployment. No remote has been changed by this implementation.

## Environment

Use `.env.example` as the template for a local `.env.local`. Keep real secrets out of Git and never prefix them with `NEXT_PUBLIC_`.

| Variable | Purpose |
| --- | --- |
| `NYC_POSTGRES_URL` | TLS connection string for the newly created NYC database only. |
| `NYC_STATION_SECRET` | High-entropy staff-only password for unlocking stations and signing station cookies. |
| `NYC_ADMIN_SECRET` | Separate high-entropy staff-only password for leaderboard administration. |

Generate two independent random secrets using a password manager (at least 32 random bytes each). Do not reuse the original deployment's passwords. Missing secrets fail closed. Missing/unavailable database configuration produces sanitized HTTP 503 responses without exposing connection details.

## Database Initialization

1. Provision a new PostgreSQL database with TLS enabled. Record its NYC-only connection string and verify the database/host in the provider dashboard.
2. Connect **only to that new database** using the provider SQL editor and run `db/schema.sql`. Alternatively, with `NYC_POSTGRES_URL` explicitly set to the new database in your shell, run:

```bash
psql "$NYC_POSTGRES_URL" -v ON_ERROR_STOP=1 -f db/schema.sql
```

3. Confirm `nyc_scores` and `nyc_score_submissions` exist. The schema can be applied again safely. It does not initialize automatically on requests.
4. Prefer an application database role restricted to these NYC tables. Use separate databases for production and preview/development so preview tests cannot alter live event rankings.

`nyc_scores` contains active and archived entries. `nyc_score_submissions` holds UUID/hash receipts for retry safety. Archive hides active scores from public rankings; purge deletes active and archived score rows. Receipts intentionally survive deletion and purge so a delayed retry cannot resurrect an entry. Do not clear receipts during the event. Their hashes are not plaintext names, but should still be covered by your retention policy.

## Local Checks

```bash
npm ci
npm run lint
npx tsc --noEmit
npm run build
npm run dev
```

Open `http://localhost:3000` for the game and `http://localhost:3000/scoreboard` for the public scoreboard. Local plain HTTP is supported for development; production station cookies require HTTPS. Database connections always require TLS.

## New Vercel Deployment

1. Create a new Vercel project for the NYC clone with a distinct project name. Select the Next.js framework and the repository root. Do not select the original project or reuse an existing CLI project link.
2. In the **new project's** environment settings, add exactly the three NYC variables above. Set production values to the new NYC production database and fresh secrets. Use a separate database for previews, or leave previews unconfigured and locked.
3. Initialize the new database with `db/schema.sql` before event testing.
4. Deploy the new project through the dashboard. Confirm its generated HTTPS hostname is distinct from the original. Add an NYC-specific custom domain only to the new project if needed.
5. The public display URL is `https://<NEW-NYC-HOST>/scoreboard`. The station URL is `https://<NEW-NYC-HOST>/`. Visitors do not need a station or admin secret to view rankings.
6. Verify unlock, a test turn, retry behavior, relock, and the public scoreboard on the new hostname. Verify that the original site's rankings remain unchanged. Admin-delete the test score from the NYC game only.

No deployment is performed by these setup instructions.

The Next.js API routes are the backend and deploy with the new Vercel project. Only PostgreSQL needs separate provisioning; a second application server is not necessary.

### Integration Test

`tests/api.integration.mjs` exercises authorization, validation, persistence, retry deduplication, pagination, global search ranks, deletion, archive, and purge. It intentionally clears NYC score rows. Run it **only against a local app connected to a disposable database**, never the live event database:

```bash
TEST_BASE_URL=http://localhost:3000 \
TEST_STATION_SECRET="$NYC_STATION_SECRET" \
TEST_ADMIN_SECRET="$NYC_ADMIN_SECRET" \
node --test tests/api.integration.mjs
```

## Event Operation

- Staff opens the station URL and enters `NYC_STATION_SECRET` before any game is rendered. The server issues an HttpOnly, SameSite=Strict, signed cookie valid for 12 hours (Secure in production). The secret is never embedded in the client bundle or persisted by the UI.
- Use one game tab per station browser profile. Use a separate public scoreboard tab/device for the display. Staff should keep unlocked stations supervised; authorization is for the browser, not the physical player.
- Each turn receives a UUID. Finishing all lives, completing a winning turn, or pressing `q` twice within 600ms saves the best score from that turn. The shortcut is ignored in text fields and on key-repeat.
- Failed saves keep the exact payload and UUID, block new turns, and present **Retry Save**. Pending payloads are stored locally so reloading normally restores them. Keep the tab open during storage/network failures; do not clear browser data or open another game tab to bypass the save gate.
- If a cookie expires while playing, the save remains pending. Staff unlocks again, then retries the same submission. A lost response after a successful database commit cannot produce a duplicate score.
- If browser storage cannot be read, the game fails closed with a recovery message. Staff should preserve/recover the `nyc-pending-score` local-storage value before clearing any corrupted data. Never discard a pending player score without recording and resolving it.
- Use **Relock Station** on the menu after the turn is saved before leaving a station unattended. Mid-turn relocking is intentionally unavailable so it cannot discard a player's result. Use `qq`, complete the save, then relock.
- Use the game's admin controls with `NYC_ADMIN_SECRET` for delete/archive/purge. The station secret does not authorize admin actions. Archive starts a fresh visible board while retaining past score rows; purge removes all score rows. Export data before destructive operations if event history is required.
- Rotate `NYC_STATION_SECRET` and redeploy the new project to invalidate existing station cookies. Rotating the admin secret similarly replaces admin access. Never publish either secret or place them in a public scoreboard URL.

The station gate is not an anti-cheat system: an authorized station can submit scores. Use strong secrets and deployment-level rate limiting/WAF protection for the unlock endpoint on a publicly exposed event site.

## API Contract

- `GET /api/scores`: public top 10, `{ scores }`.
- `GET /api/scores?page=1&search=NAME`: public pagination, `{ scores, total, page, pageSize: 50 }`. `page` is 1-based; `search` is optional, at most 20 characters, case-insensitive literal substring matching. Search alone also enables the paginated response. An empty result has `scores: []` and the correct filtered `total`.
- All scores include `rank`, assigned globally before search by `score DESC, date ASC, id ASC`. Ties use distinct, deterministic row-number positions.
- `GET /api/station`: `{ unlocked }`. `POST /api/station` accepts `{ secret }`; `DELETE /api/station` clears the cookie.
- `POST /api/scores`: station cookie required; accepts `{ submissionId, name, score, distance }`. `submissionId` is a UUIDv4, name is trimmed and 2-20 characters, and score/distance are safe integers from 0 through 2,147,483,647. Reusing a UUID with the same normalized payload is safe; a different payload returns 409.
- `POST /api/admin/verify`, `POST /api/admin/archive`, `POST /api/admin/purge`, and `DELETE /api/scores/:id` require `x-admin-secret: <NYC_ADMIN_SECRET>`.
- All mutation requests must have an `Origin` exactly matching the request URL origin. Cross-origin and missing-origin writes are rejected, including command-line calls unless the correct Origin is explicitly provided. Public reads remain unauthenticated.
- Database failures return a generic 503; invalid payloads return 400, missing/invalid authorization 401, and origin violations 403.
