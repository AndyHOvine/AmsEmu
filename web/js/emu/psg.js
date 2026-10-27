// Derived from Caprice32 src/psg.cpp, written by Ulrich Doewich,
// Copyright (C) 1997-2015 Ulrich Doewich, (C) 2016-2025 Colin Pitrat.
// Converted from the AY Emulator project by Sergey Bulba. Amplitude table (c) Hacker KAY.
// Ported to JavaScript and modified for AmsEmu, 2026. GPL v2 or later, see LICENSE.

const CPU_HZ = 4000000;
const T_PER_STEP = 32;
const HIGH_PASS_HZ = 15;
const OUT_GAIN = 0.9 / 32768;

const AMPLITUDES = [
  0, 836, 1212, 1773, 2619, 3875, 5397, 8823,
  10392, 16706, 23339, 29292, 36969, 46421, 55195, 65535,
];

function rint(x) {
  const r = Math.round(x);
  return (r - x === 0.5 && r % 2 !== 0) ? r - 1 : r;
}

function levelTable(index, l) {
  const t = new Int32Array(32);
  for (let i = 0; i < 16; i++) {
    let b = rint((index / 255) * AMPLITUDES[i]);
    b = rint((b / 65535) * l);
    t[i * 2] = b;
    t[i * 2 + 1] = b;
  }
  return t;
}

const IDX_AL = 255, IDX_AR = 13, IDX_BL = 170, IDX_BR = 170, IDX_CL = 13, IDX_CR = 255;

const L_STEREO = Math.trunc((255 * 32767) /
  Math.max(IDX_AL + IDX_BL + IDX_CL, IDX_AR + IDX_BR + IDX_CR));
const LEVEL_AL = levelTable(IDX_AL, L_STEREO);
const LEVEL_AR = levelTable(IDX_AR, L_STEREO);
const LEVEL_BL = levelTable(IDX_BL, L_STEREO);
const LEVEL_BR = levelTable(IDX_BR, L_STEREO);
const LEVEL_CL = levelTable(IDX_CL, L_STEREO);
const LEVEL_CR = levelTable(IDX_CR, L_STEREO);

const L_MONO = Math.trunc((255 * 32767) /
  (IDX_AL + IDX_BL + IDX_CL + IDX_AR + IDX_BR + IDX_CR));
const LEVEL_A = levelTable(IDX_AL + IDX_AR, L_MONO);
const LEVEL_B = levelTable(IDX_BL + IDX_BR, L_MONO);
const LEVEL_C = levelTable(IDX_CL + IDX_CR, L_MONO);

const REG_MASK = [255, 15, 255, 15, 255, 15, 31, 255, 31, 31, 31, 255, 255, 15, 255, 255];

export class Psg {
  constructor(sampleRate = 48000) {
    this.out = new Float32Array(16384);
    this.outLen = 0;
    this.enabled = true;
    this.stereo = true;
    this.regs = new Uint8Array(16);
    this.setSampleRate(sampleRate);
    this.reset(0);
  }

  setSampleRate(rate) {
    this.sampleRate = rate;
    this.cps = CPU_HZ / rate;
    this.hpBeta = 1 - Math.exp((-2 * Math.PI * HIGH_PASS_HZ) / rate);
  }

  setRateTrim(factor) {
    this.cps = (CPU_HZ / this.sampleRate) * factor;
  }

  reset(cycle = 0) {
    this.regs.fill(0);
    this.toneCntA = 0;
    this.toneCntB = 0;
    this.toneCntC = 0;
    this.noiseCnt = 0;
    this.envCnt = 0;
    this.toneA = 0;
    this.toneB = 0;
    this.toneC = 0;
    this.noiseSeed = 0xffff;
    this.ampEnv = 0;
    this.firstPeriod = false;
    this.tPhase = 0;
    this.sampleAcc = 0;
    this.sumL = 0;
    this.sumR = 0;
    this.sumN = 0;
    this.lastL = 0;
    this.lastR = 0;
    this.hpL = 0;
    this.hpR = 0;
    this.lastCycle = cycle;
  }

  writeReg(reg, value, cycle) {
    if (reg < 0 || reg > 15) return;
    this.update(cycle);
    value &= REG_MASK[reg];
    this.regs[reg] = value;
    if (reg === 13) {
      this.envCnt = 0;
      this.firstPeriod = true;
      this.ampEnv = (value & 4) ? -1 : 32;
    }
  }

  readReg(reg) {
    return this.regs[reg & 15];
  }

