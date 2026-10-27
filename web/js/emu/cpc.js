// Derived from Caprice32 src/cap32.cpp, written by Ulrich Doewich,
// Copyright (C) 1997-2015 Ulrich Doewich, (C) 2016-2025 Colin Pitrat.
// Ported to JavaScript and modified for AmsEmu, 2026. GPL v2 or later, see LICENSE.

import { Z80 } from './z80.js';
import { Video } from './video.js';
import { Asic, parseCpr, CART_PAGES, CART_PAGE_SIZE } from './asic.js';
import { Psg } from './psg.js';
import { Fdc } from './fdc.js';
import { DskImage } from './dsk.js';
import { Tape } from './tape.js';
import { CPC_KEYS, CHAR_TO_KEYS } from './keys.js';
import { saveFields, loadFields } from './state.js';
import { amsdosHeader } from './media.js';

const STATE_VERSION = 1;

export const CLOCK = 4000000;
export const CYCLES_PER_FRAME = 79872;

export const MODELS = {
  '464': { name: 'CPC 464', rom: 'cpc464', ram: 64, fdc: false, plus: false },
  '664': { name: 'CPC 664', rom: 'cpc664', ram: 64, fdc: true, plus: false },
  '6128': { name: 'CPC 6128', rom: 'cpc6128', ram: 128, fdc: true, plus: false },
  '464plus': { name: '464 Plus', ram: 64, fdc: false, plus: true },
  '6128plus': { name: '6128 Plus', ram: 128, fdc: true, plus: true },
  'gx4000': { name: 'GX4000', ram: 64, fdc: false, plus: true },
};

export const ROM_FILES = { cpc464: 'cpc464.rom', cpc664: 'cpc664.rom', cpc6128: 'cpc6128.rom', amsdos: 'amsdos.rom', system: 'system.cpr' };

export function romsFor(model, { plusSystem = 'cpc6128', cartridge = false, disk = false } = {}) {
  const info = MODELS[resolveModel(model)];
  if (info.plus) {
    if (cartridge) return [];
    if (plusSystem === 'cartridge') return ['system'];
    return info.fdc || disk ? ['cpc6128', 'amsdos'] : ['cpc6128'];
  }
  return info.fdc || disk ? [info.rom, 'amsdos'] : [info.rom];
}

export function autoModel({ cartridge = false, snapshot = null } = {}) {
  if (cartridge) return '6128plus';
  return (snapshot && Cpc.snaModel(snapshot)) || '6128';
}

export function firmwareCartridge(roms) {
  if (!roms.cpc6128) throw new Error('The CPC 6128 ROM is missing');
  const pages = new Uint8Array(CART_PAGES * CART_PAGE_SIZE);
  pages.set(roms.cpc6128.subarray(0, 0x8000), 0);
  if (roms.amsdos) pages.set(roms.amsdos.subarray(0, 0x4000), 3 * CART_PAGE_SIZE);
  return { pages, count: 4 };
}

export function resolveModel(model) {
  const key = String(model || '6128').toLowerCase().replace(/\+/g, 'plus').replace(/[\s_-]/g, '').replace(/^cpc/, '');
  if (MODELS[key]) return key;
  throw new Error('Unknown CPC model: ' + model);
}

const JOY_UP = 1, JOY_DOWN = 2, JOY_LEFT = 4, JOY_RIGHT = 8, JOY_FIRE = 16, JOY_FIRE2 = 32;
export const JOY = { UP: JOY_UP, DOWN: JOY_DOWN, LEFT: JOY_LEFT, RIGHT: JOY_RIGHT, FIRE: JOY_FIRE, FIRE2: JOY_FIRE2 };

const RAM_CONFIGS = [
  [0, 1, 2, 3], [0, 1, 2, 7], [4, 5, 6, 7], [0, 3, 2, 7],
  [0, 4, 2, 3], [0, 5, 2, 3], [0, 6, 2, 3], [0, 7, 2, 3],
];

const READY_FRAMES = 100;

