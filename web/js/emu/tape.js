// Derived from Caprice32 src/tape.cpp and src/slotshandler.cpp, written by Ulrich Doewich,
// Copyright (C) 1997-2015 Ulrich Doewich, (C) 2016-2025 Colin Pitrat.
// Ported to JavaScript and modified for AmsEmu, 2026. GPL v2 or later, see LICENSE.

const LOW = 0;
const HIGH = 0x80;

const CYCLE_SCALE = Math.trunc((40 << 16) / 35);
const adj = (p) => Math.floor((p * CYCLE_SCALE) / 65536);
const MS = 4000;

const PILOT = 1, SYNC = 2, DATA = 3, SAMPLE = 4, PAUSE = 5, END = 6, RAW = 7;

const K_DATA = 1;
const K_DIRECT = 2;
const K_PAUSE = 3;
const K_RAW = 4;
const K_LEVEL = 5;
const K_INFO = 6;

const BLOCK_NAMES = {
  0x10: 'standard speed data', 0x11: 'turbo speed data', 0x12: 'pure tone', 0x13: 'pulse sequence',
  0x14: 'pure data', 0x15: 'direct recording', 0x18: 'CSW recording', 0x19: 'generalized data',
  0x20: 'pause', 0x21: 'group start', 0x22: 'group end', 0x23: 'jump', 0x24: 'loop start',
  0x25: 'loop end', 0x26: 'call sequence', 0x27: 'return', 0x28: 'select', 0x2a: 'stop if 48K',
  0x2b: 'set signal level', 0x30: 'text description', 0x31: 'message', 0x32: 'archive info',
  0x33: 'hardware type', 0x34: 'emulation info', 0x35: 'custom info', 0x40: 'snapshot', 0x5a: 'glue',
};

function startsWith(b, s, off = 0) {
  if (b.length < off + s.length) return false;
  for (let i = 0; i < s.length; i++) if (b[off + i] !== s.charCodeAt(i)) return false;
  return true;
}

function levelsToRaw(n, levelAt, rate) {
  const runs = [];
  let first = n > 0 ? levelAt(0) : 0;
  let cur = first, tPrev = 0;
  for (let i = 1; i <= n; i++) {
    const v = i < n ? levelAt(i) : -1;
    if (v !== cur) {
      const t = Math.round((i * 4000000) / rate);
      runs.push(t - tPrev);
      tPrev = t;
      cur = v;
    }
  }
  return { pulses: Uint32Array.from(runs), level: first ? HIGH : LOW };
}

export class Tape {
  constructor() {
    this.bytes = null;
    this.name = '';
    this.blocks = [];
    this.pulses = new Uint32Array(0);
    this.present = false;
    this.playing = false;
    this.motor = false;
    this.level = LOW;
    this.resetPosition();
    this.stage = END;
  }

  get running() {
    return this.present && this.playing && this.motor;
  }

  get atEnd() {
    return this.stage === END;
  }

  get blockSummary() {
    return this.blocks.map((b) => ({ id: b.id, name: BLOCK_NAMES[b.id] || b.name || 'unknown', desc: b.desc || '' }));
  }

  insert(bytes, name = '') {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    const label = name ? ` (${name})` : '';
    let blocks;
    if (startsWith(bytes, 'ZXTape!\x1a')) blocks = this.parseTzx(bytes);
    else if (startsWith(bytes, 'Creative Voice File\x1a')) blocks = this.parseVoc(bytes);
    else if (startsWith(bytes, 'Compressed Square Wave\x1a')) blocks = this.parseCsw(bytes);
    else if (startsWith(bytes, 'RIFF') && startsWith(bytes, 'WAVE', 8)) blocks = this.parseWav(bytes);
    else throw new Error(`Unrecognised tape image${label}: expected CDT/TZX, CSW, VOC or WAV`);
    this.bytes = bytes;
    this.name = name;
    this.blocks = blocks;
    this.present = true;
    this.rewind();
  }

  eject() {
    this.bytes = null;
    this.name = '';
    this.blocks = [];
    this.pulses = new Uint32Array(0);
    this.present = false;
    this.playing = false;
    this.level = LOW;
    this.resetPosition();
    this.stage = END;
  }

  play() {
    if (this.present && !this.atEnd) this.playing = true;
  }

  stop() {
    this.playing = false;
  }

