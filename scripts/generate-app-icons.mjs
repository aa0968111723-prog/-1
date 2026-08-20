#!/usr/bin/env node
/**
 * Draws 小財's launcher icon straight to PNG.
 *
 * Android 8+ uses the adaptive icon (a vector foreground over a solid
 * background, see res/drawable/ic_launcher_foreground.xml), but minSdk is 24,
 * so Android 7 devices still load the raster mipmaps. Rather than commit
 * binaries nobody can regenerate, the raster is produced from the same
 * geometry as the vector by this script — `npm run icons` redraws every
 * density, and a change to the character is a change to one file.
 *
 * No image library: the only dependency is zlib, which ships with Node.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// ---------------------------------------------------------------- png output

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}

/** RGBA8 pixel buffer -> PNG file bytes. */
function encodePng(width, height, rgba) {
  const stride = width * 4;
  // Filter type 0 (None) on every scanline: simple, and these icons are small.
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ drawing

const SS = 4; // supersampling factor — the only anti-aliasing we need

function hex(c) {
  return [
    parseInt(c.slice(1, 3), 16),
    parseInt(c.slice(3, 5), 16),
    parseInt(c.slice(5, 7), 16),
    c.length > 7 ? parseInt(c.slice(7, 9), 16) : 255,
  ];
}

/**
 * A canvas at SS× resolution that knows how to fill ellipses and polygons,
 * then averages down. Every shape below is expressed in a 0..1 coordinate
 * space so one description renders at every density.
 */
function createCanvas(size) {
  const n = size * SS;
  const buf = Buffer.alloc(n * n * 4); // transparent

  const put = (x, y, [r, g, b, a]) => {
    if (x < 0 || y < 0 || x >= n || y >= n) return;
    const i = (y * n + x) * 4;
    if (a === 255) {
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
      return;
    }
    // source-over onto whatever is already there
    const sa = a / 255;
    const da = buf[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa === 0) return;
    buf[i] = Math.round((r * sa + buf[i] * da * (1 - sa)) / oa);
    buf[i + 1] = Math.round((g * sa + buf[i + 1] * da * (1 - sa)) / oa);
    buf[i + 2] = Math.round((b * sa + buf[i + 2] * da * (1 - sa)) / oa);
    buf[i + 3] = Math.round(oa * 255);
  };

  const ellipse = (cx, cy, rx, ry, color) => {
    const c = hex(color);
    const [x0, x1] = [Math.floor((cx - rx) * n), Math.ceil((cx + rx) * n)];
    const [y0, y1] = [Math.floor((cy - ry) * n), Math.ceil((cy + ry) * n)];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = (x + 0.5) / n - cx;
        const dy = (y + 0.5) / n - cy;
        if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) put(x, y, c);
      }
    }
  };

  const polygon = (points, color) => {
    const c = hex(color);
    const xs = points.map(p => p[0]);
    const ys = points.map(p => p[1]);
    const x0 = Math.floor(Math.min(...xs) * n);
    const x1 = Math.ceil(Math.max(...xs) * n);
    const y0 = Math.floor(Math.min(...ys) * n);
    const y1 = Math.ceil(Math.max(...ys) * n);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = (x + 0.5) / n;
        const py = (y + 0.5) / n;
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const [xi, yi] = points[i];
          const [xj, yj] = points[j];
          if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
        }
        if (inside) put(x, y, c);
      }
    }
  };

  /** Average the SS×SS block down to one pixel. */
  const resolve_ = () => {
    const out = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let sy = 0; sy < SS; sy++) {
          for (let sx = 0; sx < SS; sx++) {
            const i = ((y * SS + sy) * n + (x * SS + sx)) * 4;
            const pa = buf[i + 3];
            r += buf[i] * pa; g += buf[i + 1] * pa; b += buf[i + 2] * pa; a += pa;
          }
        }
        const o = (y * size + x) * 4;
        if (a === 0) continue;
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
        out[o + 3] = Math.round(a / (SS * SS));
      }
    }
    return out;
  };

  return { ellipse, polygon, resolve: resolve_ };
}

// -------------------------------------------------------------- the character

const BG = '#FFEFC9';       // V2: 柔和奶油底（spec §五十一），不再用銀行藍
const BODY = '#FFD66B';
const BODY_EDGE = '#E0AE45';
const BELLY = '#FFF3D2';
const SPROUT = '#8FBF7F';

/** Draws the icon into a canvas of the given size. `withBackground` off = adaptive foreground. */
function drawIcon(size, { withBackground }) {
  const c = createCanvas(size);
  if (withBackground) c.ellipse(0.5, 0.5, 0.5, 0.5, BG);

  // sprout, drawn first so the body overlaps its base
  c.polygon([[0.495, 0.33], [0.55, 0.10], [0.625, 0.175], [0.555, 0.33]], SPROUT);

  // wings
  c.ellipse(0.225, 0.625, 0.065, 0.095, BODY_EDGE);
  c.ellipse(0.775, 0.625, 0.065, 0.095, BODY_EDGE);

  // body
  c.ellipse(0.5, 0.555, 0.315, 0.305, BODY_EDGE);
  c.ellipse(0.5, 0.555, 0.295, 0.285, BODY);

  // belly
  c.ellipse(0.5, 0.675, 0.165, 0.125, BELLY);

  // eyes
  c.ellipse(0.412, 0.505, 0.040, 0.048, '#5C4A2E');
  c.ellipse(0.588, 0.505, 0.040, 0.048, '#5C4A2E');
  c.ellipse(0.425, 0.490, 0.015, 0.017, '#FFFFFF');
  c.ellipse(0.601, 0.490, 0.015, 0.017, '#FFFFFF');

  // beak
  c.polygon([[0.5, 0.560], [0.458, 0.600], [0.542, 0.600]], '#F0A24B');

  // cheeks
  c.ellipse(0.338, 0.590, 0.040, 0.027, '#F7B9A0');
  c.ellipse(0.662, 0.590, 0.040, 0.027, '#F7B9A0');

  return c.resolve();
}

// ------------------------------------------------------------------- output

const ROOT = resolve(import.meta.dirname, '..');
const DENSITIES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
/** Adaptive foregrounds are 108dp with only the middle 72dp guaranteed visible. */
const FOREGROUND = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };

function write(path, bytes) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  console.log(`  ${path.replace(ROOT + '/', '')}  ${bytes.length} bytes`);
}

/** Scales the 0..1 drawing into the adaptive safe zone (66.7% of the canvas). */
function drawForeground(size) {
  const inner = Math.round(size * 0.667);
  const art = drawIcon(inner, { withBackground: false });
  const out = Buffer.alloc(size * size * 4);
  const off = Math.round((size - inner) / 2);
  for (let y = 0; y < inner; y++) {
    art.copy(out, ((y + off) * size + off) * 4, y * inner * 4, (y + 1) * inner * 4);
  }
  return out;
}

console.log('小財 launcher icons');
for (const [density, size] of Object.entries(DENSITIES)) {
  const dir = `${ROOT}/android/app/src/main/res/mipmap-${density}`;
  const square = encodePng(size, size, drawIcon(size, { withBackground: true }));
  write(`${dir}/ic_launcher.png`, square);
  write(`${dir}/ic_launcher_round.png`, square); // the art is already circular
  const fg = FOREGROUND[density];
  write(`${dir}/ic_launcher_foreground.png`, encodePng(fg, fg, drawForeground(fg)));
}
console.log('done');
