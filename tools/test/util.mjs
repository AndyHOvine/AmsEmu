import fs from 'node:fs';
import zlib from 'node:zlib';
import { Cpc } from '../../web/js/emu/cpc.js';
import { FB_WIDTH, FB_HEIGHT } from '../../web/js/emu/video.js';
import { hardwareColours, plusColours } from '../../web/js/host/palettes.js';

const ROM_DIR = new URL('../../web/roms/', import.meta.url);

export const hasSystemCart = fs.existsSync(new URL('system.cpr', ROM_DIR));

export function loadRoms() {
  const r = (n) => new Uint8Array(fs.readFileSync(new URL(n, ROM_DIR)));
  const roms = {
    cpc464: r('cpc464.rom'), cpc664: r('cpc664.rom'), cpc6128: r('cpc6128.rom'),
    amsdos: r('amsdos.rom'),
  };
  if (hasSystemCart) roms.system = r('system.cpr');
  return roms;
}

export function makeMachine(opts = {}) {
  const m = new Cpc({ roms: loadRoms(), ...opts });
  m.video.setColours(hardwareColours('cpc'), plusColours('cpc'));
  return m;
}

export function runSeconds(m, s) {
  const frames = Math.round((s * m.clock) / m.cyclesPerFrame);
  for (let i = 0; i < frames; i++) m.runFrame();
}

export function runUntilText(m, text, seconds = 10) {
  const frames = Math.round((seconds * m.clock) / m.cyclesPerFrame);
  for (let i = 0; i < frames; i++) {
    m.runFrame();
    if (i % 10 === 0 && screenText(m).some((l) => l.includes(text))) return true;
  }
  return screenText(m).some((l) => l.includes(text));
}

export function screenText(m) {
  const v = m.video, regs = v.regs, ram = m.ram;
  const font = m.mem.subarray(m.lowRomOff + 0x3800, m.lowRomOff + 0x4000);
  const glyphs = new Map();
  for (let c = 0; c < 256; c++) {
    const key = Array.from(font.subarray(c * 8, c * 8 + 8)).join(',');
    if (!glyphs.has(key)) glyphs.set(key, c);
  }
  const mode = v.scrMode;
  const bytesPerChar = [4, 2, 1, 4][mode];
  const cols = (regs[1] * 2) / bytesPerChar, rows = regs[6];
  const maStart = ((regs[12] & 0x3F) << 8) | regs[13];
  const pixel = (b, x) => {
    if (mode === 2) return (b >> (7 - x)) & 1;
    if (mode === 1) return ((b >> (7 - x)) & 1) | ((b >> (3 - x)) & 1);
    return ((b >> (7 - x)) & 1) | ((b >> (5 - x)) & 1) | ((b >> (3 - x)) & 1) | ((b >> (1 - x)) & 1);
  };
  const perByte = 8 / bytesPerChar;
  const lines = [];
  for (let r = 0; r < rows; r++) {
    let s = '';
    for (let c = 0; c < cols; c++) {
      const rowBytes = [];
      for (let y = 0; y < 8; y++) {
        let bits = 0;
        for (let i = 0; i < bytesPerChar; i++) {
          const j = c * bytesPerChar + i;
          const ma = maStart + r * regs[1] + (j >> 1);
          const addr = (((ma & 0x3FF) << 1) | (j & 1)) + ((ma & 0x3000) << 2) + y * 0x800;
          const b = ram[addr & 0xFFFF];
          for (let x = 0; x < perByte; x++) bits = (bits << 1) | (pixel(b, x) ? 1 : 0);
        }
        rowBytes.push(bits);
      }
      let ch = glyphs.get(rowBytes.join(','));
      if (ch === undefined) ch = glyphs.get(rowBytes.map((b) => ~b & 0xFF).join(','));
      s += ch !== undefined && ch >= 32 && ch < 127 ? String.fromCharCode(ch) : ch === undefined ? '#' : ' ';
    }
    lines.push(s.replace(/\s+$/, ''));
  }
  return lines;
}

export function writePng(file, m) {
  const w = FB_WIDTH, h = FB_HEIGHT, fb = m.video.fb;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) {
      const c = fb[y * w + x];
      raw[o++] = c & 255; raw[o++] = (c >> 8) & 255; raw[o++] = (c >> 16) & 255;
    }
  }
  const crcTable = new Int32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  const crc = (buf) => {
    let c = -1;
    for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]));
}