  update(cycle) {
    const delta = cycle - this.lastCycle;
    if (delta <= 0) return;
    this.lastCycle = cycle;
    if (!this.enabled) return;

    const phase = this.tPhase + delta;
    let steps = Math.floor(phase / T_PER_STEP);
    this.tPhase = phase - steps * T_PER_STEP;
    if (steps === 0) return;

    const r = this.regs;
    const tonA = r[0] | (r[1] << 8), tonB = r[2] | (r[3] << 8), tonC = r[4] | (r[5] << 8);
    const noisePer = r[6] << 1;
    const mixer = r[7];
    const ampA = r[8], ampB = r[9], ampC = r[10];
    const envPer = r[11] | (r[12] << 8);
    const shape = r[13];

    const toneOnA = !(mixer & 1) && ((ampA & 16) || tonA > 4);
    const toneOnB = !(mixer & 2) && ((ampB & 16) || tonB > 4);
    const toneOnC = !(mixer & 4) && ((ampC & 16) || tonC > 4);
    const noiseOnA = !(mixer & 8), noiseOnB = !(mixer & 16), noiseOnC = !(mixer & 32);
    const envA = ampA & 16, envB = ampB & 16, envC = ampC & 16;
    const fixA = (ampA & 15) * 2 + 1, fixB = (ampB & 15) * 2 + 1, fixC = (ampC & 15) * 2 + 1;

    const st = this.stereo;
    const tAL = st ? LEVEL_AL : LEVEL_A, tAR = st ? LEVEL_AR : LEVEL_A;
    const tBL = st ? LEVEL_BL : LEVEL_B, tBR = st ? LEVEL_BR : LEVEL_B;
    const tCL = st ? LEVEL_CL : LEVEL_C, tCR = st ? LEVEL_CR : LEVEL_C;

    let tcA = this.toneCntA, tcB = this.toneCntB, tcC = this.toneCntC;
    let outA = this.toneA, outB = this.toneB, outC = this.toneC;
    let nc = this.noiseCnt, seed = this.noiseSeed;
    let ec = this.envCnt, env = this.ampEnv, first = this.firstPeriod;
    let sumL = this.sumL, sumR = this.sumR, sumN = this.sumN;
    let acc = this.sampleAcc;
    const cps = this.cps, beta = this.hpBeta;

    for (; steps > 0; steps--) {
      if (++tcA >= tonA) { tcA = 0; outA ^= 1; }
      if (++tcB >= tonB) { tcB = 0; outB ^= 1; }
      if (++tcC >= tonC) { tcC = 0; outC ^= 1; }
      if (!(++nc & 1) && nc >= noisePer) {
        nc = 0;
        seed = (((((seed >> 13) ^ (seed >> 16)) & 1) ^ 1) | (seed << 1)) & 0x1ffff;
      }
      if (ec === 0) {
        switch (shape) {
          case 0: case 1: case 2: case 3: case 9:
            if (first) { env--; if (env === 0) first = false; }
            break;
          case 4: case 5: case 6: case 7: case 15:
            if (first) { env++; if (env === 32) { first = false; env = 0; } }
            break;
          case 8:
            env = (env - 1) & 31;
            break;
          case 10:
            if (first) { env--; if (env === -1) { first = false; env = 0; } }
            else { env++; if (env === 32) { first = true; env = 31; } }
            break;
          case 11:
            if (first) { env--; if (env === -1) { first = false; env = 31; } }
            break;
          case 12:
            env = (env + 1) & 31;
            break;
          case 13:
            if (first) { env++; if (env === 32) { first = false; env = 31; } }
            break;
          case 14:
            if (!first) { env--; if (env === -1) { first = true; env = 0; } }
            else { env++; if (env === 32) { first = false; env = 31; } }
            break;
        }
      }
      if (++ec >= envPer) ec = 0;

      const nv = seed >> 16;
      let l = 0, rr = 0, k, i;
      k = toneOnA ? outA : 1;
      if (noiseOnA) k &= nv;
      if (k) { i = envA ? env : fixA; l += tAL[i]; rr += tAR[i]; }
      k = toneOnB ? outB : 1;
      if (noiseOnB) k &= nv;
      if (k) { i = envB ? env : fixB; l += tBL[i]; rr += tBR[i]; }
      k = toneOnC ? outC : 1;
      if (noiseOnC) k &= nv;
      if (k) { i = envC ? env : fixC; l += tCL[i]; rr += tCR[i]; }
      sumL += l;
      sumR += rr;
      sumN++;

      acc += T_PER_STEP;
      while (acc >= cps) {
        acc -= cps;
        let xl = this.lastL, xr = this.lastR;
        if (sumN > 0) {
          xl = (sumL / sumN) * OUT_GAIN;
          xr = (sumR / sumN) * OUT_GAIN;
          this.lastL = xl;
          this.lastR = xr;
          sumL = 0;
          sumR = 0;
          sumN = 0;
        }
        const yl = xl - this.hpL;
        this.hpL += yl * beta;
        const yr = xr - this.hpR;
        this.hpR += yr * beta;
        if (this.outLen + 2 > this.out.length) this.grow();
        this.out[this.outLen++] = yl < -1 ? -1 : yl > 1 ? 1 : yl;
        this.out[this.outLen++] = yr < -1 ? -1 : yr > 1 ? 1 : yr;
      }
    }

    this.toneCntA = tcA; this.toneCntB = tcB; this.toneCntC = tcC;
    this.toneA = outA; this.toneB = outB; this.toneC = outC;
    this.noiseCnt = nc; this.noiseSeed = seed;
    this.envCnt = ec; this.ampEnv = env; this.firstPeriod = first;
    this.sumL = sumL; this.sumR = sumR; this.sumN = sumN;
    this.sampleAcc = acc;
  }

  grow() {
    const n = new Float32Array(this.out.length * 2);
    n.set(this.out);
    this.out = n;
  }

  take() {
    const v = this.out.subarray(0, this.outLen);
    this.outLen = 0;
    return v;
  }
}
