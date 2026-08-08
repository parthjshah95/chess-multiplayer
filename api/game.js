import { list, put } from "@vercel/blob";
import { Chess } from "chess.js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { recordGame } from "./recorder.js";

// One JSON document per game version: games/<id>/v000042.json
// A new version is written with overwrite disabled, so two racing writers
// can't clobber each other — the loser gets a conflict and re-syncs.

const ID_RE = /^[A-Za-z0-9_-]{6,32}$/;
const SQ_RE = /^[a-h][1-8]$/;
const PROMOS = new Set(["q", "r", "b", "n"]);

const sha = (s) => createHash("sha256").update(s).digest("hex");
const other = (c) => (c === "w" ? "b" : "w");
const versionPath = (id, v) => `games/${id}/v${String(v).padStart(6, "0")}.json`;
export const versionOf = (pathname) => Number(pathname.split("/").pop().slice(1, -5));

function replay(doc) {
  const chess = new Chess(doc.startFen || undefined);
  for (const san of doc.moves) chess.move(san);
  return chess;
}

async function latestBlob(id) {
  let cursor;
  let newest = null;
  do {
    const page = await list({ prefix: `games/${id}/`, cursor });
    for (const blob of page.blobs) {
      if (!newest || blob.pathname > newest.pathname) newest = blob;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return newest;
}

// Every version lives at its own path and is never overwritten, so each URL is
// immutable and safe to serve from cache. Forcing an origin read here (the old
// `cache: "no-store"`) got the whole store rate-limited into 403s under polling.
async function readDoc(blob) {
  const res = await fetch(blob.url);
  if (!res.ok) throw new Error(`blob fetch failed: ${res.status}`);
  return res.json();
}

async function latestDoc(id) {
  const newest = await latestBlob(id);
  return newest ? readDoc(newest) : null;
}

async function writeDoc(doc) {
  await put(versionPath(doc.id, doc.v), JSON.stringify(doc), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
  });
}

function seatOf(doc, key) {
  if (!key) return null;
  const hash = sha(key);
  if (doc.seats.w === hash) return "w";
  if (doc.seats.b === hash) return "b";
  return null;
}

function publicState(doc, key) {
  return {
    id: doc.id,
    v: doc.v,
    status: doc.status,
    result: doc.result,
    startFen: doc.startFen,
    moves: doc.moves,
    fen: doc.fen,
    turn: doc.turn,
    lastMove: doc.lastMove,
    rematch: { w: !!doc.rematch.w, b: !!doc.rematch.b },
    seats: { w: !!doc.seats.w, b: !!doc.seats.b },
    you: seatOf(doc, key),
  };
}

function finishByPosition(doc, chess, mover) {
  if (chess.isCheckmate()) {
    doc.status = "over";
    doc.result = { winner: mover, reason: "checkmate" };
  } else if (chess.isStalemate()) {
    doc.status = "over";
    doc.result = { winner: null, reason: "stalemate" };
  } else if (chess.isThreefoldRepetition()) {
    doc.status = "over";
    doc.result = { winner: null, reason: "threefold repetition" };
  } else if (chess.isInsufficientMaterial()) {
    doc.status = "over";
    doc.result = { winner: null, reason: "insufficient material" };
  } else if (chess.isDraw()) {
    doc.status = "over";
    doc.result = { winner: null, reason: "fifty-move rule" };
  }
}

export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  try {
    if (req.method === "GET") {
      const { id, key, since } = req.query;
      if (!ID_RE.test(id || "")) return res.status(400).json({ error: "bad id" });
      const newest = await latestBlob(id);
      if (!newest) return res.status(404).json({ error: "game not found" });
      // The pathname already carries the version, so an idle poll needs no body read.
      const v = versionOf(newest.pathname);
      if (Number(since) === v) return res.status(200).json({ unchanged: true, v });
      return res.status(200).json({ state: publicState(await readDoc(newest), key) });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });

    const body = req.body || {};
    const action = body.action;

    if (action === "create") {
      let startFen = null;
      if (body.fen) {
        try { new Chess(body.fen); startFen = body.fen; }
        catch { return res.status(400).json({ error: "bad fen" }); }
      }
      const id = randomBytes(8).toString("base64url");
      const key = randomUUID();
      const color = Math.random() < 0.5 ? "w" : "b";
      const chess = new Chess(startFen || undefined);
      const doc = {
        id, v: 1, createdAt: Date.now(), startFen,
        gameNo: 1, startedAt: null, endedAt: null,
        seats: { w: null, b: null },
        moves: [], fen: chess.fen(), turn: chess.turn(), lastMove: null,
        status: "waiting", result: null,
        rematch: { w: false, b: false },
      };
      doc.seats[color] = sha(key);
      await writeDoc(doc);
      return res.status(200).json({ key, state: publicState(doc, key) });
    }

    // all other actions address an existing game
    const id = body.id;
    if (!ID_RE.test(id || "")) return res.status(400).json({ error: "bad id" });
    const doc = await latestDoc(id);
    if (!doc) return res.status(404).json({ error: "game not found" });
    const you = seatOf(doc, body.key);

    if (action === "join") {
      if (you) return res.status(200).json({ state: publicState(doc, body.key) }); // rejoin
      const open = !doc.seats.w ? "w" : !doc.seats.b ? "b" : null;
      if (!open) return res.status(200).json({ state: publicState(doc, null) }); // spectator
      const key = randomUUID();
      doc.seats[open] = sha(key);
      if (doc.seats.w && doc.seats.b) {
        doc.status = "active";
        doc.startedAt = Date.now();
      }
      doc.v += 1;
      await writeDoc(doc);
      return res.status(200).json({ key, state: publicState(doc, key) });
    }

    if (!you) return res.status(403).json({ error: "not a player in this game" });

    if (action === "move") {
      if (doc.status !== "active") return res.status(400).json({ error: "game is not active" });
      const { from, to, promotion } = body;
      if (!SQ_RE.test(from || "") || !SQ_RE.test(to || "") || (promotion != null && !PROMOS.has(promotion))) {
        return res.status(400).json({ error: "bad move" });
      }
      const chess = replay(doc);
      if (chess.turn() !== you) return res.status(409).json({ error: "not your turn" });
      let mv;
      try { mv = chess.move({ from, to, promotion: promotion ?? undefined }); }
      catch { return res.status(400).json({ error: "illegal move" }); }
      doc.moves.push(mv.san);
      doc.fen = chess.fen();
      doc.turn = chess.turn();
      doc.lastMove = { from: mv.from, to: mv.to, captured: !!mv.captured };
      finishByPosition(doc, chess, you);
      if (doc.status === "over") doc.endedAt = Date.now();
      doc.v += 1;
      await writeDoc(doc);
      if (doc.status === "over") await recordGame(doc); // best-effort; never throws
      return res.status(200).json({ state: publicState(doc, body.key) });
    }

    if (action === "resign") {
      if (doc.status !== "active") return res.status(400).json({ error: "game is not active" });
      doc.status = "over";
      doc.result = { winner: other(you), reason: "resignation" };
      doc.endedAt = Date.now();
      doc.v += 1;
      await writeDoc(doc);
      await recordGame(doc); // best-effort; never throws
      return res.status(200).json({ state: publicState(doc, body.key) });
    }

    if (action === "rematch") {
      if (doc.status !== "over") return res.status(400).json({ error: "game is not over" });
      doc.rematch[you] = true;
      if (doc.rematch.w && doc.rematch.b) {
        const chess = new Chess();
        [doc.seats.w, doc.seats.b] = [doc.seats.b, doc.seats.w]; // swap colors
        doc.startFen = null;
        doc.moves = [];
        doc.fen = chess.fen();
        doc.turn = "w";
        doc.lastMove = null;
        doc.status = "active";
        doc.result = null;
        // A rematch reuses this id in place; bump game_no so it archives as a
        // distinct game rather than overwriting the one just finished.
        doc.gameNo = (doc.gameNo || 1) + 1;
        doc.startedAt = Date.now();
        doc.endedAt = null;
        doc.rematch = { w: false, b: false };
      }
      doc.v += 1;
      await writeDoc(doc);
      return res.status(200).json({ state: publicState(doc, body.key) });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (err) {
    if (String(err?.message || err).includes("already exists")) {
      return res.status(409).json({ error: "conflict — please retry" });
    }
    console.error(err);
    return res.status(500).json({ error: "server error" });
  }
}
