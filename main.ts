// news-image-20261123 — draws one newspaper front page summing up the world news
// of Monday 23 November 2026 and writes it to /output/entry.png.
//
// The page is a data-driven broadsheet: a list of stories (tag, accent colour,
// pictogram, headline, body) is laid out by a small renderer below, and every
// pixel is painted into a raw RGB buffer with hand-rolled primitives. Node 22,
// standard library only, no network, fully deterministic: the same input always
// produces the same PNG bytes.
//
// Run locally: mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';

const IMG_W = 1024;
const IMG_H = 1024;
const MARGIN = 24;
const CONTENT_W = IMG_W - 2 * MARGIN; // 976

type Colour = [number, number, number];

// Newsprint palette: warm paper, dark ink, one accent colour per story.
const PAPER: Colour = [247, 243, 232];
const INK: Colour = [17, 24, 39];
const NAVY: Colour = [15, 42, 74];
const CRIMSON: Colour = [185, 28, 28];
const TEAL: Colour = [13, 116, 128];
const OCHRE: Colour = [180, 83, 9];
const LEAF: Colour = [21, 101, 52];
const SLATE: Colour = [71, 85, 105];
const WHITE: Colour = [255, 255, 255];
const CARD: Colour = [255, 255, 255];
const HAIRLINE: Colour = [203, 199, 186];
const MASTHEAD_SUB: Colour = [190, 205, 225];

// ---- raw RGB frame buffer and drawing primitives ----
const frame = new Uint8Array(IMG_W * IMG_H * 3);

function paint(c: Colour): void {
  for (let i = 0; i < IMG_W * IMG_H; i += 1) {
    frame[i * 3] = c[0];
    frame[i * 3 + 1] = c[1];
    frame[i * 3 + 2] = c[2];
  }
}

function dot(x: number, y: number, c: Colour): void {
  if (x < 0 || y < 0 || x >= IMG_W || y >= IMG_H) return;
  const i = (y * IMG_W + x) * 3;
  frame[i] = c[0];
  frame[i + 1] = c[1];
  frame[i + 2] = c[2];
}

function box(x: number, y: number, w: number, h: number, c: Colour): void {
  for (let yy = y; yy < y + h; yy += 1) {
    for (let xx = x; xx < x + w; xx += 1) dot(xx, yy, c);
  }
}

function ruleH(x: number, y: number, w: number, c: Colour): void {
  box(x, y, w, 1, c);
}

function ruleV(x: number, y: number, h: number, c: Colour): void {
  box(x, y, 1, h, c);
}

// Bresenham segment.
function seg(x0: number, y0: number, x1: number, y1: number, c: Colour): void {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    dot(x, y, c);
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

function fatSeg(x0: number, y0: number, x1: number, y1: number, t: number, c: Colour): void {
  const half = Math.floor(t / 2);
  for (let d = -half; d <= half; d += 1) {
    seg(x0 + d, y0, x1 + d, y1, c);
    seg(x0, y0 + d, x1, y1 + d, c);
  }
}

function disc(cx: number, cy: number, r: number, c: Colour): void {
  for (let y = -r; y <= r; y += 1) {
    for (let x = -r; x <= r; x += 1) {
      if (x * x + y * y <= r * r) dot(cx + x, cy + y, c);
    }
  }
}

function circ(cx: number, cy: number, r: number, t: number, c: Colour): void {
  for (let a = 0; a < 360; a += 1) {
    const rad = (a * Math.PI) / 180;
    for (let d = 0; d < t; d += 1) {
      dot(Math.round(cx + (r - d) * Math.cos(rad)), Math.round(cy + (r - d) * Math.sin(rad)), c);
    }
  }
}

function tri(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: Colour): void {
  const minX = Math.min(x0, x1, x2);
  const maxX = Math.max(x0, x1, x2);
  const minY = Math.min(y0, y1, y2);
  const maxY = Math.max(y0, y1, y2);
  const d = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const a = ((x - x0) * (y2 - y0) - (y - y0) * (x2 - x0)) / d;
      const b = ((x - x1) * (y0 - y1) - (y - y1) * (x0 - x1)) / d;
      if (a >= 0 && b >= 0 && 1 - a - b >= 0) dot(x, y, c);
    }
  }
}