  rewind() {
    this.playing = false;
    this.level = LOW;
    this.resetPosition();
    if (this.present) this.nextBlock();
  }

  resetPosition() {
    this.block = 0;
    this.stage = END;
    this.count = 0;
    this.pulseCount = 0;
    this.pulseCycles = 0;
    this.zeroCycles = 0;
    this.oneCycles = 0;
    this.dataPos = 0;
    this.dataCount = 0;
    this.bitsLeft = 0;
    this.curByte = 0;
    this.seqPos = 0;
  }

  tick(t) {
    this.count -= t;
    while (this.count <= 0) {
      if (this.stage === END) {
        this.playing = false;
        return;
      }
      this.updateLevel();
    }
  }

  saveState() {
    return {
      block: this.block, stage: this.stage, count: this.count, level: this.level,
      pulseCount: this.pulseCount, pulseCycles: this.pulseCycles,
      zeroCycles: this.zeroCycles, oneCycles: this.oneCycles,
      dataPos: this.dataPos, dataCount: this.dataCount, bitsLeft: this.bitsLeft,
      curByte: this.curByte, seqPos: this.seqPos, playing: this.playing, motor: this.motor,
    };
  }

  loadState(s) {
    for (const k of Object.keys(this.saveState())) {
      if (k in s) this[k] = s[k];
    }
    if (!this.present) {
      this.stage = END;
      this.playing = false;
    } else if (this.stage !== END && this.block >= this.blocks.length) {
      throw new Error('Tape state does not match the inserted tape');
    }
  }

  updateLevel() {
    const b = this.blocks[this.block];
    switch (this.stage) {
      case PILOT:
        this.level ^= HIGH;
        if (--this.pulseCount > 0) this.count += this.pulseCycles;
        else if (!this.enterSync(b)) this.blockDone();
        break;
      case SYNC:
        this.level ^= HIGH;
        if (--this.pulseCount > 0) {
          this.pulseCycles = b.sync[this.seqPos++];
          this.count += this.pulseCycles;
        } else if (!this.enterData(b)) this.blockDone();
        break;
      case DATA:
        this.level ^= HIGH;
        if (--this.pulseCount > 0) this.count += this.pulseCycles;
        else if (this.readDataBit()) this.count += this.pulseCycles;
        else if (!this.enterPause(b.pause)) this.blockDone();
        break;
      case SAMPLE:
        if (!this.readSampleBit()) {
          if (!this.enterPause(b.pause)) this.blockDone();
        }
        break;
      case RAW:
        if (this.dataCount > 0) {
          this.level ^= HIGH;
          this.count += this.pulses[this.dataPos++];
          this.dataCount--;
        } else this.blockDone();
        break;
      case PAUSE:
        this.level = LOW;
        if (--this.pulseCount > 0) this.count += this.pulseCycles;
        else this.blockDone();
        break;
      default:
        this.stage = END;
    }
  }

  blockDone() {
    this.block++;
    this.nextBlock();
  }

  nextBlock() {
    while (this.block < this.blocks.length) {
      if (this.begin(this.blocks[this.block])) return;
      this.block++;
    }
    this.stage = END;
    this.playing = false;
  }

  begin(b) {
    switch (b.kind) {
      case K_DATA: return this.enterPilot(b);
      case K_DIRECT:
        this.stage = SAMPLE;
        this.pulseCycles = b.sampleCycles;
        this.startData(b);
        if (this.readSampleBit()) return true;
        return this.enterPause(b.pause);
      case K_PAUSE: return this.enterPause(b.pause);
      case K_RAW:
        if (b.count === 0) return false;
        this.stage = RAW;
        this.level = b.level;
        this.dataPos = b.start;
        this.count += this.pulses[this.dataPos++];
        this.dataCount = b.count - 1;
        return true;
      case K_LEVEL:
        this.level = b.level;
        return false;
      default: return false;
    }
  }

  enterPilot(b) {
    if (b.pilotCount > 0) {
      this.stage = PILOT;
      this.pulseCycles = b.pilot;
      this.pulseCount = b.pilotCount;
      this.count += this.pulseCycles;
      return true;
    }
    return this.enterSync(b);
  }

  enterSync(b) {
    if (b.sync.length > 0) {
      this.stage = SYNC;
      this.seqPos = 0;
      this.pulseCycles = b.sync[this.seqPos++];
      this.pulseCount = b.sync.length;
      this.count += this.pulseCycles;
      return true;
    }
    return this.enterData(b);
  }

