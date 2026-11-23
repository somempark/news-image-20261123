// news-image-20261123 — a program that draws one newspaper front page summing up
// the world news of Monday 23 November 2026 and writes it to /output/entry.png.
// Node 22, standard library only. No network: every pixel is drawn here, in code,
// with a small built-in 5x7 bitmap font so every word is crisp and legible.
// Run locally: mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';

const W = 1024;
const H = 1024;

// ---- palette: newsprint paper, ink, and one accent per story ----
const PAPER: RGB = [247, 243, 232];
const INK: RGB = [17, 24, 39];
const NAVY: RGB = [15, 42, 74];
const RED: RGB = [185, 28, 28];
const TEAL: RGB = [13, 116, 128];
const AMBER: RGB = [180, 83, 9];
const GREEN: RGB = [21, 101, 52];
const SLATE: RGB = [71, 85, 105];
const LIGHT: RGB = [255, 255, 255];
const PANEL: RGB = [255, 255, 255];
const RULE: RGB = [203, 199, 186];

type RGB = [number, number, number];

const px = new Uint8Array(W * H * 3);
function fill(c: RGB): void {
  for (let i = 0; i < W * H; i++) {
    px[i * 3] = c[0];
    px[i * 3 + 1] = c[1];
    px[i * 3 + 2] = c[2];
  }
}
function set(x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = c[0];
  px[i + 1] = c[1];
  px[i + 2] = c[2];
}
function rect(x: number, y: number, w: number, h: number, c: RGB): void {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) set(xx, yy, c);
  }
}
function hline(x: number, y: number, w: number, c: RGB): void {
  rect(x, y, w, 1, c);
}
function vline(x: number, y: number, h: number, c: RGB): void {
  rect(x, y, 1, h, c);
}
function line(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    set(x, y, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}
function thickLine(x0: number, y0: number, x1: number, y1: number, t: number, c: RGB): void {
  for (let d = -Math.floor(t / 2); d <= Math.floor(t / 2); d++) {
    line(x0 + d, y0, x1 + d, y1, c);
    line(x0, y0 + d, x1, y1 + d, c);
  }
}
function circle(cx: number, cy: number, r: number, c: RGB): void {
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      if (x * x + y * y <= r * r) set(cx + x, cy + y, c);
    }
  }
}
function ring(cx: number, cy: number, r: number, t: number, c: RGB): void {
  for (let a = 0; a < 360; a++) {
    const rad = (a * Math.PI) / 180;
    for (let d = 0; d < t; d++) {
      set(Math.round(cx + (r - d) * Math.cos(rad)), Math.round(cy + (r - d) * Math.sin(rad)), c);
    }
  }
}
function triangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: RGB): void {
  const minX = Math.min(x0, x1, x2);
  const maxX = Math.max(x0, x1, x2);
  const minY = Math.min(y0, y1, y2);
  const maxY = Math.max(y0, y1, y2);
  const d = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const a = ((x - x0) * (y2 - y0) - (y - y0) * (x2 - x0)) / d;
      const b = ((x - x1) * (y0 - y1) - (y - y1) * (x0 - x1)) / d;
      const g = 1 - a - b;
      if (a >= 0 && b >= 0 && g >= 0) set(x, y, c);
    }
  }
}

