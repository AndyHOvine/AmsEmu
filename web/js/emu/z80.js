// Derived from Caprice32 src/z80.cpp, written by Ulrich Doewich,
// Copyright (C) 1997-2015 Ulrich Doewich, (C) 2016-2025 Colin Pitrat.
// Ported to JavaScript and modified for AmsEmu, 2026. GPL v2 or later, see LICENSE.

const CF = 0x01;
const NF = 0x02;
const PF = 0x04;
const VF = 0x04;
const HF = 0x10;
const ZF = 0x40;
const SF = 0x80;
const XYF = 0x28;

const SZ = new Uint8Array(256);
const SZ_BIT = new Uint8Array(256);
const SZP = new Uint8Array(256);
const SZHV_INC = new Uint8Array(256);
const SZHV_DEC = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let p = 0;
  for (let b = 0; b < 8; b++) if (i & (1 << b)) p++;
  SZ[i] = (i ? i & SF : ZF) | (i & XYF);
  SZ_BIT[i] = (i ? i & SF : ZF | PF) | (i & XYF);
  SZP[i] = SZ[i] | (p & 1 ? 0 : PF);
  SZHV_INC[i] = SZ[i] | (i === 0x80 ? VF : 0) | ((i & 0x0f) === 0 ? HF : 0);
  SZHV_DEC[i] = SZ[i] | NF | (i === 0x7f ? VF : 0) | ((i & 0x0f) === 0x0f ? HF : 0);
}

const DAA = new Uint16Array(0x800);
for (let idx = 0; idx < 0x800; idx++) {
  const a = idx & 0xff;
  const c = idx & 0x100;
  const h = idx & 0x200;
  const n = idx & 0x400;
  const lo = a & 0x0f;
  let diff = 0;
  if (h || lo > 9) diff |= 0x06;
  if (c || a > 0x99) diff |= 0x60;
  const res = (n ? a - diff : a + diff) & 0xff;
  const half = n ? h && lo < 6 : lo > 9;
  DAA[idx] = (res << 8) | SZP[res] | (c || a > 0x99 ? CF : 0) | (half ? HF : 0) | (n ? NF : 0);
}

const IREP_TMP1 = new Uint8Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0]);
const DREP_TMP1 = new Uint8Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1]);
const BREG_TMP2 = new Uint8Array([
  0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1,
  0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0,
  1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0,
  1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1,
  0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0,
  1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1,
  0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1,
  0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0,
  1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0,
  1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1,
  0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1,
  0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0,
  1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1,
  0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0,
  1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0,
  1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1,
]);

const CC_OP = new Uint8Array([
   4, 12,  8,  8,  4,  4,  8,  4,  4, 12,  8,  8,  4,  4,  8,  4,
  12, 12,  8,  8,  4,  4,  8,  4, 12, 12,  8,  8,  4,  4,  8,  4,
   8, 12, 20,  8,  4,  4,  8,  4,  8, 12, 20,  8,  4,  4,  8,  4,
   8, 12, 16,  8, 12, 12, 12,  4,  8, 12, 16,  8,  4,  4,  8,  4,
   4,  4,  4,  4,  4,  4,  8,  4,  4,  4,  4,  4,  4,  4,  8,  4,
   4,  4,  4,  4,  4,  4,  8,  4,  4,  4,  4,  4,  4,  4,  8,  4,
   4,  4,  4,  4,  4,  4,  8,  4,  4,  4,  4,  4,  4,  4,  8,  4,
   8,  8,  8,  8,  8,  8,  4,  8,  4,  4,  4,  4,  4,  4,  8,  4,
   4,  4,  4,  4,  4,  4,  8,  4,  4,  4,  4,  4,  4,  4,  8,  4,
   4,  4,  4,  4,  4,  4,  8,  4,  4,  4,  4,  4,  4,  4,  8,  4,
   4,  4,  4,  4,  4,  4,  8,  4,  4,  4,  4,  4,  4,  4,  8,  4,
   4,  4,  4,  4,  4,  4,  8,  4,  4,  4,  4,  4,  4,  4,  8,  4,
   8, 12, 12, 12, 12, 16,  8, 16,  8, 12, 12,  4, 12, 20,  8, 16,
   8, 12, 12,  8, 12, 16,  8, 16,  8,  4, 12, 12, 12,  4,  8, 16,
   8, 12, 12, 24, 12, 16,  8, 16,  8,  4, 12,  4, 12,  4,  8, 16,
   8, 12, 12,  4, 12, 16,  8, 16,  8,  8, 12,  4, 12,  4,  8, 16,
]);

const CC_CB = new Uint8Array([
   4,  4,  4,  4,  4,  4, 12,  4,  4,  4,  4,  4,  4,  4, 12,  4,
   4,  4,  4,  4,  4,  4, 12,  4,  4,  4,  4,  4,  4,  4, 12,  4,
   4,  4,  4,  4,  4,  4, 12,  4,  4,  4,  4,  4,  4,  4, 12,  4,
   4,  4,  4,  4,  4,  4, 12,  4,  4,  4,  4,  4,  4,  4, 12,  4,
   4,  4,  4,  4,  4,  4,  8,  4,  4,  4,  4,  4,  4,  4,  8,  4,
   4,  4,  4,  4,  4,  4,  8,  4,  4,  4,  4,  4,  4,  4,  8,  4,
   4,  4,  4,  4,  4,  4,  8,  4,  4,  4,  4,  4,  4,  4,  8,  4,
   4,  4,  4,  4,  4,  4,  8,  4,  4,  4,  4,  4,  4,  4,  8,  4,
   4,  4,  4,  4,  4,  4, 12,  4,  4,  4,  4,  4,  4,  4, 12,  4,
   4,  4,  4,  4,  4,  4, 12,  4,  4,  4,  4,  4,  4,  4, 12,  4,
   4,  4,  4,  4,  4,  4, 12,  4,  4,  4,  4,  4,  4,  4, 12,  4,
   4,  4,  4,  4,  4,  4, 12,  4,  4,  4,  4,  4,  4,  4, 12,  4,
   4,  4,  4,  4,  4,  4, 12,  4,  4,  4,  4,  4,  4,  4, 12,  4,
   4,  4,  4,  4,  4,  4, 12,  4,  4,  4,  4,  4,  4,  4, 12,  4,
   4,  4,  4,  4,  4,  4, 12,  4,  4,  4,  4,  4,  4,  4, 12,  4,
   4,  4,  4,  4,  4,  4, 12,  4,  4,  4,  4,  4,  4,  4, 12,  4,
]);

const CC_ED = new Uint8Array([
   4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,
   4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,
   4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,
   4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,
  12,  8, 12, 20,  4, 12,  4,  8, 12,  8, 12, 20,  4, 12,  4,  8,
  12,  8, 12, 20,  4, 12,  4,  8, 12,  8, 12, 20,  4, 12,  4,  8,
  12,  8, 12, 20,  4, 12,  4, 16, 12,  8, 12, 20,  4, 12,  4, 16,
  12,  8, 12, 20,  4, 12,  4,  4, 12,  8, 12, 20,  4, 12,  4,  4,
   4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,
   4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,
  16, 12, 16, 12,  4,  4,  4,  4, 16, 12, 16, 12,  4,  4,  4,  4,
  16, 12, 16, 12,  4,  4,  4,  4, 16, 12, 16, 12,  4,  4,  4,  4,
   4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,
   4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,
   4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,
   4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,  4,
]);