  enterData(b) {
    if (b.bits > 0) {
      this.stage = DATA;
      this.zeroCycles = b.zero;
      this.oneCycles = b.one;
      this.startData(b);
      this.readDataBit();
      this.count += this.pulseCycles;
      return true;
    }
    return this.enterPause(b.pause);
  }

  enterPause(ms) {
    if (ms > 0) {
      this.stage = PAUSE;
      this.count += MS;
      this.pulseCycles = (ms - 1) * MS;
      this.pulseCount = 2;
      return true;
    }
    return false;
  }

  startData(b) {
    this.dataPos = b.data;
    this.dataCount = b.bits;
    this.bitsLeft = 0;
  }

  nextBit() {
    if (this.bitsLeft === 0) {
      this.curByte = this.bytes[this.dataPos++];
      this.bitsLeft = 8;
    }
    const bit = this.curByte & 0x80;
    this.curByte = (this.curByte << 1) & 0xff;
    this.bitsLeft--;
    this.dataCount--;
    return bit;
  }

  readDataBit() {
    if (this.dataCount <= 0) return false;
    this.pulseCycles = this.nextBit() ? this.oneCycles : this.zeroCycles;
    this.pulseCount = 2;
    return true;
  }

  readSampleBit() {
    if (this.dataCount <= 0) return false;
    this.level = this.nextBit() ? HIGH : LOW;
    this.count += this.pulseCycles;
    return true;
  }