export class Cpc {
  constructor({ roms, model = '6128', ram, fdc = 'auto', cartridge = null, plusSystem = 'cpc6128', expansionRoms = {}, sampleRate = 48000 } = {}) {
    this.roms = roms;
    this.model = resolveModel(model);
    const info = MODELS[this.model];
    this.plus = info.plus;
    this.plusSystem = plusSystem === 'cartridge' ? 'cartridge' : 'cpc6128';
    this.plusMenu = this.plus && !cartridge && this.plusSystem === 'cartridge';
    this.firmwareCart = this.plus && !cartridge && this.plusSystem === 'cpc6128';
    this.ramKB = Math.max(64, Math.min(576, Math.ceil((ram || info.ram) / 64) * 64));
    this.fdcPresent = fdc === 'auto' ? info.fdc : !!fdc;
    this.cycles = 0;
    this.frames = 0;
    this.sampleRate = sampleRate;

    this.layoutMemory(info, cartridge, expansionRoms);
    this.readOff = new Int32Array(4);
    this.writeOff = new Int32Array(4);
    this.ramOff = new Int32Array(4);

    this.cpu = new Z80(this);
    this.asic = this.plus ? new Asic(this) : null;
    if (this.asic) {
      this.asic.page = this.mem.subarray(this.regPageOff, this.regPageOff + 0x4000);
    }
    this.video = new Video(this);
    this.psg = new Psg(sampleRate);
    this.fdc = this.fdcPresent ? new Fdc() : null;
    this.tape = new Tape();
    this.disks = [null, null];

    this.keyCount = new Uint8Array(80);
    this.matrix = new Uint8Array(16);
    this.typedMatrix = new Uint8Array(16);
    this.joy = 0;
    this.joy2 = 0;
    this.typeQueue = [];
    this.typeHold = 0;
    this.typeGap = 0;
    this.readyHandlers = [];
    this.ready = false;

    this.hardReset();
  }

  layoutMemory(info, cartridge, expansionRoms) {
    const ramSize = this.ramKB * 1024;
    let size = ramSize;
    const alloc = (n) => { const o = size; size += n; return o; };
    this.romSlots = new Int32Array(256).fill(-1);
    let cart = null;
    if (this.plus) {
      if (cartridge) cart = cartridge;
      else if (this.plusSystem === 'cpc6128') cart = firmwareCartridge(this.roms);
      else if (this.roms.system) cart = parseCpr(this.roms.system);
      else throw new Error('The Plus system cartridge (system.cpr) is missing');
      this.cartOff = alloc(32 * CART_PAGE_SIZE);
      this.regPageOff = alloc(0x4000);
    } else {
      this.lowRomOff = alloc(0x4000);
      this.basicOff = alloc(0x4000);
      for (const slot of Object.keys(expansionRoms)) this.romSlots[slot & 255] = alloc(0x4000);
      if (this.fdcPresent && this.romSlots[7] < 0 && this.roms.amsdos) this.romSlots[7] = alloc(0x4000);
    }
    this.mem = new Uint8Array(size);
    this.ram = this.mem.subarray(0, ramSize);
    if (this.plus) {
      this.mem.set(cart.pages.subarray(0, 32 * CART_PAGE_SIZE), this.cartOff);
      this.lowRomOff = this.cartOff;
      this.basicOff = this.cartOff + CART_PAGE_SIZE;
    } else {
      const os = this.roms[info.rom];
      if (!os || os.length < 0x8000) throw new Error(`The ${info.name} ROM is missing`);
      this.mem.set(os.subarray(0, 0x4000), this.lowRomOff);
      this.mem.set(os.subarray(0x4000, 0x8000), this.basicOff);
      for (const [slot, data] of Object.entries(expansionRoms)) {
        this.mem.set(romImage(data), this.romSlots[slot & 255]);
      }
      if (this.romSlots[7] >= 0 && !expansionRoms[7]) this.mem.set(this.roms.amsdos.subarray(0, 0x4000), this.romSlots[7]);
    }
  }

