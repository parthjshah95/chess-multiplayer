// node test.js
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { Chess } from "chess.js";
import { versionOf } from "./api/game.js";
import { gameRecord } from "./api/recorder.js";
import { normalize } from "./tutorials.js";

// versionOf must invert versionPath(id, v) = games/<id>/v<6-digit>.json
assert.equal(versionOf("games/abc/v000001.json"), 1);
assert.equal(versionOf("games/abc/v000042.json"), 42);
assert.equal(versionOf("games/uyPOk57Q-xg/v000123.json"), 123);
assert.equal(versionOf("games/v-id_with-v/v999999.json"), 999999);

// lexicographic pathname order must agree with numeric version order,
// since latestBlob picks the newest by string comparison.
const paths = [1, 2, 9, 10, 99, 100, 999999].map((v) => `games/x/v${String(v).padStart(6, "0")}.json`);
assert.deepEqual([...paths].sort(), paths);

// gameRecord flattens a finished game document into an analysis row.
// Fool's mate: Black checkmates on the second move.
const fools = new Chess();
for (const san of ["f3", "e5", "g4", "Qh4#"]) fools.move(san);
const mateDoc = {
  id: "abc123", gameNo: 1, createdAt: 1000, startedAt: 2000, endedAt: 5000,
  startFen: null, moves: ["f3", "e5", "g4", "Qh4#"], fen: fools.fen(),
  status: "over", result: { winner: "b", reason: "checkmate" },
};
const mate = gameRecord(mateDoc);
assert.equal(mate.id, "abc123");
assert.equal(mate.gameNo, 1);
assert.equal(mate.winner, "b");
assert.equal(mate.reason, "checkmate");
assert.equal(mate.result, "0-1");
assert.equal(mate.plyCount, 4);
assert.equal(mate.moveCount, 2);
assert.equal(mate.finalFen, fools.fen());
assert.equal(mate.durationMs, 3000);
assert.equal(mate.startedAt, new Date(2000).toISOString());
assert.deepEqual(mate.moves, ["f3", "e5", "g4", "Qh4#"]);
assert.ok(mate.pgn.includes("Qh4#"), "pgn should contain the mating move");
assert.ok(mate.pgn.includes('[Result "0-1"]'), "pgn should carry the result header");

// Draws map to 1/2-1/2 with a null winner; a rematch instance keeps its game_no.
const drawDoc = {
  id: "d", gameNo: 3, createdAt: 0, startedAt: 0, endedAt: 10,
  startFen: null, moves: [], fen: new Chess().fen(),
  status: "over", result: { winner: null, reason: "stalemate" },
};
const draw = gameRecord(drawDoc);
assert.equal(draw.result, "1/2-1/2");
assert.equal(draw.winner, null);
assert.equal(draw.gameNo, 3);
assert.equal(draw.moveCount, 0);

// Older docs predate startedAt/gameNo: fall back to createdAt and 1.
const legacyDoc = {
  id: "n", createdAt: 500, moves: [], fen: new Chess().fen(),
  status: "over", result: { winner: "w", reason: "resignation" },
};
const legacy = gameRecord(legacyDoc);
assert.equal(legacy.gameNo, 1);
assert.equal(legacy.result, "1-0");
assert.equal(legacy.startedAt, new Date(500).toISOString());
assert.equal(legacy.durationMs, null);

// ── tutorial content ────────────────────────────────────────────────
// normalize() replays every move through chess.js, so an illegal or mistyped
// line fails here rather than rendering a wrong position to a reader.
const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const index = read("./tutorials/index.json");
assert.ok(Array.isArray(index) && index.length, "tutorials/index.json lists no studies");

for (const entry of index) {
  const where = `tutorials/${entry.slug}.json`;
  assert.match(entry.slug || "", /^[a-z0-9][a-z0-9-]*$/, `bad slug: ${entry.slug}`);
  for (const field of ["title", "blurb"]) assert.ok(entry[field], `${entry.slug}: index entry needs ${field}`);

  const doc = read(`./tutorials/${entry.slug}.json`);
  assert.equal(doc.slug, entry.slug, `${where}: slug disagrees with the index`);
  assert.ok(doc.title && doc.standfirst, `${where}: needs a title and a standfirst`);

  const { steps } = normalize(doc);
  assert.ok(steps.length >= 2, `${where}: a study needs at least two positions`);
  steps.forEach((step, i) => {
    assert.ok(step.title, `${where}: step ${i} has no title`);
    assert.ok(step.body.length, `${where}: step ${i} has no body`);
    assert.match(step.fen, /^[1-8pnbrqkPNBRQK/]+ [wb] /, `${where}: step ${i} produced a bad FEN`);
  });
  // the first step is the position you start from, so it never carries a move
  assert.equal(steps[0].san, null, `${where}: the first step should be a position, not a move`);
}

// every tutorial file must be reachable from the index
const listed = new Set(index.map((e) => `${e.slug}.json`));
for (const file of readdirSync(new URL("./tutorials/", import.meta.url))) {
  if (file === "index.json") continue;
  assert.ok(listed.has(file), `tutorials/${file} is not listed in index.json`);
}

console.log(`ok — versions, game records, ${index.length} tutorial(s)`);
