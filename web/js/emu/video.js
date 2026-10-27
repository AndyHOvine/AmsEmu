// Derived from Caprice32 src/crtc.cpp, written by Ulrich Doewich,
// Copyright (C) 1997-2015 Ulrich Doewich, (C) 2016-2025 Colin Pitrat.
// Its CRTC emulation is based on WinAPE by Richard Wilson.
// Ported to JavaScript and modified for AmsEmu, 2026. GPL v2 or later, see LICENSE.

export const FB_WIDTH = 768;
export const FB_HEIGHT = 272;

const MAX_DRAWN = 270;
const MAX_SYNC_DEC = 80;
const MAX_SYNC_INC = 80;
const MIN_VHOLD = 250;
const MAX_VHOLD = 380;
const MID_VHOLD = 295;
const MIN_VHOLD_RANGE = 46;
const MAX_VHOLD_RANGE = 74;

const BLACK = 0xFF000000;

const MODE_PENS = [0, 1, 2, 3].map((mode) => {
  const t = new Uint8Array(256 * 8);
  const bit = (b, n) => (b >> n) & 1;
  for (let b = 0; b < 256; b++) {
    for (let x = 0; x < 8; x++) {
      let pen;
      if (mode === 0 || mode === 3) {
        const p = x >> 2;
        pen = bit(b, 7 - p) | (bit(b, 3 - p) << 1);
        if (mode === 0) pen |= (bit(b, 5 - p) << 2) | (bit(b, 1 - p) << 3);
      } else if (mode === 1) {
        const p = x >> 1;
        pen = bit(b, 7 - p) | (bit(b, 3 - p) << 1);
      } else {
        pen = bit(b, 7 - x);
      }
      t[b * 8 + x] = pen;
    }
  }
  return t;
});

const MA_TO_RAM = new Uint16Array(0x7400);
for (let l = 0; l < 0x7400; l++) {
  const j = l << 1;
  MA_TO_RAM[l] = (j & 0x7FE) | ((j & 0x6000) << 1);
}

export class Video {
  constructor(cpc) {
    this.cpc = cpc;
    this.fb = new Uint32Array(FB_WIDTH * FB_HEIGHT);
    this.fb.fill(BLACK);
    this.hwRgb = new Uint32Array(32).fill(BLACK);
    this.rgb12 = new Uint32Array(4096).fill(BLACK);
    this.palette = new Uint32Array(32);
    this.lineSprites = new Uint8Array(FB_WIDTH);
    this.reset();
  }

  setColours(hwRgb, rgb12) {
    this.hwRgb.set(hwRgb);
    this.rgb12.set(rgb12);
    this.refreshPalette();
  }

