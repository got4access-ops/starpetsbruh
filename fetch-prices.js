// Sweeps the StarPets market and writes prices.json as { "pet_name|VARIANT": cheapest_usd }.
// Runs in GitHub Actions, so it can take its time instead of racing a function timeout.

import { writeFile } from "node:fs/promises";

const SOURCE = "https://market.apineural.com/api/v2/store/items/all";
const PAGE_SIZE = 72; // The API rejects anything larger.
const CONCURRENCY = 3; // They start dropping connections if pages come much faster than this.
const PAGE_DELAY_MS = 250;
const RETRIES = 5;
const OUTPUT = "prices.json";

const HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/plain, */*",
  Origin: "https://starpets.gg",
  Referer: "https://starpets.gg/",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const normalise = (value) => String(value).toLowerCase().replace(/[\s-]+/g, "_");

const variantOf = ({ pumping, flyable, rideable }) =>
  (pumping === "mega_neon" ? "M" : pumping === "neon" ? "N" : "") +
  (flyable ? "F" : "") +
  (rideable ? "R" : "");

async function fetchPage(page) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(SOURCE, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({
          filter: { types: [{ type: "pet" }] },
          page,
          amount: PAGE_SIZE,
          currency: "usd",
          sort: { popularity: "desc" },
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    } catch (error) {
      if (attempt === RETRIES) throw error;
      // A refused page means we are being throttled, so back off hard before trying again.
      await sleep(2000 * 2 ** (attempt - 1));
    }
  }
}

// Listings carry a display name ("Bat Dragon") and a kind slug ("winter_2022_bat_dragon"), so
// both are indexed — the game knows pets by display name, but slugs catch the odd mismatch.
function absorb(items = [], prices) {
  for (const listing of items) {
    const price = Number(listing.price);
    if (!(price > 0)) continue;
    const variant = variantOf(listing);
    for (const label of [listing.name, listing.realName]) {
      if (!label) continue;
      const key = `${normalise(label)}|${variant}`;
      if (!(key in prices) || price < prices[key]) prices[key] = price;
    }
  }
}

const started = Date.now();
const prices = {};
const first = await fetchPage(1);
absorb(first.items, prices);

const perPage = first.items?.length || PAGE_SIZE;
const pages = Math.ceil((first.count ?? perPage) / perPage);
console.log(`${first.count} listings across ${pages} pages`);

let next = 2;
const missed = [];
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, Math.max(0, pages - 1)) }, async () => {
    while (true) {
      const page = next++;
      if (page > pages) return;
      try {
        absorb((await fetchPage(page)).items, prices);
      } catch (error) {
        missed.push(page);
        console.warn(`page ${page} failed: ${error.message}`);
      }
      if (page % 50 === 0) console.log(`...page ${page}/${pages}`);
      await sleep(PAGE_DELAY_MS);
    }
  })
);

// Second pass, one page at a time, for anything the throttling ate.
let failed = 0;
if (missed.length) {
  console.log(`retrying ${missed.length} missed pages`);
  await sleep(15000);
  for (const page of missed) {
    try {
      absorb((await fetchPage(page)).items, prices);
    } catch (error) {
      failed += 1;
      console.warn(`page ${page} failed again: ${error.message}`);
    }
    await sleep(PAGE_DELAY_MS * 2);
  }
}

const count = Object.keys(prices).length;
if (!count) throw new Error("no prices collected");

await writeFile(OUTPUT, JSON.stringify({ updated: Date.now(), count, pages, failed, prices }));
console.log(`wrote ${OUTPUT}: ${count} keys, ${failed} failed pages, ${Date.now() - started}ms`);
