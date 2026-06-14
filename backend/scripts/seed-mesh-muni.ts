import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { db } from "../src/db/index.js";
import { meshMuniMappings } from "../src/db/schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const geojsonPath = join(__dirname, "../../frontend/public/data/muni-classify.geojson");

const LAT_DIV = 120;
const LON_DIV = 80;

function pointInRings(lng: number, lat: number, rings: number[][][]) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0],
        yi = ring[i][1];
      const xj = ring[j][0],
        yj = ring[j][1];
      const intersect =
        yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
  }
  return inside;
}

function toPolygons(geometry: any) {
  if (!geometry) return [];
  const polys =
    geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
      ? geometry.coordinates
      : [];
  return polys.map((rings: any) => {
    let minLng = Infinity,
      minLat = Infinity,
      maxLng = -Infinity,
      maxLat = -Infinity;
    for (const [x, y] of rings[0]) {
      if (x < minLng) minLng = x;
      if (x > maxLng) maxLng = x;
      if (y < minLat) minLat = y;
      if (y > maxLat) maxLat = y;
    }
    return { rings, bbox: [minLng, minLat, maxLng, maxLat] };
  });
}

function meshCode(ri: number, ci: number) {
  const p = Math.floor(ri / 80);
  const within = ri - p * 80;
  const q = Math.floor(within / 10);
  const r = within - q * 10;

  const uu = Math.floor(ci / 80);
  const u = uu - 100;
  const withinLon = ci - uu * 80;
  const v = Math.floor(withinLon / 10);
  const w = withinLon - v * 10;

  return `${p}${u}${q}${v}${r}${w}`;
}

const cellKey = (ri: number, ci: number) => ri * 100000 + ci;

async function main() {
  console.log("Reading muni-classify.geojson...");
  const muni = JSON.parse(readFileSync(geojsonPath, "utf8"));

  const claimed = new Set<number>();
  const rows: { cellId: number; municipality: string }[] = [];

  console.log(`Calculating mesh mappings for ${muni.features.length} features...`);
  let processed = 0;
  for (const f of muni.features) {
    const p = f.properties || {};
    const pref = p.N03_001 || "";
    const city = [p.N03_004, p.N03_005].filter(Boolean).join("");
    if (!city) continue;
    const key = `${pref}|${city}`;
    for (const { rings, bbox } of toPolygons(f.geometry)) {
      const [minLng, minLat, maxLng, maxLat] = bbox;
      const riMin = Math.floor(minLat * LAT_DIV);
      const riMax = Math.floor(maxLat * LAT_DIV);
      const ciMin = Math.floor(minLng * LON_DIV);
      const ciMax = Math.floor(maxLng * LON_DIV);
      for (let ri = riMin; ri <= riMax; ri++) {
        const lat = (ri + 0.5) / LAT_DIV;
        for (let ci = ciMin; ci <= ciMax; ci++) {
          const ck = cellKey(ri, ci);
          if (claimed.has(ck)) continue;
          const lng = (ci + 0.5) / LON_DIV;
          if (!pointInRings(lng, lat, rings)) continue;
          claimed.add(ck);

          const codeStr = meshCode(ri, ci);
          const cellId = parseInt(codeStr, 10);
          rows.push({ cellId, municipality: key });
        }
      }
    }
    if (++processed % 200 === 0) {
      console.log(`Processed ${processed}/${muni.features.length} features, ${rows.length} mappings found`);
    }
  }
  console.log(`Calculated ${rows.length} total land cell mappings.`);

  console.log("Clearing existing mappings in DB...");
  await db.delete(meshMuniMappings);

  console.log("Inserting mappings into DB in batches...");
  const CHUNK_SIZE = 5000;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    await db.insert(meshMuniMappings).values(chunk).onConflictDoNothing();
    inserted += chunk.length;
    if (inserted % 50000 === 0 || inserted === rows.length) {
      console.log(`Inserted ${inserted}/${rows.length} mappings...`);
    }
  }
  console.log("Database seeding completed successfully!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