// ---- 5x7 bitmap font: each glyph is 7 rows of 5 bits, stored as numbers ----
// Bit 4 is the leftmost column, bit 0 the rightmost; e.g. 'A' row '.###.'
// is 0b01110 = 14. Only the glyphs the page needs are listed.
const GLYPHS: Record<string, number[]> = {
  'A': [14, 17, 17, 31, 17, 17, 17],
  'B': [30, 17, 17, 30, 17, 17, 30],
  'C': [14, 17, 16, 16, 16, 17, 14],
  'D': [30, 17, 17, 17, 17, 17, 30],
  'E': [31, 16, 16, 30, 16, 16, 31],
  'F': [31, 16, 16, 30, 16, 16, 16],
  'G': [14, 17, 16, 23, 17, 17, 15],
  'H': [17, 17, 17, 31, 17, 17, 17],
  'I': [14, 4, 4, 4, 4, 4, 14],
  'J': [7, 2, 2, 2, 2, 18, 12],
  'K': [17, 18, 20, 24, 20, 18, 17],
  'L': [16, 16, 16, 16, 16, 16, 31],
  'M': [17, 27, 21, 21, 17, 17, 17],
  'N': [17, 25, 21, 19, 17, 17, 17],
  'O': [14, 17, 17, 17, 17, 17, 14],
  'P': [30, 17, 17, 30, 16, 16, 16],
  'Q': [14, 17, 17, 17, 21, 18, 13],
  'R': [30, 17, 17, 30, 20, 18, 17],
  'S': [15, 16, 16, 14, 1, 1, 30],
  'T': [31, 4, 4, 4, 4, 4, 4],
  'U': [17, 17, 17, 17, 17, 17, 14],
  'V': [17, 17, 17, 17, 17, 10, 4],
  'W': [17, 17, 17, 21, 21, 27, 17],
  'X': [17, 17, 10, 4, 10, 17, 17],
  'Y': [17, 17, 10, 4, 4, 4, 4],
  'Z': [31, 1, 2, 4, 8, 16, 31],
  '0': [14, 17, 19, 21, 25, 17, 14],
  '1': [4, 12, 4, 4, 4, 4, 14],
  '2': [14, 17, 1, 2, 4, 8, 31],
  '3': [31, 2, 4, 2, 1, 17, 14],
  '4': [2, 6, 10, 18, 31, 2, 2],
  '5': [31, 16, 30, 1, 1, 17, 14],
  '6': [6, 8, 16, 30, 17, 17, 14],
  '7': [31, 1, 2, 4, 8, 8, 8],
  '8': [14, 17, 17, 14, 17, 17, 14],
  '9': [14, 17, 17, 15, 1, 2, 12],
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '.': [0, 0, 0, 0, 0, 12, 12],
  ',': [0, 0, 0, 0, 12, 4, 8],
  "'": [4, 4, 8, 0, 0, 0, 0],
  '-': [0, 0, 0, 14, 0, 0, 0],
  ':': [0, 12, 12, 0, 12, 12, 0],
  '!': [4, 4, 4, 4, 4, 0, 4],
  '?': [14, 17, 1, 2, 4, 0, 4],
  '/': [1, 2, 2, 4, 8, 8, 16],
  '%': [25, 26, 2, 4, 8, 22, 19],
  '(': [2, 4, 8, 8, 8, 4, 2],
  ')': [8, 4, 2, 2, 2, 4, 8],
  '+': [0, 4, 4, 31, 4, 4, 0],
  '&': [12, 18, 20, 8, 21, 18, 13],
  '=': [0, 0, 31, 0, 31, 0, 0],
};

function glyph(ch: string): number[] {
  return GLYPHS[ch] ?? GLYPHS['?'];
}

function drawGlyph(ch: string, x: number, y: number, s: number, c: Colour): void {
  const rows = glyph(ch);
  for (let r = 0; r < 7; r += 1) {
    for (let col = 0; col < 5; col += 1) {
      if ((rows[r] >> (4 - col)) & 1) box(x + col * s, y + r * s, s, s, c);
    }
  }
}

