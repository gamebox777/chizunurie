#!/usr/bin/env node
// ───────────────────────────────────────────────────────────────────────────
// build-graphics.mjs — Play ストア用グラフィック（仮）を「必要な解像度ちょうど」で生成
//
//   node build-graphics.mjs
//
// 依存なし。HTML/Canvas を headless Chrome で正確なピクセルサイズにレンダリングする。
// ブランド配色のデザイン入りプレースホルダー。後で実機スクショに差し替え可能。
// 出力:
//   icon/icon-512.png                         アプリアイコン 512x512（言語非依存）
//   feature/feature-1024x500-{ja,en}.png      フィーチャーグラフィック
//   screenshots/phone/{ja,en}/0N.png          スマホ 1080x1920（各5枚）
//   screenshots/tablet7/{ja,en}/0N.png        7型タブレット 1296x2304（各2枚・9:16）
//   screenshots/tablet10/{ja,en}/0N.png       10型タブレット 1620x2880（各2枚・9:16）
// ───────────────────────────────────────────────────────────────────────────
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, "..");
const G = resolve(ROOT, "graphics");
const DATA = resolve(ROOT, "../../frontend/public/data"); // 地図ジオメトリの取得元
const CHROME =
  process.env.CHROME ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TMP = resolve(__dir, ".tmp-render");
mkdirSync(TMP, { recursive: true });

// ── 実ジオメトリ（geojson）からリングを取り出して軽量化する ─────────────────────
// prefectures.geojson（日本）/ world-land.geojson（世界）の外周リングだけを取り、
// マンハッタン距離でラジアル簡略化。穴・極小島は落とす。緯度経度のまま保持する。
function ringsFromGeo(file, { eps, minSpan, dropBelowLat = -91 }) {
  const j = JSON.parse(readFileSync(resolve(DATA, file), "utf8"));
  const out = [];
  const addPoly = (poly) => {
    const ring = poly && poly[0];
    if (!ring) return;
    let mnx = 9e9, mny = 9e9, mxx = -9e9, mxy = -9e9;
    for (const p of ring) {
      if (p[0] < mnx) mnx = p[0]; if (p[0] > mxx) mxx = p[0];
      if (p[1] < mny) mny = p[1]; if (p[1] > mxy) mxy = p[1];
    }
    if (Math.max(mxx - mnx, mxy - mny) < minSpan) return; // 極小島は捨てる
    if (mxy < dropBelowLat) return; // 南極などを捨てる
    const s = [];
    let last = null;
    for (const p of ring) {
      if (!last || Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) > eps) {
        s.push([Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]);
        last = p;
      }
    }
    if (s.length >= 4) out.push(s);
  };
  for (const ft of j.features) {
    const g = ft.geometry;
    if (!g) continue;
    if (g.type === "Polygon") addPoly(g.coordinates);
    else if (g.type === "MultiPolygon") for (const poly of g.coordinates) addPoly(poly);
  }
  return out;
}

// 各地図の設定（投影 bbox・グリッド/塗りの粒度・塗り開始セル・塗り上限）
const MAPS = {
  japan: {
    bbox: [122, 23, 149, 46],
    rings: ringsFromGeo("prefectures.geojson", { eps: 0.04, minSpan: 0.18 }),
    cellDeg: 0.5,
    seed: [138, 36], // 中部地方あたりから塗り広げる
    cap: 62,
    fill: 0.94,
    gps: [137.2, 36.6],
  },
  world: {
    bbox: [-168, -56, 190, 84],
    rings: ringsFromGeo("world-land.geojson", { eps: 0.5, minSpan: 1.4, dropBelowLat: -56 }),
    cellDeg: 4.5,
    seed: [12, 50], // 中央ヨーロッパから塗り広げる
    cap: 78,
    fill: 0.96,
    gps: [10, 50],
  },
};