const CC_XY = new Uint8Array([
   4, 12,  8,  8,  4,  4,  8,  4,  4, 12,  8,  8,  4,  4,  8,  4,
  12, 12,  8,  8,  4,  4,  8,  4, 12, 12,  8,  8,  4,  4,  8,  4,
   8, 12, 20,  8,  4,  4,  8,  4,  8, 12, 20,  8,  4,  4,  8,  4,
   8, 12, 16,  8, 20, 20, 20,  4,  8, 12, 16,  8,  4,  4,  8,  4,
   4,  4,  4,  4,  4,  4, 16,  4,  4,  4,  4,  4,  4,  4, 16,  4,
   4,  4,  4,  4,  4,  4, 16,  4,  4,  4,  4,  4,  4,  4, 16,  4,
   4,  4,  4,  4,  4,  4, 16,  4,  4,  4,  4,  4,  4,  4, 16,  4,
  16, 16, 16, 16, 16, 16,  4, 16,  4,  4,  4,  4,  4,  4, 16,  4,
   4,  4,  4,  4,  4,  4, 16,  4,  4,  4,  4,  4,  4,  4, 16,  4,
   4,  4,  4,  4,  4,  4, 16,  4,  4,  4,  4,  4,  4,  4, 16,  4,
   4,  4,  4,  4,  4,  4, 16,  4,  4,  4,  4,  4,  4,  4, 16,  4,
   4,  4,  4,  4,  4,  4, 16,  4,  4,  4,  4,  4,  4,  4, 16,  4,
   8, 12, 12, 12, 12, 16,  8, 16,  8, 12, 12,  4, 12, 20,  8, 16,
   8, 12, 12,  8, 12, 16,  8, 16,  8,  4, 12, 12, 12,  4,  8, 16,
   8, 12, 12, 24, 12, 16,  8, 16,  8,  4, 12,  4, 12,  4,  8, 16,
   8, 12, 12,  4, 12, 16,  8, 16,  8,  8, 12,  4, 12,  4,  8, 16,
]);

const CC_XYCB = new Uint8Array(256);
for (let i = 0; i < 256; i++) CC_XYCB[i] = (i & 0xc0) === 0x40 ? 16 : 20;

const CC_EX = new Uint8Array([
   0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
   4,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
   4,  0,  0,  0,  0,  0,  0,  0,  4,  0,  0,  0,  0,  0,  0,  0,
   4,  0,  0,  0,  0,  0,  0,  0,  4,  0,  0,  0,  0,  0,  0,  0,
   0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
   0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
   0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
   0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
   0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
   0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
   0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
   4,  8,  4,  4,  0,  0,  0,  0,  4,  8,  4,  4,  0,  0,  0,  0,
   8,  0,  0,  0,  8,  0,  0,  0,  8,  0,  0,  0,  8,  0,  0,  0,
   8,  0,  0,  0,  8,  0,  0,  0,  8,  0,  0,  0,  8,  0,  0,  0,
   8,  0,  0,  0,  8,  0,  0,  0,  8,  0,  0,  0,  8,  0,  0,  0,
   8,  0,  0,  0,  8,  0,  0,  0,  8,  0,  0,  0,  8,  0,  0,  0,
]);

export class Z80 {
  constructor(bus) {
    this.bus = bus;
    this.trapFlags = null;
    this.onTrap = null;
    this.a = 0; this.f = 0; this.b = 0; this.c = 0;
    this.d = 0; this.e = 0; this.h = 0; this.l = 0;
    this.a_ = 0; this.f_ = 0; this.b_ = 0; this.c_ = 0;
    this.d_ = 0; this.e_ = 0; this.h_ = 0; this.l_ = 0;
    this.ix = 0; this.iy = 0; this.sp = 0; this.pc = 0;
    this.i = 0;
    this.r = 0;
    this.r7 = 0;
    this.iff1 = 0; this.iff2 = 0;
    this.im = 0;
    this.halt = 0;
    this.eiDelay = 0;
    this.intPending = 0;
    this.cycleCount = 0;
    this.wsAdjust = 0;
    this.reset();
  }

  reset() {
    this.a = 0; this.f = ZF; this.b = 0; this.c = 0;
    this.d = 0; this.e = 0; this.h = 0; this.l = 0;
    this.a_ = 0; this.f_ = 0; this.b_ = 0; this.c_ = 0;
    this.d_ = 0; this.e_ = 0; this.h_ = 0; this.l_ = 0;
    this.ix = 0xffff; this.iy = 0xffff; this.sp = 0; this.pc = 0;
    this.i = 0; this.r = 0; this.r7 = 0;
    this.iff1 = 0; this.iff2 = 0; this.im = 0; this.halt = 0;
    this.eiDelay = 0; this.intPending = 0;
    this.cycleCount = 0; this.wsAdjust = 0;
  }

  getR() {
    return (this.r & 0x7f) | this.r7;
  }

  setR(v) {
    this.r = v & 0x7f;
    this.r7 = v & 0x80;
  }

  step() {
    const tf = this.trapFlags;
    if (tf !== null && tf[this.pc] !== 0 && this.onTrap !== null && this.onTrap(this.pc)) {
    } else {
      const pc = this.pc;
      const op = this.bus.read(pc);
      this.pc = (pc + 1) & 0xffff;
      this.cycleCount = CC_OP[op];
      this.r = (this.r + 1) & 0x7f;
      this.execMain(op);
      if (this.cycleCount !== 0) this.bus.waitStates(this.cycleCount);
    }
    if (this.eiDelay !== 0) {
      if (--this.eiDelay === 0) {
        this.iff1 = this.iff2 = 1;
        if (this.intPending) this.interrupt();
      }
    } else if (this.intPending) {
      this.interrupt();
    }
    this.wsAdjust = 0;
  }

  interrupt() {
    if (!this.iff1) return;
    const bus = this.bus;
    this.r = (this.r + 1) & 0x7f;
    this.iff1 = this.iff2 = 0;
    this.intPending = 0;
    bus.intAck();
    if (this.halt) {
      this.halt = 0;
      this.pc = (this.pc + 1) & 0xffff;
    }
    if (this.im < 2) {
      this.cycleCount = this.wsAdjust ? 16 : 20;
      this.push16(this.pc);
      this.pc = 0x0038;
    } else {
      this.cycleCount = this.wsAdjust ? 24 : 28;
      this.push16(this.pc);
      const v = (this.i << 8) | bus.intVector();
      this.pc = bus.read(v) | (bus.read((v + 1) & 0xffff) << 8);
    }
    bus.waitStates(this.cycleCount);
  }

  ioSync(rest) {
    if (this.cycleCount !== 0) this.bus.waitStates(this.cycleCount);
    this.cycleCount = rest;
  }

  fetch() {
    const pc = this.pc;
    this.pc = (pc + 1) & 0xffff;
    return this.bus.read(pc);
  }

  fetch16() {
    const lo = this.fetch();
    return lo | (this.fetch() << 8);
  }

  fetchDisp() {
    return ((this.fetch() << 24) >> 24);
  }

  push16(v) {
    const bus = this.bus;
    let sp = (this.sp - 1) & 0xffff;
    bus.write(sp, v >> 8);
    sp = (sp - 1) & 0xffff;
    bus.write(sp, v & 0xff);
    this.sp = sp;
  }

  pop16() {
    const bus = this.bus;
    const sp = this.sp;
    const lo = bus.read(sp);
    const hi = bus.read((sp + 1) & 0xffff);
    this.sp = (sp + 2) & 0xffff;
    return lo | (hi << 8);
  }

  jr() {
    const o = (this.bus.read(this.pc) << 24) >> 24;
    this.pc = (this.pc + o + 1) & 0xffff;
  }

  jp() {
    const pc = this.pc;
    this.pc = this.bus.read(pc) | (this.bus.read((pc + 1) & 0xffff) << 8);
  }

  call() {
    const dest = this.fetch16();
    this.push16(this.pc);
    this.pc = dest;
  }

