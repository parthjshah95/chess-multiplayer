// The board, rendered once and shared by the game and every tutorial.
//
// Nothing in here knows about game state, seats, or lessons — callers pass in
// everything. That is the whole point: the board used to be re-implemented
// wherever it was needed, and a copy silently drifts from the original (a copy
// that omitted `grid-template-rows` collapsed the empty ranks to half height).
// One renderer, one stylesheet, no drift.

export const GLYPH = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
export const TEXT = "︎"; // variation selector: force text (non-emoji) glyph rendering
export const FILES = "abcdefgh";
export const PIECE_ORDER = ["p", "n", "b", "r", "q"]; // cheapest first, so like pieces group up

export function findKing(chess, color) {
  const rows = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = rows[r][c];
      if (p && p.type === "k" && p.color === color) return FILES[c] + (8 - r);
    }
  }
  return null;
}

/**
 * Draw a position into `el`.
 *
 * @param {HTMLElement} el          container; emptied and refilled
 * @param {object}      opts
 * @param {Chess}       opts.chess  position — the single source of truth
 * @param {boolean}     [opts.flipped]        black at the bottom
 * @param {?object}     [opts.lastMove]       {from, to}, highlighted
 * @param {?string}     [opts.selected]       square with the selection ring
 * @param {object[]}    [opts.targets]        verbose moves, drawn as move hints
 * @param {?string}     [opts.checkSquare]    square to flag as in check
 * @param {?string}     [opts.interactiveFor] 'w'|'b' — whose pieces look grabbable
 */
export function renderBoard(el, {
  chess,
  flipped = false,
  lastMove = null,
  selected = null,
  targets = [],
  checkSquare = null,
  interactiveFor = null,
} = {}) {
  el.innerHTML = "";
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const fileIdx = flipped ? 7 - col : col;
      const rankIdx = flipped ? row : 7 - row;
      const sq = FILES[fileIdx] + (rankIdx + 1);
      const cell = document.createElement("div");
      cell.dataset.square = sq;
      cell.className = "square " + ((fileIdx + rankIdx) % 2 === 0 ? "dark" : "light");
      if (row === 7) cell.dataset.file = FILES[fileIdx];
      if (col === 0) cell.dataset.rank = String(rankIdx + 1);
      if (lastMove && (sq === lastMove.from || sq === lastMove.to)) cell.classList.add("last");
      if (sq === selected) cell.classList.add("selected");
      if (sq === checkSquare) cell.classList.add("check");
      const hits = targets.filter((m) => m.to === sq);
      if (hits.length) cell.classList.add(hits.some((m) => m.captured) ? "capture-hint" : "hint");
      const piece = chess.get(sq);
      if (piece) {
        const span = document.createElement("span");
        span.className = `piece ${piece.color}`;
        span.textContent = GLYPH[piece.type] + TEXT;
        if (lastMove && sq === lastMove.to) span.classList.add("just-moved");
        if (interactiveFor && piece.color === interactiveFor) span.classList.add("mine");
        cell.appendChild(span);
      }
      el.appendChild(cell);
    }
  }
}

/** Which pieces each side has lost, replayed from the move list. */
export function fallenPieces(chess) {
  // Replaying the moves is exact where counting the board isn't — a promoted
  // pawn leaves the board without ever having been captured, and en passant
  // takes a piece from a square the move never lands on.
  const fallen = { w: [], b: [] };
  for (const mv of chess.history({ verbose: true })) {
    if (mv.captured) fallen[mv.color === "w" ? "b" : "w"].push(mv.captured);
  }
  for (const side of ["w", "b"]) {
    fallen[side].sort((a, b) => PIECE_ORDER.indexOf(a) - PIECE_ORDER.indexOf(b));
  }
  return fallen;
}

/** Fill one tray element with `color`'s losses. */
export function renderTray(el, color, fallen) {
  el.setAttribute("aria-label", `${color === "w" ? "White" : "Black"} pieces captured`);
  el.innerHTML = "";
  for (const type of fallen[color]) {
    const span = document.createElement("span");
    span.className = `fallen ${color}`;
    span.textContent = GLYPH[type] + TEXT;
    el.appendChild(span);
  }
}
