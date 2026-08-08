import { neon } from "@neondatabase/serverless";
import { replay } from "../replay.js";

// Best-effort archive of every *finished* game into Postgres, so games can be
// queried and analyzed later. The authoritative game state lives in Blob (see
// game.js); this is a read-only-for-analytics mirror. It must never affect
// gameplay: with no database configured, recordGame() is a no-op, and any write
// error or slow connection is swallowed and time-bounded.
//
// Configure by setting a connection string in the environment. The Vercel
// Postgres / Neon integrations expose one of these automatically:
const CONN =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  "";

// neon() only builds an HTTP query function — it opens no connection until a
// query actually runs, so importing this module is free even without a DB.
const sql = CONN ? neon(CONN) : null;

// A game finishes exactly once; a hung DB must never hold the move response.
const RECORD_TIMEOUT_MS = 4000;

// Create the table lazily on first write. Neon's HTTP driver runs one statement
// per call, so table and indexes go in separate calls; all are idempotent and
// this runs at most once per warm instance.
let schemaReady = null;
async function ensureSchema() {
  await sql`CREATE TABLE IF NOT EXISTS games (
    id           TEXT        NOT NULL,
    game_no      INTEGER     NOT NULL DEFAULT 1,
    winner       TEXT,
    reason       TEXT        NOT NULL,
    result       TEXT        NOT NULL,
    white_name   TEXT,
    black_name   TEXT,
    ply_count    INTEGER     NOT NULL,
    move_count   INTEGER     NOT NULL,
    start_fen    TEXT,
    final_fen    TEXT        NOT NULL,
    moves        JSONB       NOT NULL,
    pgn          TEXT        NOT NULL,
    started_at   TIMESTAMPTZ,
    ended_at     TIMESTAMPTZ NOT NULL,
    duration_ms  BIGINT,
    created_at   TIMESTAMPTZ,
    recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, game_no)
  )`;
  // Deployments that created the table before names existed get the columns now.
  await sql`ALTER TABLE games ADD COLUMN IF NOT EXISTS white_name TEXT`;
  await sql`ALTER TABLE games ADD COLUMN IF NOT EXISTS black_name TEXT`;
  await sql`CREATE INDEX IF NOT EXISTS games_ended_at_idx ON games (ended_at)`;
  await sql`CREATE INDEX IF NOT EXISTS games_reason_idx ON games (reason)`;
  // Pull all of one player's games regardless of the color they had.
  await sql`CREATE INDEX IF NOT EXISTS games_white_name_idx ON games (white_name)`;
  await sql`CREATE INDEX IF NOT EXISTS games_black_name_idx ON games (black_name)`;
}
function ready() {
  // Cache the successful check; on failure clear it so the next write retries.
  if (!schemaReady) {
    schemaReady = ensureSchema().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());

// Derive the flat analysis record from a finished game document. Pure (only
// chess.js) so it can be unit-tested without a database. Exported for test.js.
export function gameRecord(doc) {
  const chess = replay(doc);

  const winner = doc.result?.winner ?? null; // 'w' | 'b' | null (draw)
  const reason = doc.result?.reason ?? "unknown";
  const result = winner === "w" ? "1-0" : winner === "b" ? "0-1" : "1/2-1/2";
  const whiteName = doc.names?.w ?? null; // player-provided; null when anonymous
  const blackName = doc.names?.b ?? null;

  // A self-contained PGN so any game can be dropped straight into a chess tool —
  // carrying the players' names so it's recognizable outside the database too.
  chess.setHeader("Event", "Chess with a Friend");
  chess.setHeader("Site", "chess-multiplayer");
  chess.setHeader("White", whiteName || "White");
  chess.setHeader("Black", blackName || "Black");
  chess.setHeader("Result", result);
  chess.setHeader("Termination", reason);
  if (doc.startFen) {
    chess.setHeader("SetUp", "1");
    chess.setHeader("FEN", doc.startFen);
  }

  const plyCount = doc.moves.length;
  const startedAt = doc.startedAt ?? doc.createdAt ?? null; // older docs predate startedAt
  const endedAt = doc.endedAt ?? null;

  return {
    id: doc.id,
    gameNo: doc.gameNo ?? 1, // a rematch chain reuses one id; game_no separates instances
    winner,
    reason,
    result,
    whiteName,
    blackName,
    plyCount,
    moveCount: Math.ceil(plyCount / 2),
    startFen: doc.startFen ?? null,
    finalFen: doc.fen,
    moves: doc.moves,
    pgn: chess.pgn(),
    startedAt: iso(startedAt),
    endedAt: iso(endedAt),
    durationMs: startedAt != null && endedAt != null ? endedAt - startedAt : null,
    createdAt: iso(doc.createdAt ?? null),
  };
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Insert one finished game. Idempotent (ON CONFLICT DO NOTHING) so a retried
// request can't duplicate a row. Never throws — recording is a nicety, never a
// reason to fail a move.
export async function recordGame(doc) {
  if (!sql) return; // no database configured — recording is off
  try {
    await withTimeout(
      (async () => {
        await ready();
        const r = gameRecord(doc);
        await sql`INSERT INTO games
          (id, game_no, winner, reason, result, white_name, black_name, ply_count, move_count,
           start_fen, final_fen, moves, pgn, started_at, ended_at, duration_ms, created_at)
          VALUES
          (${r.id}, ${r.gameNo}, ${r.winner}, ${r.reason}, ${r.result}, ${r.whiteName}, ${r.blackName}, ${r.plyCount}, ${r.moveCount},
           ${r.startFen}, ${r.finalFen}, ${JSON.stringify(r.moves)}::jsonb, ${r.pgn},
           ${r.startedAt}, ${r.endedAt}, ${r.durationMs}, ${r.createdAt})
          ON CONFLICT (id, game_no) DO NOTHING`;
      })(),
      RECORD_TIMEOUT_MS,
      "game recording",
    );
  } catch (err) {
    // Blob already holds the authoritative finished state; a missed row just
    // means one game won't appear in analysis. Log and move on.
    console.error("game recording failed:", err?.message || err);
  }
}