// ── Canvas で実地図（緯度経度投影）＋タイル塗りを描く（全アセット共通） ───────────
const MAP_JS = String.raw`
function projector(W,H,bbox,fill){
  const w=bbox[0],s=bbox[1],e=bbox[2],n=bbox[3];
  const midLat=(s+n)/2,midLng=(w+e)/2,kx=Math.cos(midLat*Math.PI/180);
  const scale=Math.min(W/((e-w)*kx),H/(n-s))*fill,cx=W/2,cy=H/2;
  return {x:(lng)=>cx+(lng-midLng)*kx*scale,y:(lat)=>cy-(lat-midLat)*scale};
}
function pointInRings(rings,lng,lat){
  let inside=false;
  for(const r of rings){
    for(let i=0,j=r.length-1;i<r.length;j=i++){
      const xi=r[i][0],yi=r[i][1],xj=r[j][0],yj=r[j][1];
      if(((yi>lat)!==(yj>lat))&&(lng<(xj-xi)*(lat-yi)/(yj-yi)+xi))inside=!inside;
    }
  }
  return inside;
}
function drawMap(canvas,M){
  const ctx=canvas.getContext('2d'),W=canvas.width,H=canvas.height,S=Math.min(W,H);
  const P=projector(W,H,M.bbox,M.fill),cd=M.cellDeg,bb=M.bbox;
  ctx.fillStyle='#d7e9f6';ctx.fillRect(0,0,W,H);
  // 陸地
  ctx.fillStyle='#efe7d8';ctx.strokeStyle='#c9b79a';ctx.lineWidth=Math.max(1,S*0.0022);
  for(const r of M.rings){ctx.beginPath();
    for(let i=0;i<r.length;i++){const x=P.x(r[i][0]),y=P.y(r[i][1]);i?ctx.lineTo(x,y):ctx.moveTo(x,y);}
    ctx.closePath();ctx.fill();ctx.stroke();}
  // 経緯度グリッド（塗りセルと整列）
  ctx.strokeStyle='rgba(80,70,50,0.12)';ctx.lineWidth=1;
  for(let lng=Math.ceil(bb[0]/cd)*cd;lng<=bb[2];lng+=cd){const x=P.x(lng);ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
  for(let lat=Math.ceil(bb[1]/cd)*cd;lat<=bb[3];lat+=cd){const y=P.y(lat);ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
  // タイル塗り：seed セルから陸地のみを連結で塗り広げる
  const gx0=Math.round(M.seed[0]/cd),gy0=Math.round(M.seed[1]/cd);
  const seen=new Set(),q=[[gx0,gy0]];let c=0;
  ctx.fillStyle='rgba(227,49,49,0.82)';ctx.strokeStyle='rgba(170,18,18,0.55)';
  while(q.length&&c<M.cap){const cell=q.shift(),k=cell[0]+','+cell[1];
    if(seen.has(k))continue;seen.add(k);
    const cLng=cell[0]*cd+cd/2,cLat=cell[1]*cd+cd/2;
    if(cLng<bb[0]||cLng>bb[2]||cLat<bb[1]||cLat>bb[3])continue;
    if(!pointInRings(M.rings,cLng,cLat))continue;
    const x1=P.x(cell[0]*cd),x2=P.x(cell[0]*cd+cd),y1=P.y(cell[1]*cd+cd),y2=P.y(cell[1]*cd);
    ctx.lineWidth=1;ctx.fillRect(x1+1,y2+1,(x2-x1)-2,(y1-y2)-2);ctx.strokeRect(x1+1.5,y2+1.5,(x2-x1)-3,(y1-y2)-3);
    c++;q.push([cell[0]+1,cell[1]],[cell[0]-1,cell[1]],[cell[0],cell[1]+1],[cell[0],cell[1]-1]);
  }
  // GPS マーカー
  if(M.showGps&&M.gps){const px=P.x(M.gps[0]),py=P.y(M.gps[1]);
    ctx.beginPath();ctx.arc(px,py,S*0.05,0,7);ctx.fillStyle='rgba(59,111,212,0.18)';ctx.fill();
    ctx.beginPath();ctx.arc(px,py,S*0.02,0,7);ctx.fillStyle='#3b6fd4';ctx.fill();
    ctx.lineWidth=Math.max(3,S*0.006);ctx.strokeStyle='#fff';ctx.stroke();}
}
`;

const FONT =
  "'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP','Yu Gothic',system-ui,sans-serif";

// 地図設定を JSON 化（showGps / fill を上書きして埋め込む）
const mapConfig = (kind, over = {}) => JSON.stringify({ ...MAPS[kind], ...over });

