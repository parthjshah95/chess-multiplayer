// Tutorial content lives in tutorials/*.json — prose and moves, no positions.
//
// Steps carry SAN (`"san": "Nf3"`) and the position is DERIVED by replaying the
// line through chess.js. A hand-written FEN is duplicated state that can quietly
// disagree with the position it claims to describe — castling rights and the
// en-passant square especially — and nothing would catch it. Replaying also
// yields from/to for the move highlight, and turns an illegal line into a test
// failure (see test.js) instead of a broken lesson.
//
// A step may still set `"fen"` to jump somewhere no move sequence reaches, which
// is what tactics puzzles and endgame studies need.

import { Chess } from "./vendor/chess.js";

const INDEX_URL = "tutorials/index.json";
const tutorialUrl = (slug) => `tutorials/${slug}.json`;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,48}$/;

async function getJson(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${url} — HTTP ${res.status}`);
  return res.json();
}

export const loadIndex = () => getJson(INDEX_URL);

/** Fetch a tutorial and expand it into ready-to-render steps. */
export async function loadTutorial(slug) {
  if (!SLUG_RE.test(slug || "")) throw new Error("bad tutorial id");
  return normalize(await getJson(tutorialUrl(slug)));
}

/**
 * Turn authored steps into rendered ones. Exported on its own so test.js can
 * validate every tutorial in Node, where there is no fetch and no DOM.
 *
 * @returns {{...doc, steps: Array<{ply, san, fen, from, to, tag, title, body}>}}
 */
export function normalize(doc) {
  if (!Array.isArray(doc.steps) || !doc.steps.length) throw new Error(`${doc.slug}: no steps`);
  const chess = new Chess(doc.startFen || undefined);
  let moveNo = chess.moveNumber();

  const steps = doc.steps.map((step, i) => {
    let move = null;
    if (step.fen) {
      chess.load(step.fen); // explicit jump — puzzles, endgames
      moveNo = chess.moveNumber();
    } else if (step.san) {
      const turn = chess.turn();
      moveNo = chess.moveNumber();
      try { move = chess.move(step.san); }
      catch { throw new Error(`${doc.slug}: step ${i} — illegal move "${step.san}"`); }
      move.label = `${moveNo}${turn === "w" ? "." : "…"} ${move.san}`;
    }
    return {
      ply: move ? move.label : (step.label || "Start"),
      san: move ? move.san : null,
      fen: chess.fen(),
      from: move ? move.from : null,
      to: move ? move.to : null,
      tag: step.tag || "",
      title: step.title || "",
      body: Array.isArray(step.body) ? step.body : [step.body].filter(Boolean),
    };
  });

  return { ...doc, steps };
}