  read(addr) {
    return this.mem[this.readOff[addr >> 14] + (addr & 0x3FFF)];
  }

  write(addr, v) {
    const b = addr >> 14;
    if (b === 1 && this.regPageOn) { this.asic.write(addr, v); return; }
    this.mem[this.writeOff[b] + (addr & 0x3FFF)] = v;
  }

  readRam(addr) {
    return this.mem[this.ramOff[addr >> 14] + (addr & 0x3FFF)];
  }

  peek(addr) { return this.read(addr & 0xFFFF); }
  poke(addr, v) { this.mem[this.writeOff[(addr >> 14) & 3] + (addr & 0x3FFF)] = v; }

  updateMemory() {
    let bank = 0;
    if (this.ramKB === 64) {
      this.ramConfig = 0;
    } else {
      bank = (this.ramConfig >> 3) & 7;
      if ((bank + 2) * 64 > this.ramKB) bank = 0;
    }
    const cfg = RAM_CONFIGS[this.ramConfig & 7];
    const ext = 0x10000 * (bank + 1);
    for (let n = 0; n < 4; n++) {
      const blk = cfg[n];
      const off = blk < 4 ? blk * 0x4000 : ext + (blk - 4) * 0x4000;
      this.ramOff[n] = this.readOff[n] = this.writeOff[n] = off;
    }
    if (!(this.romConfig & 0x04)) this.readOff[this.lowerRomBank] = this.lowRomOff;
    if (this.plus && this.regPageOn) this.readOff[1] = this.regPageOff;
    if (!(this.romConfig & 0x08)) this.readOff[3] = this.upperRomOff;
  }

  selectUpperRom(val) {
    this.upperRom = val;
    if (this.plus) {
      const amsdos = this.fdcPresent || !this.firmwareCart;
      const page = val === 7 && amsdos ? 3 : val >= 128 ? val & 31 : 1;
      this.upperRomOff = this.cartOff + page * CART_PAGE_SIZE;
    } else {
      const off = this.romSlots[val];
      this.upperRomOff = off >= 0 ? off : this.basicOff;
    }
    if (!(this.romConfig & 0x08)) this.readOff[3] = this.upperRomOff;
  }

  waitStates(t) {
    this.cycles += t;
    this.video.cycle(t >> 2);
    if (this.fdc !== null) this.fdc.tick(t);
    const tape = this.tape;
    if (tape.motor && tape.playing && tape.present) tape.tick(t);
  }

  intAck() {
    this.video.gaSlCount &= 0x1F;
  }

  intVector() {
    return this.asic ? this.asic.intVector() : 0xFF;
  }

  ioIn(port) {
    const hi = port >> 8, lo = port & 0xFF;
    let ret = 0xFF;
    if (!(hi & 0x40)) {
      if ((hi & 3) === 3) ret = this.video.readReg();
    } else if (!(hi & 0x08)) {
      ret = this.ppiRead(hi & 3);
    } else if (!(hi & 0x04)) {
      if (hi === 0xFB && !(lo & 0x80) && this.fdc !== null) {
        ret = lo & 1 ? this.fdc.readData() : this.fdc.readStatus();
      }
    }
    return ret;
  }

