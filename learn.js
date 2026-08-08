// The openings index. Reads tutorials/index.json and renders a card per study.
//
// Each card's little board is drawn by the same renderBoard() the live game
// uses — so if the shared component ever breaks, this page shows it too.

import { Chess } from "./vendor/chess.js";
import { renderBoard } from "./board.js";
import { loadIndex, loadTutorial } from "./tutorials.js";

const cardsEl = document.getElementById("cards");
const emptyEl = document.getElementById("empty");

const fail = (message) => {
  emptyEl.textContent = message;
  emptyEl.hidden = false;
};

const entries = await loadIndex().catch(() => null);
if (!entries) fail("Couldn't load the studies — check your connection and reload.");
else if (!entries.length) fail("No studies published yet.");
else {
  // Build every card at once, then append in index order. Awaiting them one at
  // a time meant one round-trip per study, so the page filled in visibly.
  for (const li of await Promise.all(entries.map(card))) cardsEl.appendChild(li);
}

async function card(entry) {
  const li = document.createElement("li");
  const link = document.createElement("a");
  link.className = "card";
  link.href = `tutorial.html?t=${encodeURIComponent(entry.slug)}`;

  // The final position doubles as the card's thumbnail. Deriving it from the
  // tutorial keeps the index free of positions it would otherwise duplicate.
  const board = document.createElement("div");
  board.className = "board mini";
  board.setAttribute("role", "img");
  board.setAttribute("aria-label", `Final position of ${entry.title}`);
  let steps = 0;
  try {
    const tutorial = await loadTutorial(entry.slug);
    steps = tutorial.steps.length;
    const last = tutorial.steps.at(-1);
    renderBoard(board, { chess: new Chess(last.fen), lastMove: last });
  } catch {
    renderBoard(board, { chess: new Chess() }); // still a board, just the start
  }

  const text = document.createElement("div");
  text.className = "card-text";
  const heading = document.createElement("h3");
  heading.textContent = entry.title;
  const blurb = document.createElement("p");
  blurb.textContent = entry.blurb || "";
  const meta = document.createElement("p");
  meta.className = "card-meta";
  for (const bit of [entry.level, steps ? `${steps} positions` : null].filter(Boolean)) {
    const span = document.createElement("span");
    span.textContent = bit;
    meta.appendChild(span);
  }
  text.append(heading, blurb, meta);

  link.append(board, text);
  li.appendChild(link);
  return li;
}
