import { Chess } from "./vendor/chess.js";

const $ = (id) => document.getElementById(id);
const boardEl = $("board"), statusEl = $("status"), subStatusEl = $("substatus"),
  shareCard = $("sharecard"), linkInput = $("link"), copyBtn = $("copy"),
  movesEl = $("moves"), resignBtn = $("resign"), rematchBtn = $("rematch"),
  connChip = $("conn"), promoEl = $("promo"), promoButtons = $("promo-buttons"),
  roleEl = $("role"), notifyBtn = $("notify"),
  fallenTopEl = $("fallen-top"), fallenBottomEl = $("fallen-bottom");

const GLYPH = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const FALLEN_ORDER = ["p", "n", "b", "r", "q"]; // cheapest first, so like pieces group up
const TEXT = "\uFE0E"; // variation selector: force text (non-emoji) glyph rendering
const FILES = "abcdefgh";

// ── url / identity ──────────────────────────────────────────────────
const params = new URLSearchParams(location.hash.slice(1));
const urlGameId = params.get("g");
const debugFen = params.get("fen") || undefined; // ponytail: #fen=… debug hook for testing endgames
const seatStore = (id) => `chess-seat:${id}`;
// sessionStorage first: each tab keeps its own seat across refreshes even when
// two tabs of one browser hold both seats. localStorage covers "come back later".
const loadSeatKey = (id) => sessionStorage.getItem(seatStore(id)) || localStorage.getItem(seatStore(id));
const saveSeatKey = (id, key) => {
  sessionStorage.setItem(seatStore(id), key);
  localStorage.setItem(seatStore(id), key);
};

// ── state ───────────────────────────────────────────────────────────
let state = null;          // latest server state (authoritative)
let chess = new Chess();   // local mirror, rebuilt from state
let myKey = null;
let you = null;            // 'w' | 'b' | null (spectator)
let lastMove = null;
let selected = null;
let legalTargets = [];
let pendingPromo = null;
let resignArm = null;
let posting = false;
let pollTimer = null;
let failStreak = 0;

// ── server api ──────────────────────────────────────────────────────
async function api(payload) {
  const res = await fetch("/api/game", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// Pass `since` on idle polls so the server can answer from the version number
// alone; returns null when nothing has changed.
async function fetchState(id, since) {
  const query = `id=${encodeURIComponent(id)}`
    + (myKey ? `&key=${encodeURIComponent(myKey)}` : "")
    + (since != null ? `&since=${since}` : "");
  const res = await fetch(`/api/game?${query}`, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data.unchanged ? null : data.state;
}

// ── boot ────────────────────────────────────────────────────────────
init();
async function init() {
  render();
  try {
    if (!urlGameId) {
      const res = await api({ action: "create", fen: debugFen });
      myKey = res.key;
      saveSeatKey(res.state.id, myKey);
      history.replaceState(null, "", `#g=${res.state.id}`);
      applyState(res.state);
    } else {
      myKey = loadSeatKey(urlGameId);
      const res = await joinWithRetry(urlGameId);
      if (res.key) myKey = res.key;
      if (myKey && res.state.you) saveSeatKey(urlGameId, myKey);
      applyState(res.state);
    }
    schedulePoll();
  } catch (err) {
    setChip("err", "error");
    if (err.status === 404) {
      setStatus("Game not found", "The link may be wrong — ask your friend to copy it again.");
    } else {
      setStatus("Can't reach the game server", "Check your connection and reload the page.");
    }
  }
}

async function joinWithRetry(id) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await api({ action: "join", id, key: myKey || undefined });
    } catch (err) {
      // 404 right after creation or a 409 seat race: brief retry, then give up
      if ((err.status === 404 || err.status === 409) && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        continue;
      }
      throw err;
    }
  }
}

// ── state application ───────────────────────────────────────────────
function applyState(next) {
  const prev = state;
  state = next;
  you = next.you;
  chess = new Chess(next.startFen || undefined);
  for (const san of next.moves) chess.move(san);
  lastMove = next.lastMove;

  const opponentMoved = prev && next.v > prev.v && next.moves.length > prev.moves.length && next.turn === you;
  if (opponentMoved) blip(next.lastMove?.captured ? 220 : 440);
  // The board came round to you: they moved, or the game just started (or a
  // rematch began) with you up first. Never on the first apply — you're right here.
  const becameYourTurn = prev && you && next.status === "active" && next.turn === you
    && (next.moves.length > prev.moves.length || prev.status !== "active");
  if (becameYourTurn) notifyTurn();
  if (prev && prev.status === "over" && next.status === "active") disarmResign(); // rematch started

  clearSelection();
  syncUi();
}

