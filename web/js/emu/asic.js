// Derived from Caprice32 src/asic.cpp and src/cartridge.cpp,
// Copyright (C) 1997-2015 Ulrich Doewich, (C) 2016-2025 Colin Pitrat.
// Ported to JavaScript and modified for AmsEmu, 2026. GPL v2 or later, see LICENSE.

const LOCK_SEQ = [0x00, 0x00, 0xFF, 0x77, 0xB3, 0x51, 0xA8, 0xD4, 0x62, 0x39, 0x9C, 0x46, 0x2B, 0x15, 0x8A, 0xCD];

export const CART_PAGES = 32;
export const CART_PAGE_SIZE = 0x4000;

const LEVEL = [0, 6, 15];
export const HW_TO_PLUS = new Uint16Array(32);
{
  const grb = [
    [1, 1, 1], [1, 1, 1], [2, 0, 1], [2, 2, 1], [0, 0, 1], [0, 2, 1], [1, 0, 1], [1, 2, 1],
    [0, 2, 1], [2, 2, 1], [2, 2, 0], [2, 2, 2], [0, 2, 0], [0, 2, 2], [1, 2, 0], [1, 2, 2],
    [0, 0, 1], [2, 0, 1], [2, 0, 0], [2, 0, 2], [0, 0, 0], [0, 0, 2], [1, 0, 0], [1, 0, 2],
    [0, 1, 1], [2, 1, 1], [2, 1, 0], [2, 1, 2], [0, 1, 0], [0, 1, 2], [1, 1, 0], [1, 1, 2],
  ];
  grb.forEach(([g, r, b], i) => { HW_TO_PLUS[i] = (LEVEL[g] << 8) | (LEVEL[r] << 4) | LEVEL[b]; });
}

