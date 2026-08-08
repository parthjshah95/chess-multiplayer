// Rebuilding a position from a game document is the one operation every part of
// this app needs: the API validates moves against it, the recorder derives the
// PGN from it, the client mirrors it. It lived in two places (api/game.js and
// api/recorder.js) with identical bodies — the same shape of duplication that
// let a copied board drift from the original. One definition instead.
//
// Kept out of api/ on purpose: files there are deployed as routes, and this is a
// library, not an endpoint.

import { Chess } from "chess.js";

/** Replay a finished or in-progress game document into a Chess instance. */
export function replay(doc) {
  const chess = new Chess(doc.startFen || undefined);
  for (const san of doc.moves) chess.move(san);
  return chess;
}