  parseTzx(d) {
    if (d.length < 10) throw new Error('CDT file is truncated');
    if (d[8] !== 1) throw new Error(`Unsupported CDT/TZX major version ${d[8]}`);
    const w = (o) => d[o] | (d[o + 1] << 8);
    const t3 = (o) => d[o] | (d[o + 1] << 8) | (d[o + 2] << 16);
    const dw = (o) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;

    const blocks = [{ id: 0x20, kind: K_PAUSE, pause: 2000, desc: 'leading 2000 ms' }];
    let loopStart = -1, loopCount = 0;
    let gotData = false;
    let p = 10;
    while (p < d.length) {
      const id = d[p++];
      const at = p;
      let len, b = null;
      const need = (n) => {
        if (at + n > d.length) throw new Error(`CDT block 0x${id.toString(16)} at offset ${at - 1} is truncated`);
      };
      switch (id) {
        case 0x10: {
          need(4);
          const n = w(at + 2);
          len = 4 + n;
          need(len);
          const flag = n > 0 ? d[at + 4] : 0;
          b = {
            kind: K_DATA, pilot: adj(2168), pilotCount: flag < 128 ? 8063 : 3223,
            sync: [adj(667), adj(735)], zero: adj(855), one: adj(1710),
            data: at + 4, bits: n * 8, pause: w(at), desc: `${n} bytes, pause ${w(at)} ms`,
          };
          break;
        }
        case 0x11: {
          need(0x12);
          const n = t3(at + 0x0f);
          len = 0x12 + n;
          need(len);
          b = {
            kind: K_DATA, pilot: adj(w(at)), pilotCount: w(at + 0x0a),
            sync: [adj(w(at + 2)), adj(w(at + 4))], zero: adj(w(at + 6)), one: adj(w(at + 8)),
            data: at + 0x12, bits: n > 0 ? (n - 1) * 8 + d[at + 0x0c] : 0, pause: w(at + 0x0d),
            desc: `${n} bytes, pilot ${w(at)}x${w(at + 0x0a)}, bits ${w(at + 6)}/${w(at + 8)}, pause ${w(at + 0x0d)} ms`,
          };
          break;
        }
        case 0x12:
          need(4);
          len = 4;
          b = {
            kind: K_DATA, pilot: adj(w(at)), pilotCount: w(at + 2), sync: [], bits: 0, pause: 0,
            desc: `${w(at + 2)} x ${w(at)}`,
          };
          break;
        case 0x13: {
          need(1);
          const n = d[at];
          len = 1 + n * 2;
          need(len);
          const sync = [];
          for (let i = 0; i < n; i++) sync.push(adj(w(at + 1 + i * 2)));
          b = { kind: K_DATA, pilotCount: 0, sync, bits: 0, pause: 0, desc: `${n} pulses` };
          break;
        }
        case 0x14: {
          need(0x0a);
          const n = t3(at + 7);
          len = 0x0a + n;
          need(len);
          b = {
            kind: K_DATA, pilotCount: 0, sync: [], zero: adj(w(at)), one: adj(w(at + 2)),
            data: at + 0x0a, bits: n > 0 ? (n - 1) * 8 + d[at + 4] : 0, pause: w(at + 5),
            desc: `${n} bytes, pause ${w(at + 5)} ms`,
          };
          break;
        }
        case 0x15: {
          need(8);
          const n = t3(at + 5);
          len = 8 + n;
          need(len);
          b = {
            kind: K_DIRECT, sampleCycles: adj(w(at)), data: at + 8,
            bits: n > 0 ? (n - 1) * 8 + d[at + 4] : 0, pause: w(at + 2),
            desc: `${n} bytes at ${w(at)} T/sample`,
          };
          break;
        }
        case 0x20:
          need(2);
          len = 2;
          b = { kind: K_PAUSE, pause: gotData ? w(at) : 0, desc: `${w(at)} ms` };
          break;
        case 0x21: need(1); len = 1 + d[at]; break;
        case 0x22: len = 0; break;
        case 0x23: case 0x26: case 0x27:
          throw new Error(`Unsupported CDT block 0x${id.toString(16)} (${BLOCK_NAMES[id]})`);
        case 0x24:
          need(2);
          len = 2;
          loopStart = blocks.length;
          loopCount = w(at);
          break;
        case 0x25:
          len = 0;
          if (loopStart >= 0) {
            const body = blocks.slice(loopStart);
            for (let i = 1; i < loopCount; i++) blocks.push(...body);
            loopStart = -1;
          }
          break;
        case 0x28: need(2); len = 2 + w(at); break;
        case 0x2b:
          need(5);
          len = 4 + dw(at);
          b = { kind: K_LEVEL, level: d[at + 4] ? HIGH : LOW, desc: d[at + 4] ? 'high' : 'low' };
          break;
        case 0x30: need(1); len = 1 + d[at]; break;
        case 0x31: need(2); len = 2 + d[at + 1]; break;
        case 0x32: need(2); len = 2 + w(at); break;
        case 0x33: need(1); len = 1 + d[at] * 3; break;
        case 0x34: len = 8; break;
        case 0x35: need(0x14); len = 0x14 + dw(at + 0x10); break;
        case 0x40: need(4); len = 4 + t3(at + 1); break;
        case 0x5a: len = 9; break;
        default: need(4); len = 4 + dw(at);
      }
      need(len);
      if (!b) b = { kind: K_INFO };
      b.id = id;
      if (id === 0x30) b.desc = String.fromCharCode(...d.subarray(at + 1, at + len));
      if (b.kind === K_DATA || b.kind === K_DIRECT) gotData = true;
      if (id !== 0x24 && id !== 0x25) blocks.push(b);
      p = at + len;
    }
    blocks.push({ id: 0x20, kind: K_PAUSE, pause: 2000, desc: 'trailing 2000 ms' });
    this.pulses = new Uint32Array(0);
    return blocks;
  }

  rawTape(raw, id, desc) {
    this.pulses = raw.pulses;
    return [
      { id: 0x20, kind: K_PAUSE, pause: 2000, desc: 'leading 2000 ms' },
      { id, name: desc, kind: K_RAW, start: 0, count: raw.pulses.length, level: raw.level, desc: `${raw.pulses.length} pulses` },
      { id: 0x20, kind: K_PAUSE, pause: 2000, desc: 'trailing 2000 ms' },
    ];
  }