// アプリの簡易UI（端末枠の中身）。lang で文言を切替
function appChrome(lang, opts = {}) {
  const t =
    lang === "ja"
      ? {
          login: "ログイン",
          modes: ["現地塗り", "となり塗り", "なぞり塗り"],
          pt: "塗りポイント 10 / 10",
          lv: "Lv.4",
          rankTitle: "全国ランキング",
          rows: [
            ["1", "ぬりお", "12,840"],
            ["2", "まっぷ太郎", "9,310"],
            ["3", "あなた", "7,205"],
          ],
          statTitle: "東京都 64%",
          statSub: "渋谷区 82%（410 / 500）",
        }
      : {
          login: "Sign in",
          modes: ["Visit", "Neighbor", "Drag"],
          pt: "Paint points 10 / 10",
          lv: "Lv.4",
          rankTitle: "National ranking",
          rows: [
            ["1", "Nurio", "12,840"],
            ["2", "MapTaro", "9,310"],
            ["3", "You", "7,205"],
          ],
          statTitle: "Tokyo 64%",
          statSub: "Shibuya 82% (410 / 500)",
        };
  const panel =
    opts.overlay === "rank"
      ? `<div class="panel">
           <div class="panelTitle">🏆 ${t.rankTitle}</div>
           ${t.rows
             .map(
               (r, i) =>
                 `<div class="row${i === 2 ? " me" : ""}"><span class="rk">${r[0]}</span><span class="nm">${r[1]}</span><span class="sc">${r[2]}</span></div>`
             )
             .join("")}
         </div>`
      : opts.overlay === "stat"
        ? `<div class="statbox"><b>${t.statTitle}</b><span>${t.statSub}</span></div>`
        : "";
  return `
    <div class="appbar"><span class="brand">ちずぬりえ</span><span class="grow"></span><span class="loginpill">${t.login}</span></div>
    <canvas class="map" width="${opts.cw}" height="${opts.ch}"></canvas>
    <div class="toolbar">${t.modes
      .map((m, i) => `<span class="${i === 0 ? "on" : ""}">${m}</span>`)
      .join("")}</div>
    <div class="ptchip">${t.pt}</div>
    ${panel}
    <div class="lvbar"><span class="lvtag">${t.lv}</span><div class="lvtrack"><i style="width:46%"></i></div></div>
  `;
}