  reset() {
    this.regs = new Uint8Array(18);
    this.regs[0] = 0x3F;
    this.regs[2] = 0x2E;
    this.regs[3] = 0x8E;
    this.regSelect = 0;
    this.requestedAddr = 0;
    this.nextAddr = 0;
    this.addr = 0;
    this.nextAddress = 0;
    this.scrBase = 0;
    this.charCount = 0;
    this.lineCount = 0;
    this.rasterCount = 0;
    this.hsw = 0;
    this.hswCount = 0;
    this.vsw = 0;
    this.vswCount = 0;
    this.flagHadhsync = 0;
    this.flagInmonhsync = 0;
    this.flagInvsync = 0;
    this.flagInvta = 0;
    this.flagNewscan = 0;
    this.flagReschar = 0;
    this.flagResframe = 0;
    this.flagResnext = 0;
    this.flagResscan = 0;
    this.flagResvsync = 0;
    this.flagStartvta = 0;
    this.lastHend = 0;
    this.reg5 = 0;
    this.r7match = 0;
    this.r9match = 0;
    this.hstart = 0;
    this.hend = 0;
    this.charInstMR = 0;
    this.charInstSL = 0;
    this.slCount = 0;

    this.monVSYNC = 0;
    this.inHSYNC = 0;
    this.dispTimg = 0xFF;
    this.hdspTimg = 0x03;
    this.newDispTimg = 0xFF;
    this.newHdspTimg = 0x03;

    this.horzPos = 0x500;
    this.horzChar = 0x04;
    this.horzMax = 48;
    this.outX = 0;
    this.hSyncDuration = 0xA00;
    this.minHSync = 0x4000 - this.hSyncDuration - 257;
    this.maxHSync = 0x4000 - this.hSyncDuration + 257;
    this.monHSYNC = 0x4000 - this.hSyncDuration;
    this.monFreeSync = this.monHSYNC;
    this.monHSPeakPos = 0;
    this.monHSStartPos = 0;
    this.monHSEndPos = 0;
    this.monHSPeakToStart = 0;
    this.monHSStartToPeak = 0;
    this.monHSEndToPeak = 0;
    this.monHSPeakToEnd = 0;
    this.hadP = 0;
    this.minVSync = MID_VHOLD;
    this.maxVSync = this.minVSync + MIN_VHOLD_RANGE + Math.ceil(((this.minVSync - MIN_VHOLD) *
      (MAX_VHOLD_RANGE - MIN_VHOLD_RANGE)) / (MAX_VHOLD - MIN_VHOLD));

    this.scrln = 0;
    this.scanline = 0;
    this.flagDrawing = 1;
    this.frameCompleted = 0;
    this.lineDispX = -1;
    this.lineDispEnd = -1;
    this.winX0 = FB_WIDTH; this.winX1 = 0; this.winY0 = FB_HEIGHT; this.winY1 = 0;
    this.window = { x: 0, y: 0, w: 0, h: 0 };

    this.gaHsCount = 0;
    this.gaSlCount = 0;
    this.scrMode = 1;
    this.requestedScrMode = 1;
    this.pen = 0;
    this.inkValues = new Uint8Array(17);
    this.penColour = new Uint16Array(32).fill(0x1000 | 0x14);
    this.updateSkew();
    this.refreshPalette();
  }

  refreshPalette() {
    for (let i = 0; i < 32; i++) this.setPenRgb(i);
  }

  setPenRgb(i) {
    const c = this.penColour[i];
    this.palette[i] = c & 0x1000 ? this.hwRgb[c & 31] : this.rgb12[c & 0xFFF];
  }

  selectPen(v) {
    this.pen = v & 0x10 ? 0x10 : v & 0x0F;
  }

  setInk(v) {
    const colour = v & 0x1F;
    this.inkValues[this.pen] = colour;
    this.penColour[this.pen] = 0x1000 | colour;
    this.setPenRgb(this.pen);
    const asic = this.cpc.asic;
    if (asic) asic.inkWritten(this.pen, colour);
  }

  setPlusColour(i, grb) {
    this.penColour[i] = grb & 0xFFF;
    this.setPenRgb(i);
  }

  setMode(v) {
    this.requestedScrMode = v & 3;
  }

  readReg() {
    const r = this.regSelect;
    return r > 11 && r < 18 ? this.regs[r] : 0;
  }

