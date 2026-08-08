# Chess with a Friend

Online chess with no accounts: open the app, share the link, play. Live game
state lives in Vercel Blob; every finished game is archived to Postgres for later
analysis (see [`db/README.md`](db/README.md)).

## Deployment — `main` is production

**The `main` branch is the deployed state. Ship only by merging to `main`.**

This project is connected to Vercel with Git auto-deploy: every push/merge to
`main` builds and promotes to production automatically. That protects one
guarantee worth keeping — **whatever is in `main` is exactly what's live.**

- **Do:** open a PR and merge it to `main`. The merge *is* the deploy.
- **Don't:** run `vercel --prod` (or any local/CLI deploy) to publish to
  production. A local deploy ships code that isn't in `main`, silently breaks the
  "main == production" promise, and overwrites whatever the last `main` deploy
  put live — including work from another branch or another person's session.

`vercel dev` (local dev server) and preview deployments from PR branches are
fine — they don't touch production. The rule is only about publishing to prod.

## Develop

```bash
node test.js     # unit tests (pure logic — no network)
vercel dev       # run the static site + /api functions locally
```