function measure(text: string, s: number): number {
  return text.length * 6 * s - s;
}

function write(text: string, x: number, y: number, s: number, c: Colour): void {
  let cx = x;
  for (const ch of text) {
    drawGlyph(ch, cx, y, s, c);
    cx += 6 * s;
  }
}

function writeCentred(text: string, cx: number, y: number, s: number, c: Colour): void {
  write(text, cx - Math.floor(measure(text, s) / 2), y, s, c);
}

function wrapWords(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const w of text.split(' ')) {
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= maxChars) cur += ' ' + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function writePara(text: string, x: number, y: number, s: number, maxW: number, c: Colour, leading: number): void {
  const maxChars = Math.max(1, Math.floor(maxW / (6 * s)));
  wrapWords(text, maxChars).forEach((ln, i) => write(ln, x, y + i * (7 * s + leading), s, c));
}

// ---- story cards ----
function card(x: number, y: number, w: number, h: number, accent: Colour): void {
  box(x, y, w, h, CARD);
  box(x, y, w, 4, accent);
  for (let i = 0; i < 2; i += 1) {
    box(x + i, y + i, w - 2 * i, 1, HAIRLINE);
    box(x + i, y + h - 1 - i, w - 2 * i, 1, HAIRLINE);
    box(x + i, y + i, 1, h - 2 * i, HAIRLINE);
    box(x + w - 1 - i, y + i, 1, h - 2 * i, HAIRLINE);
  }
}

// ---- pictograms, one per story, drawn from plain shapes ----
function globeIcon(cx: number, cy: number, r: number): void {
  disc(cx, cy, r, TEAL);
  disc(cx, cy, r - 5, WHITE);
  for (let k = -2; k <= 2; k += 1) ruleH(cx - r + 8, cy + k * 12, 2 * r - 16, TEAL);
  for (let k = -1; k <= 1; k += 1) {
    const dx = k * 14;
    const half = Math.floor(Math.sqrt(Math.max(0, (r - 8) * (r - 8) - dx * dx)));
    ruleV(cx + dx, cy - half, 2 * half, TEAL);
  }
  // a red slash across it: no deal.
  fatSeg(cx - r + 4, cy + r - 6, cx + r - 4, cy - r + 6, 5, CRIMSON);
}

function shipIcon(cx: number, cy: number): void {
  // A warship listing and sinking: smoke and fire above it, waves below.
  box(cx - 70, cy - 6, 140, 16, NAVY);
  tri(cx - 70, cy - 6, cx - 52, cy - 34, cx - 52, cy - 6, NAVY);
  box(cx - 30, cy - 30, 60, 24, NAVY);
  box(cx - 8, cy - 52, 6, 24, NAVY);
  box(cx - 44, cy + 10, 88, 4, SLATE);
  for (let k = 0; k < 3; k += 1) {
    fatSeg(cx - 84 + k * 8, cy + 34 + k * 8, cx - 40 + k * 8, cy + 34 + k * 8, 3, TEAL);
    fatSeg(cx + 20 + k * 8, cy + 34 + k * 8, cx + 64 + k * 8, cy + 34 + k * 8, 3, TEAL);
  }
  disc(cx + 52, cy - 44, 14, CRIMSON);
  disc(cx + 66, cy - 58, 9, [255, 120, 40]);
  for (let a = 0; a < 8; a += 1) {
    const rad = (a * Math.PI) / 4;
    seg(cx + 52, cy - 44, Math.round(cx + 52 + 30 * Math.cos(rad)), Math.round(cy - 44 + 30 * Math.sin(rad)), CRIMSON);
  }
  disc(cx - 30, cy - 62, 12, SLATE);
  disc(cx - 14, cy - 74, 9, SLATE);
}

