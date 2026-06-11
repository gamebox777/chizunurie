// 宣伝用画像をまとめて生成する（実プレイ非依存・デモの塗り日本地図）。
//  - promo-square.png  1080x1080  SNS投稿用（X/Instagram）
//  - promo-ogp.png     1200x630   OGP/Twitterカード（URL共有時に展開）
//  - icon.png          1024x1024  SNSプロフィールアイコン（X/Instaのアバター）
// 素材: frontend/public/data/prefectures.geojson（47県・nam_ja/id）
// 出力: frontend/public/promo/*.png（+ .svg）
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// アプリ実物の配色
const C = {
  bg0: "#0b1220",
  bg1: "#162033",
  land: "#2b3a52",       // 未踏（薄いスレート）
  landStroke: "#1b2740",
  gps: "#facc15",        // GPS塗り（黄）
  manual: "#b5652f",     // 手動塗り（茶）
  conquer: "#f59e0b",    // 制覇（金）
  text: "#ffffff",
  sub: "#cbd5e1",
  accent: "#facc15",
};

// デモの塗り分け（それっぽく約4割）
const CONQUER = ["東京都", "神奈川県", "千葉県", "大阪府", "京都府", "沖縄県"];
const GPS = ["埼玉県", "愛知県", "福岡県", "北海道", "宮城県", "広島県", "茨城県"];
const MANUAL = ["静岡県", "兵庫県", "長野県", "新潟県", "石川県", "岡山県", "栃木県", "群馬県"];
const colorFor = (name) =>
  CONQUER.includes(name) ? C.conquer
  : GPS.includes(name) ? C.gps
  : MANUAL.includes(name) ? C.manual
  : C.land;

const FONT = "'Hiragino Sans','Yu Gothic','Noto Sans JP',sans-serif";
const mercX = (lon) => (lon * Math.PI) / 180;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

// view(緯度経度の範囲)を矩形 rect(px) にアスペクト維持でフィットする投影を作る
function makeProjection(view, rect) {
  const xMin = mercX(view.lonMin), xMax = mercX(view.lonMax);
  const yMin = mercY(view.latMin), yMax = mercY(view.latMax);
  const scale = Math.min(rect.w / (xMax - xMin), rect.h / (yMax - yMin));
  const offX = rect.x + (rect.w - (xMax - xMin) * scale) / 2;
  const offY = rect.y + (rect.h - (yMax - yMin) * scale) / 2;
  return {
    px: (lon) => offX + (mercX(lon) - xMin) * scale,
    py: (lat) => offY + (yMax - mercY(lat)) * scale,
  };
}

const geo = JSON.parse(readFileSync(resolve(ROOT, "frontend/public/data/prefectures.geojson"), "utf8"));

function ringToPath(ring, proj) {
  let d = "";
  for (let i = 0; i < ring.length; i++) {
    const [lon, lat] = ring[i];
    d += (i === 0 ? "M" : "L") + proj.px(lon).toFixed(1) + " " + proj.py(lat).toFixed(1);
  }
  return d + "Z";
}
function featurePath(geom, proj) {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  return polys.map((poly) => poly.map((r) => ringToPath(r, proj)).join("")).join("");
}
// colorFn(name)・glowFn(name) でフィーチャ毎の塗り/発光を制御
function mapPaths(proj, colorFn, glowFn, strokeW = 0.8) {
  return geo.features
    .map((f) => {
      const name = f.properties.nam_ja;
      const fill = colorFn(name);
      const glow = glowFn ? glowFn(name, fill) : false;
      return `<path d="${featurePath(f.geometry, proj)}" fill="${fill}" stroke="${C.landStroke}" stroke-width="${strokeW}"${glow ? ' filter="url(#glow)"' : ""}/>`;
    })
    .join("\n");
}

const defs = `<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${C.bg1}"/><stop offset="1" stop-color="${C.bg0}"/>
  </linearGradient>
  <radialGradient id="vignette" cx="0.5" cy="0.45" r="0.8">
    <stop offset="0.5" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.45"/>
  </radialGradient>
  <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
    <feGaussianBlur stdDeviation="3.5" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="glowStrong" x="-60%" y="-60%" width="220%" height="220%">
    <feGaussianBlur stdDeviation="9" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>`;

const demoColor = colorFor;
const demoGlow = (_n, fill) => fill === C.conquer || fill === C.gps;