function syncUi() {
  const s = state;
  shareCard.hidden = !(s && s.status === "waiting" && you);
  if (!shareCard.hidden) linkInput.value = `${location.origin}${location.pathname}#g=${s.id}`;

  roleEl.hidden = !s || s.status === "waiting";
  roleEl.textContent = you ? (you === "w" ? "You play White" : "You play Black") : "Spectating";

  if (failStreak > 0) setChip("err", "reconnecting…");
  else if (!s) setChip("waiting", "connecting…");
  else if (s.status === "waiting") setChip("waiting", "waiting for opponent");
  else if (!you) setChip("ok", "watching");
  else setChip("ok", "live");

  resignBtn.hidden = !(s && s.status === "active" && you);
  rematchBtn.hidden = !(s && s.status === "over" && you);
  if (!rematchBtn.hidden) {
    const mine = s.rematch[you], theirs = s.rematch[you === "w" ? "b" : "w"];
    rematchBtn.textContent = theirs && !mine ? "Accept rematch" : mine ? "Rematch offered…" : "Rematch";
  }

  updateStatus();
  syncNotifyUi();
  render();
  renderMoves();
  renderFallen();
}

function updateStatus() {
  const s = state;
  if (!s) return;
  if (s.status === "waiting") {
    if (you) setStatus("Send the link to a friend", "The game starts the moment they open it. You can refresh or come back later — your seat is saved.");
    else setStatus("Waiting for players…", "");
    return;
  }
  if (s.status === "over") {
    const r = s.result || {};
    let text;
    if (!r.winner) text = `Draw — ${r.reason}.`;
    else if (!you) text = `${r.winner === "w" ? "White" : "Black"} wins by ${r.reason}.`;
    else if (r.reason === "resignation") text = r.winner === you ? "Your opponent resigned — you win." : "You resigned — your opponent wins.";
    else text = r.winner === you ? "Checkmate — you win." : "Checkmate — you lose.";
    const theirs = you && s.rematch[you === "w" ? "b" : "w"];
    setStatus(text, theirs && !s.rematch[you] ? "Your opponent wants a rematch." : "");
    return;
  }
  // active
  const check = chess.inCheck() ? " — check!" : "";
  if (!you) { setStatus(`${chess.turn() === "w" ? "White" : "Black"} to move${check}`, ""); return; }
  const mine = chess.turn() === you;
  setStatus(mine ? `Your move${check}` : `Waiting for your opponent${check}`,
    mine ? "Tap a piece, then a highlighted square." : "They can close the tab and come back — the game is saved.");
}

// ── polling ─────────────────────────────────────────────────────────
function pollDelay() {
  if (!state) return 3000;
  if (document.hidden) return 15000;
  if (state.status === "waiting") return 2500;
  if (state.status === "active") return you && state.turn === you ? 6000 : 2000;
  return 4000; // over (rematch flags) or spectating
}

function schedulePoll(immediate) {
  clearTimeout(pollTimer);
  if (!state) return;
  pollTimer = setTimeout(poll, immediate ? 50 : pollDelay());
}

async function poll() {
  if (posting) return schedulePoll();
  try {
    const next = await fetchState(state.id, state.v);
    failStreak = 0;
    if (next && next.v > state.v) applyState(next);
    else syncUi();
  } catch {
    failStreak++;
    setChip("err", "reconnecting…");
  }
  schedulePoll();
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  dismissNotifications(); // you're looking at the board — the alert has done its job
  if (state) schedulePoll(true);
});
window.addEventListener("focus", dismissNotifications);

// ── board interaction ───────────────────────────────────────────────
boardEl.addEventListener("click", (e) => {
  const cell = e.target.closest("[data-square]");
  if (cell) onSquare(cell.dataset.square);
});

function onSquare(sq) {
  if (!state || state.status !== "active" || !you || chess.turn() !== you || posting) return;
  const piece = chess.get(sq);
  if (selected) {
    if (sq === selected) { clearSelection(); render(); return; }
    const matches = legalTargets.filter((m) => m.to === sq);
    if (matches.length) {
      if (matches.some((m) => m.promotion)) return askPromotion(sq);
      return makeMove(selected, sq);
    }
  }
  if (piece && piece.color === you) {
    selected = sq;
    legalTargets = chess.moves({ square: sq, verbose: true });
  } else {
    clearSelection();
  }
  render();
}

