// Production smoke: two browsers playing a real game with the client's polling pattern.
import { Chess } from "chess.js";

const B = "https://chess-multiplayer-kappa.vercel.app/api/game";
const codes = new Map();
const errors = [];
const tally = (what, code, body) => {
  const k = `${what} ${code}`;
  codes.set(k, (codes.get(k) || 0) + 1);
  if (code !== 200) errors.push(`${what} ${code} ${String(body).slice(0, 120)}`);
};

async function post(payload) {
  const res = await fetch(B, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const body = await res.text();
  tally(`POST:${payload.action}`, res.status, body);
  return res.status === 200 ? JSON.parse(body) : null;
}

async function poll(id, key, since) {
  const res = await fetch(`${B}?id=${id}&key=${key}&since=${since}`);
  const body = await res.text();
  tally("GET:poll", res.status, body);
  return res.status === 200 ? JSON.parse(body) : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pollDelay = (st, you) => (st.status === "waiting" ? 2500 : st.status === "active" ? (st.turn === you ? 6000 : 2000) : 4000);

const created = await post({ action: "create" });
const id = created.state.id;
const joined = await post({ action: "join", id });
const seats = { [created.state.you]: created.key, [joined.state.you]: joined.key };
console.log(`game ${id}  seats=${Object.keys(seats).join(",")}  status=${joined.state.status}`);

let plies = 0;
const MAX_PLIES = 24;

async function browser(you) {
  const key = seats[you];
  let st = joined.state;
  while (st.status !== "over" && plies < MAX_PLIES) {
    await sleep(pollDelay(st, you));
    const r = await poll(id, key, st.v);
    if (!r) continue;
    if (!r.unchanged) st = r.state;
    if (st.status === "active" && st.turn === you && plies < MAX_PLIES) {
      const chess = new Chess();
      for (const san of st.moves) chess.move(san);
      const legal = chess.moves({ verbose: true });
      if (!legal.length) break;
      const mv = legal[Math.floor(Math.random() * legal.length)];
      const r2 = await post({ action: "move", id, key, from: mv.from, to: mv.to, promotion: mv.promotion ?? undefined });
      if (r2) { st = r2.state; plies++; process.stdout.write(`${plies}.${mv.san} `); }
    }
  }
}

await Promise.all([browser("w"), browser("b")]);
console.log("\n\n--- status counts ---");
for (const [k, v] of [...codes].sort()) console.log(`  ${k.padEnd(20)} ${v}`);
console.log(`\nplies played: ${plies}`);
console.log(errors.length ? `FAILURES (${errors.length}):\n  ` + errors.slice(0, 10).join("\n  ") : "NO FAILURES");
process.exit(errors.length ? 1 : 0);