  parseVoc(d) {
    if (d.length < 26) throw new Error('VOC file is truncated');
    let p = d[0x14] | (d[0x15] << 8);
    let sr = -1;
    const chunks = [];
    let total = 0;
    while (p < d.length && d[p] !== 0) {
      const type = d[p];
      const size = d[p + 1] | (d[p + 2] << 8) | (d[p + 3] << 16);
      const body = p + 4;
      if (body + size > d.length && type !== 3) throw new Error('VOC file is truncated');
      switch (type) {
        case 1:
          if (sr >= 0 && sr !== d[body]) throw new Error('VOC: changes of sample rate are not supported');
          sr = d[body];
          if (d[body + 1] !== 0) throw new Error('VOC: only 8-bit PCM is supported');
          chunks.push([body + 2, size - 2]);
          total += size - 2;
          break;
        case 2:
          chunks.push([body, size]);
          total += size;
          break;
        case 3: {
          const n = (d[body] | (d[body + 1] << 8)) + 1;
          if (sr >= 0 && sr !== d[body + 2]) throw new Error('VOC: changes of sample rate are not supported');
          sr = d[body + 2];
          chunks.push([-1, n]);
          total += n;
          break;
        }
        case 4: case 5: break;
        default: throw new Error(`VOC: unsupported block type ${type}`);
      }
      p = body + size;
    }
    if (sr < 0) throw new Error('VOC file contains no sound data');
    const levels = new Uint8Array(total);
    let o = 0;
    for (const [off, n] of chunks) {
      if (off < 0) o += n;
      else for (let i = 0; i < n; i++) levels[o++] = d[off + i] > 128 ? 1 : 0;
    }
    return this.rawTape(levelsToRaw(total, (i) => levels[i], 1000000 / (256 - sr)), 0x100, 'VOC');
  }

  parseCsw(d) {
    if (d.length < 0x20) throw new Error('CSW file is truncated');
    const major = d[0x17];
    const dw = (o) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
    let rate, comp, flags, p;
    if (major === 1) {
      rate = d[0x19] | (d[0x1a] << 8);
      comp = d[0x1b];
      flags = d[0x1c];
      p = 0x20;
    } else if (major === 2) {
      if (d.length < 0x34) throw new Error('CSW file is truncated');
      rate = dw(0x19);
      comp = d[0x21];
      flags = d[0x22];
      p = 0x34 + d[0x23];
    } else throw new Error(`Unsupported CSW version ${major}`);
    if (comp === 2) throw new Error('CSW Z-RLE (compressed) files are not supported; convert to uncompressed RLE');
    if (comp !== 1) throw new Error(`Unknown CSW compression type ${comp}`);
    if (!rate) throw new Error('CSW file has a zero sample rate');
    const runs = [];
    let samples = 0, tPrev = 0;
    while (p < d.length) {
      let n = d[p++];
      if (n === 0) {
        if (p + 4 > d.length) break;
        n = dw(p);
        p += 4;
      }
      samples += n;
      const t = Math.round((samples * 4000000) / rate);
      runs.push(t - tPrev);
      tPrev = t;
    }
    return this.rawTape({ pulses: Uint32Array.from(runs), level: flags & 1 ? HIGH : LOW }, 0x101, 'CSW');
  }

  parseWav(d) {
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    let p = 12, fmt = null, data = null;
    while (p + 8 <= d.length) {
      const size = dv.getUint32(p + 4, true);
      if (startsWith(d, 'fmt ', p)) {
        fmt = {
          format: dv.getUint16(p + 8, true), channels: dv.getUint16(p + 10, true),
          rate: dv.getUint32(p + 12, true), align: dv.getUint16(p + 20, true), bits: dv.getUint16(p + 22, true),
        };
      } else if (startsWith(d, 'data', p)) {
        data = [p + 8, Math.min(size, d.length - p - 8)];
      }
      p += 8 + size + (size & 1);
    }
    if (!fmt || !data) throw new Error('WAV file has no fmt or data chunk');
    if ((fmt.format !== 1 && fmt.format !== 0xfffe) || (fmt.bits !== 8 && fmt.bits !== 16)) {
      throw new Error('WAV: only 8 or 16-bit PCM is supported');
    }
    const ch = fmt.channels, bps = fmt.bits / 8, align = fmt.align || ch * bps;
    const n = Math.floor(data[1] / align);
    const levels = new Uint8Array(n);
    const dcBeta = 1 - Math.exp((-2 * Math.PI * 20) / fmt.rate);
    const hyst = 0.02;
    let dc = 0, lv = 0;
    for (let i = 0; i < n; i++) {
      const o = data[0] + i * align;
      let s = 0;
      for (let c = 0; c < ch; c++) {
        s += bps === 1 ? (d[o + c] - 128) / 128 : dv.getInt16(o + c * 2, true) / 32768;
      }
      s /= ch;
      dc += (s - dc) * dcBeta;
      const x = s - dc;
      if (x > hyst) lv = 1;
      else if (x < -hyst) lv = 0;
      levels[i] = lv;
    }
    return this.rawTape(levelsToRaw(n, (i) => levels[i], fmt.rate), 0x102, 'WAV');
  }
}