function clearSelection() {
  selected = null;
  legalTargets = [];
}

async function makeMove(from, to, promotion) {
  let mv;
  try { mv = chess.move({ from, to, promotion }); } // optimistic local apply
  catch { clearSelection(); render(); return; }
  clearSelection();
  lastMove = { from: mv.from, to: mv.to, captured: !!mv.captured };
  blip(mv.captured ? 220 : 440);
  render();
  renderMoves();
  renderFallen();
  setStatus("Waiting for your opponent", "");
  posting = true;
  try {
    const res = await api({ action: "move", id: state.id, key: myKey, from, to, promotion });
    applyState(res.state);
  } catch {
    try { applyState(await fetchState(state.id)); } catch { /* poll will recover */ }
    setStatus("That move didn't go through", "The board re-synced — try again.");
  } finally {
    posting = false;
    schedulePoll(true);
  }
}

function askPromotion(to) {
  pendingPromo = { from: selected, to };
  promoButtons.innerHTML = "";
  for (const p of ["q", "r", "b", "n"]) {
    const button = document.createElement("button");
    button.className = `promo-piece ${you}`;
    button.textContent = GLYPH[p] + TEXT;
    button.addEventListener("click", () => {
      const { from, to: dest } = pendingPromo;
      pendingPromo = null;
      promoEl.hidden = true;
      makeMove(from, dest, p);
    });
    promoButtons.appendChild(button);
  }
  promoEl.hidden = false;
}

promoEl.addEventListener("click", (e) => {
  if (e.target !== promoEl) return; // backdrop click cancels
  promoEl.hidden = true;
  pendingPromo = null;
  clearSelection();
  render();
});

// ── rendering ───────────────────────────────────────────────────────
function render() {
  const flipped = you === "b";
  const kingSq = chess.inCheck() ? findKing(chess.turn()) : null;
  const interactive = state && state.status === "active" && you && chess.turn() === you && !posting;
  boardEl.innerHTML = "";
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
      if (sq === kingSq) cell.classList.add("check");
      const targets = legalTargets.filter((m) => m.to === sq);
      if (targets.length) cell.classList.add(targets.some((m) => m.captured) ? "capture-hint" : "hint");
      const piece = chess.get(sq);
      if (piece) {
        const span = document.createElement("span");
        span.className = `piece ${piece.color}`;
        span.textContent = GLYPH[piece.type] + TEXT;
        if (lastMove && sq === lastMove.to) span.classList.add("just-moved");
        if (interactive && piece.color === you) span.classList.add("mine");
        cell.appendChild(span);
      }
      boardEl.appendChild(cell);
    }
  }
}

function findKing(color) {
  const rows = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = rows[r][c];
      if (p && p.type === "k" && p.color === color) return FILES[c] + (8 - r);
    }
  }
  return null;
}

// Each side's losses sit along its own edge of the board, so they follow the
// flip: whoever is at the top of the board gets the top tray.
function renderFallen() {
  // Replaying the moves is exact where counting the board isn't — a promoted
  // pawn leaves the board without ever having been captured.
  const fallen = { w: [], b: [] };
  for (const mv of chess.history({ verbose: true })) {
    if (mv.captured) fallen[mv.color === "w" ? "b" : "w"].push(mv.captured);
  }
  const flipped = you === "b";
  fillTray(fallenTopEl, flipped ? "w" : "b", fallen);
  fillTray(fallenBottomEl, flipped ? "b" : "w", fallen);
}

function fillTray(el, color, fallen) {
  el.setAttribute("aria-label", `${color === "w" ? "White" : "Black"} pieces captured`);
  el.innerHTML = "";
  for (const type of fallen[color].sort((a, b) => FALLEN_ORDER.indexOf(a) - FALLEN_ORDER.indexOf(b))) {
    const span = document.createElement("span");
    span.className = `fallen ${color}`;
    span.textContent = GLYPH[type] + TEXT;
    el.appendChild(span);
  }
}

function renderMoves() {
  const history = chess.history();
  movesEl.innerHTML = "";
  for (let i = 0; i < history.length; i += 2) {
    const li = document.createElement("li");
    li.textContent = history[i] + (history[i + 1] ? " " + history[i + 1] : "");
    movesEl.appendChild(li);
  }
  movesEl.scrollTop = movesEl.scrollHeight;
}

function setStatus(main, sub) {
  statusEl.textContent = main;
  subStatusEl.textContent = sub || "";
}

