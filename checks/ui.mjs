// Browser checks for the shared board and the design tokens.
//
//   npm i -D playwright && node checks/ui.mjs
//
// Playwright is deliberately NOT a package.json dependency — it would be
// installed on every Vercel build for no benefit. Install it locally when you
// want to run this.
//
// What it guards, and why: the board used to be re-implemented per page, and a
// copy that declared grid-template-columns but not grid-template-rows collapsed
// the empty ranks to half height. Nothing in `node test.js` can see that, so
// this asserts the rendered geometry directly. It also catches a design token
// that fails to resolve (a typo or a cyclic var()), which silently drops a
// colour everywhere it is used.
//
// The live game isn't covered here because its board needs the API; it draws
// with the same board.js and the same shared.css as the pages below.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { chromium } from "playwright";

const ROOT = new URL("..", import.meta.url).pathname;
const PORT = 8799;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  try {
    const buf = await readFile(join(ROOT, path === "/" ? "/index.html" : path));
    res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" }).end(buf);
  } catch { res.writeHead(404).end("not found"); }
}).listen(PORT);

const fails = [];
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
  if (!cond) fails.push(label);
};

// CHROMIUM_PATH lets an image with a pinned browser skip `npx playwright install`
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);

// Every published study gets checked, not just one — a study is data, and bad
// data renders a broken page that node test.js cannot see.
const studies = JSON.parse(readFileSync(new URL("../tutorials/index.json", import.meta.url), "utf8"));
const studyPage = (slug) => [slug, `/tutorial.html?t=${slug}`,
  () => !document.getElementById("study").hidden, null];

// Wait for *every* card, so the board assertions below cover all of them.
const INDEX_PAGE = ["index", "/learn.html",
  (n) => document.querySelectorAll("#cards .board").length >= n, studies.length];
// Desktop sweeps everything; mobile spot-checks the index and one study, since
// the responsive rules are shared and re-testing all ten adds no coverage.
const VIEWPORTS = [
  ["desktop", 1200, 1000, [INDEX_PAGE, ...studies.map((s) => studyPage(s.slug))]],
  ["mobile ", 390, 844, [INDEX_PAGE, studyPage(studies[0].slug)]],
];

for (const [size, width, height, pages] of VIEWPORTS) {
for (const [name, path, ready, arg] of pages) {
  const label = `${size} ${name.padEnd(22)}`;
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}${path}`);
  await page.waitForFunction(ready, arg ?? null, { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready); // glyph metrics settle first

  ok(`${label} no JS errors`, errors.length === 0, errors.slice(0, 2).join(" | "));

  // Every board: 64 cells, every rank the same height, every file the same
  // width, and squares actually square. Tolerance is 1px because a board whose
  // width doesn't divide by 8 distributes the remainder across tracks — the bug
  // this guards against collapsed ranks to half height, a ~40px spread.
  const boards = await page.$$eval(".board", (els) => els.map((el) => {
    const cells = [...el.children].map((c) => c.getBoundingClientRect());
    const spread = (xs) => Math.max(...xs) - Math.min(...xs);
    const rows = cells.filter((_, i) => i % 8 === 0).map((r) => r.height);
    const cols = cells.slice(0, 8).map((r) => r.width);
    return {
      n: cells.length,
      rowSpread: +spread(rows).toFixed(2),
      colSpread: +spread(cols).toFixed(2),
      skew: +Math.abs(rows[0] - cols[0]).toFixed(2),
      size: +rows[0].toFixed(1),
    };
  }));
  ok(`${label} renders at least one board`, boards.length > 0);
  boards.forEach((b, i) => ok(
    `${label} board ${i}: 64 even squares`,
    b.n === 64 && b.rowSpread < 1 && b.colSpread < 1 && b.skew < 1,
    `${b.n} cells @ ${b.size}px, spread r=${b.rowSpread} c=${b.colSpread}, skew=${b.skew}`,
  ));

  // no design token may resolve to nothing
  const unresolved = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const names = [...document.styleSheets]
      .flatMap((s) => { try { return [...s.cssRules]; } catch { return []; } })
      .filter((r) => r.selectorText === ":root")
      .flatMap((r) => [...r.style]).filter((n) => n.startsWith("--"));
    return names.map((n) => [n, cs.getPropertyValue(n).trim()])
      .filter(([, v]) => !v || v.includes("var("))
      .map(([n, v]) => `${n}="${v}"`);
  });
  ok(`${label} every design token resolves`, unresolved.length === 0, unresolved.join(" "));

  const overflow = await page.evaluate(() => document.body.scrollWidth - document.documentElement.clientWidth);
  ok(`${label} no horizontal overflow`, overflow <= 0, `${overflow}px`);
  await ctx.close();
}
}

await browser.close();
server.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n  ${fails.join("\n  ")}` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
