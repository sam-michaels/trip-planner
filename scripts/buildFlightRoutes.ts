// ============================================================
// Generates src/lib/flightRoutes.data.ts from OpenFlights' routes.dat.
//
// This is a build-time generator, not app code: it runs manually,
// on whoever's laptop is refreshing the dataset, and its output is
// committed. Nothing here ships to the browser, so it reads more like
// a shell script than a React-adjacent module — sync fs calls,
// `process.exit`, no framework.
//
// Run it with:
//   node scripts/buildFlightRoutes.ts [path-to-routes.dat]
//   node scripts/buildFlightRoutes.ts --refetch
//
// Node 22 runs a .ts file with type annotations directly (type
// stripping, no transpile step) — that's why there's no ts-node/tsx
// dependency here and none should be added just for this script.
// ============================================================

import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROUTES_URL =
  "https://raw.githubusercontent.com/jpatokal/openflights/master/data/routes.dat";

// The copy already vendored into this environment for this task. It
// is a path into this session's scratchpad, not the repo — there's
// nowhere durable to vendor a 3MB dataset file the generator itself
// needs, so treat this default as "wherever you last downloaded it"
// and pass a path argument once that copy is gone. `--refetch` skips
// the question entirely and pulls a fresh copy from GitHub.
const DEFAULT_LOCAL_PATH =
  "/private/tmp/claude-501/-Users-sammichaels-trip-planner/99496949-63ee-4a0b-a577-aefd08a72f2e/scratchpad/routes.dat";

// Counts measured against the real dataset once, by hand, and pinned
// here as a tripwire. OpenFlights ships no schema and no checksum —
// the only way to know the parse didn't quietly drop or double-count
// rows (a stray comma, a line-ending change, a re-export with a
// header added) is to check the shape of the output against a known-
// good run. If these ever legitimately need to move because the
// upstream dataset grew, update them deliberately — don't loosen the
// check to make a bug pass.
const EXPECTED_INPUT_ROWS = 67_663;
const EXPECTED_PAIR_COUNT = 37_595;
const EXPECTED_ORIGIN_COUNT = 3_409;

const OUTPUT_PATH = fileURLToPath(
  new URL("../src/lib/flightRoutes.data.ts", import.meta.url),
);

const IATA = /^[A-Z]{3}$/;

async function readRoutesDat(): Promise<string> {
  const args = process.argv.slice(2);
  if (args.includes("--refetch")) {
    console.error(`Fetching ${ROUTES_URL} ...`);
    const res = await fetch(ROUTES_URL);
    if (!res.ok) {
      throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    }
    return res.text();
  }

  const path = args.find((a) => !a.startsWith("--")) ?? DEFAULT_LOCAL_PATH;
  return readFileSync(path, "utf8");
}

/**
 * routes.dat is 9 CSV columns, no header:
 *   airline,airlineId,srcIATA,srcId,dstIATA,dstId,codeshare,stops,equipment
 * We only care about columns 3 and 5. No field in this dataset
 * contains a comma, so a plain split is enough — no CSV library, no
 * quote handling.
 */
function parsePairs(raw: string): { pairs: Set<string>; rowCount: number } {
  // \r\n line endings in the upstream file; \n-split then trim so a
  // stray \r never ends up glued onto the last column of a row.
  const lines = raw.split("\n").map((line) => line.trim());
  const rows = lines.filter((line) => line.length > 0);

  const pairs = new Set<string>();
  for (const row of rows) {
    const cols = row.split(",");
    const src = cols[2];
    const dst = cols[4];
    // `\N` is OpenFlights' null marker (airports with no IATA code,
    // ICAO-only). It fails the regex same as anything else malformed,
    // so it needs no special case.
    if (src && dst && IATA.test(src) && IATA.test(dst)) {
      pairs.add(`${src},${dst}`);
    }
  }

  return { pairs, rowCount: rows.length };
}

function groupByOrigin(pairs: Set<string>): Map<string, string[]> {
  const byOrigin = new Map<string, string[]>();
  for (const pair of pairs) {
    const [src, dst] = pair.split(",");
    const list = byOrigin.get(src);
    if (list) {
      list.push(dst);
    } else {
      byOrigin.set(src, [dst]);
    }
  }
  // Sorted origins and sorted destinations so the generated file is
  // stable across runs — a re-generation with no real data change
  // should produce a byte-identical diff, not a shuffled one.
  for (const dsts of byOrigin.values()) dsts.sort();
  return new Map([...byOrigin.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
}

function render(byOrigin: Map<string, string[]>): string {
  const lines = [...byOrigin.entries()].map(
    ([origin, dsts]) => `${origin} ${dsts.join(" ")}`,
  );

  return `// ============================================================
// GENERATED FILE — do not hand-edit. Regenerate with:
//   node scripts/buildFlightRoutes.ts
//
// Source: OpenFlights routes.dat (see scripts/buildFlightRoutes.ts
// for the parse rules and the exact row/pair counts this was
// generated from). ${EXPECTED_INPUT_ROWS} input rows collapse to
// ${EXPECTED_PAIR_COUNT} unique (origin, destination) pairs across
// ${EXPECTED_ORIGIN_COUNT} origin airports.
// ============================================================

/**
 * One line per origin airport: its IATA code, then every airport it
 * has at least one direct OpenFlights-listed route to, space-
 * separated. Same string-table idiom as HUB_TABLE in hubs.ts — a
 * table this size reads better as columns you scan than as ~3,400
 * array literals, and it's an order of magnitude smaller on disk
 * than the equivalent JSON.
 *
 * Deliberately one-directional: src/lib/flightRoutes.ts inverts this
 * at runtime to answer "what flies *into* X" rather than doubling
 * the table with a reverse copy that could drift out of sync with it.
 */
export const FLIGHT_ROUTE_TABLE = \`
${lines.join("\n")}
\`;
`;
}

async function main() {
  const raw = await readRoutesDat();
  const { pairs, rowCount } = parsePairs(raw);
  const byOrigin = groupByOrigin(pairs);

  const problems: string[] = [];
  if (rowCount !== EXPECTED_INPUT_ROWS) {
    problems.push(`input rows: expected ${EXPECTED_INPUT_ROWS}, got ${rowCount}`);
  }
  if (pairs.size !== EXPECTED_PAIR_COUNT) {
    problems.push(`unique pairs: expected ${EXPECTED_PAIR_COUNT}, got ${pairs.size}`);
  }
  if (byOrigin.size !== EXPECTED_ORIGIN_COUNT) {
    problems.push(
      `origin airports: expected ${EXPECTED_ORIGIN_COUNT}, got ${byOrigin.size}`,
    );
  }
  if (problems.length > 0) {
    console.error("buildFlightRoutes: parse doesn't match the verified shape of the dataset:");
    for (const p of problems) console.error(`  - ${p}`);
    console.error("Not writing output. Fix the parse before trusting a different count.");
    process.exit(1);
  }

  writeFileSync(OUTPUT_PATH, render(byOrigin));
  console.error(
    `Wrote ${OUTPUT_PATH} (${pairs.size} pairs, ${byOrigin.size} origins).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
