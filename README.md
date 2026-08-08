# Chess with a Friend

Two-player correspondence chess. Copy a link, send it to a friend, play. Games
are saved server-side, so either player can close the tab and come back. There
are also opening tutorials, rendered from JSON.

No build step, no framework, no bundler. Vanilla ES modules and plain CSS,
served as static files by Vercel, with one serverless function for game state.

```
index.html    app.js       the live game
learn.html    learn.js     the openings index
tutorial.html tutorial.js  the study player  (tutorial.html?t=<slug>)

board.js       THE board renderer — game and tutorials both call it
replay.js      rebuild a position from a game document
tutorials.js   load a tutorial, derive its positions
sw.js          service worker, for turn notifications only

shared.css     design tokens + page shell + board   (every page imports this)
game.css       chrome only the game uses
learn.css      chrome only the tutorial pages use

api/game.js    the only endpoint: create / join / name / move / resign / rematch
api/recorder.js archives finished games to Postgres (best-effort, never blocks)
tutorials/*.json  tutorial content
db/            schema and setup notes
test.js        unit + data validation      — node test.js
checks/ui.mjs  rendered-geometry checks    — npm i -D playwright && node checks/ui.mjs
```

## Architectural rules

These are not style preferences. Each one is here because breaking it already
caused a bug in this repo.

### 1. One definition per concept. Never a second copy.

The board was once re-implemented for a tutorial page. The copy declared
`grid-template-columns` but not `grid-template-rows`, so the four empty middle
ranks collapsed to half height and the squares stopped being square. The
original was correct; the copy drifted. Nobody noticed until it shipped.

So: `board.js` is the only board, `replay.js` is the only
document-to-position function, `shared.css` is the only place the board is
styled. If you need one of these somewhere new, **import it**. If it almost
fits, change the shared one to take an argument — do not fork it.

This applies to data as much as code. The `games` table is defined both in
`api/recorder.js` (created at runtime) and `db/schema.sql` (documentation).
Both are genuinely useful, so neither was deleted — instead `test.js` parses
both and fails if they disagree. When you cannot collapse two copies into one,
make a test assert they match.

### 2. Derive; don't author what a machine can compute.

Tutorials store **SAN moves**, not FENs. `tutorials.js` replays the line
through chess.js to get each position. A hand-written FEN is duplicated state
that can silently disagree with the position it claims to describe — castling
rights and the en-passant square especially — and nothing would catch it.
Deriving also produces the move highlight for free, and makes an illegal line a
test failure instead of a wrong board.

A tutorial step may set `"fen"` explicitly, but only for positions no move
sequence reaches (tactics, endgame studies).

### 3. Shared components take arguments; they never read global state.

`renderBoard(el, opts)` knows nothing about seats, turns, or lessons. The game
passes its state, a tutorial passes a position and a last move. That is what
makes it reusable — the moment a shared component reaches for a module-level
variable, it belongs to one caller again.

### 4. Colours are tokens. Literals go in `:root` and nowhere else.

Every colour lives in `shared.css`'s `:root` block. The same piece fill was once
written out in both the board and the promotion overlay; when one changed the
other silently didn't. If you find yourself typing a hex or `rgba()` outside
`:root`, add a token instead — and give it a name that says what it is
(`--on-gold`, `--hairline`), not what it looks like.

Same for repeated rule bodies: the small-caps mono label used by `.eyebrow`,
`.tag`, `.card-meta` and `.fen span` is one rule with a selector list plus
per-class deltas, not four near-identical blocks.

### 5. Style the board by class, not id.

`.board`, not `#board`. Pages render more than one — the openings index shows a
small board per card. Override `--board-w` on the element to resize; `--sq` is
re-declared on `.board` so it follows. It has to be re-declared there: a custom
property is substituted where it is *declared*, so a `--sq` computed on `:root`
would keep the root's board size and the oversized glyphs would force the grid
rows open.

### 6. `api/` is for endpoints. Library code lives at the root.

Every file under `api/` is deployed as a route. `replay.js` sits at the repo
root for exactly this reason. (`api/recorder.js` is a library that predates this
rule and is still under `api/` — worth moving.)

### 7. Write the test that would have caught it, then prove it bites.

After fixing something, add the check — then break the code on purpose and
confirm the check fails. An assertion that has never failed is not known to
work. Every guard in this repo was verified this way: an illegal tutorial move,
a cyclic CSS variable, a schema column added to one file only, and deleting
`grid-template-rows` (which reproduces as a 51px rank spread).

`node test.js` covers anything expressible without a browser. `checks/ui.mjs`
covers what only a browser can see — rendered geometry, tokens that resolve.
Rendered-geometry assertions need a tolerance (~1px): boards whose width does
not divide by 8 distribute the remainder across tracks, and that is not a bug.

### 8. Don't make the deploy pay for the tests.

Playwright is deliberately **not** in `package.json` — it would install on every
Vercel build for no benefit. Install it locally when you want to run
`checks/ui.mjs`.

### 9. Polling is the transport. Keep it cheap.

The client polls `/api/game`; there is no push. An earlier version forced an
origin read on every poll and Vercel rate-limited the blob store into 403s for
everyone. Idle polls now answer from the version in the blob pathname via
`?since=`, without reading a body. Before adding anything that runs per poll,
work out what it costs at two players × every few seconds.

## Working on it

```bash
npm install
node test.js                              # unit tests + tutorial/schema validation
npm i -D playwright && node checks/ui.mjs  # rendered-geometry checks
```

`app.js` is loaded as `app.js?v=N` — bump `N` in `index.html` when you change it,
or returning players get the cached copy.

### Adding a tutorial

Write `tutorials/<slug>.json` and add an entry to `tutorials/index.json`. No
code changes. `node test.js` validates every move by replaying it, so a typo in
a line fails before it reaches a reader.

```json
{
  "slug": "my-opening",
  "title": "…", "eyebrow": "…", "standfirst": "…",
  "startFen": null,
  "steps": [
    { "tag": "…", "title": "…", "body": ["the starting position — no move"] },
    { "san": "e4", "tag": "…", "title": "…", "body": ["…"] }
  ]
}
```

Step `body` entries are rendered as HTML, so `<b>` and `<i>` work. This is
first-party content from the repo — do not point the loader at anything a user
can write without escaping it first.
