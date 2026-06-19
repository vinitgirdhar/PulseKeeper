#!/usr/bin/env node
'use strict';

/**
 * PulseKeeper Extension — Icon Generator
 * Generates icons/icon16.png, icon48.png, icon128.png
 *
 * Run once before loading the extension:
 *   node extension/generate-icons.js
 *
 * No external dependencies — uses only built-in Node.js modules.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, 'icons');

// ─── PulseKeeper icon renderer ───────────────────────────────────────────────
// Dark navy rounded square with a cyan EKG/pulse line — matches the app icon.
// SVG reference path (64-unit space):
//   4,34 14,34 18,26 22,42 26,16 30,50 34,34 44,34 48,27 52,41 60,34
// Peak highlight dot at 26,16.

function renderIcon(size) {
  const s = size;
  // RGBA pixel buffer (flat array: [R, G, B, A, R, G, B, A, ...])
  const buf = new Uint8Array(s * s * 4);

  const set = (x, y, r, g, b, a = 255) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || x >= s || y < 0 || y >= s) return;
    const i = (y * s + x) * 4;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
  };

  // ── Background: dark navy rounded square ──────────────────────────────────
  // Corner radius scales with size
  const cr = s * 0.20;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const rx = Math.min(x, s - 1 - x);
      const ry = Math.min(y, s - 1 - y);
      // Anti-aliased corner rounding
      if (rx < cr && ry < cr) {
        const dist = Math.sqrt((rx - cr) ** 2 + (ry - cr) ** 2);
        if (dist > cr + 0.5) continue;         // fully outside
        const alpha = dist > cr - 0.5 ? Math.round(255 * (cr + 0.5 - dist)) : 255;
        set(x, y, 11, 29, 58, alpha);          // #0b1d3a
      } else {
        set(x, y, 11, 29, 58);                 // #0b1d3a fully inside
      }
    }
  }

  // ── EKG pulse line in cyan (#60cdff = 96, 205, 255) ───────────────────────
  // Scaled from the 64-unit SVG coordinate space
  const t = v => v * s / 64;

  // Line width: 1px at 16, 2px at 48, 3px at 128
  const lw = Math.max(1, Math.round(s / 28));

  const pulse = [
    [4,34],[14,34],[18,26],[22,42],[26,16],[30,50],[34,34],[44,34],[48,27],[52,41],[60,34]
  ];

  const drawLine = (x0, y0, x1, y1) => {
    x0 = t(x0); y0 = t(y0); x1 = t(x1); y1 = t(y1);
    const dx = x1 - x0, dy = y1 - y0;
    const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
    for (let i = 0; i <= steps; i++) {
      const fx = x0 + dx * i / steps;
      const fy = y0 + dy * i / steps;
      for (let oy = -Math.floor(lw / 2); oy <= Math.floor(lw / 2); oy++) {
        for (let ox = -Math.floor(lw / 2); ox <= Math.floor(lw / 2); ox++) {
          set(fx + ox, fy + oy, 96, 205, 255);
        }
      }
    }
  };

  for (let i = 0; i < pulse.length - 1; i++) {
    drawLine(pulse[i][0], pulse[i][1], pulse[i + 1][0], pulse[i + 1][1]);
  }

  // Peak highlight dot at [26,16]
  const pr = Math.max(1, Math.round(s / 22));
  const px = t(26), py = t(16);
  for (let dy = -pr; dy <= pr; dy++) {
    for (let dx = -pr; dx <= pr; dx++) {
      if (dx * dx + dy * dy <= pr * pr) {
        set(px + dx, py + dy, 150, 230, 255);
      }
    }
  }

  return bufToPNG(buf, s);
}

// ─── PNG encoder (pure Node.js, no external deps) ────────────────────────────
function bufToPNG(buf, s) {
  const rows = [];
  for (let y = 0; y < s; y++) {
    const row = Buffer.alloc(1 + s * 4);
    row[0] = 0; // filter: None
    for (let x = 0; x < s; x++) {
      const i = (y * s + x) * 4;
      row[1 + x * 4]     = buf[i];
      row[1 + x * 4 + 1] = buf[i + 1];
      row[1 + x * 4 + 2] = buf[i + 2];
      row[1 + x * 4 + 3] = buf[i + 3];
    }
    rows.push(row);
  }

  const pixelData = zlib.deflateSync(Buffer.concat(rows), { level: 9 });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(s, 0);
  ihdr.writeUInt32BE(s, 4);
  ihdr[8]  = 8;  // bit depth
  ihdr[9]  = 6;  // colour type: RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), // PNG signature
    chunk('IHDR', ihdr),
    chunk('IDAT', pixelData),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function chunk(type, data) {
  const len = Buffer.allocUnsafe(4);
  len.writeUInt32BE(data.length, 0);
  const tb = Buffer.from(type, 'ascii');
  const crc = Buffer.allocUnsafe(4);
  crc.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
  return Buffer.concat([len, tb, data, crc]);
}

function crc32(buf) {
  if (!crc32._t) {
    crc32._t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crc32._t[i] = c;
    }
  }
  let c = 0xFFFFFFFF;
  for (const b of buf) c = crc32._t[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const sizes = [16, 48, 128];
for (const size of sizes) {
  const png = renderIcon(size);
  const outPath = path.join(OUT_DIR, `icon${size}.png`);
  fs.writeFileSync(outPath, png);
  console.log(`✓  icons/icon${size}.png  (${png.length} bytes)`);
}

console.log('\nDone! Now reload the extension in chrome://extensions or edge://extensions.');