  rst(addr) {
    this.push16(this.pc);
    this.pc = addr;
  }

  add8(v) {
    const a = this.a;
    const res = a + v;
    this.f = SZ[res & 0xff] | ((res >> 8) & CF) | ((a ^ res ^ v) & HF) | (((v ^ a ^ 0x80) & (v ^ res) & 0x80) >> 5);
    this.a = res & 0xff;
  }

  adc8(v) {
    const a = this.a;
    const res = a + v + (this.f & CF);
    this.f = SZ[res & 0xff] | ((res >> 8) & CF) | ((a ^ res ^ v) & HF) | (((v ^ a ^ 0x80) & (v ^ res) & 0x80) >> 5);
    this.a = res & 0xff;
  }

  sub8(v) {
    const a = this.a;
    const res = a - v;
    this.f = SZ[res & 0xff] | ((res >> 8) & CF) | NF | ((a ^ res ^ v) & HF) | (((v ^ a) & (a ^ res) & 0x80) >> 5);
    this.a = res & 0xff;
  }

  sbc8(v) {
    const a = this.a;
    const res = a - v - (this.f & CF);
    this.f = SZ[res & 0xff] | ((res >> 8) & CF) | NF | ((a ^ res ^ v) & HF) | (((v ^ a) & (a ^ res) & 0x80) >> 5);
    this.a = res & 0xff;
  }

  and8(v) {
    this.a &= v;
    this.f = SZP[this.a] | HF;
  }

  xor8(v) {
    this.a ^= v;
    this.f = SZP[this.a];
  }

  or8(v) {
    this.a |= v;
    this.f = SZP[this.a];
  }

  cp8(v) {
    const a = this.a;
    const res = a - v;
    this.f = (SZ[res & 0xff] & (SF | ZF)) | (v & XYF) | ((res >> 8) & CF) | NF | ((a ^ res ^ v) & HF) |
      ((((v ^ a) & (a ^ res)) >> 5) & VF);
  }

  inc8(v) {
    v = (v + 1) & 0xff;
    this.f = (this.f & CF) | SZHV_INC[v];
    return v;
  }

  dec8(v) {
    v = (v - 1) & 0xff;
    this.f = (this.f & CF) | SZHV_DEC[v];
    return v;
  }

  add16(d, s) {
    const res = d + s;
    this.f = (this.f & (SF | ZF | VF)) | (((d ^ res ^ s) >> 8) & HF) | ((res >> 16) & CF) | ((res >> 8) & XYF);
    return res & 0xffff;
  }

  adc16(v) {
    const hl = (this.h << 8) | this.l;
    const res = hl + v + (this.f & CF);
    this.f = (((hl ^ res ^ v) >> 8) & HF) | ((res >> 16) & CF) | ((res >> 8) & (SF | XYF)) |
      ((res & 0xffff) ? 0 : ZF) | (((v ^ hl ^ 0x8000) & (v ^ res) & 0x8000) >> 13);
    this.h = (res >> 8) & 0xff;
    this.l = res & 0xff;
  }

  sbc16(v) {
    const hl = (this.h << 8) | this.l;
    const res = hl - v - (this.f & CF);
    this.f = (((hl ^ res ^ v) >> 8) & HF) | NF | ((res >> 16) & CF) | ((res >> 8) & (SF | XYF)) |
      ((res & 0xffff) ? 0 : ZF) | (((v ^ hl) & (hl ^ res) & 0x8000) >> 13);
    this.h = (res >> 8) & 0xff;
    this.l = res & 0xff;
  }

  shift(kind, v) {
    let res;
    let carry;
    switch (kind) {
      case 0: carry = v >> 7; res = ((v << 1) | (v >> 7)) & 0xff; break;
      case 1: carry = v & 1; res = ((v >> 1) | (v << 7)) & 0xff; break;
      case 2: carry = v >> 7; res = ((v << 1) | (this.f & CF)) & 0xff; break;
      case 3: carry = v & 1; res = ((v >> 1) | (this.f << 7)) & 0xff; break;
      case 4: carry = v >> 7; res = (v << 1) & 0xff; break;
      case 5: carry = v & 1; res = (v >> 1) | (v & 0x80); break;
      case 6: carry = v >> 7; res = ((v << 1) | 1) & 0xff; break;
      default: carry = v & 1; res = v >> 1; break;
    }
    this.f = SZP[res] | carry;
    return res;
  }