function missileIcon(cx: number, cy: number): void {
  // A missile arcing down, with a burst at its target.
  fatSeg(cx - 46, cy - 34, cx + 10, cy + 6, 7, OCHRE);
  tri(cx + 10, cy + 6, cx - 8, cy - 6, cx - 2, cy + 18, OCHRE);
  fatSeg(cx - 52, cy - 40, cx - 30, cy - 22, 3, CRIMSON);
  fatSeg(cx - 58, cy - 28, cx - 34, cy - 14, 3, CRIMSON);
  disc(cx + 34, cy + 30, 12, CRIMSON);
  for (let a = 0; a < 8; a += 1) {
    const rad = (a * Math.PI) / 4;
    seg(cx + 34, cy + 30, Math.round(cx + 34 + 24 * Math.cos(rad)), Math.round(cy + 30 + 24 * Math.sin(rad)), CRIMSON);
  }
}

function cuffsIcon(cx: number, cy: number): void {
  circ(cx - 26, cy, 24, 7, NAVY);
  circ(cx + 26, cy, 24, 7, NAVY);
  fatSeg(cx - 26, cy - 24, cx + 26, cy - 24, 6, NAVY);
  disc(cx - 26, cy, 8, CRIMSON);
  disc(cx + 26, cy, 8, CRIMSON);
}

function chartIcon(cx: number, cy: number): void {
  fatSeg(cx - 48, cy + 34, cx + 48, cy + 34, 4, INK);
  fatSeg(cx - 48, cy + 34, cx - 48, cy - 40, 4, INK);
  fatSeg(cx - 44, cy - 30, cx - 12, cy - 8, 5, CRIMSON);
  fatSeg(cx - 12, cy - 8, cx + 12, cy - 22, 5, CRIMSON);
  fatSeg(cx + 12, cy - 22, cx + 44, cy + 26, 5, CRIMSON);
  tri(cx + 44, cy + 26, cx + 30, cy + 18, cx + 34, cy + 34, CRIMSON);
}

type IconName = 'globe' | 'ship' | 'missile' | 'cuffs' | 'chart';

function drawIcon(name: IconName, cx: number, cy: number): void {
  if (name === 'globe') globeIcon(cx, cy, 58);
  else if (name === 'ship') shipIcon(cx, cy);
  else if (name === 'missile') missileIcon(cx, cy);
  else if (name === 'cuffs') cuffsIcon(cx, cy);
  else chartIcon(cx, cy);
}

// ---- the day's stories, as reported on Monday 23 November 2026 ----
interface Story {
  tag: string;
  accent: Colour;
  icon: IconName;
  head: string[];
  body: string;
}

const LEAD: Story = {
  tag: 'LIBYA  -  BENGHAZI',
  accent: NAVY,
  icon: 'ship',
  head: ['RUSSIAN WARSHIP', 'SUNK BY SEA DRONES'],
  body: 'THE CORVETTE MERKURY WAS HIT AT BENGHAZI NAVAL BASE AND CAPSIZED. A SECOND RUSSIA-LINKED SHIP WAS HIT HOURS LATER.',
};

const GRID: Story[] = [
  {
    tag: 'CLIMATE  -  ANTALYA',
    accent: TEAL,
    icon: 'globe',
    head: ['COP31 TALKS', 'COLLAPSE'],
    body: 'NO CLIMATE DEAL: THE EU REJECTED A FINAL TEXT WITH NO MENTION OF FOSSIL FUELS. THE LONGEST COP EVER.',
  },
  {
    tag: 'MEXICO  -  SINALOA',
    accent: CRIMSON,
    icon: 'cuffs',
    head: ["MEXICO CAPTURES", "'EL CHAPO ISIDRO'"],
    body: 'SPECIAL FORCES SEIZED CARTEL BOSS FAUSTO ISIDRO MEZA FLORES. ELEVEN DIED IN THE RAID.',
  },
  {
    tag: 'MIDDLE EAST  -  HORMUZ',
    accent: OCHRE,
    icon: 'missile',
    head: ['HORMUZ WAR', 'WIDENS'],
    body: 'MISSILES AND DRONES HIT A US BASE IN BAHRAIN. A HOUTHI MISSILE AT SAUDI ARABIA WAS INTERCEPTED.',
  },
  {
    tag: 'MARKETS  -  NEW YORK',
    accent: LEAF,
    icon: 'chart',
    head: ['BLACK MONDAY', 'FEARS'],
    body: 'STOCKS TUMBLED WORLDWIDE ON FRIDAY. THE S AND P 500 HIT A 7-MONTH LOW AS THE AI SELL-OFF SPREAD.',
  },
];