  ioOut(port, val) {
    const hi = port >> 8, lo = port & 0xFF;
    const video = this.video;
    if ((hi & 0xC0) === 0x40) {
      switch (val >> 6) {
        case 0: video.selectPen(val); break;
        case 1: video.setInk(val); break;
        case 2:
          if (this.asic && !this.asic.locked && (val & 0x20)) {
            let bank = (val >> 3) & 3;
            this.regPageOn = bank === 3;
            if (bank === 3) bank = 0;
            this.lowerRomBank = bank;
            this.lowRomOff = this.cartOff + (val & 7) * CART_PAGE_SIZE;
            this.updateMemory();
          } else {
            this.romConfig = val;
            video.setMode(val);
            this.updateMemory();
            if (val & 0x10) {
              this.cpu.intPending = 0;
              video.gaSlCount = 0;
            }
          }
          break;
        default: break;
      }
    }
    if (!(hi & 0x80) && (val & 0xC0) === 0xC0) {
      this.ramConfig = val;
      this.updateMemory();
    }
    if (!(hi & 0x40)) {
      const r = hi & 3;
      if (r === 0) {
        if (this.asic) this.asic.pokeLockSequence(val);
        video.regSelect = val;
      } else if (r === 1) {
        video.writeReg(val);
      }
    }
    if (!(hi & 0x20)) this.selectUpperRom(val);
    if (!(hi & 0x10)) this.printerPort = val ^ 0x80;
    if (!(hi & 0x08)) this.ppiWrite(hi & 3, val);
    if (hi === 0xFA && !(lo & 0x80)) {
      if (this.fdc !== null) this.fdc.setMotor(val & 1);
    } else if (hi === 0xFB && !(lo & 0x80)) {
      if (this.fdc !== null) this.fdc.writeData(val);
    }
  }

  ppiRead(p) {
    switch (p) {
      case 0: {
        if (!(this.ppiControl & 0x10)) return this.ppiA;
        if ((this.psgControl & 0xC0) !== 0x40) return 0xFF;
        const reg = this.psgSelect;
        if (reg >= 16) return 0xFF;
        const regs = this.psg.regs;
        if (reg === 14) {
          const keys = this.keyLine();
          return regs[7] & 0x40 ? regs[14] & keys : keys;
        }
        if (reg === 15) return regs[7] & 0x80 ? regs[15] : 0xFF;
        return regs[reg];
      }
      case 1:
        if (this.plus || (this.ppiControl & 2)) {
          return this.tape.level | (this.printerReady ? 0 : 0x40) | (this.jumpers & 0x7F) |
            (this.video.flagInvsync ? 1 : 0);
        }
        return this.ppiB;
      case 2: {
        const dir = this.ppiControl & 9;
        let ret = this.ppiC;
        if (dir) {
          if (dir & 8) {
            ret &= 0x0F;
            let v = this.ppiC & 0xC0;
            if (v === 0xC0) v = 0x80;
            ret |= v | 0x20;
            if (this.tape.motor) ret |= 0x10;
          }
          if (!(dir & 1)) ret |= 0x0F;
        }
        return ret;
      }
      default: return 0xFF;
    }
  }

  ppiWrite(p, val) {
    switch (p) {
      case 0:
        this.ppiA = val;
        if (!(this.ppiControl & 0x10)) this.psgPortWrite(val);
        break;
      case 1:
        this.ppiB = val;
        break;
      case 2:
        this.ppiC = val;
        this.portCChanged();
        break;
      case 3:
        if (val & 0x80) {
          this.ppiControl = val;
          this.ppiA = this.ppiB = this.ppiC = 0;
        } else {
          const bit = (val >> 1) & 7;
          if (val & 1) this.ppiC |= 1 << bit; else this.ppiC &= ~(1 << bit);
          this.portCChanged();
        }
        break;
    }
  }

  portCChanged() {
    if (!(this.ppiControl & 1)) this.keyboardLine = this.ppiC & 0x0F;
    if (!(this.ppiControl & 8)) {
      this.tape.motor = (this.ppiC & 0x10) !== 0;
      this.psgControl = this.ppiC;
      this.psgPortWrite(this.ppiA);
    }
  }

  psgPortWrite(data) {
    const control = this.psgControl & 0xC0;
    if (control === 0xC0) this.psgSelect = data;
    else if (control === 0x80 && this.psgSelect < 16) this.psgWrite(this.psgSelect, data);
  }

  psgWrite(reg, val) {
    this.psg.writeReg(reg, val, this.cycles);
  }

  keyLine() {
    const line = this.keyboardLine;
    let bits = this.matrix[line] | this.typedMatrix[line];
    if (line === 9) bits |= this.joy & 0x3F;
    else if (line === 6) bits |= this.joy2 & 0x3F;
    return ~bits & 0xFF;
  }