  execMain(op) {
    const bus = this.bus;
    switch (op) {
      case 0x00: break;
      case 0x01: this.c = this.fetch(); this.b = this.fetch(); break;
      case 0x02: bus.write((this.b << 8) | this.c, this.a); break;
      case 0x03: if (++this.c === 256) { this.c = 0; this.b = (this.b + 1) & 0xff; } this.wsAdjust++; break;
      case 0x04: this.b = this.inc8(this.b); break;
      case 0x05: this.b = this.dec8(this.b); break;
      case 0x06: this.b = this.fetch(); break;
      case 0x07: {
        const a = ((this.a << 1) | (this.a >> 7)) & 0xff;
        this.a = a;
        this.f = (this.f & (SF | ZF | PF)) | (a & (XYF | CF));
        break;
      }
      case 0x08: {
        let t = this.a; this.a = this.a_; this.a_ = t;
        t = this.f; this.f = this.f_; this.f_ = t;
        break;
      }
      case 0x09: {
        const r = this.add16((this.h << 8) | this.l, (this.b << 8) | this.c);
        this.h = r >> 8; this.l = r & 0xff;
        break;
      }
      case 0x0a: this.a = bus.read((this.b << 8) | this.c); break;
      case 0x0b: if (--this.c < 0) { this.c = 0xff; this.b = (this.b - 1) & 0xff; } this.wsAdjust++; break;
      case 0x0c: this.c = this.inc8(this.c); break;
      case 0x0d: this.c = this.dec8(this.c); break;
      case 0x0e: this.c = this.fetch(); break;
      case 0x0f: {
        const a = this.a;
        const r = ((a >> 1) | (a << 7)) & 0xff;
        this.f = (this.f & (SF | ZF | PF)) | (a & CF) | (r & XYF);
        this.a = r;
        break;
      }
      case 0x10:
        this.b = (this.b - 1) & 0xff;
        if (this.b !== 0) { this.cycleCount += CC_EX[op]; this.jr(); } else this.pc = (this.pc + 1) & 0xffff;
        break;
      case 0x11: this.e = this.fetch(); this.d = this.fetch(); break;
      case 0x12: bus.write((this.d << 8) | this.e, this.a); break;
      case 0x13: if (++this.e === 256) { this.e = 0; this.d = (this.d + 1) & 0xff; } this.wsAdjust++; break;
      case 0x14: this.d = this.inc8(this.d); break;
      case 0x15: this.d = this.dec8(this.d); break;
      case 0x16: this.d = this.fetch(); break;
      case 0x17: {
        const a = this.a;
        const r = ((a << 1) | (this.f & CF)) & 0xff;
        this.f = (this.f & (SF | ZF | PF)) | (a >> 7) | (r & XYF);
        this.a = r;
        break;
      }
      case 0x18: this.jr(); break;
      case 0x19: {
        const r = this.add16((this.h << 8) | this.l, (this.d << 8) | this.e);
        this.h = r >> 8; this.l = r & 0xff;
        break;
      }
      case 0x1a: this.a = bus.read((this.d << 8) | this.e); break;
      case 0x1b: if (--this.e < 0) { this.e = 0xff; this.d = (this.d - 1) & 0xff; } this.wsAdjust++; break;
      case 0x1c: this.e = this.inc8(this.e); break;
      case 0x1d: this.e = this.dec8(this.e); break;
      case 0x1e: this.e = this.fetch(); break;
      case 0x1f: {
        const a = this.a;
        const r = ((a >> 1) | (this.f << 7)) & 0xff;
        this.f = (this.f & (SF | ZF | PF)) | (a & CF) | (r & XYF);
        this.a = r;
        break;
      }
      case 0x20:
        if (!(this.f & ZF)) { this.cycleCount += CC_EX[op]; this.jr(); } else this.pc = (this.pc + 1) & 0xffff;
        break;
      case 0x21: this.l = this.fetch(); this.h = this.fetch(); break;
      case 0x22: {
        const addr = this.fetch16();
        bus.write(addr, this.l);
        bus.write((addr + 1) & 0xffff, this.h);
        break;
      }
      case 0x23: if (++this.l === 256) { this.l = 0; this.h = (this.h + 1) & 0xff; } this.wsAdjust++; break;
      case 0x24: this.h = this.inc8(this.h); break;
      case 0x25: this.h = this.dec8(this.h); break;
      case 0x26: this.h = this.fetch(); break;
      case 0x27: {
        const v = DAA[this.a | ((this.f & CF) << 8) | ((this.f & HF) << 5) | ((this.f & NF) << 9)];
        this.a = v >> 8;
        this.f = v & 0xff;
        break;
      }
      case 0x28:
        if (this.f & ZF) { this.cycleCount += CC_EX[op]; this.jr(); } else this.pc = (this.pc + 1) & 0xffff;
        break;
      case 0x29: {
        const hl = (this.h << 8) | this.l;
        const r = this.add16(hl, hl);
        this.h = r >> 8; this.l = r & 0xff;
        break;
      }
      case 0x2a: {
        const addr = this.fetch16();
        this.l = bus.read(addr);
        this.h = bus.read((addr + 1) & 0xffff);
        break;
      }
      case 0x2b: if (--this.l < 0) { this.l = 0xff; this.h = (this.h - 1) & 0xff; } this.wsAdjust++; break;
      case 0x2c: this.l = this.inc8(this.l); break;
      case 0x2d: this.l = this.dec8(this.l); break;
      case 0x2e: this.l = this.fetch(); break;
      case 0x2f:
        this.a ^= 0xff;
        this.f = (this.f & (SF | ZF | PF | CF)) | HF | NF | (this.a & XYF);
        break;
      case 0x30:
        if (!(this.f & CF)) { this.cycleCount += CC_EX[op]; this.jr(); } else this.pc = (this.pc + 1) & 0xffff;
        break;
      case 0x31: this.sp = this.fetch16(); break;
      case 0x32: bus.write(this.fetch16(), this.a); break;
      case 0x33: this.sp = (this.sp + 1) & 0xffff; this.wsAdjust++; break;
      case 0x34: {
        const hl = (this.h << 8) | this.l;
        bus.write(hl, this.inc8(bus.read(hl)));
        break;
      }
      case 0x35: {
        const hl = (this.h << 8) | this.l;
        bus.write(hl, this.dec8(bus.read(hl)));
        break;
      }
      case 0x36: {
        const n = this.fetch();
        bus.write((this.h << 8) | this.l, n);
        break;
      }
      case 0x37: this.f = (this.f & (SF | ZF | PF)) | CF | (this.a & XYF); break;
      case 0x38:
        if (this.f & CF) { this.cycleCount += CC_EX[op]; this.jr(); } else this.pc = (this.pc + 1) & 0xffff;
        break;
      case 0x39: {
        const r = this.add16((this.h << 8) | this.l, this.sp);
        this.h = r >> 8; this.l = r & 0xff;
        break;
      }
      case 0x3a: this.a = bus.read(this.fetch16()); break;
      case 0x3b: this.sp = (this.sp - 1) & 0xffff; this.wsAdjust++; break;
      case 0x3c: this.a = this.inc8(this.a); break;
      case 0x3d: this.a = this.dec8(this.a); break;
      case 0x3e: this.a = this.fetch(); break;
      case 0x3f: this.f = ((this.f & (SF | ZF | PF | CF)) | ((this.f & CF) << 4) | (this.a & XYF)) ^ CF; break;

      case 0x40: break;
      case 0x41: this.b = this.c; break;
      case 0x42: this.b = this.d; break;
      case 0x43: this.b = this.e; break;
      case 0x44: this.b = this.h; break;
      case 0x45: this.b = this.l; break;
      case 0x46: this.b = bus.read((this.h << 8) | this.l); break;
      case 0x47: this.b = this.a; break;
      case 0x48: this.c = this.b; break;
      case 0x49: break;
      case 0x4a: this.c = this.d; break;
      case 0x4b: this.c = this.e; break;
      case 0x4c: this.c = this.h; break;
      case 0x4d: this.c = this.l; break;
      case 0x4e: this.c = bus.read((this.h << 8) | this.l); break;
      case 0x4f: this.c = this.a; break;
      case 0x50: this.d = this.b; break;
      case 0x51: this.d = this.c; break;
      case 0x52: break;
      case 0x53: this.d = this.e; break;
      case 0x54: this.d = this.h; break;
      case 0x55: this.d = this.l; break;
      case 0x56: this.d = bus.read((this.h << 8) | this.l); break;
      case 0x57: this.d = this.a; break;
      case 0x58: this.e = this.b; break;
      case 0x59: this.e = this.c; break;
      case 0x5a: this.e = this.d; break;
      case 0x5b: break;
      case 0x5c: this.e = this.h; break;
      case 0x5d: this.e = this.l; break;
      case 0x5e: this.e = bus.read((this.h << 8) | this.l); break;
      case 0x5f: this.e = this.a; break;
      case 0x60: this.h = this.b; break;
      case 0x61: this.h = this.c; break;
      case 0x62: this.h = this.d; break;
      case 0x63: this.h = this.e; break;
      case 0x64: break;
      case 0x65: this.h = this.l; break;
      case 0x66: this.h = bus.read((this.h << 8) | this.l); break;
      case 0x67: this.h = this.a; break;
      case 0x68: this.l = this.b; break;
      case 0x69: this.l = this.c; break;
      case 0x6a: this.l = this.d; break;
      case 0x6b: this.l = this.e; break;
      case 0x6c: this.l = this.h; break;
      case 0x6d: break;
      case 0x6e: this.l = bus.read((this.h << 8) | this.l); break;
      case 0x6f: this.l = this.a; break;
      case 0x70: bus.write((this.h << 8) | this.l, this.b); break;
      case 0x71: bus.write((this.h << 8) | this.l, this.c); break;
      case 0x72: bus.write((this.h << 8) | this.l, this.d); break;
      case 0x73: bus.write((this.h << 8) | this.l, this.e); break;
      case 0x74: bus.write((this.h << 8) | this.l, this.h); break;
      case 0x75: bus.write((this.h << 8) | this.l, this.l); break;
      case 0x76: this.halt = 1; this.pc = (this.pc - 1) & 0xffff; break;
      case 0x77: bus.write((this.h << 8) | this.l, this.a); break;
      case 0x78: this.a = this.b; break;
      case 0x79: this.a = this.c; break;
      case 0x7a: this.a = this.d; break;
      case 0x7b: this.a = this.e; break;
      case 0x7c: this.a = this.h; break;
      case 0x7d: this.a = this.l; break;
      case 0x7e: this.a = bus.read((this.h << 8) | this.l); break;
      case 0x7f: break;

      case 0x80: this.add8(this.b); break;
      case 0x81: this.add8(this.c); break;
      case 0x82: this.add8(this.d); break;
      case 0x83: this.add8(this.e); break;
      case 0x84: this.add8(this.h); break;
      case 0x85: this.add8(this.l); break;
      case 0x86: this.add8(bus.read((this.h << 8) | this.l)); break;
      case 0x87: this.add8(this.a); break;
      case 0x88: this.adc8(this.b); break;
      case 0x89: this.adc8(this.c); break;
      case 0x8a: this.adc8(this.d); break;
      case 0x8b: this.adc8(this.e); break;
      case 0x8c: this.adc8(this.h); break;
      case 0x8d: this.adc8(this.l); break;
      case 0x8e: this.adc8(bus.read((this.h << 8) | this.l)); break;
      case 0x8f: this.adc8(this.a); break;
      case 0x90: this.sub8(this.b); break;
      case 0x91: this.sub8(this.c); break;
      case 0x92: this.sub8(this.d); break;
      case 0x93: this.sub8(this.e); break;
      case 0x94: this.sub8(this.h); break;
      case 0x95: this.sub8(this.l); break;
      case 0x96: this.sub8(bus.read((this.h << 8) | this.l)); break;
      case 0x97: this.sub8(this.a); break;
      case 0x98: this.sbc8(this.b); break;
      case 0x99: this.sbc8(this.c); break;
      case 0x9a: this.sbc8(this.d); break;
      case 0x9b: this.sbc8(this.e); break;
      case 0x9c: this.sbc8(this.h); break;
      case 0x9d: this.sbc8(this.l); break;
      case 0x9e: this.sbc8(bus.read((this.h << 8) | this.l)); break;
      case 0x9f: this.sbc8(this.a); break;
      case 0xa0: this.and8(this.b); break;
      case 0xa1: this.and8(this.c); break;
      case 0xa2: this.and8(this.d); break;
      case 0xa3: this.and8(this.e); break;
      case 0xa4: this.and8(this.h); break;
      case 0xa5: this.and8(this.l); break;
      case 0xa6: this.and8(bus.read((this.h << 8) | this.l)); break;
      case 0xa7: this.and8(this.a); break;
      case 0xa8: this.xor8(this.b); break;
      case 0xa9: this.xor8(this.c); break;
      case 0xaa: this.xor8(this.d); break;
      case 0xab: this.xor8(this.e); break;
      case 0xac: this.xor8(this.h); break;
      case 0xad: this.xor8(this.l); break;
      case 0xae: this.xor8(bus.read((this.h << 8) | this.l)); break;
      case 0xaf: this.xor8(this.a); break;
      case 0xb0: this.or8(this.b); break;
      case 0xb1: this.or8(this.c); break;
      case 0xb2: this.or8(this.d); break;
      case 0xb3: this.or8(this.e); break;
      case 0xb4: this.or8(this.h); break;
      case 0xb5: this.or8(this.l); break;
      case 0xb6: this.or8(bus.read((this.h << 8) | this.l)); break;
      case 0xb7: this.or8(this.a); break;
      case 0xb8: this.cp8(this.b); break;
      case 0xb9: this.cp8(this.c); break;
      case 0xba: this.cp8(this.d); break;
      case 0xbb: this.cp8(this.e); break;
      case 0xbc: this.cp8(this.h); break;
      case 0xbd: this.cp8(this.l); break;
      case 0xbe: this.cp8(bus.read((this.h << 8) | this.l)); break;
      case 0xbf: this.cp8(this.a); break;

      case 0xc0: if (!(this.f & ZF)) { this.cycleCount += CC_EX[op]; this.pc = this.pop16(); } else this.wsAdjust++; break;
      case 0xc1: { const v = this.pop16(); this.b = v >> 8; this.c = v & 0xff; break; }
      case 0xc2: if (!(this.f & ZF)) this.jp(); else this.pc = (this.pc + 2) & 0xffff; break;
      case 0xc3: this.jp(); break;
      case 0xc4: if (!(this.f & ZF)) { this.cycleCount += CC_EX[op]; this.call(); } else this.pc = (this.pc + 2) & 0xffff; break;
      case 0xc5: this.push16((this.b << 8) | this.c); break;
      case 0xc6: this.add8(this.fetch()); break;
      case 0xc7: this.rst(0x00); break;
      case 0xc8: if (this.f & ZF) { this.cycleCount += CC_EX[op]; this.pc = this.pop16(); } else this.wsAdjust++; break;
      case 0xc9: this.pc = this.pop16(); break;
      case 0xca: if (this.f & ZF) this.jp(); else this.pc = (this.pc + 2) & 0xffff; break;
      case 0xcb: this.execCB(); break;
      case 0xcc: if (this.f & ZF) { this.cycleCount += CC_EX[op]; this.call(); } else this.pc = (this.pc + 2) & 0xffff; break;
      case 0xcd: this.call(); break;
      case 0xce: this.adc8(this.fetch()); break;
      case 0xcf: this.rst(0x08); break;
      case 0xd0: if (!(this.f & CF)) { this.cycleCount += CC_EX[op]; this.pc = this.pop16(); } else this.wsAdjust++; break;
      case 0xd1: { const v = this.pop16(); this.d = v >> 8; this.e = v & 0xff; break; }
      case 0xd2: if (!(this.f & CF)) this.jp(); else this.pc = (this.pc + 2) & 0xffff; break;
      case 0xd3: {
        this.ioSync(4);
        const port = (this.a << 8) | this.fetch();
        bus.ioOut(port, this.a);
        break;
      }
      case 0xd4: if (!(this.f & CF)) { this.cycleCount += CC_EX[op]; this.call(); } else this.pc = (this.pc + 2) & 0xffff; break;
      case 0xd5: this.push16((this.d << 8) | this.e); break;
      case 0xd6: this.sub8(this.fetch()); break;
      case 0xd7: this.rst(0x10); break;
      case 0xd8: if (this.f & CF) { this.cycleCount += CC_EX[op]; this.pc = this.pop16(); } else this.wsAdjust++; break;
      case 0xd9: {
        let t = this.b; this.b = this.b_; this.b_ = t;
        t = this.c; this.c = this.c_; this.c_ = t;
        t = this.d; this.d = this.d_; this.d_ = t;
        t = this.e; this.e = this.e_; this.e_ = t;
        t = this.h; this.h = this.h_; this.h_ = t;
        t = this.l; this.l = this.l_; this.l_ = t;
        break;
      }
      case 0xda: if (this.f & CF) this.jp(); else this.pc = (this.pc + 2) & 0xffff; break;
      case 0xdb: {
        this.ioSync(0);
        const port = (this.a << 8) | this.fetch();
        this.a = bus.ioIn(port);
        break;
      }
      case 0xdc: if (this.f & CF) { this.cycleCount += CC_EX[op]; this.call(); } else this.pc = (this.pc + 2) & 0xffff; break;
      case 0xdd: this.execXY(false); break;
      case 0xde: this.sbc8(this.fetch()); break;
      case 0xdf: this.rst(0x18); break;
      case 0xe0: if (!(this.f & PF)) { this.cycleCount += CC_EX[op]; this.pc = this.pop16(); } else this.wsAdjust++; break;
      case 0xe1: { const v = this.pop16(); this.h = v >> 8; this.l = v & 0xff; break; }
      case 0xe2: if (!(this.f & PF)) this.jp(); else this.pc = (this.pc + 2) & 0xffff; break;
      case 0xe3: {
        const sp = this.sp;
        const sp1 = (sp + 1) & 0xffff;
        const lo = bus.read(sp);
        const hi = bus.read(sp1);
        bus.write(sp1, this.h);
        bus.write(sp, this.l);
        this.h = hi; this.l = lo;
        this.wsAdjust++;
        break;
      }
      case 0xe4: if (!(this.f & PF)) { this.cycleCount += CC_EX[op]; this.call(); } else this.pc = (this.pc + 2) & 0xffff; break;
      case 0xe5: this.push16((this.h << 8) | this.l); break;
      case 0xe6: this.and8(this.fetch()); break;
      case 0xe7: this.rst(0x20); break;
      case 0xe8: if (this.f & PF) { this.cycleCount += CC_EX[op]; this.pc = this.pop16(); } else this.wsAdjust++; break;
      case 0xe9: this.pc = (this.h << 8) | this.l; break;
      case 0xea: if (this.f & PF) this.jp(); else this.pc = (this.pc + 2) & 0xffff; break;
      case 0xeb: {
        let t = this.d; this.d = this.h; this.h = t;
        t = this.e; this.e = this.l; this.l = t;
        break;
      }
      case 0xec: if (this.f & PF) { this.cycleCount += CC_EX[op]; this.call(); } else this.pc = (this.pc + 2) & 0xffff; break;
      case 0xed: this.execED(); break;
      case 0xee: this.xor8(this.fetch()); break;
      case 0xef: this.rst(0x28); break;
      case 0xf0: if (!(this.f & SF)) { this.cycleCount += CC_EX[op]; this.pc = this.pop16(); } else this.wsAdjust++; break;
      case 0xf1: { const v = this.pop16(); this.a = v >> 8; this.f = v & 0xff; break; }
      case 0xf2: if (!(this.f & SF)) this.jp(); else this.pc = (this.pc + 2) & 0xffff; break;
      case 0xf3: this.iff1 = this.iff2 = 0; this.eiDelay = 0; break;
      case 0xf4: if (!(this.f & SF)) { this.cycleCount += CC_EX[op]; this.call(); } else this.pc = (this.pc + 2) & 0xffff; break;
      case 0xf5: this.push16((this.a << 8) | this.f); break;
      case 0xf6: this.or8(this.fetch()); break;
      case 0xf7: this.rst(0x30); break;
      case 0xf8: if (this.f & SF) { this.cycleCount += CC_EX[op]; this.pc = this.pop16(); } else this.wsAdjust++; break;
      case 0xf9: this.sp = (this.h << 8) | this.l; this.wsAdjust++; break;
      case 0xfa: if (this.f & SF) this.jp(); else this.pc = (this.pc + 2) & 0xffff; break;
      case 0xfb: this.eiDelay = 2; break;
      case 0xfc: if (this.f & SF) { this.cycleCount += CC_EX[op]; this.call(); } else this.pc = (this.pc + 2) & 0xffff; break;
      case 0xfd: this.execXY(true); break;
      case 0xfe: this.cp8(this.fetch()); break;
      case 0xff: this.rst(0x38); break;
    }
  }