  writeReg(val) {
    const r = this.regSelect;
    if (r >= 16) return;
    const regs = this.regs;
    switch (r) {
      case 0: regs[0] = val; break;
      case 1: regs[1] = val; this.updateSkew(); break;
      case 2: regs[2] = val; break;
      case 3:
        regs[3] = val;
        this.hsw = val & 0x0F;
        this.vsw = val >> 4;
        break;
      case 4:
        regs[4] = val & 0x7F;
        if (this.charInstMR === 2 && this.lineCount === regs[4] && this.rasterCount === regs[9]) {
          this.flagStartvta = 1;
        }
        break;
      case 5: regs[5] = val & 0x1F; break;
      case 6:
        regs[6] = val & 0x7F;
        if (this.lineCount === regs[6]) this.newDispTimg = 0;
        break;
      case 7:
        regs[7] = val & 0x7F;
        if (this.lineCount === regs[7]) {
          if (this.r7match !== 1) {
            this.r7match = 1;
            if (this.charCount >= 2) {
              this.flagResvsync = 0;
              if (!this.flagInvsync) this.startVsync();
            }
          }
        } else {
          this.r7match = 0;
        }
        break;
      case 8: regs[8] = val; this.updateSkew(); break;
      case 9: {
        regs[9] = val & 0x1F;
        let temp = 0;
        if (this.rasterCount === regs[9]) {
          temp = 1;
          this.flagResscan = 1;
        }
        if (this.r9match !== temp) {
          this.r9match = temp;
          if (temp) this.charInstMR = 1;
        }
        if (this.rasterCount === regs[9]) {
          if (this.charCount === regs[1]) this.nextAddr = this.addr + this.charCount;
          if (this.charCount === regs[0]) this.flagReschar = 1;
          if (!this.flagStartvta) this.flagResscan = 1;
        } else if (!this.flagInvta) {
          this.flagResscan = 0;
        }
        break;
      }
      case 10: regs[10] = val & 0x7F; break;
      case 11: regs[11] = val & 0x1F; break;
      case 12:
        regs[12] = val & 0x3F;
        this.requestedAddr = regs[13] + (regs[12] << 8);
        break;
      case 13:
        regs[13] = val;
        this.requestedAddr = regs[13] + (regs[12] << 8);
        break;
      case 14: regs[14] = val & 0x3F; break;
      case 15: regs[15] = val; break;
    }
  }

  startVsync() {
    this.vswCount = 0;
    this.flagInvsync = 1;
    this.monVSYNC = 26;
    this.gaHsCount = 2;
  }

  updateSkew() {
    this.newHdspTimg |= 0x02;
    const skew = (this.regs[8] >> 4) & 3;
    if (skew === 3) {
      this.newHdspTimg &= 0xFD;
    } else {
      this.hstart = skew;
      this.hend = this.hstart + this.regs[1];
    }
    const asic = this.cpc.asic;
    if (asic && asic.extendBorder) this.hstart++;
  }

  changeMode() {
    if (this.flagHadhsync) {
      this.flagHadhsync = 0;
      this.scrMode = this.requestedScrMode;
    }
  }

  endVduHsync() {
    this.flagInmonhsync = 0;
    this.monHSPeakToEnd = this.monHSPeakPos;
    if (this.hadP) {
      this.hadP = 0;
      let temp;
      if (this.monHSPeakPos >= this.monHSStartPos) {
        temp = this.monHSEndPos - this.hSyncDuration;
        if (temp < this.monFreeSync) {
          if (this.monFreeSync !== this.minHSync) this.monFreeSync--;
        } else if (temp > this.monFreeSync) {
          if (this.monFreeSync !== this.maxHSync) this.monFreeSync++;
        }
        temp = this.monHSPeakToEnd - this.monHSEndToPeak;
        if (temp < 0) this.syncInc(-temp);
        else this.syncDec(temp);
      } else {
        temp = this.monHSStartToPeak - this.monHSPeakToEnd;
        if (!temp) this.monHSYNC = this.monFreeSync;
        else if (temp < 0) this.syncInc(-temp);
        else this.syncDec(temp);
      }
    }
    this.monHSEndPos = 0;
  }

  syncInc(temp) {
    if (temp > this.monHSStartPos) temp = this.monHSStartPos;
    temp >>= 3;
    if (!temp) temp++;
    if (temp > MAX_SYNC_INC) temp = MAX_SYNC_INC;
    this.monHSYNC = Math.min(this.monFreeSync + temp, this.maxHSync);
  }

  syncDec(temp) {
    if (temp > this.monHSStartPos) temp = this.monHSStartPos;
    temp >>= 3;
    if (!temp) temp++;
    if (temp > MAX_SYNC_DEC) temp = MAX_SYNC_DEC;
    this.monHSYNC = Math.max(this.monFreeSync - temp, this.minHSync);
  }

  matchLineCount() {
    const regs = this.regs;
    if (this.lineCount === regs[6]) this.newDispTimg = 0;
    if (this.lineCount === regs[7]) {
      if (this.lastHend >= 2 && !this.r7match) {
        this.flagResvsync = 0;
        if (!this.flagInvsync) this.startVsync();
      }
      this.r7match = 1;
    } else {
      this.r7match = 0;
    }
  }

