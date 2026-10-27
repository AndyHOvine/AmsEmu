import { readFileSync, existsSync } from 'node:fs';
import { Tape } from '../../web/js/emu/tape.js';

let failed = 0, passed = 0;
function check(name, ok, info = '') {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`);
}

const adj = (p) => Math.floor((p * Math.trunc((40 << 16) / 35)) / 65536);

function bytes(n, seed) {
  const a = new Uint8Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) >>> 0; a[i] = s >>> 24; }
  return a;
}

class W {
  constructor() { this.a = []; }
  u8(...v) { for (const x of v) this.a.push(x & 255); return this; }
  u16(v) { return this.u8(v, v >> 8); }
  u24(v) { return this.u8(v, v >> 8, v >> 16); }
  u32(v) { return this.u8(v, v >> 8, v >> 16, v >>> 24); }
  str(s) { for (const c of s) this.a.push(c.charCodeAt(0)); return this; }
  data(d) { for (const x of d) this.a.push(x); return this; }
  get bytes() { return Uint8Array.from(this.a); }
}

const header = new Uint8Array([0x2c, ...bytes(256, 1), 0x12, 0x34, 0xff, 0xff, 0xff, 0xff]);
const payload = new Uint8Array([0x16, ...bytes(512, 2), 0x56, 0x78, 0xff, 0xff, 0xff, 0xff]);
const T = { pilot: 2000, sync1: 1000, sync2: 1000, zero: 1000, one: 2000, pilotCount: 4096 };
const cdt = new W()
  .str('ZXTape!\x1a').u8(1, 20)
  .u8(0x30, 5).str('hello')
  .u8(0x20).u16(3000)
  .u8(0x10).u16(1000).u16(header.length).data(header)
  .u8(0x11).u16(T.pilot).u16(T.sync1).u16(T.sync2).u16(T.zero).u16(T.one).u16(T.pilotCount)
  .u8(8).u16(500).u24(payload.length).data(payload)
  .u8(0x20).u16(700)
  .u8(0x12).u16(3000).u16(10)
  .u8(0x13).u8(2).u16(500).u16(600)
  .bytes;

function record(tape, maxT = 1e9, stepSeed = 7) {
  const edges = [];
  let t = 0, s = stepSeed, lvl = tape.level;
  while (tape.running && t < maxT) {
    s = (s * 1103515245 + 12345) >>> 0;
    const dt = 4 + ((s >>> 16) % 20);
    tape.tick(dt);
    t += dt;
    if (tape.level !== lvl) { lvl = tape.level; edges.push([t, lvl]); }
  }
  return { edges, t };
}

function decode(edges) {
  const pulses = [];
  for (let i = 1; i < edges.length; i++) pulses.push({ len: edges[i][0] - edges[i - 1][0], at: edges[i - 1][0] });
  const blocks = [];
  let i = 0;
  while (i < pulses.length) {
    let j = i;
    while (j + 1 < pulses.length && Math.abs(pulses[j + 1].len - pulses[i].len) < pulses[i].len * 0.1) j++;
    const run = j - i + 1;
    if (run < 256) { i++; continue; }
    const pilot = pulses.slice(i, j + 1).reduce((a, p) => a + p.len, 0) / run;
    let k = j + 1 + 2;
    const pairs = [];
    while (k + 1 < pulses.length && pulses[k].len < pilot * 1.5 && pulses[k + 1].len < pilot * 1.5) {
      pairs.push(pulses[k].len + pulses[k + 1].len);
      k += 2;
    }
    let lo = Infinity, hi = 0;
    for (const x of pairs) { if (x < lo) lo = x; if (x > hi) hi = x; }
    const thr = (lo + hi) / 2;
    const out = new Uint8Array(pairs.length >> 3);
    for (let b = 0; b < out.length * 8; b++) if (pairs[b] > thr) out[b >> 3] |= 0x80 >> (b & 7);
    blocks.push({
      pilot, pilotPulses: run, sync: [pulses[j + 1].len, pulses[j + 2].len], bytes: out,
      start: pulses[i].at, end: pulses[k - 1].at + pulses[k - 1].len, zeroPair: lo, onePair: hi,
    });
    i = k;
  }
  return blocks;
}

const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const near = (a, b, tol = 25) => Math.abs(a - b) <= tol;

{
  const tape = new Tape();
  tape.insert(cdt, 'synthetic.cdt');
  check('insert: present, rewound, not playing', tape.present && !tape.playing && !tape.atEnd && tape.level === 0);
  check('block list', tape.blockSummary.map((b) => b.id.toString(16)).join(',') === '20,30,20,10,11,20,12,13,20',
    tape.blockSummary.map((b) => b.id.toString(16)).join(','));
  tape.play();
  check('running needs the motor', !tape.running);
  tape.motor = true;
  check('running with play + motor', tape.running);
  const { edges, t } = record(tape);
  check('atEnd after the tape runs out; PLAY released', tape.atEnd && !tape.playing && !tape.running);
  const blocks = decode(edges);
  check('two data blocks found', blocks.length === 2, `${blocks.length}`);
  const [b1, b2] = blocks;
  check('standard block bytes recovered', b1 && eq(b1.bytes, header), b1 && `${b1.bytes.length} bytes`);
  check('standard block timings (pilot 2168, sync 667/735, bits 855/1710 at 3.5 MHz)', b1 &&
    near(b1.pilot, adj(2168), 2) && near(b1.sync[0], adj(667)) && near(b1.sync[1], adj(735)) &&
    near(b1.zeroPair, 2 * adj(855)) && near(b1.onePair, 2 * adj(1710)),
    b1 && `pilot ${b1.pilot.toFixed(0)} sync ${b1.sync} pairs ${b1.zeroPair}/${b1.onePair}`);
  check('standard header block pilot length (8063 pulses)', b1 && b1.pilotPulses >= 8060 && b1.pilotPulses <= 8063, b1 && `${b1.pilotPulses}`);
  check('turbo block bytes recovered', b2 && eq(b2.bytes, payload), b2 && `${b2.bytes.length} bytes`);
  check('turbo block timings', b2 && near(b2.pilot, adj(T.pilot), 2) && near(b2.sync[0], adj(T.sync1)) &&
    near(b2.zeroPair, 2 * adj(T.zero)) && near(b2.onePair, 2 * adj(T.one)) && b2.pilotPulses >= T.pilotCount - 2,
    b2 && `pilot ${b2.pilot.toFixed(0)} x${b2.pilotPulses}, pairs ${b2.zeroPair}/${b2.onePair}`);
  check('leading 2 s pause', near(edges[0][0], 2000 * 4000 + adj(2168), 30), `${edges[0][0]}`);
  const gap = b2.start - b1.end;
  check('1000 ms pause after the standard block', gap >= 1000 * 4000 && gap <= 1000 * 4000 + adj(T.pilot) + 50,
    `${(gap / 4000).toFixed(2)} ms`);
  const tail = t - b2.end;
  const minTail = (500 + 700 + 2000) * 4000 + 9 * adj(3000) + adj(500) + adj(600);
  check('tail timing (pauses, tone, pulses)', tail >= minTail && tail < minTail + 4 * adj(3000), `${(tail / 4000).toFixed(1)} ms`);
  const after = [];
  for (let i = 1; i < edges.length; i++) if (edges[i - 1][0] >= b2.end) after.push(edges[i][0] - edges[i - 1][0]);
  const tones = after.filter((x) => near(x, adj(3000), 25)).length;
  check('pure tone and pulse sequence play', tones >= 9 && after.some((x) => near(x, adj(500), 25)) &&
    after.some((x) => near(x, adj(600), 25)), `${tones} tone pulses`);
}

{
  const a = new Tape();
  a.insert(cdt);
  a.play(); a.motor = true;
  record(a, 4000 * 3500, 11);
  const st = JSON.parse(JSON.stringify(a.saveState()));
  const ra = record(a, 4000 * 3000, 99);
  const b = new Tape();
  b.insert(cdt);
  b.loadState(st);
  b.motor = true;
  const rb = record(b, 4000 * 3000, 99);
  check('saveState/loadState resumes identically', ra.edges.length > 1000 && JSON.stringify(ra.edges) === JSON.stringify(rb.edges),
    `${ra.edges.length} edges`);
  b.rewind();
  check('rewind returns to the start', b.block === 0 && !b.playing && b.level === 0 && !b.atEnd);
  b.eject();
  check('eject', !b.present && b.atEnd && !b.running);
}

{
  const runs = [10, 20, 30, 300, 5, 5];
  const rle = new W();
  for (const r of runs) { if (r < 256) rle.u8(r); else rle.u8(0).u32(r); }
  const v1 = new W().str('Compressed Square Wave\x1a').u8(1, 1).u16(44100).u8(1, 1, 0, 0, 0).data(rle.a).bytes;
  const v2 = new W().str('Compressed Square Wave\x1a').u8(2, 0).u32(44100).u32(runs.length).u8(1, 1, 0)
    .str('test'.padEnd(16, '\0')).data(rle.a).bytes;
  for (const [name, img] of [['CSW v1', v1], ['CSW v2', v2]]) {
    const tp = new Tape();
    tp.insert(img);
    tp.play(); tp.motor = true;
    const { edges } = record(tp);
    const got = [];
    for (let i = 1; i < edges.length; i++) got.push(edges[i][0] - edges[i - 1][0]);
    const exp = runs.slice(0, 5).map((r) => r * 4000000 / 44100);
    const ok = exp.every((e, i) => near(got[i], e, 30));
    check(`${name} pulses`, ok && tp.atEnd, got.slice(0, 5).join(','));
  }
  const z = new W().str('Compressed Square Wave\x1a').u8(2, 0).u32(44100).u32(1).u8(2, 0, 0).str(''.padEnd(16, '\0')).u8(0x78, 0x9c).bytes;
  let msg = '';
  try { new Tape().insert(z); } catch (e) { msg = e.message; }
  check('CSW Z-RLE gives a clear error', /Z-RLE/.test(msg), msg);

  const n = 2000, rate = 22050;
  const pcm = new Uint8Array(n).map((_, i) => (Math.floor(i / 50) & 1 ? 40 : 216));
  const wav = new W().str('RIFF').u32(36 + n).str('WAVE').str('fmt ').u32(16).u16(1).u16(1).u32(rate).u32(rate).u16(1).u16(8)
    .str('data').u32(n).data(pcm).bytes;
  const tw = new Tape();
  tw.insert(wav);
  tw.play(); tw.motor = true;
  const ew = record(tw).edges;
  const lens = [];
  for (let i = 1; i < ew.length; i++) lens.push(ew[i][0] - ew[i - 1][0]);
  const half = 50 * 4000000 / rate;
  check('WAV 8-bit square wave', lens.filter((x) => near(x, half, 30)).length >= 15, `${lens.length} pulses, first ${lens[0]}`);

  const d16 = new W();
  for (let i = 0; i < n; i++) { const v = Math.floor(i / 50) & 1 ? -12000 : 12000; d16.u16(v & 0xffff).u16(v & 0xffff); }
  const wav16 = new W().str('RIFF').u32(36 + n * 4).str('WAVE').str('fmt ').u32(16).u16(1).u16(2).u32(rate).u32(rate * 4).u16(4).u16(16)
    .str('data').u32(n * 4).data(d16.a).bytes;
  const t16 = new Tape();
  t16.insert(wav16);
  t16.play(); t16.motor = true;
  const e16 = record(t16).edges;
  const l16 = [];
  for (let i = 1; i < e16.length; i++) l16.push(e16[i][0] - e16[i - 1][0]);
  check('WAV 16-bit stereo square wave', l16.filter((x) => near(x, half, 30)).length >= 15, `${l16.length} pulses`);

  const vpcm = new Uint8Array(400).map((_, i) => (Math.floor(i / 20) & 1 ? 30 : 230));
  const voc = new W().str('Creative Voice File\x1a').u16(26).u16(0x010a).u16(0x1129)
    .u8(1).u24(vpcm.length + 2).u8(156, 0).data(vpcm).u8(0).bytes;
  const tv = new Tape();
  tv.insert(voc);
  tv.play(); tv.motor = true;
  const ev = record(tv).edges;
  const lv = [];
  for (let i = 1; i < ev.length; i++) lv.push(ev[i][0] - ev[i - 1][0]);
  check('VOC 8-bit', lv.filter((x) => near(x, 20 * 400, 30)).length >= 15, `${lv.length} pulses, ${lv[1]}`);

  let err = '';
  try { new Tape().insert(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), 'junk.bin'); } catch (e) { err = e.message; }
  check('unknown format throws a readable error', /Unrecognised tape image \(junk.bin\)/.test(err), err);
  err = '';
  try { new Tape().insert(cdt.slice(0, 200)); } catch (e) { err = e.message; }
  check('truncated CDT throws', /truncated/.test(err), err);
}

for (const f of ['C:/src/echo-cpc/build/echo.cdt', 'C:/src/quozimo-go-cpc/build/quozimo-go.cdt']) {
  if (!existsSync(f)) continue;
  const tape = new Tape();
  try {
    tape.insert(readFileSync(f), f);
  } catch (e) {
    check(`parse ${f}`, false, e.message);
    continue;
  }
  console.log(`\n${f}: ${tape.blocks.length} blocks`);
  for (const b of tape.blockSummary) console.log(`  0x${b.id.toString(16).padStart(2, '0')} ${b.name}${b.desc ? `: ${b.desc}` : ''}`);
  tape.play(); tape.motor = true;
  const { edges, t } = record(tape, 4000 * 600000);
  const blocks = decode(edges);
  const first = blocks[0];
  if (first && first.bytes[0] === 0x2c) {
    const fname = String.fromCharCode(...first.bytes.subarray(1, 17)).replace(/\0/g, ' ').trim();
    console.log(`  decoded ${blocks.length} data blocks; first is a header for "${fname}", type ${first.bytes[1 + 18]}, ` +
      `playing time ${(t / 4e6).toFixed(1)} s`);
  } else console.log(`  decoded ${blocks.length} data blocks, playing time ${(t / 4e6).toFixed(1)} s`);
  check(`parse and play ${f.split('/').pop()}`, tape.atEnd && blocks.length > 0);
}

console.log(`\ntape: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