  execCB() {
    const bus = this.bus;
    const op = this.fetch();
    this.cycleCount += CC_CB[op];
    this.r = (this.r + 1) & 0x7f;
    const hl = (this.h << 8) | this.l;
    let v;
    switch (op & 7) {
      case 0: v = this.b; break;
      case 1: v = this.c; break;
      case 2: v = this.d; break;
      case 3: v = this.e; break;
      case 4: v = this.h; break;
      case 5: v = this.l; break;
      case 6: v = bus.read(hl); break;
      default: v = this.a; break;
    }
    const n = (op >> 3) & 7;
    switch (op >> 6) {
      case 0: v = this.shift(n, v); break;
      case 1: this.f = (this.f & CF) | HF | SZ_BIT[v & (1 << n)]; return;
      case 2: v &= ~(1 << n); break;
      default: v |= 1 << n; break;
    }
    switch (op & 7) {
      case 0: this.b = v; break;
      case 1: this.c = v; break;
      case 2: this.d = v; break;
      case 3: this.e = v; break;
      case 4: this.h = v; break;
      case 5: this.l = v; break;
      case 6: bus.write(hl, v); break;
      default: this.a = v; break;
    }
  }

  execXY(isIY) {
    const bus = this.bus;
    let op = this.fetch();
    this.cycleCount += CC_XY[op];
    this.r = (this.r + 1) & 0x7f;
    while (op === 0xdd || op === 0xfd) {
      isIY = op === 0xfd;
      op = this.fetch();
      this.cycleCount += CC_XY[op];
      this.r = (this.r + 1) & 0x7f;
    }
    let xy = isIY ? this.iy : this.ix;
    switch (op) {
      case 0x09: xy = this.add16(xy, (this.b << 8) | this.c); break;
      case 0x19: xy = this.add16(xy, (this.d << 8) | this.e); break;
      case 0x21: xy = this.fetch16(); break;
      case 0x22: {
        const addr = this.fetch16();
        bus.write(addr, xy & 0xff);
        bus.write((addr + 1) & 0xffff, xy >> 8);
        break;
      }
      case 0x23: xy = (xy + 1) & 0xffff; this.wsAdjust++; break;
      case 0x24: xy = (this.inc8(xy >> 8) << 8) | (xy & 0xff); break;
      case 0x25: xy = (this.dec8(xy >> 8) << 8) | (xy & 0xff); break;
      case 0x26: xy = (this.fetch() << 8) | (xy & 0xff); break;
      case 0x29: xy = this.add16(xy, xy); break;
      case 0x2a: {
        const addr = this.fetch16();
        xy = bus.read(addr) | (bus.read((addr + 1) & 0xffff) << 8);
        break;
      }
      case 0x2b: xy = (xy - 1) & 0xffff; this.wsAdjust++; break;
      case 0x2c: xy = (xy & 0xff00) | this.inc8(xy & 0xff); break;
      case 0x2d: xy = (xy & 0xff00) | this.dec8(xy & 0xff); break;
      case 0x2e: xy = (xy & 0xff00) | this.fetch(); break;
      case 0x34: {
        const addr = (xy + this.fetchDisp()) & 0xffff;
        bus.write(addr, this.inc8(bus.read(addr)));
        break;
      }
      case 0x35: {
        const addr = (xy + this.fetchDisp()) & 0xffff;
        bus.write(addr, this.dec8(bus.read(addr)));
        break;
      }
      case 0x36: {
        const addr = (xy + this.fetchDisp()) & 0xffff;
        bus.write(addr, this.fetch());
        break;
      }
      case 0x39: xy = this.add16(xy, this.sp); break;

      case 0x44: this.b = xy >> 8; break;
      case 0x45: this.b = xy & 0xff; break;
      case 0x46: this.b = bus.read((xy + this.fetchDisp()) & 0xffff); break;
      case 0x4c: this.c = xy >> 8; break;
      case 0x4d: this.c = xy & 0xff; break;
      case 0x4e: this.c = bus.read((xy + this.fetchDisp()) & 0xffff); break;
      case 0x54: this.d = xy >> 8; break;
      case 0x55: this.d = xy & 0xff; break;
      case 0x56: this.d = bus.read((xy + this.fetchDisp()) & 0xffff); break;
      case 0x5c: this.e = xy >> 8; break;
      case 0x5d: this.e = xy & 0xff; break;
      case 0x5e: this.e = bus.read((xy + this.fetchDisp()) & 0xffff); break;
      case 0x60: xy = (this.b << 8) | (xy & 0xff); break;
      case 0x61: xy = (this.c << 8) | (xy & 0xff); break;
      case 0x62: xy = (this.d << 8) | (xy & 0xff); break;
      case 0x63: xy = (this.e << 8) | (xy & 0xff); break;
      case 0x64: break;
      case 0x65: xy = ((xy & 0xff) << 8) | (xy & 0xff); break;
      case 0x66: this.h = bus.read((xy + this.fetchDisp()) & 0xffff); break;
      case 0x67: xy = (this.a << 8) | (xy & 0xff); break;
      case 0x68: xy = (xy & 0xff00) | this.b; break;
      case 0x69: xy = (xy & 0xff00) | this.c; break;
      case 0x6a: xy = (xy & 0xff00) | this.d; break;
      case 0x6b: xy = (xy & 0xff00) | this.e; break;
      case 0x6c: xy = (xy & 0xff00) | (xy >> 8); break;
      case 0x6d: break;
      case 0x6e: this.l = bus.read((xy + this.fetchDisp()) & 0xffff); break;
      case 0x6f: xy = (xy & 0xff00) | this.a; break;
      case 0x70: bus.write((xy + this.fetchDisp()) & 0xffff, this.b); break;
      case 0x71: bus.write((xy + this.fetchDisp()) & 0xffff, this.c); break;
      case 0x72: bus.write((xy + this.fetchDisp()) & 0xffff, this.d); break;
      case 0x73: bus.write((xy + this.fetchDisp()) & 0xffff, this.e); break;
      case 0x74: bus.write((xy + this.fetchDisp()) & 0xffff, this.h); break;
      case 0x75: bus.write((xy + this.fetchDisp()) & 0xffff, this.l); break;
      case 0x77: bus.write((xy + this.fetchDisp()) & 0xffff, this.a); break;
      case 0x7c: this.a = xy >> 8; break;
      case 0x7d: this.a = xy & 0xff; break;
      case 0x7e: this.a = bus.read((xy + this.fetchDisp()) & 0xffff); break;

      case 0x84: this.add8(xy >> 8); break;
      case 0x85: this.add8(xy & 0xff); break;
      case 0x86: this.add8(bus.read((xy + this.fetchDisp()) & 0xffff)); break;
      case 0x8c: this.adc8(xy >> 8); break;
      case 0x8d: this.adc8(xy & 0xff); break;
      case 0x8e: this.adc8(bus.read((xy + this.fetchDisp()) & 0xffff)); break;
      case 0x94: this.sub8(xy >> 8); break;
      case 0x95: this.sub8(xy & 0xff); break;
      case 0x96: this.sub8(bus.read((xy + this.fetchDisp()) & 0xffff)); break;
      case 0x9c: this.sbc8(xy >> 8); break;
      case 0x9d: this.sbc8(xy & 0xff); break;
      case 0x9e: this.sbc8(bus.read((xy + this.fetchDisp()) & 0xffff)); break;
      case 0xa4: this.and8(xy >> 8); break;
      case 0xa5: this.and8(xy & 0xff); break;
      case 0xa6: this.and8(bus.read((xy + this.fetchDisp()) & 0xffff)); break;
      case 0xac: this.xor8(xy >> 8); break;
      case 0xad: this.xor8(xy & 0xff); break;
      case 0xae: this.xor8(bus.read((xy + this.fetchDisp()) & 0xffff)); break;
      case 0xb4: this.or8(xy >> 8); break;
      case 0xb5: this.or8(xy & 0xff); break;
      case 0xb6: this.or8(bus.read((xy + this.fetchDisp()) & 0xffff)); break;
      case 0xbc: this.cp8(xy >> 8); break;
      case 0xbd: this.cp8(xy & 0xff); break;
      case 0xbe: this.cp8(bus.read((xy + this.fetchDisp()) & 0xffff)); break;

      case 0xcb: this.execXYCB(xy); return;
      case 0xe1: xy = this.pop16(); break;
      case 0xe3: {
        const sp = this.sp;
        const sp1 = (sp + 1) & 0xffff;
        const lo = bus.read(sp);
        const hi = bus.read(sp1);
        bus.write(sp1, xy >> 8);
        bus.write(sp, xy & 0xff);
        xy = lo | (hi << 8);
        this.wsAdjust++;
        break;
      }
      case 0xe5: this.push16(xy); break;
      case 0xe9: this.pc = xy; break;
      case 0xf9: this.sp = xy; this.wsAdjust++; break;
      default: this.execMain(op); return;
    }
    if (isIY) this.iy = xy; else this.ix = xy;
  }