  hardReset() {
    this.ram.fill(0);
    this.romConfig = 0;
    this.ramConfig = 0;
    this.lowerRomBank = 0;
    this.regPageOn = false;
    if (this.plus) this.lowRomOff = this.cartOff;
    this.upperRom = 0;
    this.upperRomOff = this.basicOff;
    this.ppiA = this.ppiB = this.ppiC = this.ppiControl = 0;
    this.psgControl = 0;
    this.psgSelect = 0;
    this.keyboardLine = 0;
    this.printerPort = 0xFF;
    this.printerReady = false;
    this.jumpers = 0x1E;
    this.tape.motor = false;
    if (this.asic) this.asic.reset();
    this.video.reset();
    this.psg.reset(this.cycles);
    if (this.fdc) this.fdc.reset();
    this.cpu.reset();
    this.cpu.intPending = 0;
    this.updateMemory();
    this.typeQueue = [];
    this.typeHold = this.typeGap = 0;
    this.typedMatrix.fill(0);
    this.readyHandlers = [];
    this.ready = false;
    this.frames = 0;
  }

  runFrame() {
    this.serviceTyping();
    const video = this.video, cpu = this.cpu;
    video.frameCompleted = 0;
    const limit = this.cycles + CYCLES_PER_FRAME * 2;
    while (!video.frameCompleted && this.cycles < limit) cpu.step();
    this.frames++;
    this.psg.update(this.cycles);
    if (!this.ready && this.frames >= READY_FRAMES) this.becomeReady();
  }

  runCycles(n) {
    const end = this.cycles + n;
    while (this.cycles < end) {
      const before = this.video.frameCompleted;
      this.cpu.step();
      if (this.video.frameCompleted && !before) {
        this.video.frameCompleted = 0;
        this.frames++;
        this.serviceTyping();
        if (!this.ready && this.frames >= READY_FRAMES) this.becomeReady();
      }
    }
    this.psg.update(this.cycles);
  }

  get busy() {
    return (this.tape.present && this.tape.playing && this.tape.motor) || (this.fdc !== null && this.fdc.busy);
  }

  get clock() { return CLOCK; }
  get cyclesPerFrame() { return CYCLES_PER_FRAME; }

  key(name, down) {
    const code = CPC_KEYS[name];
    if (code === undefined) return;
    if (down) this.keyCount[code]++;
    else if (this.keyCount[code] > 0) this.keyCount[code]--;
    const line = code >> 3, bit = 1 << (code & 7);
    if (this.keyCount[code]) this.matrix[line] |= bit;
    else this.matrix[line] &= ~bit;
  }

  releaseAllKeys() {
    this.keyCount.fill(0);
    this.matrix.fill(0);
  }

  setJoystick(bits, port = 0) {
    if (port === 1) this.joy2 = bits;
    else this.joy = bits;
  }

  typeText(text) {
    for (const ch of text) {
      const k = CHAR_TO_KEYS[ch];
      if (k) this.typeQueue.push(k);
    }
  }

  typeKey(name, shift = false) {
    if (CPC_KEYS[name] !== undefined) this.typeQueue.push([name, shift]);
  }

  typeWait(frames) {
    this.typeQueue.push(frames);
  }

  serviceTyping() {
    if (!this.ready) return;
    if (this.typeHold > 0) {
      if (--this.typeHold === 0) {
        this.typedMatrix.fill(0);
        this.typeGap = 1;
      }
      return;
    }
    if (this.typeGap > 0) { this.typeGap--; return; }
    const next = this.typeQueue.shift();
    if (next === undefined) return;
    if (typeof next === 'number') {
      this.typeGap = next;
      return;
    }
    const [key, shift] = next;
    const code = CPC_KEYS[key];
    this.typedMatrix[code >> 3] |= 1 << (code & 7);
    if (shift) this.typedMatrix[CPC_KEYS.SHIFT >> 3] |= 1 << (CPC_KEYS.SHIFT & 7);
    this.typeHold = 2;
  }

