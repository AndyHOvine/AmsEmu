import { Psg } from '../../web/js/emu/psg.js';

const CPU = 4000000;
let failed = 0, passed = 0;
function check(name, ok, info = '') {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`);
}

function run(psg, seconds, startCycle) {
  const parts = [];
  let total = 0;
  let c = startCycle;
  const end = startCycle + Math.round(seconds * CPU);
  let k = 0;
  while (c < end) {
    c = Math.min(end, c + 997 + ((k++ * 7919) % 5000));
    psg.update(c);
    const s = psg.take();
    parts.push(s.slice());
    total += s.length;
  }
  const out = new Float32Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return { out, cycle: end };
}

const left = (s) => s.filter((_, i) => (i & 1) === 0);
const right = (s) => s.filter((_, i) => (i & 1) === 1);
const rms = (a) => Math.sqrt(a.reduce((x, v) => x + v * v, 0) / a.length);
const maxAbs = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

function risingCrossings(a, h = 0.01) {
  let n = 0, state = a[0] > 0;
  for (const v of a) {
    if (!state && v > h) { state = true; n++; } else if (state && v < -h) state = false;
  }
  return n;
}

function setup(regs, rate = 48000) {
  const p = new Psg(rate);
  for (const [r, v] of Object.entries(regs)) p.writeReg(+r, v, 0);
  return p;
}

{
  const period = 284;
  const p = setup({ 0: period & 255, 1: period >> 8, 7: 0x3e, 8: 15 });
  let { cycle } = run(p, 0.2, 0);
  const { out } = run(p, 1, cycle);
  const f = risingCrossings(left(out));
  const expect = 1000000 / (16 * period);
  check('tone A frequency', Math.abs(f - expect) <= 2, `${f} Hz, expected ${expect.toFixed(2)}`);
  const L = rms(left(out)), R = rms(right(out));
  check('stereo: A is in the left channel', L > 0.1 && R < 0.1 * L, `L rms ${L.toFixed(4)}, R rms ${R.toFixed(4)}`);
}

{
  const p = setup({ 4: 100, 7: 0x3b, 10: 15 });
  const { out } = run(p, 0.5, 0);
  const L = rms(left(out)), R = rms(right(out));
  check('stereo: C is in the right channel', R > 0.1 && L < 0.1 * R, `L ${L.toFixed(4)}, R ${R.toFixed(4)}`);
  const q = setup({ 2: 100, 7: 0x3d, 9: 15 });
  const o2 = run(q, 0.5, 0).out;
  const bl = rms(left(o2)), br = rms(right(o2));
  check('stereo: B is centred', Math.abs(bl - br) < 1e-6 && bl > 0.05, `L ${bl.toFixed(4)}, R ${br.toFixed(4)}`);
}

{
  const p = setup({ 0: 200, 7: 0x3e, 8: 15 });
  p.stereo = false;
  const { out } = run(p, 0.5, 0);
  let same = true;
  for (let i = 0; i < out.length; i += 2) if (out[i] !== out[i + 1]) { same = false; break; }
  check('mono: L equals R', same && rms(left(out)) > 0.05, `rms ${rms(left(out)).toFixed(4)}`);
}

{
  const p = setup({ 6: 16, 7: 0x37, 8: 15 });
  const { out } = run(p, 1, 0);
  const a = left(out).slice(9600);
  const mean = a.reduce((x, v) => x + v, 0) / a.length;
  const x = a.map((v) => v - mean);
  const e0 = x.reduce((s, v) => s + v * v, 0);
  let worst = 0, worstLag = 0;
  for (let lag = 20; lag <= 4000; lag += 1) {
    let s = 0;
    for (let i = 0; i + lag < x.length; i++) s += x[i] * x[i + lag];
    const r = Math.abs(s / e0);
    if (r > worst) { worst = r; worstLag = lag; }
  }
  check('noise: no periodicity (autocorrelation, lags 20..4000)', worst < 0.2 && e0 > 0,
    `max |r| ${worst.toFixed(3)} at lag ${worstLag}`);
  const runs = new Set();
  let last = 0;
  for (let i = 1; i < x.length; i++) if ((x[i] > 0) !== (x[i - 1] > 0)) { runs.add(i - last); last = i; }
  check('noise: varied run lengths', runs.size > 10, `${runs.size} distinct`);
}

for (const [shape, mult, name] of [[0x08, 256, 'sawtooth 0x08'], [0x0e, 512, 'triangle 0x0E'],
  [0x0c, 256, 'sawtooth 0x0C'], [0x0a, 512, 'triangle 0x0A']]) {
  const E = 20;
  const p = setup({ 7: 0x3f, 8: 0x10, 11: E, 12: 0, 13: shape });
  const { cycle } = run(p, 0.2, 0);
  const { out } = run(p, 1, cycle);
  const f = risingCrossings(left(out), 0.02);
  const expect = 1000000 / (mult * E);
  check(`envelope ${name} rate`, Math.abs(f - expect) <= 2, `${f} Hz, expected ${expect.toFixed(2)}`);
}

{
  const E = 10;
  const p = setup({ 7: 0x3f, 8: 0x10, 11: E, 13: 0x00 });
  p.update(32 * E * 32 * 31 / 32 - 64);
  const mid = p.ampEnv;
  p.update(32 * E * 32 + 64);
  check('envelope 0x00 decays then holds at 0', mid > 0 && p.ampEnv === 0 && !p.firstPeriod, `mid ${mid}`);
  p.writeReg(13, 0x00, 32 * E * 32 + 64);
  p.update(32 * E * 32 + 64 + 32);
  check('reg 13 write restarts the envelope', p.ampEnv === 31, `env ${p.ampEnv}`);
}

{
  const p = setup({ 0: 100, 6: 5, 7: 0x3f, 8: 15, 9: 15, 10: 15 });
  const { out } = run(p, 1, 0);
  const tail = out.slice(out.length - 4800);
  check('mixer disabled: output settles to 0', maxAbs(tail) < 1e-4, `max ${maxAbs(tail).toExponential(2)}`);
  check('all channels full DC step stays within -1..1', maxAbs(out) <= 1 && maxAbs(out) > 0.5, `peak ${maxAbs(out).toFixed(3)}`);
  const q = setup({ 0: 100, 7: 0x3e, 8: 0 });
  check('volume 0 is silent', maxAbs(run(q, 0.2, 0).out) === 0);
}

{
  const p = setup({ 0: 140, 2: 141, 4: 142, 7: 0x38, 8: 15, 9: 15, 10: 15 });
  const { out } = run(p, 1, 0);
  check('three channels full volume within -1..1', maxAbs(out) < 0.99, `peak ${maxAbs(out).toFixed(3)}`);
}

{
  const p = setup({ 0: 50, 7: 0x3e, 8: 15 });
  let { cycle } = run(p, 0.3, 0);
  p.writeReg(8, 0, cycle);
  const { out } = run(p, 0.6, cycle);
  const tail = out.slice(out.length - 4800);
  check('silence settles to 0', maxAbs(tail) < 1e-4, `max ${maxAbs(tail).toExponential(2)}`);
}

{
  const p = new Psg();
  p.writeReg(1, 0xff, 0); p.writeReg(6, 0xff, 0); p.writeReg(8, 0xff, 0); p.writeReg(13, 0xff, 0);
  p.writeReg(7, 0xff, 0); p.writeReg(14, 0xab, 0);
  check('register masks', p.readReg(1) === 15 && p.readReg(6) === 31 && p.readReg(8) === 31 &&
    p.readReg(13) === 15 && p.readReg(7) === 0xff && p.readReg(14) === 0xab);
}

for (const rate of [48000, 44100, 22050]) {
  const p = setup({ 0: 100, 7: 0x3e, 8: 15 }, rate);
  const { out } = run(p, 1, 0);
  const n = out.length / 2;
  check(`sample count at ${rate} Hz`, Math.abs(n - rate) / rate < 0.005, `${n}`);
}

{
  const p = setup({ 0: 100, 7: 0x3e, 8: 15 });
  p.setRateTrim(1.01);
  const n = run(p, 1, 0).out.length / 2;
  check('rate trim 1.01 gives ~1% fewer samples', Math.abs(n - 48000 / 1.01) < 50, `${n}`);
  const q = setup({ 0: 100, 7: 0x3e, 8: 15 });
  q.enabled = false;
  q.update(CPU);
  check('disabled: no samples, time advances', q.take().length === 0 && q.lastCycle === CPU);
}

{
  const p = setup({ 0: 100, 2: 101, 4: 102, 6: 3, 7: 0x30, 8: 15, 9: 0x10, 10: 12, 11: 30, 13: 14 });
  const t0 = performance.now();
  run(p, 5, 0);
  const ms = (performance.now() - t0) / 5;
  console.log(`info: ${ms.toFixed(1)} ms per emulated second`);
}

console.log(`\npsg: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