const FOOTER_LINES = [
  'ALSO ON 23 NOVEMBER:',
  'INDONESIA FACTORY FIRE: 7 BODIES FOUND, 50 MISSING.',
  'S. KOREA MINISTER QUITS OVER AI CHEATING. INDIA 720/9D: TEST RECORD.',
];

// ---- the front page ----
function renderLead(s: Story): void {
  const y = 152;
  const h = 272;
  card(MARGIN, y, CONTENT_W, h, s.accent);
  drawIcon(s.icon, MARGIN + 130, y + 136);
  write(s.tag, MARGIN + 250, y + 24, 2, s.accent);
  s.head.forEach((ln, i) => write(ln, MARGIN + 250, y + 52 + i * (7 * 4 + 6), 4, INK));
  writePara(s.body, MARGIN + 250, y + 160, 2, CONTENT_W - 274, INK, 6);
}

function renderGrid(): void {
  const rowY = [440, 692];
  const rowH = 236;
  const half = Math.floor((CONTENT_W - 16) / 2); // 480
  GRID.forEach((s, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = MARGIN + col * (half + 16);
    const y = rowY[row];
    card(x, y, half, rowH, s.accent);
    drawIcon(s.icon, x + 78, y + 128);
    write(s.tag, x + 168, y + 22, 2, s.accent);
    s.head.forEach((ln, j) => write(ln, x + 168, y + 50 + j * (7 * 3 + 6), 3, INK));
    writePara(s.body, x + 168, y + 128, 2, half - 192, INK, 5);
  });
}

function renderPage(): void {
  paint(PAPER);

  // Masthead.
  box(MARGIN, 16, CONTENT_W, 116, NAVY);
  writeCentred('THE WORLD IN ONE DAY', IMG_W / 2, 30, 5, WHITE);
  writeCentred('MONDAY 23 NOVEMBER 2026  -  WORLD NEWS IN ONE IMAGE', IMG_W / 2, 92, 2, MASTHEAD_SUB);
  ruleH(MARGIN, 140, CONTENT_W, CRIMSON);
  box(MARGIN, 141, CONTENT_W, 3, CRIMSON);

  renderLead(LEAD);
  renderGrid();

  // Footer strip: three more stories of the day.
  const fy = 940;
  box(MARGIN, fy, CONTENT_W, 68, NAVY);
  write(FOOTER_LINES[0], MARGIN + 16, fy + 8, 2, MASTHEAD_SUB);
  write(FOOTER_LINES[1], MARGIN + 16, fy + 28, 2, WHITE);
  write(FOOTER_LINES[2], MARGIN + 16, fy + 48, 2, WHITE);
}

// ---- PNG encoder: 8-bit RGB, filter 0, one IDAT, CRC32 ----
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(): Buffer {
  const raw = Buffer.alloc(IMG_H * (1 + IMG_W * 3));
  for (let y = 0; y < IMG_H; y += 1) {
    raw[y * (1 + IMG_W * 3)] = 0; // filter: none
    raw.set(frame.subarray(y * IMG_W * 3, (y + 1) * IMG_W * 3), y * (1 + IMG_W * 3) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(IMG_W, 0);
  ihdr.writeUInt32BE(IMG_H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function main(): void {
  renderPage();
  const png = encodePng();
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, 'entry.png');
  writeFileSync(out, png);
  // Self-check: the file just written must be a whole PNG under the 1 MiB cap.
  if (png.length > 1048576) throw new Error(`entry.png is ${png.length} bytes, over the 1 MiB cap`);
  if (png[0] !== 0x89 || png[1] !== 0x50) throw new Error('entry.png does not start with a PNG signature');
  console.log(`wrote ${out} (${png.length} bytes, ${IMG_W}x${IMG_H})`);
}

main();