  get typing() { return this.typeQueue.length > 0 || this.typeHold > 0; }

  onReady(fn) {
    if (this.ready) fn(this);
    else this.readyHandlers.push(fn);
  }

  becomeReady() {
    this.ready = true;
    const handlers = this.readyHandlers;
    this.readyHandlers = [];
    for (const h of handlers) h(this);
  }

  insertDisk(image, drive = 0) {
    const img = image ? (image instanceof DskImage ? image : DskImage.parse(image)) : null;
    this.disks[drive] = img;
    if (this.fdc) this.fdc.insert(drive, img);
  }

  ejectDisk(drive = 0) { this.insertDisk(null, drive); }

  diskImage(drive = 0) {
    const d = this.disks[drive];
    return d ? d.toBytes() : null;
  }

  insertTape(bytes, name = '') {
    this.tape.insert(bytes, name);
    this.tapeData = bytes;
  }

  ejectTape() {
    this.tape.eject();
    this.tapeData = null;
  }

  injectBinary(data, load, exec) {
    for (let i = 0; i < data.length; i++) this.poke((load + i) & 0xFFFF, data[i]);
    const cpu = this.cpu;
    cpu.pc = exec & 0xFFFF;
  }

  loadSna(bytes) {
    const id = String.fromCharCode(...bytes.subarray(0, 8));
    if (id !== 'MV - SNA') throw new Error('Not a CPC snapshot');
    const h = bytes;
    const w = (o) => h[o] | (h[o + 1] << 8);
    const sizeKB = w(0x6B) & ~0x3F;
    if (!sizeKB) throw new Error('Empty snapshot');
    this.hardReset();
    const ramBytes = Math.min(sizeKB * 1024, this.ram.length, bytes.length - 0x100);
    this.ram.set(bytes.subarray(0x100, 0x100 + ramBytes));

    const cpu = this.cpu;
    cpu.f = h[0x11]; cpu.a = h[0x12]; cpu.c = h[0x13]; cpu.b = h[0x14];
    cpu.e = h[0x15]; cpu.d = h[0x16]; cpu.l = h[0x17]; cpu.h = h[0x18];
    cpu.setR(h[0x19]);
    cpu.i = h[0x1A];
    cpu.iff1 = h[0x1B] ? 1 : 0;
    cpu.iff2 = h[0x1C] ? 1 : 0;
    cpu.ix = w(0x1D); cpu.iy = w(0x1F); cpu.sp = w(0x21); cpu.pc = w(0x23);
    cpu.im = h[0x25] & 3;
    cpu.f_ = h[0x26]; cpu.a_ = h[0x27]; cpu.c_ = h[0x28]; cpu.b_ = h[0x29];
    cpu.e_ = h[0x2A]; cpu.d_ = h[0x2B]; cpu.l_ = h[0x2C]; cpu.h_ = h[0x2D];

    for (let n = 0; n < 17; n++) {
      this.video.pen = n;
      this.ioOut(0x7F00, (h[0x2F + n] & 0x1F) | 0x40);
    }
    this.ioOut(0x7F00, h[0x2E] & 0x3F);
    this.ioOut(0x7F00, (h[0x40] & 0x3F) | 0x80);
    this.ioOut(0x7F00, (h[0x41] & 0x3F) | 0xC0);
    for (let n = 0; n < 18; n++) {
      this.video.regSelect = n;
      this.video.writeReg(h[0x43 + n]);
    }
    this.video.regSelect = h[0x42];
    this.ioOut(0xDF00, h[0x55]);
    this.ioOut(0xF400, h[0x56]);
    this.ioOut(0xF500, h[0x57]);
    this.ioOut(0xF600, h[0x58]);
    this.ioOut(0xF700, h[0x59]);
    this.psgControl = this.ppiC;
    this.psgSelect = h[0x5A];
    for (let n = 0; n < 16; n++) this.psg.writeReg(n, h[0x5B + n], this.cycles);

    if (h[0x10] > 2) {
      const v = this.video;
      if (this.fdc) this.fdc.setMotor(h[0x9C] & 1);
      v.addr = w(0xA5);
      v.scanline = Math.min(w(0xA7), v.maxVSync);
      v.charCount = h[0xA9];
      v.lineCount = h[0xAB] & 127;
      v.rasterCount = h[0xAC] & 31;
      v.hswCount = h[0xAE] & 15;
      v.vswCount = h[0xAF] & 15;
      const flags = w(0xB0);
      v.flagInvsync = flags & 1 ? 1 : 0;
      if (flags & 2) {
        v.inHSYNC = 0xFF;
        v.flagHadhsync = 1;
        if (v.hswCount >= 3 && v.hswCount < 7) v.flagInmonhsync = 1;
      }
      v.flagInvta = flags & 0x80 ? 1 : 0;
      v.gaHsCount = h[0xB2] & 3;
      v.gaSlCount = h[0xB3];
      cpu.intPending = h[0xB4] ? 1 : 0;
    }
    this.ready = true;
    this.readyHandlers = [];
  }

