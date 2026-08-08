# Game recording

Every **finished** game is archived to a Postgres database so games can be
queried and analyzed later. Recording is handled by
[`api/recorder.js`](../api/recorder.js) and is best-effort: if no database is
configured, or a write fails, gameplay is completely unaffected — the
authoritative game state always lives in Vercel Blob.

## Setup

1. **Provision a Postgres database.** In the Vercel dashboard, add a Postgres
   store (Storage → Create → Postgres/Neon) and connect it to this project, or
   use any Neon/Postgres database you like.

2. **Set the connection string.** The recorder reads the first of these
   environment variables that is present:

   - `DATABASE_URL`
   - `POSTGRES_URL`
   - `POSTGRES_PRISMA_URL`

   The Vercel Postgres and Neon integrations set these automatically. For local
   runs, put one in your environment (e.g. an untracked `.env.local`).

3. **That's it.** The `games` table is created automatically on the first
   finished game (`CREATE TABLE IF NOT EXISTS`). To create it ahead of time
   instead, run [`schema.sql`](./schema.sql) against your database.

Without a connection string, recording is simply off and everything else keeps
working.

## Schema

See [`schema.sql`](./schema.sql). One row per finished game, keyed by
`(id, game_no)` — a rematch reuses the same game `id`, so `game_no` (1, 2, 3…)
separates the individual games on a rematch chain.

## Example analysis queries

```sql
-- Results breakdown
SELECT result, count(*) FROM games GROUP BY result ORDER BY count DESC;

-- How games end
SELECT reason, count(*) FROM games GROUP BY reason ORDER BY count DESC;

-- White vs. Black win rate
SELECT
  count(*) FILTER (WHERE winner = 'w') AS white_wins,
  count(*) FILTER (WHERE winner = 'b') AS black_wins,
  count(*) FILTER (WHERE winner IS NULL) AS draws
FROM games;

-- Game length distribution (in full moves)
SELECT
  min(move_count)  AS shortest,
  round(avg(move_count)) AS average,
  max(move_count)  AS longest
FROM games;

-- Most common opening move
SELECT moves->>0 AS first_move, count(*)
FROM games
WHERE jsonb_array_length(moves) > 0
GROUP BY first_move
ORDER BY count DESC;

-- Recent games with their PGN (paste into any chess viewer)
SELECT ended_at, result, reason, move_count, pgn
FROM games
ORDER BY ended_at DESC
LIMIT 10;
```