// ---- 5x7 bitmap font: each glyph is 7 rows of 5 bits ('#' on, '.' off) ----
const FONT: Record<string, string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ',': ['.....', '.....', '.....', '.....', '.##..', '..#..', '.#...'],
  "'": ['..#..', '..#..', '.#...', '.....', '.....', '.....', '.....'],
  '-': ['.....', '.....', '.....', '.###.', '.....', '.....', '.....'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  '/': ['....#', '...#.', '...#.', '..#..', '.#...', '.#...', '#....'],
  '%': ['##..#', '##.#.', '...#.', '..#..', '.#...', '#.##.', '#..##'],
  '(': ['...#.', '..#..', '.#...', '.#...', '.#...', '..#..', '...#.'],
  ')': ['.#...', '..#..', '...#.', '...#.', '...#.', '..#..', '.#...'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  '&': ['.##..', '#..#.', '#.#..', '.#...', '#.#.#', '#..#.', '.##.#'],
  '=': ['.....', '.....', '#####', '.....', '#####', '.....', '.....'],
};

// ---- text: draw one glyph, one line, and word-wrapped paragraphs ----
function drawChar(ch: string, x: number, y: number, s: number, c: RGB): void {
  const g = FONT[ch] ?? FONT['?'];
  for (let r = 0; r < 7; r++) {
    for (let col = 0; col < 5; col++) {
      if (g[r][col] === '#') rect(x + col * s, y + r * s, s, s, c);
    }
  }
}
function textWidth(t: string, s: number): number {
  return t.length * 6 * s - s;
}
function drawText(t: string, x: number, y: number, s: number, c: RGB): void {
  let cx = x;
  for (const ch of t) {
    drawChar(ch, cx, y, s, c);
    cx += 6 * s;
  }
}
function drawTextCentered(t: string, cx: number, y: number, s: number, c: RGB): void {
  drawText(t, cx - Math.floor(textWidth(t, s) / 2), y, s, c);
}
function wrap(t: string, maxChars: number): string[] {
  const words = t.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) {
      cur = w;
    } else if (cur.length + 1 + w.length <= maxChars) {
      cur += ' ' + w;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}
function drawParagraph(t: string, x: number, y: number, s: number, maxW: number, c: RGB, leading: number): number {
  const maxChars = Math.max(1, Math.floor(maxW / (6 * s)));
  const lines = wrap(t, maxChars);
  lines.forEach((ln, i) => drawText(ln, x, y + i * (7 * s + leading), s, c));
  return lines.length;
}

// ---- story panels ----
function panel(x: number, y: number, w: number, h: number, accent: RGB): void {
  rect(x, y, w, h, PANEL);
  rect(x, y, w, 4, accent);
  for (let i = 0; i < 2; i++) {
    rect(x + i, y + i, w - 2 * i, 1, RULE);
    rect(x + i, y + h - 1 - i, w - 2 * i, 1, RULE);
    rect(x + i, y + i, 1, h - 2 * i, RULE);
    rect(x + w - 1 - i, y + i, 1, h - 2 * i, RULE);
  }
}
function kicker(x: number, y: number, t: string, c: RGB): void {
  drawText(t, x, y, 2, c);
}
function headline(x: number, y: number, lines: string[], s: number): void {
  lines.forEach((ln, i) => drawText(ln, x, y + i * (7 * s + 6), s, INK));
}

// ---- pictograms, one per story, drawn from plain shapes ----
function iconGlobe(cx: number, cy: number, r: number): void {
  circle(cx, cy, r, TEAL);
  circle(cx, cy, r - 5, LIGHT);
  for (let k = -2; k <= 2; k++) hline(cx - r + 8, cy + k * 12, 2 * r - 16, TEAL);
  for (let k = -1; k <= 1; k++) {
    const dx = k * 14;
    const half = Math.floor(Math.sqrt(Math.max(0, (r - 8) * (r - 8) - dx * dx)));
    vline(cx + dx, cy - half, 2 * half, TEAL);
  }
  thickLine(cx - r + 4, cy + r - 6, cx + r - 4, cy - r + 6, 5, RED);
}
function iconShip(cx: number, cy: number): void {
  // a warship listing and sinking, smoke and fire above it, waves below
  rect(cx - 70, cy - 6, 140, 16, NAVY);
  triangle(cx - 70, cy - 6, cx - 52, cy - 34, cx - 52, cy - 6, NAVY);
  rect(cx - 30, cy - 30, 60, 24, NAVY);
  rect(cx - 8, cy - 52, 6, 24, NAVY);
  rect(cx - 44, cy + 10, 88, 4, SLATE);
  for (let k = 0; k < 3; k++) {
    thickLine(cx - 84 + k * 8, cy + 34 + k * 8, cx - 40 + k * 8, cy + 34 + k * 8, 3, TEAL);
    thickLine(cx + 20 + k * 8, cy + 34 + k * 8, cx + 64 + k * 8, cy + 34 + k * 8, 3, TEAL);
  }
  circle(cx + 52, cy - 44, 14, RED);
  circle(cx + 66, cy - 58, 9, [255, 120, 40]);
  for (let a = 0; a < 8; a++) {
    const rad = (a * Math.PI) / 4;
    line(cx + 52, cy - 44, Math.round(cx + 52 + 30 * Math.cos(rad)), Math.round(cy - 44 + 30 * Math.sin(rad)), RED);
  }
  circle(cx - 30, cy - 62, 12, SLATE);
  circle(cx - 14, cy - 74, 9, SLATE);
}
function iconMissile(cx: number, cy: number): void {
  // a missile arcing down, with a burst at its target
  thickLine(cx - 46, cy - 34, cx + 10, cy + 6, 7, AMBER);
  triangle(cx + 10, cy + 6, cx - 8, cy - 6, cx - 2, cy + 18, AMBER);
  thickLine(cx - 52, cy - 40, cx - 30, cy - 22, 3, RED);
  thickLine(cx - 58, cy - 28, cx - 34, cy - 14, 3, RED);
  circle(cx + 34, cy + 30, 12, RED);
  for (let a = 0; a < 8; a++) {
    const rad = (a * Math.PI) / 4;
    line(cx + 34, cy + 30, Math.round(cx + 34 + 24 * Math.cos(rad)), Math.round(cy + 30 + 24 * Math.sin(rad)), RED);
  }
}
function iconCuffs(cx: number, cy: number): void {
  ring(cx - 26, cy, 24, 7, NAVY);
  ring(cx + 26, cy, 24, 7, NAVY);
  thickLine(cx - 26, cy - 24, cx + 26, cy - 24, 6, NAVY);
  circle(cx - 26, cy, 8, RED);
  circle(cx + 26, cy, 8, RED);
}
function iconBuilding(cx: number, cy: number): void {
  rect(cx - 42, cy - 34, 84, 68, SLATE);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) rect(cx - 34 + c * 20, cy - 26 + r * 20, 10, 12, [255, 214, 64]);
  }
  thickLine(cx - 10, cy - 34, cx + 6, cy - 8, 4, RED);
  thickLine(cx + 6, cy - 8, cx - 4, cy + 16, 4, RED);
  thickLine(cx - 4, cy + 16, cx + 12, cy + 34, 4, RED);
  circle(cx + 40, cy - 40, 10, RED);
  circle(cx + 52, cy - 28, 7, [255, 120, 40]);
}
function iconChart(cx: number, cy: number): void {
  thickLine(cx - 48, cy + 34, cx + 48, cy + 34, 4, INK);
  thickLine(cx - 48, cy + 34, cx - 48, cy - 40, 4, INK);
  thickLine(cx - 44, cy - 30, cx - 12, cy - 8, 5, RED);
  thickLine(cx - 12, cy - 8, cx + 12, cy - 22, 5, RED);
  thickLine(cx + 12, cy - 22, cx + 44, cy + 26, 5, RED);
  triangle(cx + 44, cy + 26, cx + 30, cy + 18, cx + 34, cy + 34, RED);
}

