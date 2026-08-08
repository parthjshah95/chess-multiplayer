-- Schema for the finished-games archive (see api/recorder.js).
--
-- The application creates this table automatically on the first recorded game
-- (CREATE TABLE IF NOT EXISTS), so running this file by hand is optional — it
-- exists for transparency and for setting the database up ahead of time.
--
-- One row per finished game. A rematch reuses the same game id in place, so the
-- primary key is (id, game_no): game_no starts at 1 and increments per rematch,
-- keeping each game on a rematch chain a distinct row.

CREATE TABLE IF NOT EXISTS games (
  id           TEXT        NOT NULL,           -- game id (shared across a rematch chain)
  game_no      INTEGER     NOT NULL DEFAULT 1, -- 1, 2, 3… within one rematch chain
  winner       TEXT,                           -- 'w' | 'b' | NULL for a draw
  reason       TEXT        NOT NULL,           -- checkmate | resignation | stalemate |
                                               --   threefold repetition | insufficient material |
                                               --   fifty-move rule
  result       TEXT        NOT NULL,           -- '1-0' | '0-1' | '1/2-1/2'
  white_name   TEXT,                           -- player-provided name; NULL if anonymous
  black_name   TEXT,                           -- player-provided name; NULL if anonymous
  ply_count    INTEGER     NOT NULL,           -- half-moves played
  move_count   INTEGER     NOT NULL,           -- full moves (ceil(ply_count / 2))
  start_fen    TEXT,                           -- NULL for a standard start position
  final_fen    TEXT        NOT NULL,           -- board position at game end
  moves        JSONB       NOT NULL,           -- array of SAN strings, e.g. ["e4","c5",…]
  pgn          TEXT        NOT NULL,           -- full PGN, importable into any chess tool
  started_at   TIMESTAMPTZ,                    -- when both players were seated
  ended_at     TIMESTAMPTZ NOT NULL,           -- when the game finished
  duration_ms  BIGINT,                         -- ended_at - started_at, in milliseconds
  created_at   TIMESTAMPTZ,                    -- when the game id was first created
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, game_no)
);

CREATE INDEX IF NOT EXISTS games_ended_at_idx   ON games (ended_at);
CREATE INDEX IF NOT EXISTS games_reason_idx     ON games (reason);
CREATE INDEX IF NOT EXISTS games_white_name_idx ON games (white_name);
CREATE INDEX IF NOT EXISTS games_black_name_idx ON games (black_name);