  execXYCB(xy) {
    const bus = this.bus;
    const addr = (xy + this.fetchDisp()) & 0xffff;
    const op = this.fetch();
    this.cycleCount += CC_XYCB[op];
    let v = bus.read(addr);
    const n = (op >> 3) & 7;
    switch (op >> 6) {
      case 0: v = this.shift(n, v); break;
      case 1: this.f = (this.f & CF) | HF | SZ_BIT[v & (1 << n)]; return;
      case 2: v &= ~(1 << n); break;
      default: v |= 1 << n; break;
    }
    switch (op & 7) {
      case 0: this.b = v; break;
      case 1: this.c = v; break;
      case 2: this.d = v; break;
      case 3: this.e = v; break;
      case 4: this.h = v; break;
      case 5: this.l = v; break;
      case 6: break;
      default: this.a = v; break;
    }
    bus.write(addr, v);
  }

  execED() {
    const bus = this.bus;
    const op = this.fetch();
    this.cycleCount += CC_ED[op];
    this.r = (this.r + 1) & 0x7f;
    switch (op) {
      case 0x40: this.ioSync(0); this.b = bus.ioIn((this.b << 8) | this.c); this.f = (this.f & CF) | SZP[this.b]; break;
      case 0x48: this.ioSync(0); this.c = bus.ioIn((this.b << 8) | this.c); this.f = (this.f & CF) | SZP[this.c]; break;
      case 0x50: this.ioSync(0); this.d = bus.ioIn((this.b << 8) | this.c); this.f = (this.f & CF) | SZP[this.d]; break;
      case 0x58: this.ioSync(0); this.e = bus.ioIn((this.b << 8) | this.c); this.f = (this.f & CF) | SZP[this.e]; break;
      case 0x60: this.ioSync(0); this.h = bus.ioIn((this.b << 8) | this.c); this.f = (this.f & CF) | SZP[this.h]; break;
      case 0x68: this.ioSync(0); this.l = bus.ioIn((this.b << 8) | this.c); this.f = (this.f & CF) | SZP[this.l]; break;
      case 0x70: this.ioSync(0); this.f = (this.f & CF) | SZP[bus.ioIn((this.b << 8) | this.c)]; break;
      case 0x78: this.ioSync(0); this.a = bus.ioIn((this.b << 8) | this.c); this.f = (this.f & CF) | SZP[this.a]; break;
      case 0x41: this.ioSync(4); bus.ioOut((this.b << 8) | this.c, this.b); break;
      case 0x49: this.ioSync(4); bus.ioOut((this.b << 8) | this.c, this.c); break;
      case 0x51: this.ioSync(4); bus.ioOut((this.b << 8) | this.c, this.d); break;
      case 0x59: this.ioSync(4); bus.ioOut((this.b << 8) | this.c, this.e); break;
      case 0x61: this.ioSync(4); bus.ioOut((this.b << 8) | this.c, this.h); break;
      case 0x69: this.ioSync(4); bus.ioOut((this.b << 8) | this.c, this.l); break;
      case 0x71: this.ioSync(4); bus.ioOut((this.b << 8) | this.c, 0); break;
      case 0x79: this.ioSync(4); bus.ioOut((this.b << 8) | this.c, this.a); break;

      case 0x42: this.sbc16((this.b << 8) | this.c); break;
      case 0x52: this.sbc16((this.d << 8) | this.e); break;
      case 0x62: this.sbc16((this.h << 8) | this.l); break;
      case 0x72: this.sbc16(this.sp); break;
      case 0x4a: this.adc16((this.b << 8) | this.c); break;
      case 0x5a: this.adc16((this.d << 8) | this.e); break;
      case 0x6a: this.adc16((this.h << 8) | this.l); break;
      case 0x7a: this.adc16(this.sp); break;

      case 0x43: { const addr = this.fetch16(); bus.write(addr, this.c); bus.write((addr + 1) & 0xffff, this.b); break; }
      case 0x53: { const addr = this.fetch16(); bus.write(addr, this.e); bus.write((addr + 1) & 0xffff, this.d); break; }
      case 0x63: { const addr = this.fetch16(); bus.write(addr, this.l); bus.write((addr + 1) & 0xffff, this.h); break; }
      case 0x73: { const addr = this.fetch16(); bus.write(addr, this.sp & 0xff); bus.write((addr + 1) & 0xffff, this.sp >> 8); break; }
      case 0x4b: { const addr = this.fetch16(); this.c = bus.read(addr); this.b = bus.read((addr + 1) & 0xffff); break; }
      case 0x5b: { const addr = this.fetch16(); this.e = bus.read(addr); this.d = bus.read((addr + 1) & 0xffff); break; }
      case 0x6b: { const addr = this.fetch16(); this.l = bus.read(addr); this.h = bus.read((addr + 1) & 0xffff); break; }
      case 0x7b: { const addr = this.fetch16(); this.sp = bus.read(addr) | (bus.read((addr + 1) & 0xffff) << 8); break; }

      case 0x44: case 0x4c: case 0x54: case 0x5c:
      case 0x64: case 0x6c: case 0x74: case 0x7c: {
        const v = this.a;
        this.a = 0;
        this.sub8(v);
        break;
      }
      case 0x45: case 0x4d: case 0x55: case 0x5d:
      case 0x65: case 0x6d: case 0x75: case 0x7d:
        this.iff1 = this.iff2;
        this.pc = this.pop16();
        break;
      case 0x46: case 0x4e: case 0x66: case 0x6e: this.im = 0; break;
      case 0x56: case 0x76: this.im = 1; break;
      case 0x5e: case 0x7e: this.im = 2; break;
      case 0x47: this.i = this.a; this.wsAdjust++; break;
      case 0x4f: this.r = this.a & 0x7f; this.r7 = this.a & 0x80; this.wsAdjust++; break;
      case 0x57:
        this.a = this.i;
        this.f = (this.f & CF) | SZ[this.a] | (this.iff2 << 2);
        this.wsAdjust++;
        break;
      case 0x5f:
        this.a = (this.r & 0x7f) | this.r7;
        this.f = (this.f & CF) | SZ[this.a] | (this.iff2 << 2);
        this.wsAdjust++;
        break;
      case 0x67: {
        const hl = (this.h << 8) | this.l;
        const n = bus.read(hl);
        bus.write(hl, ((n >> 4) | (this.a << 4)) & 0xff);
        this.a = (this.a & 0xf0) | (n & 0x0f);
        this.f = (this.f & CF) | SZP[this.a];
        break;
      }
      case 0x6f: {
        const hl = (this.h << 8) | this.l;
        const n = bus.read(hl);
        bus.write(hl, ((n << 4) | (this.a & 0x0f)) & 0xff);
        this.a = (this.a & 0xf0) | (n >> 4);
        this.f = (this.f & CF) | SZP[this.a];
        break;
      }

      case 0xa0: this.ldi(1); this.wsAdjust++; break;
      case 0xa8: this.ldi(-1); this.wsAdjust++; break;
      case 0xb0:
      case 0xb8:
        this.ldi(op === 0xb0 ? 1 : -1);
        if (this.b | this.c) { this.cycleCount += CC_EX[op]; this.pc = (this.pc - 2) & 0xffff; }
        this.wsAdjust++;
        break;
      case 0xa1: this.cpi(1); break;
      case 0xa9: this.cpi(-1); break;
      case 0xb1:
      case 0xb9:
        this.cpi(op === 0xb1 ? 1 : -1);
        if ((this.b | this.c) && !(this.f & ZF)) {
          this.cycleCount += CC_EX[op];
          this.pc = (this.pc - 2) & 0xffff;
          this.wsAdjust++;
        }
        break;
      case 0xa2: this.ioSync(0); this.ini(1); break;
      case 0xaa: this.ioSync(0); this.ini(-1); break;
      case 0xb2:
      case 0xba:
        this.ioSync(0);
        this.ini(op === 0xb2 ? 1 : -1);
        if (this.b) { this.cycleCount += CC_EX[op]; this.pc = (this.pc - 2) & 0xffff; }
        break;
      case 0xa3: this.ioSync(4); this.outi(1); break;
      case 0xab: this.ioSync(4); this.outi(-1); break;
      case 0xb3:
      case 0xbb:
        this.ioSync(4);
        this.outi(op === 0xb3 ? 1 : -1);
        if (this.b) { this.cycleCount += CC_EX[op]; this.pc = (this.pc - 2) & 0xffff; }
        break;
      default: break;
    }
  }

