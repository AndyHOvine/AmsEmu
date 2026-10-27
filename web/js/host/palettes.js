// GT65 luminances from Caprice32, Copyright (C) 1997-2015 Ulrich Doewich, (C) 2016-2025 Colin Pitrat.
// CTM644 colour measurements from CPCWiki.
// Ported to JavaScript and modified for AmsEmu, 2026. GPL v2 or later, see LICENSE.

export const PALETTE_NAMES = ['ctm644', 'cpc', 'gt65', 'grey'];

const HW_LEVELS = [
  [1, 1, 1], [1, 1, 1], [0, 2, 1], [2, 2, 1], [0, 0, 1], [2, 0, 1], [0, 1, 1], [2, 1, 1],
  [2, 0, 1], [2, 2, 1], [2, 2, 0], [2, 2, 2], [2, 0, 0], [2, 0, 2], [2, 1, 0], [2, 1, 2],
  [0, 0, 1], [0, 2, 1], [0, 2, 0], [0, 2, 2], [0, 0, 0], [0, 0, 2], [0, 1, 0], [0, 1, 2],
  [1, 0, 1], [1, 2, 1], [1, 2, 0], [1, 2, 2], [1, 0, 0], [1, 0, 2], [1, 1, 0], [1, 1, 2],
];

const CTM644 = [
  0x000201, 0x00026B, 0x0C02F4, 0x6C0201, 0x690268, 0x6C02F2, 0xF30506, 0xF00268, 0xF302F4,
  0x027801, 0x007868, 0x0C7BF4, 0x6E7B01, 0x6E7D6B, 0x6E7BF6, 0xF37D0D, 0xF37D6B, 0xFA80F9,
  0x02F001, 0x00F36B, 0x0FF3F2, 0x71F504, 0x71F36B, 0x71F3F4, 0xF3F30D, 0xF3F36D, 0xFFF3F9,
];

const GREEN = [
  0.5647, 0.5647, 0.7529, 0.9412, 0.1882, 0.3765, 0.4706, 0.6588,
  0.3765, 0.9412, 0.9098, 0.9725, 0.3451, 0.4078, 0.6275, 0.6902,
  0.1882, 0.7529, 0.7216, 0.7843, 0.1569, 0.2196, 0.4392, 0.5020,
  0.2824, 0.8471, 0.8157, 0.8784, 0.2510, 0.3137, 0.5333, 0.5961,
];

function rgba(r, g, b) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return (0xFF000000 | (c(b) << 16) | (c(g) << 8) | c(r)) >>> 0;
}

function luma(r, g, b) {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function mono(name, l) {
  return name === 'grey' ? rgba(l * 255, l * 255, l * 255) : rgba(l * 40, l * 255, l * 60);
}

export function hardwareColours(name) {
  const out = new Uint32Array(32);
  for (let n = 0; n < 32; n++) {
    const [r, g, b] = HW_LEVELS[n];
    if (name === 'gt65' || name === 'grey') {
      out[n] = mono(name, GREEN[n]);
    } else if (name === 'cpc') {
      out[n] = rgba(r * 127.5, g * 127.5, b * 127.5);
    } else {
      const c = CTM644[r * 3 + g * 9 + b];
      out[n] = rgba(c >> 16, (c >> 8) & 0xFF, c & 0xFF);
    }
  }
  return out;
}

export function plusColours(name) {
  const out = new Uint32Array(4096);
  for (let i = 0; i < 4096; i++) {
    const g = ((i >> 8) & 15) * 17, r = ((i >> 4) & 15) * 17, b = (i & 15) * 17;
    out[i] = name === 'gt65' || name === 'grey' ? mono(name, luma(r, g, b)) : rgba(r, g, b);
  }
  return out;
}