// ---------- 1) 正方形 1080x1080 ----------
function buildSquare() {
  const S = 1080;
  const proj = makeProjection(
    { lonMin: 126.5, lonMax: 146.5, latMin: 26.0, latMax: 46.2 },
    { x: 70, y: 70, w: S - 140, h: S - 140 }
  );
  return `<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" xmlns="http://www.w3.org/2000/svg">
${defs}
  <rect width="${S}" height="${S}" fill="url(#bg)"/>
  <g>${mapPaths(proj, demoColor, demoGlow)}</g>
  <rect width="${S}" height="${S}" fill="url(#vignette)"/>
  <rect x="0" y="0" width="${S}" height="300" fill="${C.bg0}" opacity="0.55"/>
  <rect x="0" y="${S - 300}" width="${S}" height="300" fill="${C.bg0}" opacity="0.6"/>
  <text x="60" y="116" font-family="${FONT}" font-size="40" font-weight="700" fill="${C.accent}" letter-spacing="6">GPSで日本を“制覇”する</text>
  <text x="56" y="206" font-family="${FONT}" font-size="92" font-weight="900" fill="${C.text}">歩いて、塗る。</text>
  <circle cx="92" cy="${S - 96}" r="34" fill="${C.accent}"/>
  <text x="92" y="${S - 82}" font-family="${FONT}" font-size="40" font-weight="900" fill="${C.bg0}" text-anchor="middle">塗</text>
  <text x="150" y="${S - 104}" font-family="${FONT}" font-size="60" font-weight="900" fill="${C.text}">ちずぬりえ</text>
  <text x="152" y="${S - 60}" font-family="${FONT}" font-size="30" font-weight="600" fill="${C.sub}">歩いた街が色になる、白地図ぬりつぶしゲーム</text>
</svg>`;
}

// ---------- 2) OGPバナー 1200x630（左テキスト・右地図） ----------
function buildOgp() {
  const W = 1200, H = 630;
  const proj = makeProjection(
    { lonMin: 127.5, lonMax: 146.5, latMin: 30.0, latMax: 46.2 },
    { x: 600, y: 20, w: 600, h: H - 40 }
  );
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
${defs}
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <g>${mapPaths(proj, demoColor, demoGlow)}</g>
  <rect width="${W}" height="${H}" fill="url(#vignette)"/>
  <rect x="0" y="0" width="720" height="${H}" fill="${C.bg0}" opacity="0.55"/>
  <text x="72" y="150" font-family="${FONT}" font-size="34" font-weight="700" fill="${C.accent}" letter-spacing="5">GPSで日本を“制覇”する</text>
  <text x="68" y="270" font-family="${FONT}" font-size="116" font-weight="900" fill="${C.text}">歩いて、塗る。</text>
  <text x="72" y="345" font-family="${FONT}" font-size="34" font-weight="600" fill="${C.sub}">歩いた街が色になる、白地図ぬりつぶしゲーム</text>
  <circle cx="100" cy="${H - 86}" r="36" fill="${C.accent}"/>
  <text x="100" y="${H - 71}" font-family="${FONT}" font-size="42" font-weight="900" fill="${C.bg0}" text-anchor="middle">塗</text>
  <text x="156" y="${H - 92}" font-family="${FONT}" font-size="56" font-weight="900" fill="${C.text}">ちずぬりえ</text>
</svg>`;
}

// ---------- 3) アイコン 1024x1024（金の日本シルエット・アバター用） ----------
function buildIcon() {
  const S = 1024;
  const proj = makeProjection(
    { lonMin: 128.0, lonMax: 146.2, latMin: 30.5, latMax: 46.0 },
    { x: 150, y: 150, w: S - 300, h: S - 300 }
  );
  // 全県を金で塗り「日本＝このアプリ」を一目で。アバターは円形クロップ前提で中央寄せ。
  const goldJapan = mapPaths(proj, () => C.accent, () => true, 0);
  return `<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" xmlns="http://www.w3.org/2000/svg">
${defs}
  <rect width="${S}" height="${S}" fill="url(#bg)"/>
  <circle cx="${S / 2}" cy="${S / 2}" r="${S / 2 - 8}" fill="none" stroke="${C.accent}" stroke-width="6" opacity="0.35"/>
  <g filter="url(#glowStrong)">${goldJapan}</g>
</svg>`;
}

// ---------- 出力 ----------
const outDir = resolve(ROOT, "frontend/public/promo");
mkdirSync(outDir, { recursive: true });

function emit(name, svg, size) {
  writeFileSync(resolve(outDir, name + ".svg"), svg);
  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: size },
    font: { loadSystemFonts: true, defaultFontFamily: "Hiragino Sans" },
    background: C.bg0,
  }).render().asPng();
  writeFileSync(resolve(outDir, name + ".png"), png);
  console.log("wrote", name + ".png", "(" + png.length + " bytes)");
}

emit("promo-square", buildSquare(), 1080);
emit("promo-ogp", buildOgp(), 1200);
emit("icon", buildIcon(), 1024);