function phoneHTML({ lang, headline, sub, variant }) {
  const W = 1080;
  const mapH = 1190; // 端末内 canvas の高さ
  const kind = lang === "ja" ? "japan" : "world"; // 日本語=日本地図 / 英語=世界地図
  const overlay = variant === "rank" ? "rank" : variant === "large" ? "stat" : "";
  const gps = variant === "gps";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
   *{margin:0;padding:0;box-sizing:border-box}
   html,body{width:${W}px;height:1920px;overflow:hidden;font-family:${FONT}}
   .screen{width:${W}px;height:1920px;background:linear-gradient(160deg,#3b6fd4,#6ea0ee);
     display:flex;flex-direction:column;align-items:center}
   .band{width:100%;padding:74px 78px 30px;color:#fff;text-align:center}
   .logo{font-size:34px;font-weight:700;opacity:.92;letter-spacing:.04em}
   .logo b{background:#fff;color:#3b6fd4;border-radius:10px;padding:2px 12px;margin-right:14px}
   h1{font-size:66px;line-height:1.22;font-weight:800;margin:26px 0 16px;letter-spacing:.01em}
   .band p{font-size:33px;line-height:1.5;opacity:.94;font-weight:500}
   .device{flex:1;margin:18px 60px 70px;background:#1a1a1a;border-radius:54px;
     padding:16px;box-shadow:0 30px 60px rgba(0,0,0,.30);width:calc(100% - 120px)}
   .frame{width:100%;height:100%;background:#eef1f4;border-radius:40px;overflow:hidden;position:relative}
   .appbar{position:absolute;top:0;left:0;right:0;height:96px;background:#fff;display:flex;
     align-items:center;padding:0 36px;z-index:5;border-bottom:1px solid #eee}
   .brand{font-size:38px;font-weight:800;color:#1a1a1a}
   .grow{flex:1}
   .loginpill{background:#3b6fd4;color:#fff;font-size:28px;font-weight:700;padding:14px 30px;border-radius:999px}
   .map{position:absolute;top:96px;left:0;width:100%;height:${mapH}px;display:block}
   .toolbar{position:absolute;top:128px;left:30px;display:flex;gap:10px;z-index:6}
   .toolbar span{background:rgba(255,255,255,.92);color:#444;font-size:26px;font-weight:700;
     padding:14px 22px;border-radius:14px;box-shadow:0 4px 10px rgba(0,0,0,.12)}
   .toolbar span.on{background:#f6c343;color:#1a1a1a}
   .ptchip{position:absolute;top:212px;left:34px;color:#e03131;font-size:30px;font-weight:800;z-index:6;
     text-shadow:0 1px 2px #fff}
   .lvbar{position:absolute;left:30px;right:30px;bottom:30px;display:flex;align-items:center;gap:18px;z-index:6;
     background:rgba(255,255,255,.95);border-radius:20px;padding:18px 24px;box-shadow:0 6px 16px rgba(0,0,0,.14)}
   .lvtag{background:#f6c343;color:#1a1a1a;font-weight:800;font-size:28px;padding:8px 18px;border-radius:12px}
   .lvtrack{flex:1;height:18px;background:#e6e6e6;border-radius:99px;overflow:hidden}
   .lvtrack i{display:block;height:100%;background:#3b6fd4}
   .panel{position:absolute;right:30px;top:300px;width:62%;background:rgba(255,255,255,.97);
     border-radius:22px;padding:24px 26px;z-index:7;box-shadow:0 10px 26px rgba(0,0,0,.2)}
   .panelTitle{font-size:30px;font-weight:800;margin-bottom:14px;color:#1a1a1a}
   .row{display:flex;align-items:center;font-size:30px;padding:12px 6px;border-top:1px solid #f0f0f0}
   .row .rk{width:54px;font-weight:800;color:#888}
   .row .nm{flex:1;font-weight:700;color:#222}
   .row .sc{font-weight:700;color:#3b6fd4}
   .row.me{background:#eef4ff;border-radius:12px}
   .statbox{position:absolute;left:30px;bottom:150px;background:rgba(26,26,26,.86);color:#fff;
     border-radius:18px;padding:18px 26px;z-index:7;display:flex;flex-direction:column;gap:6px}
   .statbox b{font-size:34px}.statbox span{font-size:26px;opacity:.9}
  </style></head><body>
   <div class="screen">
     <div class="band">
       <div class="logo"><b>▦</b>${lang === "ja" ? "ちずぬりえ" : "Color the Map"}</div>
       <h1>${headline}</h1>
       <p>${sub}</p>
     </div>
     <div class="device"><div class="frame">
       ${appChrome(lang, { cw: W - 32, ch: mapH, overlay, gps })}
     </div></div>
   </div>
   <script>${MAP_JS}
     drawMap(document.querySelector('.map'),${mapConfig(kind, { showGps: gps })});
   </script>
  </body></html>`;
}

function featureHTML(lang) {
  const tag =
    lang === "ja"
      ? "歩いて塗る、日本制覇マップ"
      : "Walk, paint, and conquer the map";
  const name = lang === "ja" ? "ちずぬりえ" : "Color the Map";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
   *{margin:0;box-sizing:border-box}
   html,body{width:1024px;height:500px;overflow:hidden;font-family:${FONT}}
   .wrap{width:1024px;height:500px;background:linear-gradient(120deg,#3b6fd4,#6ea0ee);
     display:flex;align-items:center;position:relative;overflow:hidden}
   .left{padding:0 60px;color:#fff;z-index:2;max-width:560px}
   .logo{font-size:30px;font-weight:700;opacity:.9}
   .logo b{background:#fff;color:#3b6fd4;border-radius:8px;padding:1px 10px;margin-right:10px}
   h1{font-size:76px;font-weight:900;margin:14px 0 18px;letter-spacing:.02em}
   p{font-size:34px;font-weight:600;opacity:.96}
   canvas{position:absolute;right:-40px;top:0;height:500px;width:540px;
     -webkit-mask-image:linear-gradient(90deg,transparent,#000 22%);mask-image:linear-gradient(90deg,transparent,#000 22%)}
  </style></head><body>
   <div class="wrap">
     <canvas id="m" width="540" height="500"></canvas>
     <div class="left">
       <div class="logo"><b>▦</b>${name}</div>
       <h1>${name}</h1>
       <p>${tag}</p>
     </div>
   </div>
   <script>${MAP_JS}
     drawMap(document.getElementById('m'),${mapConfig(lang === "ja" ? "japan" : "world")});
   </script>
  </body></html>`;
}

function iconHTML() {
  // 512x512。マップピン＋1kmマスの塗り。Play は角丸マスクを自動適用するので全面塗り。
  return `<!doctype html><html><head><meta charset="utf-8"><style>
   *{margin:0}html,body{width:512px;height:512px;overflow:hidden}
   .bg{width:512px;height:512px;background:linear-gradient(135deg,#3b6fd4,#5b8def);position:relative}
   canvas{position:absolute;inset:0}
  </style></head><body>
   <div class="bg"><canvas id="i" width="512" height="512"></canvas></div>
   <script>
    const ctx=document.getElementById('i').getContext('2d');
    // 半透明の1kmマス
    ctx.strokeStyle='rgba(255,255,255,0.18)';ctx.lineWidth=2;
    for(let i=0;i<=512;i+=64){ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i,512);ctx.stroke();
      ctx.beginPath();ctx.moveTo(0,i);ctx.lineTo(512,i);ctx.stroke();}
    // 塗り（赤マスの連なりでざっくり日本列島）
    const cells=[[5,1],[6,1],[6,2],[5,2],[4,3],[5,3],[4,4],[3,4],[3,5],[4,5],[3,6],[2,6],[2,5]];
    ctx.fillStyle='#ffffff';
    for(const c of cells){ctx.fillRect(c[0]*64+6,c[1]*64+6,52,52);}
    // 中央のピン
    function pin(cx,cy,r){ctx.beginPath();ctx.moveTo(cx,cy+r*1.7);
      ctx.bezierCurveTo(cx-r*1.2,cy+r*0.4,cx-r,cy-r*0.8,cx,cy-r);
      ctx.bezierCurveTo(cx+r,cy-r*0.8,cx+r*1.2,cy+r*0.4,cx,cy+r*1.7);ctx.closePath();}
    pin(256,232,84);ctx.fillStyle='#e03131';ctx.fill();
    ctx.lineWidth=10;ctx.strokeStyle='#fff';ctx.stroke();
    ctx.beginPath();ctx.arc(256,222,30,0,7);ctx.fillStyle='#fff';ctx.fill();
   </script>
  </body></html>`;
}

// ── レンダリング ───────────────────────────────────────────────────────────
// scale: レイアウト(w×h)を等比拡大して出力（w*scale × h*scale）。タブレットは
// スマホ 1080×1920 のデザインをそのまま拡大して 9:16 を保ち、余白を出さないために使う。
function render(html, w, h, outPath, scale = 1) {
  const f = resolve(TMP, "page.html");
  writeFileSync(f, html);
  rmSync(outPath, { force: true });
  execFileSync(
    CHROME,
    [
      "--headless=new",
      "--no-sandbox",
      "--hide-scrollbars",
      `--force-device-scale-factor=${scale}`,
      `--window-size=${w},${h}`,
      `--screenshot=${outPath}`,
      `file://${f}`,
    ],
    { stdio: "ignore" }
  );
  console.log("rendered", outPath.replace(G + "/", ""), `${w * scale}x${h * scale}`);
}

const CAPTIONS = {
  ja: [
    ["日本全国を1kmマスで塗ろう", "白地図を歩いて塗りつぶす陣取りゲーム", "small"],
    ["GPSで歩いた街を記録", "現在地ボタンでその場を塗る「現地塗り」", "gps"],
    ["となり・なぞりでどんどん拡大", "隣のマスを連続で塗って面を広げる", "brush"],
    ["市区町村ごとの塗り％を集計", "どこを何％塗ったか自動でカウント", "large"],
    ["全国・地域別ランキング", "塗った面積で全国・都道府県・国別に競う", "rank"],
  ],
  en: [
    ["Paint Japan, 1km tile by tile", "A map-coloring territory game you play on foot", "small"],
    ["Log the towns you walk", '"Visit paint" colors your spot with GPS', "gps"],
    ["Grow fast: neighbor & drag", "Paint adjacent tiles to expand your area", "brush"],
    ["Track coverage % per area", "See how much of each city you've painted", "large"],
    ["National & regional rankings", "Compete by painted area, nationwide & by region", "rank"],
  ],
};

for (const lang of ["ja", "en"]) {
  // フィーチャーグラフィック
  render(featureHTML(lang), 1024, 500, resolve(G, `feature/feature-1024x500-${lang}.png`));
  // スマホ 1080x1920 ×5
  CAPTIONS[lang].forEach(([headline, sub, variant], i) => {
    const n = String(i + 1).padStart(2, "0");
    render(
      phoneHTML({ lang, headline, sub, variant }),
      1080,
      1920,
      resolve(G, `screenshots/phone/${lang}/${n}.png`)
    );
  });
  // タブレット: スマホ 1080×1920 のデザインを等比拡大（9:16 維持・余白なし）。
  //   7型  = ×1.2 → 1296×2304    10型 = ×1.5 → 1620×2880
  const tabletPick = [0, 3]; // 全国 と 塗り％ の2枚
  tabletPick.forEach((idx, j) => {
    const [headline, sub, variant] = CAPTIONS[lang][idx];
    const n = String(j + 1).padStart(2, "0");
    const html = phoneHTML({ lang, headline, sub, variant });
    render(html, 1080, 1920, resolve(G, `screenshots/tablet7/${lang}/${n}.png`), 1.2);
    render(html, 1080, 1920, resolve(G, `screenshots/tablet10/${lang}/${n}.png`), 1.5);
  });
}

// アイコン（言語非依存）
render(iconHTML(), 512, 512, resolve(G, "icon/icon-512.png"));

rmSync(TMP, { recursive: true, force: true });
console.log("\nDONE");