  ldi(dir) {
    const bus = this.bus;
    const hl = (this.h << 8) | this.l;
    const de = (this.d << 8) | this.e;
    const io = bus.read(hl);
    bus.write(de, io);
    let f = this.f & (SF | ZF | CF);
    const n = this.a + io;
    if (n & 0x02) f |= 0x20;
    if (n & 0x08) f |= 0x08;
    const hl2 = (hl + dir) & 0xffff;
    const de2 = (de + dir) & 0xffff;
    const bc = (((this.b << 8) | this.c) - 1) & 0xffff;
    this.h = hl2 >> 8; this.l = hl2 & 0xff;
    this.d = de2 >> 8; this.e = de2 & 0xff;
    this.b = bc >> 8; this.c = bc & 0xff;
    if (bc) f |= VF;
    this.f = f;
  }

  cpi(dir) {
    const hl = (this.h << 8) | this.l;
    const val = this.bus.read(hl);
    let res = (this.a - val) & 0xff;
    const hl2 = (hl + dir) & 0xffff;
    const bc = (((this.b << 8) | this.c) - 1) & 0xffff;
    this.h = hl2 >> 8; this.l = hl2 & 0xff;
    this.b = bc >> 8; this.c = bc & 0xff;
    let f = (this.f & CF) | (SZ[res] & ~XYF) | ((this.a ^ val ^ res) & HF) | NF;
    if (f & HF) res = (res - 1) & 0xff;
    if (res & 0x02) f |= 0x20;
    if (res & 0x08) f |= 0x08;
    if (bc) f |= VF;
    this.f = f;
  }

