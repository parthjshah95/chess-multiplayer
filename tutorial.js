// The study player. Reads ?t=<slug>, renders one step at a time.
//
// It owns no board code: positions come from tutorials.js and are drawn by the
// shared renderBoard(), the same one the live game uses.

import { Chess } from "./vendor/chess.js";
import { renderBoard } from "./board.js";
import { loadTutorial } from "./tutorials.js";

const $ = (id) => document.getElementById(id);
const boardEl = $("board"), studyEl = $("study"), scoreEl = $("score"), ribbonEl = $("ribbon"),
  fenBtn = $("fen"), fenLabel = $("fen-label"), fenText = $("fen-text"),
  prevBtn = $("prev"), nextBtn = $("next");

const slug = new URLSearchParams(location.search).get("t") || "italian-game";
let steps = [];
let at = 0;

try {
  const tutorial = await loadTutorial(slug);
  document.title = `${tutorial.title} — Chess with a Friend`;
  $("eyebrow").textContent = tutorial.eyebrow || "Opening study";
  $("title").textContent = tutorial.title;
  $("standfirst").textContent = tutorial.standfirst || "";
  steps = tutorial.steps;
  buildRibbon();
  studyEl.hidden = false;
  scoreEl.hidden = false;
  show(0);
} catch (err) {
  $("title").textContent = "That study isn't here";
  $("standfirst").textContent = "The link may be wrong. Browse the openings index to find it.";
  console.error(err);
}

function buildRibbon() {
  steps.forEach((step, i) => {
    const button = document.createElement("button");
    button.className = "step";
    button.type = "button";
    button.textContent = step.ply;
    button.addEventListener("click", () => show(i));
    ribbonEl.appendChild(button);
  });
}

function show(i) {
  at = Math.max(0, Math.min(steps.length - 1, i));
  const step = steps[at];

  renderBoard(boardEl, {
    chess: new Chess(step.fen),
    lastMove: step.from ? { from: step.from, to: step.to } : null,
  });
  boardEl.setAttribute("aria-label", `Position after ${step.ply}`);

  $("ply").textContent = step.ply;
  $("tag").textContent = step.tag;
  $("step-title").textContent = step.title;
  // Tutorial prose is first-party content from the repo, so the small amount of
  // inline markup it carries (<b>, <i>) is rendered rather than escaped.
  $("body").innerHTML = step.body.map((p) => `<p>${p}</p>`).join("");
  fenText.textContent = step.fen;
  fenLabel.textContent = "FEN";
  $("counter").textContent = `${at + 1} / ${steps.length}`;
  prevBtn.disabled = at === 0;
  nextBtn.disabled = at === steps.length - 1;
  [...ribbonEl.children].forEach((el, n) => el.setAttribute("aria-current", String(n === at)));
}

prevBtn.addEventListener("click", () => show(at - 1));
nextBtn.addEventListener("click", () => show(at + 1));
document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") show(at + 1);
  if (e.key === "ArrowLeft") show(at - 1);
});

fenBtn.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(steps[at].fen); fenLabel.textContent = "Copied"; }
  catch { fenLabel.textContent = "Select it"; }
  setTimeout(() => { fenLabel.textContent = "FEN"; }, 1400);
});