  reloadAddr() {
    if (this.lineCount === 0) {
      this.newDispTimg = 0xFF;
      this.addr = this.nextAddr = this.requestedAddr;
    }
    this.matchLineCount();
  }

  restartFrame() {
    this.flagInvta = 0;
    this.flagResframe = 0;
    this.flagResscan = 0;
    this.flagReschar = 0;
    this.rasterCount = 0;
    this.scrBase = 0;
    this.lineCount = 0;
    this.slCount = 0;
    this.reloadAddr();
  }

  matchHsw() {
    if (this.hswCount === this.hsw) {
      const cpc = this.cpc, asic = cpc.asic;
      const priLine = asic ? asic.interruptLine : 0;
      this.gaSlCount++;
      if (this.gaSlCount === 52) {
        if (priLine === 0) cpc.cpu.intPending = 1;
        this.gaSlCount = 0;
      }
      if (priLine !== 0 && this.slCount === priLine) asic.rasterInterrupt();
      if (this.gaHsCount) {
        this.gaHsCount--;
        if (!this.gaHsCount) {
          if (this.gaSlCount >= 32 && priLine === 0) cpc.cpu.intPending = 1;
          this.gaSlCount = 0;
        }
      }
      this.inHSYNC = 0;
      if (this.monVSYNC) this.monVSYNC--;
      this.changeMode();
      if (this.flagInmonhsync) this.endVduHsync();
    } else {
      this.hswCount = (this.hswCount + 1) & 15;
      if (this.hswCount === 3) {
        this.flagInmonhsync = 1;
        this.monHSStartPos = 0;
        this.monHSPeakToStart = this.monHSPeakPos;
        if (this.cpc.asic) this.cpc.asic.dmaCycle();
      } else if (this.hswCount === 7) {
        this.changeMode();
        this.endVduHsync();
      }
    }
  }

  frameFinished() {
    this.frameCompleted = 1;
    const w = this.window;
    if (this.winX1 > this.winX0) {
      w.x = this.winX0; w.y = this.winY0; w.w = this.winX1 - this.winX0; w.h = this.winY1 - this.winY0;
    } else {
      w.w = w.h = 0;
    }
    this.winX0 = FB_WIDTH; this.winX1 = 0; this.winY0 = FB_HEIGHT; this.winY1 = 0;
    this.scrln = -(((this.scanline - MIN_VHOLD) + 1) >> 1);
    this.scanline = 0;
    this.flagDrawing = 0;
  }

  render() {
    const x0 = this.outX;
    this.outX = x0 + 16;
    if (x0 >= FB_WIDTH || x0 <= -16) return;
    const fb = this.fb;
    const row = this.scrln * FB_WIDTH;
    const from = x0 < 0 ? -x0 : 0;
    const to = x0 + 16 > FB_WIDTH ? FB_WIDTH - x0 : 16;
    let o = row + x0;

    if (this.monVSYNC || this.inHSYNC) {
      for (let i = from; i < to; i++) fb[o + i] = BLACK;
      return;
    }
    const pal = this.palette;
    if (!this.dispTimg || this.hdspTimg !== 3) {
      const c = pal[16];
      for (let i = from; i < to; i++) fb[o + i] = c;
      return;
    }
    if (this.lineDispX < 0) this.lineDispX = x0;
    this.lineDispEnd = x0 + 16;
    const ram = this.cpc.ram;
    const pens = MODE_PENS[this.scrMode];
    const asic = this.cpc.asic;
    let a = this.nextAddress;
    if (asic !== null && (asic.hscroll | asic.vscroll)) {
      this.renderScrolled(o, from, to, a, pens, asic);
      return;
    }
    let p = ram[a] << 3;
    if (from === 0 && to === 16) {
      for (let i = 0; i < 8; i++) fb[o + i] = pal[pens[p + i]];
      p = ram[(a + 1) & 0xFFFF] << 3;
      o += 8;
      for (let i = 0; i < 8; i++) fb[o + i] = pal[pens[p + i]];
      return;
    }
    const p2 = ram[(a + 1) & 0xFFFF] << 3;
    for (let i = from; i < to; i++) fb[o + i] = pal[pens[i < 8 ? p + i : p2 + i - 8]];
  }