// ---- the front page ----
function drawPage(): void {
  fill(PAPER);
  const M = 24; // outer margin
  const CW = W - 2 * M; // 976

  // masthead
  rect(M, 16, CW, 116, NAVY);
  drawTextCentered('THE WORLD IN ONE DAY', W / 2, 30, 5, LIGHT);
  drawTextCentered('MONDAY 23 NOVEMBER 2026  -  WORLD NEWS IN ONE IMAGE', W / 2, 92, 2, [190, 205, 225]);
  hline(M, 140, CW, RED);
  rect(M, 141, CW, 3, RED);

  // lead story: Russian warship sunk in Libya
  panel(M, 152, CW, 272, NAVY);
  iconShip(M + 130, 288);
  kicker(M + 250, 176, 'LIBYA  -  BENGHAZI', NAVY);
  headline(M + 250, 204, ['RUSSIAN WARSHIP', 'SUNK BY SEA DRONES'], 4);
  drawParagraph(
    'THE CORVETTE MERKURY WAS HIT AT BENGHAZI NAVAL BASE AND CAPSIZED. A SECOND RUSSIA-LINKED SHIP WAS HIT HOURS LATER.',
    M + 250, 312, 2, CW - 274, INK, 6,
  );

  // row 2: COP31 / Mexico
  const rowY = 440;
  const rowH = 236;
  const half = Math.floor((CW - 16) / 2);
  panel(M, rowY, half, rowH, TEAL);
  iconGlobe(M + 78, rowY + 128, 58);
  kicker(M + 168, rowY + 22, 'CLIMATE  -  ANTALYA', TEAL);
  headline(M + 168, rowY + 50, ['COP31 TALKS', 'COLLAPSE'], 3);
  drawParagraph(
    'NO CLIMATE DEAL: THE EU REJECTED A FINAL TEXT WITH NO MENTION OF FOSSIL FUELS. THE LONGEST COP EVER.',
    M + 168, rowY + 128, 2, half - 192, INK, 5,
  );
  panel(M + half + 16, rowY, half, rowH, RED);
  iconCuffs(M + half + 16 + 78, rowY + 128);
  kicker(M + half + 16 + 168, rowY + 22, 'MEXICO  -  SINALOA', RED);
  headline(M + half + 16 + 168, rowY + 50, ["MEXICO CAPTURES", "'EL CHAPO ISIDRO'"], 3);
  drawParagraph(
    'SPECIAL FORCES SEIZED CARTEL BOSS FAUSTO ISIDRO MEZA FLORES. ELEVEN DIED IN THE RAID.',
    M + half + 16 + 168, rowY + 128, 2, half - 192, INK, 5,
  );

  // row 3: Hormuz / markets
  const row3Y = 692;
  panel(M, row3Y, half, rowH, AMBER);
  iconMissile(M + 78, row3Y + 128);
  kicker(M + 168, row3Y + 22, 'MIDDLE EAST  -  HORMUZ', AMBER);
  headline(M + 168, row3Y + 50, ['HORMUZ WAR', 'WIDENS'], 3);
  drawParagraph(
    'MISSILES AND DRONES HIT A US BASE IN BAHRAIN. A HOUTHI MISSILE AT SAUDI ARABIA WAS INTERCEPTED.',
    M + 168, row3Y + 128, 2, half - 192, INK, 5,
  );
  panel(M + half + 16, row3Y, half, rowH, GREEN);
  iconChart(M + half + 16 + 78, row3Y + 128);
  kicker(M + half + 16 + 168, row3Y + 22, 'MARKETS  -  NEW YORK', GREEN);
  headline(M + half + 16 + 168, row3Y + 50, ['BLACK MONDAY', 'FEARS'], 3);
  drawParagraph(
    'STOCKS TUMBLED WORLDWIDE ON FRIDAY. THE S AND P 500 HIT A 7-MONTH LOW AS THE AI SELL-OFF SPREAD.',
    M + half + 16 + 168, row3Y + 128, 2, half - 192, INK, 5,
  );

  // footer strip: three more stories of the day
  const fy = 940;
  rect(M, fy, CW, 68, NAVY);
  drawText('ALSO ON 23 NOVEMBER:', M + 16, fy + 8, 2, [190, 205, 225]);
  drawText('INDONESIA FACTORY FIRE: 7 BODIES FOUND, 50 MISSING.', M + 16, fy + 28, 2, LIGHT);
  drawText('S. KOREA MINISTER QUITS OVER AI CHEATING. INDIA 720/9D: TEST RECORD.', M + 16, fy + 48, 2, LIGHT);
  void fy;
}

// ---- PNG encoder: 8-bit RGB, filter 0, one IDAT, CRC32 ----
const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePng(): Buffer {
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0;
    raw.set(px.subarray(y * W * 3, (y + 1) * W * 3), y * (1 + W * 3) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function main(): void {
  drawPage();
  const png = encodePng();
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, 'entry.png');
  writeFileSync(out, png);
  // self-check: the file we just wrote must be a whole PNG under the 1 MiB cap.
  if (png.length > 1048576) throw new Error(`entry.png is ${png.length} bytes, over the 1 MiB cap`);
  if (png[0] !== 0x89 || png[1] !== 0x50) throw new Error('entry.png does not start with a PNG signature');
  console.log(`wrote ${out} (${png.length} bytes, ${W}x${H})`);
}

main();