function setChip(chipState, text) {
  connChip.dataset.state = chipState;
  connChip.textContent = text;
}

// ── buttons ─────────────────────────────────────────────────────────
copyBtn.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(linkInput.value); }
  catch { linkInput.select(); document.execCommand("copy"); }
  copyBtn.textContent = "Copied!";
  setTimeout(() => { copyBtn.textContent = "Copy link"; }, 1500);
});

resignBtn.addEventListener("click", async () => {
  if (!state || state.status !== "active" || !you) return;
  if (!resignArm) {
    resignBtn.textContent = "Sure? Tap again";
    resignArm = setTimeout(disarmResign, 3000);
    return;
  }
  clearTimeout(resignArm);
  disarmResign();
  try { applyState((await api({ action: "resign", id: state.id, key: myKey })).state); }
  catch { schedulePoll(true); }
});

function disarmResign() {
  resignArm = null;
  resignBtn.textContent = "Resign";
}

rematchBtn.addEventListener("click", async () => {
  if (!state || state.status !== "over" || !you) return;
  try { applyState((await api({ action: "rematch", id: state.id, key: myKey })).state); }
  catch { schedulePoll(true); }
});

// ── turn notifications ──────────────────────────────────────────────
// Fired locally off the poll loop — there is no push server, so the tab has to
// stay open (backgrounded is fine) for an alert to land.
const NOTIFY_PREF = "chess-notify";
const NOTIFY_TAG = "chess-turn"; // one tag: a new alert replaces the stale one
const notifySupported = typeof Notification !== "undefined" && window.isSecureContext;
// Permission can be revoked in browser settings long after the pref was saved.
let notifyOn = notifySupported && localStorage.getItem(NOTIFY_PREF) === "on"
  && Notification.permission === "granted";
let swReg = null;
let liveNote = null; // constructor-path handle, so coming back to the tab can dismiss it

// Android has no Notification constructor; there they must come from a service
// worker registration. Wait for `ready` so the worker is active before we use it.
if (notifySupported && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js")
    .then(() => navigator.serviceWorker.ready)
    .then((reg) => { swReg = reg; }, () => { /* fall back to the constructor */ });
}

const pageInView = () => !document.hidden && document.hasFocus();

function syncNotifyUi() {
  notifyBtn.hidden = !notifySupported || !you;
  if (notifyBtn.hidden) return;
  const blocked = Notification.permission === "denied";
  notifyBtn.disabled = blocked;
  notifyBtn.setAttribute("aria-pressed", String(notifyOn && !blocked));
  notifyBtn.textContent = blocked ? "Turn alerts blocked by your browser"
    : notifyOn ? "Turn alerts on" : "Notify me when it's my turn";
}

notifyBtn.addEventListener("click", async () => {
  if (notifyOn) return setNotify(false);
  let permission = Notification.permission;
  if (permission === "default") {
    try { permission = await Notification.requestPermission(); }
    catch { /* older callback-only API resolves to undefined */ }
    permission ||= Notification.permission;
  }
  setNotify(permission === "granted");
  if (permission === "granted") notify("Turn alerts on", "This is what you'll see when it's your move.");
});

function setNotify(on) {
  notifyOn = on;
  localStorage.setItem(NOTIFY_PREF, on ? "on" : "off");
  if (!on) dismissNotifications();
  syncNotifyUi();
}

function notifyTurn() {
  if (!notifyOn || pageInView()) return; // no point pinging someone who's watching
  const san = chess.history().at(-1);
  const check = chess.inCheck() ? " You're in check." : "";
  notify("Your move", (san ? `They played ${san}.` : "The game has started.") + check);
}

async function notify(title, body) {
  const options = { body, tag: NOTIFY_TAG, renotify: true, data: { url: location.href } };
  try {
    if (swReg) return await swReg.showNotification(title, options);
    liveNote = new Notification(title, options);
    liveNote.onclick = () => { window.focus(); liveNote?.close(); };
  } catch { /* alerts are a nicety — never break the game over one */ }
}

async function dismissNotifications() {
  try {
    liveNote?.close();
    liveNote = null;
    for (const note of (await swReg?.getNotifications({ tag: NOTIFY_TAG })) || []) note.close();
  } catch { /* nothing to dismiss */ }
}

// ── move sound ──────────────────────────────────────────────────────
let audioCtx = null;
function blip(freq) {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.12);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.13);
  } catch { /* sound is optional */ }
}
