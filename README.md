# StarPets price proxy

One endpoint, `/api/prices`, that pages the StarPets market once on the server and returns every
pet price as a flat lookup the Roblox script can read in a single request:

```json
{
  "updated": 1761000000000,
  "count": 4812,
  "prices": { "bat_dragon|MFR": 42.5, "shadow_dragon|NFR": 18.99, "owl|": 1.2 }
}
```

Key format is `pet_name|VARIANT`, lowercased with spaces and hyphens turned into `_`. The variant is
`M` (mega neon) or `N` (neon), then `F` (fly) and `R` (ride) — so a plain pet's key ends in `|`.
Each key holds the **cheapest** live listing in USD.

## Layout

All four files sit side by side — no `api/` folder. `vercel.json` builds `prices.js` as a Node
function and routes `/api/prices` to it, so the whole folder can be dragged into GitHub in one go.
Vercel's **Root Directory** must be set to `starpets-proxy` when the repo nests it in that folder.

## Deploy

```bash
cd starpets-proxy
npx vercel deploy --prod
```

Then put the deployed URL in `Newblueprint.lua`:

```lua
local STARPETS_URL = "https://your-project.vercel.app/api/prices"
```

## Freshness

- `s-maxage=300` — the CDN serves a cached copy for 5 minutes, so the script's request never waits
  on StarPets.
- `stale-while-revalidate=86400` — after those 5 minutes the stale copy is still returned instantly
  while Vercel refreshes it in the background. Price changes land on the next request.
- There is no cron: the caching above is what keeps it current, and a cron can't be declared
  alongside the `builds` config this layout uses.

A failed upstream fetch returns whatever was collected with a 60s cache, so one bad page doesn't
poison the cache for 5 minutes.