  static snaModel(bytes) {
    if (bytes.length < 0x100 || bytes[0x10] < 2) return null;
    return ['464', '664', '6128', '6128plus'][bytes[0x6D]] || null;
  }

  saveState() {
    return {
      version: STATE_VERSION,
      model: this.model,
      ramKB: this.ramKB,
      fdcPresent: this.fdcPresent,
      plusSystem: this.plusSystem,
      machine: saveFields(this, ['mem', 'ram', 'keyCount', 'matrix', 'typedMatrix', 'typeQueue', 'joy', 'joy2',
        'readyHandlers', 'sampleRate', 'romSlots', 'tapeData', 'disks']),
      ram: this.ram.slice(),
      cpu: saveFields(this.cpu, ['trapFlags']),
      video: saveFields(this.video, ['fb', 'hwRgb', 'rgb12', 'palette', 'lineSprites']),
      asic: this.asic ? saveFields(this.asic) : null,
      psg: saveFields(this.psg, ['sampleRate', 'out', 'outLen', 'enabled', 'stereo']),
      fdc: this.fdc ? this.fdc.saveState() : null,
      disks: this.disks.map((d) => (d ? d.toBytes() : null)),
      tapeData: this.tapeData ? this.tapeData.slice() : null,
      tape: this.tape.present ? this.tape.saveState() : null,
    };
  }

  loadState(s) {
    if (s.version !== STATE_VERSION || s.model !== this.model || s.ramKB !== this.ramKB ||
        (this.plus && (s.plusSystem || 'cartridge') !== this.plusSystem)) {
      throw new Error('Incompatible save state');
    }
    loadFields(this, s.machine);
    this.ram.set(s.ram);
    loadFields(this.cpu, s.cpu);
    loadFields(this.video, s.video);
    this.video.refreshPalette();
    if (this.asic && s.asic) loadFields(this.asic, s.asic);
    loadFields(this.psg, s.psg);
    this.psg.outLen = 0;
    s.disks.forEach((d, i) => this.insertDisk(d ? DskImage.parse(d) : null, i));
    if (this.fdc && s.fdc) this.fdc.loadState(s.fdc);
    if (s.tapeData) {
      this.insertTape(s.tapeData.slice());
      if (s.tape) this.tape.loadState(s.tape);
    } else {
      this.ejectTape();
    }
    this.updateMemory();
    this.releaseAllKeys();
    this.joy = this.joy2 = 0;
    this.typeQueue = [];
    this.typedMatrix.fill(0);
    this.readyHandlers = [];
  }
}

function romImage(data) {
  let d = data;
  if (d.length > 0x4000 + 127 && amsdosHeader(d)) d = d.subarray(128);
  const out = new Uint8Array(0x4000);
  out.set(d.subarray(0, 0x4000));
  return out;
}
