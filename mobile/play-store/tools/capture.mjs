#!/usr/bin/env node
// ───────────────────────────────────────────────────────────────────────────
// capture.mjs — 本番サイトを headless Chrome で実機解像度キャプチャするツール
//
// Play ストア用のスクリーンショット（携帯 1080x1920）を、本物のアプリ画面から撮る。
// 依存パッケージ無し（Node 標準 http + 自前の最小 WebSocket クライアントで CDP を叩く）。
//
//   node capture.mjs
//
// 環境変数:
//   URL     キャプチャ対象（既定: https://chizunurie.unitygamebox.com）
//   OUT     出力ディレクトリ（既定: ../graphics/screenshots/raw）
//   CHROME  Chrome 実行ファイル（既定: macOS の Google Chrome）
//
// 仕組み: Chrome を --remote-debugging-port で起動 → CDP の Page.navigate で開き、
// Input.dispatchMouseEvent のホイールで東京付近をズームイン → 各段階で
// Page.captureScreenshot。地図は WebGL なので swiftshader でソフトレンダリングする。
// ───────────────────────────────────────────────────────────────────────────
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import http from "node:http";

const __dir = dirname(fileURLToPath(import.meta.url));
const URL_ = process.env.URL || "https://chizunurie.unitygamebox.com";
const OUT = process.env.OUT || resolve(__dir, "../graphics/screenshots/raw");
const CHROME =
  process.env.CHROME ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9333;
const W = 1080;
const H = 1920;

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 最小 WebSocket クライアント（CDP 用・テキスト/バイナリのみ） ──────────────
function wsConnect(wsUrl) {
  const u = new URL(wsUrl);
  return new Promise((resolveConn, reject) => {
    const sock = createConnection(
      { host: u.hostname, port: Number(u.port) },
      () => {
        const key = randomBytes(16).toString("base64");
        sock.write(
          `GET ${u.pathname}${u.search} HTTP/1.1\r\n` +
            `Host: ${u.host}\r\n` +
            `Upgrade: websocket\r\n` +
            `Connection: Upgrade\r\n` +
            `Sec-WebSocket-Key: ${key}\r\n` +
            `Sec-WebSocket-Version: 13\r\n\r\n`
        );
      }
    );
    let buf = Buffer.alloc(0);
    let handshook = false;
    const listeners = [];
    const api = {
      send(str) {
        const payload = Buffer.from(str);
        const mask = randomBytes(4);
        const len = payload.length;
        let header;
        if (len < 126) header = Buffer.from([0x81, 0x80 | len]);
        else if (len < 65536) {
          header = Buffer.from([0x81, 0x80 | 126, len >> 8, len & 0xff]);
        } else {
          header = Buffer.alloc(10);
          header[0] = 0x81;
          header[1] = 0x80 | 127;
          header.writeUInt32BE(Math.floor(len / 2 ** 32), 2);
          header.writeUInt32BE(len >>> 0, 6);
        }
        const masked = Buffer.alloc(len);
        for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4];
        sock.write(Buffer.concat([header, mask, masked]));
      },
      onMessage(fn) {
        listeners.push(fn);
      },
      close() {
        sock.end();
      },
    };
    sock.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!handshook) {
        const idx = buf.indexOf("\r\n\r\n");
        if (idx === -1) return;
        const head = buf.slice(0, idx).toString();
        if (!/101/.test(head)) return reject(new Error("WS handshake failed"));
        handshook = true;
        buf = buf.slice(idx + 4);
        resolveConn(api);
      }
      // フレーム解釈（サーバ→クライアントはマスクなし）
      while (buf.length >= 2) {
        const len0 = buf[1] & 0x7f;
        let offset = 2;
        let len = len0;
        if (len0 === 126) {
          if (buf.length < 4) break;
          len = buf.readUInt16BE(2);
          offset = 4;
        } else if (len0 === 127) {
          if (buf.length < 10) break;
          len = Number(buf.readBigUInt64BE(2));
          offset = 10;
        }
        if (buf.length < offset + len) break;
        const payload = buf.slice(offset, offset + len);
        buf = buf.slice(offset + len);
        const opcode = buf.length >= 0 ? null : null; // unused
        for (const fn of listeners) fn(payload.toString());
      }
    });
    sock.on("error", reject);
  });
}

function getJSON(path) {
  return new Promise((res, rej) => {
    http
      .get({ host: "127.0.0.1", port: PORT, path }, (r) => {
        let d = "";
        r.on("data", (c) => (d += c));
        r.on("end", () => res(JSON.parse(d)));
      })
      .on("error", rej);
  });
}

async function main() {
  const args = [
    "--headless=new",
    "--no-sandbox",
    "--hide-scrollbars",
    "--mute-audio",
    `--remote-debugging-port=${PORT}`,
    `--window-size=${W},${H}`,
    "--force-device-scale-factor=1",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "about:blank",
  ];
  const chrome = spawn(CHROME, args, { stdio: "ignore" });
  process.on("exit", () => chrome.kill());

  // デバッグエンドポイントが立つまで待つ
  let target;
  for (let i = 0; i < 40; i++) {
    try {
      const list = await getJSON("/json");
      target = list.find((t) => t.type === "page");
      if (target?.webSocketDebuggerUrl) break;
    } catch {}
    await sleep(250);
  }
  if (!target) throw new Error("Chrome の CDP target が見つからない");

  const ws = await wsConnect(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onMessage((msg) => {
    const m = JSON.parse(msg);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });
  const cmd = (method, params = {}) =>
    new Promise((res) => {
      const myId = ++id;
      pending.set(myId, res);
      ws.send(JSON.stringify({ id: myId, method, params }));
    });

  await cmd("Page.enable");
  await cmd("Runtime.enable");
  // 実機の携帯レイアウトを得る: CSS 360x640 を DPR3 で描く → 物理 1080x1920。
  // （width=1080 のままだと CSS 幅が広く PC レイアウトになり UI が小さくなる）
  const CSS_W = 360;
  const CSS_H = 640;
  await cmd("Emulation.setDeviceMetricsOverride", {
    width: CSS_W,
    height: CSS_H,
    deviceScaleFactor: 3,
    mobile: true,
  });

  async function shot(name) {
    const r = await cmd("Page.captureScreenshot", { format: "png" });
    const file = resolve(OUT, name);
    writeFileSync(file, Buffer.from(r.result.data, "base64"));
    console.log("saved", file);
  }

  // マップ中心（CSS px ≒ 地理中心 [136.5,37] の陸地）でホイールズーム。
  // 中心アンカーなので拡大しても陸地から逸れない。ネイティブの小さな +/- ボタンを
  // 狙うより安定。1ノッチ -120 ≒ 0.27 ズーム相当を複数回。
  const cx = CSS_W / 2;
  const cy = 320;
  async function zoomIn(targetTicks, delta = -400, gap = 130) {
    for (let i = 0; i < targetTicks; i++) {
      await cmd("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: cx,
        y: cy,
        deltaX: 0,
        deltaY: delta,
      });
      await sleep(gap);
    }
  }

  console.log("navigate:", URL_);
  await cmd("Page.navigate", { url: URL_ });
  await sleep(9000); // 地図タイル＋ラベルの初回ロード待ち
  await shot("01-japan.png");

  await zoomIn(20); // 全国 → 県スケール（中心＝中部地方の陸地）
  await sleep(4000);
  await shot("02-zoom-region.png");

  await zoomIn(28); // → 約1kmメッシュが見えるズーム（z10+）
  await sleep(4500);
  await shot("03-zoom-mesh.png");

  ws.close();
  chrome.kill();
  await sleep(300);
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