  renderScrolled(o, from, to, a, pens, asic) {
    const ram = this.cpc.ram, fb = this.fb, pal = this.palette;
    if (asic.vscroll) {
      if (this.rasterCount + asic.vscroll <= this.regs[9]) a += asic.vscroll * 0x0800;
      else a += 80 - (this.regs[9] + 1 - asic.vscroll) * 0x0800;
    }
    const byteOffset = asic.hscroll >> 3, shift = asic.hscroll & 7;
    const base = a - byteOffset - 1;
    for (let i = from; i < to; i++) {
      const s = i + 8 - shift;
      const b = ram[(base + (s >> 3)) & 0xFFFF];
      fb[o + i] = pal[pens[(b << 3) + (s & 7)]];
    }
  }

  drawSprites(asic) {
    if (this.lineDispX < 0 || this.scrln < 0 || this.scrln >= MAX_DRAWN) return;
    const y = this.slCount;
    const fb = this.fb, pal = this.palette;
    const row = this.scrln * FB_WIDTH;
    for (let s = 15; s >= 0; s--) {
      const mx = asic.spriteMagX[s], my = asic.spriteMagY[s];
      if (!mx || !my) continue;
      const sy = y - asic.spriteY[s];
      if (sy < 0 || sy >= 16 * my) continue;
      const line = ((sy / my) | 0) << 4;
      const sx = this.lineDispX + asic.spriteX[s];
      const data = asic.spriteData, base = s << 8;
      const right = this.lineDispX + this.regs[1] * 16;
      for (let x = 0; x < 16; x++) {
        const pen = data[base + line + x];
        if (!pen) continue;
        const c = pal[16 + pen];
        for (let d = 0, px = sx + x * mx; d < mx; d++, px++) {
          if (px >= this.lineDispX && px < right && px < FB_WIDTH) fb[row + px] = c;
        }
      }
    }
  }

  cycle(count) {
    const regs = this.regs;
    while (count-- > 0) {
      if (this.flagDrawing && this.horzChar < this.horzMax) this.render();

      this.nextAddress = MA_TO_RAM[(this.addr + this.charCount) & 0x73FF] | this.scrBase;
      this.dispTimg = this.newDispTimg;
      this.hdspTimg = this.newHdspTimg;

      this.monHSStartPos += 0x100;
      this.monHSEndPos += 0x100;
      this.monHSPeakPos += 0x100;
      this.horzPos += 0x100;
      this.horzChar = (this.horzChar + 1) & 0xFF;
      if (this.horzPos >= this.monHSYNC) this.newMonitorLine();

      if (this.charCount === regs[0]) {
        this.lastHend = this.charCount;
        this.flagNewscan = 1;
        this.charCount = 0;
      } else {
        this.charCount = (this.charCount + 1) & 0xFF;
      }

      if (this.charCount === regs[0]) {
        this.flagReschar = this.rasterCount === regs[9] ? 1 : 0;
        if (this.flagResnext) {
          this.flagResnext = 0;
          this.flagResframe = 1;
        }
        if (this.flagStartvta) {
          this.flagStartvta = 0;
          this.flagInvta = 1;
        }
        if (this.flagInvta) {
          this.flagResscan = this.rasterCount === regs[9] && this.lineCount === regs[4] ? 1 : 0;
        }
      }

      if (this.charCount === regs[1] && this.rasterCount === regs[9]) {
        this.nextAddr = this.addr + this.charCount;
      }

      if (!this.inHSYNC) {
        if (this.charCount === regs[2]) {
          this.inHSYNC = 0xFF;
          this.flagHadhsync = 1;
          this.hswCount = 0;
          this.matchHsw();
        }
      } else {
        this.matchHsw();
      }

      if (this.charInstSL === 2) {
        this.reg5 = regs[5];
        this.charInstSL = 0;
      } else if (this.charInstSL === 1) {
        this.charInstSL = 2;
      }
      if (this.charInstMR === 2) {
        if (this.flagStartvta && this.lineCount === regs[4] && regs[5] === 0) this.flagResnext = 1;
        this.charInstMR = 0;
      } else if (this.charInstMR === 1) {
        if (this.rasterCount === regs[9] && this.lineCount === regs[4]) {
          this.flagInvta = 0;
          this.flagStartvta = 1;
        } else {
          this.flagStartvta = 0;
        }
        this.charInstMR = 2;
      }

      if (this.flagNewscan) this.newScanline();

      if (this.charCount === this.hstart) this.newHdspTimg |= 0x01;
      if (this.charCount === this.hend) this.newHdspTimg &= 0xFE;
    }
  }