  ini(dir) {
    const bus = this.bus;
    const io = bus.ioIn((this.b << 8) | this.c);
    const b = (this.b - 1) & 0xff;
    this.b = b;
    const hl = (this.h << 8) | this.l;
    bus.write(hl, io);
    const hl2 = (hl + dir) & 0xffff;
    this.h = hl2 >> 8; this.l = hl2 & 0xff;
    this.blockIoFlags(io, (this.c + dir) & 0xff, dir > 0 ? IREP_TMP1 : DREP_TMP1);
  }

  outi(dir) {
    const bus = this.bus;
    const hl = (this.h << 8) | this.l;
    const io = bus.read(hl);
    const b = (this.b - 1) & 0xff;
    this.b = b;
    bus.ioOut((b << 8) | this.c, io);
    const hl2 = (hl + dir) & 0xffff;
    this.h = hl2 >> 8; this.l = hl2 & 0xff;
    this.blockIoFlags(io, (this.c + dir) & 0xff, dir > 0 ? IREP_TMP1 : DREP_TMP1);
  }

  blockIoFlags(io, c1, tmp1) {
    const b = this.b;
    const c = this.c;
    let f = SZ[b];
    if (io & SF) f |= NF;
    if ((c1 + io) & 0x100) f |= HF | CF;
    if ((tmp1[((c & 3) << 2) | (io & 3)] ^ BREG_TMP2[b] ^ (c >> 2) ^ (io >> 2)) & 1) f |= PF;
    this.f = f;
  }
}