export function parseCpr(bytes) {
  const str = (o) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  const u32 = (o) => (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0;
  if (bytes.length < 12 || str(0) !== 'RIFF' || str(8) !== 'AMS!') throw new Error('Not a CPR cartridge');
  const pages = new Uint8Array(CART_PAGES * CART_PAGE_SIZE);
  const end = Math.min(bytes.length, u32(4) + 8);
  let o = 12, next = 0, count = 0;
  while (o + 8 <= end) {
    const id = str(o), size = u32(o + 4);
    o += 8;
    const m = /^cb(\d\d)$/i.exec(id);
    let page = m ? parseInt(m[1], 10) : next;
    if (size > 0 && page < CART_PAGES) {
      pages.set(bytes.subarray(o, o + Math.min(size, CART_PAGE_SIZE)), page * CART_PAGE_SIZE);
      next = page + 1;
      count = Math.max(count, next);
    }
    o += size + (size & 1);
  }
  if (!count) throw new Error('Empty CPR cartridge');
  return { pages, count };
}

export class Asic {
  constructor(cpc) {
    this.cpc = cpc;
    this.page = new Uint8Array(0x4000);
    this.spriteData = new Uint8Array(16 * 256);
    this.spriteX = new Int16Array(16);
    this.spriteY = new Int16Array(16);
    this.spriteMagX = new Uint8Array(16);
    this.spriteMagY = new Uint8Array(16);
    this.dmaAddr = new Uint16Array(3);
    this.dmaLoopAddr = new Uint16Array(3);
    this.dmaPrescaler = new Uint8Array(3);
    this.dmaEnabled = new Uint8Array(3);
    this.dmaIntPending = new Uint8Array(3);
    this.dmaPause = new Int32Array(3);
    this.dmaTick = new Uint8Array(3);
    this.dmaLoops = new Int32Array(3);
    this.reset();
  }

  reset() {
    this.locked = true;
    this.lockSeqPos = 0;
    this.extendBorder = false;
    this.hscroll = 0;
    this.vscroll = 0;
    this.page.fill(0);
    this.spriteData.fill(0);
    this.spriteX.fill(0);
    this.spriteY.fill(0);
    this.spriteMagX.fill(0);
    this.spriteMagY.fill(0);
    this.spritesOn = false;
    this.rasterIntPending = false;
    this.interruptVector = 1;
    this.interruptLine = 0;
    this.splitLine = 0;
    this.splitAddr = 0;
    for (let c = 0; c < 3; c++) this.resetDma(c);
  }

  resetDma(c) {
    this.dmaAddr[c] = 0;
    this.dmaLoopAddr[c] = 0;
    this.dmaPrescaler[c] = 0;
    this.dmaEnabled[c] = 0;
    this.dmaIntPending[c] = 0;
    this.dmaPause[c] = 0;
    this.dmaTick[c] = 0;
    this.dmaLoops[c] = 0;
  }

  pokeLockSequence(val) {
    const n = LOCK_SEQ.length;
    if (this.lockSeqPos === 0) {
      if (val > 0) this.lockSeqPos = 1;
    } else if (this.lockSeqPos < n) {
      if (val === LOCK_SEQ[this.lockSeqPos]) {
        this.lockSeqPos++;
      } else {
        this.lockSeqPos++;
        if (this.lockSeqPos === n) this.locked = true;
        this.lockSeqPos = val === 0 ? 2 : 1;
      }
    } else if (this.lockSeqPos === n) {
      this.locked = false;
      this.lockSeqPos = val === 0 ? 0 : 1;
    }
  }

  inkWritten(pen, hw) {
    const c = HW_TO_PLUS[hw];
    this.page[0x2400 + pen * 2] = c & 0xFF;
    this.page[0x2401 + pen * 2] = c >> 8;
  }

  read(addr) {
    return this.page[addr & 0x3FFF];
  }

  write(addr, val) {
    const page = this.page, a = addr & 0x3FFF;
    if (addr < 0x5000) {
      page[a] = val & 0x0F;
      this.spriteData[a & 0xFFF] = val & 0x0F;
      return;
    }
    if (addr >= 0x6000 && addr < 0x6080) {
      const id = (addr - 0x6000) >> 3;
      switch (addr & 7) {
        case 0: case 1: {
          page[a] = page[a + 4] = val;
          let x = (page[(a & ~7)] | (page[(a & ~7) + 1] << 8)) & 0x3FF;
          if (x > 767) x -= 1024;
          this.spriteX[id] = x;
          break;
        }
        case 2: case 3: {
          page[a] = page[a + 4] = val;
          let y = (page[(a & ~7) + 2] | (page[(a & ~7) + 3] << 8)) & 0x1FF;
          if (y > 255) y -= 512;
          this.spriteY[id] = y;
          break;
        }
        case 4: {
          const mag = (v) => ((v & 3) === 3 ? 4 : v & 3);
          this.spriteMagX[id] = mag(val >> 2);
          this.spriteMagY[id] = mag(val);
          let on = false;
          for (let i = 0; i < 16; i++) if (this.spriteMagX[i] && this.spriteMagY[i]) on = true;
          this.spritesOn = on;
          break;
        }
        default: break;
      }
      return;
    }
    if (addr >= 0x6400 && addr < 0x6440) {
      const colour = (addr & 0x3F) >> 1;
      page[a] = addr & 1 ? val & 0x0F : val;
      const base = 0x2400 + colour * 2;
      this.cpc.video.setPlusColour(colour, (page[base + 1] << 8) | page[base]);
      return;
    }
    if (addr >= 0x6800 && addr < 0x6806) {
      page[a] = val;
      switch (addr) {
        case 0x6800: this.interruptLine = val; break;
        case 0x6801: this.splitLine = val; break;
        case 0x6802: this.splitAddr = (this.splitAddr & 0x00FF) | (val << 8); break;
        case 0x6803: this.splitAddr = (this.splitAddr & 0x3F00) | val; break;
        case 0x6804:
          this.hscroll = val & 0x0F;
          this.vscroll = (val >> 4) & 7;
          this.extendBorder = (val & 0x80) !== 0;
          this.cpc.video.updateSkew();
          break;
        case 0x6805:
          this.interruptVector = val & 0xF9;
          break;
      }
      return;
    }
    if (addr >= 0x6C00 && addr < 0x6C0B) {
      const c = (addr & 0x0C) >> 2;
      page[a] = val;
      switch (addr & 3) {
        case 0: this.dmaAddr[c] = (this.dmaAddr[c] & 0xFF00) | (val & 0xFE); break;
        case 1: this.dmaAddr[c] = (this.dmaAddr[c] & 0x00FF) | (val << 8); break;
        case 2: this.dmaPrescaler[c] = val; break;
        default: break;
      }
      return;
    }
    if (addr === 0x6C0F) {
      let dcsr = page[0x2C0F];
      for (let c = 0; c < 3; c++) {
        if (val & (1 << c)) {
          this.dmaEnabled[c] = 1;
          dcsr |= 1 << c;
        } else {
          dcsr &= ~(1 << c);
          this.resetDma(c);
        }
        if (val & (0x40 >> c)) {
          this.dmaIntPending[c] = 0;
          dcsr &= ~(0x40 >> c);
        }
      }
      if (val & 0x80) {
        this.rasterIntPending = false;
        dcsr &= 0x7F;
      }
      page[0x2C0F] = dcsr;
      return;
    }
    page[a] = val;
  }

  rasterInterrupt() {
    this.cpc.cpu.intPending = 1;
    this.rasterIntPending = true;
    this.page[0x2C0F] |= 0x80;
  }

  intVector() {
    if (this.locked) return 0xFF;
    const iv = this.interruptVector;
    let ret = -1, more = false;
    if (this.rasterIntPending) {
      ret = (iv & 0xF8) | 6;
      if ((iv & 1) === 0) this.rasterIntPending = false;
    }
    let source = 0;
    for (let c = 2; c >= 0; c--) {
      if (this.dmaIntPending[c]) {
        if (ret >= 0) {
          more = true;
        } else {
          ret = (iv & 0xF8) | source;
          if ((iv & 1) === 0) this.dmaIntPending[c] = 0;
        }
      }
      source += 2;
    }
    if (ret < 0) ret = (iv & 0xF8) | 6;
    if (more) this.cpc.cpu.intPending = 1;
    return ret;
  }

  dmaCycle() {
    if (!(this.dmaEnabled[0] | this.dmaEnabled[1] | this.dmaEnabled[2])) return;
    const cpc = this.cpc, page = this.page;
    let dcsr = page[0x2C0F];
    for (let c = 0; c < 3; c++) {
      if (!this.dmaEnabled[c]) continue;
      if (this.dmaPause[c] > 0) {
        if (this.dmaTick[c] < this.dmaPrescaler[c]) {
          this.dmaTick[c]++;
        } else {
          this.dmaTick[c] = 0;
          this.dmaPause[c]--;
        }
        continue;
      }
      const src = this.dmaAddr[c];
      const ins = cpc.readRam(src) | (cpc.readRam((src + 1) & 0xFFFF) << 8);
      const op = (ins & 0x7000) >> 12;
      if (op === 0) {
        cpc.psgWrite((ins & 0x0F00) >> 8, ins & 0xFF);
      } else {
        if (op & 1) {
          this.dmaPause[c] = ins & 0x0FFF;
          this.dmaTick[c] = 0;
        }
        if (op & 2) {
          this.dmaLoops[c] = ins & 0x0FFF;
          this.dmaLoopAddr[c] = src;
        }
        if (op & 4) {
          if ((ins & 0x0001) && this.dmaLoops[c] > 0) {
            this.dmaAddr[c] = this.dmaLoopAddr[c];
            this.dmaLoops[c]--;
          }
          if (ins & 0x0010) {
            this.dmaIntPending[c] = 1;
            cpc.cpu.intPending = 1;
          }
          if (ins & 0x0020) this.dmaEnabled[c] = 0;
        }
      }
      this.dmaAddr[c] = (this.dmaAddr[c] + 2) & 0xFFFF;
      const reg = 0x2C00 + (c << 2);
      page[reg] = this.dmaAddr[c] & 0xFF;
      page[reg + 1] = this.dmaAddr[c] >> 8;
      page[reg + 2] = this.dmaPrescaler[c];
      if (this.dmaEnabled[c]) dcsr |= 1 << c; else dcsr &= ~(1 << c);
      if (this.dmaIntPending[c]) dcsr |= 0x40 >> c;
    }
    page[0x2C0F] = dcsr;
  }
}