  newMonitorLine() {
    const asic = this.cpc.asic;
    if (asic !== null && asic.spritesOn && this.flagDrawing) this.drawSprites(asic);
    if (this.lineDispX >= 0 && this.flagDrawing) {
      if (this.lineDispX < this.winX0) this.winX0 = Math.max(0, this.lineDispX);
      if (this.lineDispEnd > this.winX1) this.winX1 = Math.min(FB_WIDTH, this.lineDispEnd);
      if (this.scrln < this.winY0) this.winY0 = this.scrln;
      if (this.scrln + 1 > this.winY1) this.winY1 = this.scrln + 1;
    }
    this.hadP = 1;
    this.monHSPeakPos = this.horzPos - this.monHSYNC;
    this.monHSStartToPeak = this.monHSStartPos - this.monHSPeakPos;
    this.monHSEndToPeak = this.monHSEndPos - this.monHSPeakPos;
    this.horzPos = this.monHSPeakPos - this.hSyncDuration;
    this.horzChar = (this.horzPos >> 8) & 0xFF;
    const val = (this.horzPos & 0xF0) >> 4;
    if (!val) {
      this.horzMax = 48;
      this.outX = 0;
      this.horzChar = (this.horzChar - 1) & 0xFF;
    } else {
      this.horzMax = 49;
      this.outX = val - 16;
    }
    this.lineDispX = -1;
    this.scrln++;
    this.scanline++;
    this.flagDrawing = this.scrln >= 0 && this.scrln < MAX_DRAWN ? 1 : 0;
  }

  newScanline() {
    const regs = this.regs;
    this.flagNewscan = 0;
    const asic = this.cpc.asic;
    if (asic !== null && asic.splitLine && this.slCount === asic.splitLine) this.nextAddr = asic.splitAddr;
    this.addr = this.nextAddr;
    this.slCount++;

    if (this.flagInvsync) {
      this.vswCount = (this.vswCount + 1) & 15;
      if (this.vswCount === this.vsw) {
        this.vswCount = 0;
        this.flagResvsync = 1;
      }
    }

    if (this.flagResframe) {
      this.restartFrame();
    } else if (this.flagResscan) {
      this.flagResscan = 0;
      this.rasterCount = 0;
      this.scrBase = 0;
    } else {
      this.rasterCount = (this.rasterCount + 1) & 31;
      if (!this.rasterCount) this.matchLineCount();
      this.scrBase = (this.scrBase + 0x0800) & 0x3800;
    }

    this.charInstSL = 1;

    const temp = this.rasterCount === regs[9] ? 1 : 0;
    if (temp) this.flagResscan = 1;
    this.r9match = temp;
    if (temp) this.charInstMR = 1;

    if (this.flagInvta && this.rasterCount === this.reg5) {
      this.restartFrame();
      if (regs[9] === 0) this.flagResscan = 1;
    }

    if (this.flagReschar) {
      this.lineCount = (this.lineCount + 1) & 127;
      this.reloadAddr();
    }

    if (this.flagInvsync) {
      if (this.flagResvsync) {
        this.flagInvsync = 0;
        this.flagResvsync = 0;
        if (this.scanline === this.maxVSync) this.frameFinished();
      } else if (this.scanline > this.minVSync) {
        this.frameFinished();
      }
    } else if (this.scanline === this.maxVSync) {
      this.frameFinished();
    }
  }

}
