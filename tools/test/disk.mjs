import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { DskImage, hasAmsdosHeader } from '../../web/js/emu/dsk.js';
import { Fdc } from '../../web/js/emu/fdc.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e.stack.split('\n').slice(0, 3).join('\n     ')}`);
  }
}
const hex = (a) => Array.from(a, (v) => v.toString(16).padStart(2, '0')).join(' ');

function send(fdc, bytes) {
  for (const b of bytes) {
    const st = fdc.readStatus();
    assert.equal(st & 0xc0, 0x80, `FDC not ready for command byte (status ${st.toString(16)})`);
    fdc.writeData(b);
  }
}

function results(fdc) {
  const out = [];
  while ((fdc.readStatus() & 0xd0) === 0xd0) out.push(fdc.readData());
  assert.equal(fdc.readStatus(), 0x80, 'FDC should be idle after the result phase');
  return out;
}

function execRead(fdc, max = Infinity) {
  const out = [];
  while (out.length < max) {
    const st = fdc.readStatus();
    if (!(st & 0x80)) continue;
    if (!(st & 0x20)) break;
    assert.equal(st & 0x40, 0x40, 'direction should be FDC->CPU');
    out.push(fdc.readData());
  }
  return out;
}

function execWrite(fdc, data) {
  let i = 0;
  for (;;) {
    const st = fdc.readStatus();
    if (!(st & 0x80)) continue;
    if (!(st & 0x20)) break;
    assert.equal(st & 0x40, 0, 'direction should be CPU->FDC');
    fdc.writeData(data[i++]);
  }
  return i;
}

const senseInt = (fdc) => { send(fdc, [0x08]); return results(fdc); };
const rw = (code, c, r, eot, h = 0, unit = 0) => [code, unit | (h << 2), c, h, r, 2, eot, 0x2a, 0xff];

function amsdosHeader(name, ext, type, len, load, exec) {
  const h = new Uint8Array(128);
  const nm = (name.padEnd(8) + ext.padEnd(3)).toUpperCase();
  for (let i = 0; i < 11; i++) h[1 + i] = nm.charCodeAt(i);
  h[18] = type;
  h[21] = load & 0xff; h[22] = load >> 8;
  h[24] = len & 0xff; h[25] = len >> 8;
  h[26] = exec & 0xff; h[27] = exec >> 8;
  h[64] = len & 0xff; h[65] = len >> 8;
  let sum = 0;
  for (let i = 0; i < 67; i++) sum += h[i];
  h[67] = sum & 0xff; h[68] = sum >> 8;
  return h;
}

function dirEntry(user, name, ext, extent, rc, blocks, attrs = {}) {
  const e = new Uint8Array(32);
  e[0] = user;
  const nm = (name.padEnd(8) + ext.padEnd(3)).toUpperCase();
  for (let i = 0; i < 11; i++) e[1 + i] = nm.charCodeAt(i);
  if (attrs.readOnly) e[9] |= 0x80;
  if (attrs.system) e[10] |= 0x80;
  e[12] = extent;
  e[15] = rc;
  e.set(blocks, 16);
  return e;
}

function putBlock(img, fmt, block, bytes) {
  const { first, spt, off } = fmt;
  for (let k = 0; k < 2; k++) {
    const idx = block * 2 + k;
    const sec = new Uint8Array(512);
    sec.set(bytes.subarray(k * 512, Math.min(bytes.length, k * 512 + 512)));
    assert.ok(img.writeSector(off + Math.floor(idx / spt), 0, first + (idx % spt), sec));
  }
}

function writeFile(img, fmt, dirSlot, user, name, ext, content, firstBlock, attrs) {
  const nblocks = Math.ceil(content.length / 1024);
  const blocks = Array.from({ length: nblocks }, (_, i) => firstBlock + i);
  blocks.forEach((b, i) => putBlock(img, fmt, b, content.subarray(i * 1024, i * 1024 + 1024)));
  const records = Math.ceil(content.length / 128);
  const dirSecs = [];
  for (let s = 0; s < 4; s++) dirSecs.push(img.readSector(fmt.off, 0, fmt.first + s));
  for (let ext0 = 0; ext0 * 128 < Math.max(records, 1); ext0++) {
    const rc = Math.min(128, records - ext0 * 128);
    const e = dirEntry(user, name, ext, ext0, rc, blocks.slice(ext0 * 16, ext0 * 16 + 16), attrs);
    const slot = dirSlot + ext0;
    dirSecs[slot >> 4].set(e, (slot & 15) * 32);
  }
  dirSecs.forEach((d, s) => img.writeSector(fmt.off, 0, fmt.first + s, d));
}

const DATA = { first: 0xc1, spt: 9, off: 0 };
const SYSTEM = { first: 0x41, spt: 9, off: 2 };

const img = DskImage.blank('data');
const fdc = new Fdc();
fdc.insert(0, img);
const pattern = Uint8Array.from({ length: 512 }, (_, i) => (i * 7 + 3) & 0xff);

test('blank data disk shape', () => {
  assert.equal(img.tracks, 40);
  assert.equal(img.sides, 1);
  assert.equal(img.format(), 'data');
  const t0 = img.getTrack(0, 0);
  assert.deepEqual(t0.sectors.map((s) => s.r), [0xc1, 0xc6, 0xc2, 0xc7, 0xc3, 0xc8, 0xc4, 0xc9, 0xc5]);
  assert.ok(img.readSector(39, 0, 0xc9).every((v) => v === 0xe5));
  assert.equal(img.dirty, false);
  assert.deepEqual(img.listFiles(), []);
});

test('drive not ready with motor off', () => {
  send(fdc, rw(0x66, 0, 0xc1, 0xc1));
  assert.deepEqual(results(fdc), [0x48, 0, 0, 0, 0, 0xc1, 2]);
});

test('specify, recalibrate, sense interrupt status', () => {
  fdc.setMotor(1);
  assert.equal(fdc.busy, true);
  send(fdc, [0x03, 0xa1, 0x03]);
  assert.equal(fdc.readStatus(), 0x80);
  send(fdc, [0x07, 0x00]);
  assert.deepEqual(senseInt(fdc), [0x20, 0]);
  assert.deepEqual(senseInt(fdc), [0xc9, 0]);
  assert.deepEqual(senseInt(fdc), [0x80]);
});

test('seek + sense + read ID', () => {
  send(fdc, [0x0f, 0x00, 5]);
  assert.deepEqual(senseInt(fdc), [0x20, 5]);
  assert.equal(fdc.drives[0].track, 5);
  send(fdc, [0x4a, 0x00]);
  assert.deepEqual(results(fdc), [0x00, 0, 0, 5, 0, 0xc1, 2]);
  send(fdc, [0x4a, 0x00]);
  assert.deepEqual(results(fdc), [0x00, 0, 0, 5, 0, 0xc6, 2]);
});

test('sense drive status', () => {
  send(fdc, [0x04, 0x00]);
  assert.deepEqual(results(fdc), [0x20]);
  send(fdc, [0x04, 0x01]);
  assert.deepEqual(results(fdc), [0x59]);
});

test('write sector &C1 on track 0', () => {
  send(fdc, [0x0f, 0x00, 0]);
  assert.deepEqual(senseInt(fdc), [0x20, 0]);
  send(fdc, rw(0x45, 0, 0xc1, 0xc1));
  assert.equal(fdc.readStatus(), 0x10);
  assert.equal(execWrite(fdc, pattern), 512);
  assert.deepEqual(results(fdc), [0x40, 0x80, 0, 0, 0, 0xc1, 2]);
  assert.equal(img.dirty, true);
  assert.deepEqual(img.readSector(0, 0, 0xc1), pattern);
});

test('read it back', () => {
  send(fdc, rw(0x66, 0, 0xc1, 0xc1));
  const got = execRead(fdc);
  assert.equal(got.length, 512);
  assert.deepEqual(Uint8Array.from(got), pattern);
  assert.deepEqual(results(fdc), [0x40, 0x80, 0, 0, 0, 0xc1, 2]);
  assert.equal(fdc.busy, true);
});

test('multi-sector read &C1-&C3', () => {
  img.writeSector(0, 0, 0xc2, new Uint8Array(512).fill(0x22));
  img.writeSector(0, 0, 0xc3, new Uint8Array(512).fill(0x33));
  send(fdc, rw(0x66, 0, 0xc1, 0xc3));
  const got = execRead(fdc);
  assert.equal(got.length, 1536);
  assert.deepEqual(Uint8Array.from(got.slice(0, 512)), pattern);
  assert.ok(got.slice(512, 1024).every((v) => v === 0x22));
  assert.ok(got.slice(1024).every((v) => v === 0x33));
  assert.deepEqual(results(fdc), [0x40, 0x80, 0, 0, 0, 0xc3, 2]);
});

test('missing sector -> No Data', () => {
  send(fdc, rw(0x66, 0, 0xd0, 0xd0));
  assert.deepEqual(results(fdc), [0x40, 0x04, 0x00, 0, 0, 0xd0, 2]);
  send(fdc, rw(0x66, 7, 0xc1, 0xc1));
  assert.deepEqual(results(fdc), [0x40, 0x04, 0x10, 7, 0, 0xc1, 2]);
});

test('unformatted track -> Missing AM', () => {
  send(fdc, [0x0f, 0x00, 45]);
  senseInt(fdc);
  send(fdc, rw(0x66, 45, 0xc1, 0xc1));
  assert.deepEqual(results(fdc), [0x40, 0x01, 0x00, 45, 0, 0xc1, 2]);
});

test('format (write ID) track 39 with IDs 1..9', () => {
  send(fdc, [0x0f, 0x00, 39]);
  senseInt(fdc);
  send(fdc, [0x4d, 0x00, 2, 9, 0x52, 0x00]);
  const chrn = [];
  for (let r = 1; r <= 9; r++) chrn.push(39, 0, r, 2);
  assert.equal(execWrite(fdc, chrn), 36);
  assert.deepEqual(results(fdc), [0, 0, 0, 39, 0, 9, 2]);
  assert.deepEqual(img.getTrack(39, 0).sectors.map((s) => s.r), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.ok(img.readSector(39, 0, 5).every((v) => v === 0));
});

test('overrun when the CPU stops reading', () => {
  send(fdc, [0x0f, 0x00, 0]);
  senseInt(fdc);
  send(fdc, rw(0x66, 0, 0xc1, 0xc2));
  execRead(fdc, 10);
  fdc.tick(10 * 512 * 80 * 1024);
  assert.deepEqual(results(fdc), [0x40, 0x10, 0, 0, 0, 0xc1, 2]);
  fdc.tick(100000);
  assert.equal(fdc.readStatus(), 0x80);
});

test('save/load state mid-command', () => {
  send(fdc, rw(0x66, 0, 0xc1, 0xc3));
  const first = execRead(fdc, 700);
  const state = structuredClone(fdc.saveState());
  const restA = execRead(fdc);
  const resA = results(fdc);

  const fdc2 = new Fdc();
  fdc2.insert(0, DskImage.parse(img.toBytes()));
  fdc2.loadState(state);
  const restB = execRead(fdc2);
  const resB = results(fdc2);
  assert.equal(first.length + restB.length, 1536);
  assert.deepEqual(restB, restA);
  assert.deepEqual(resB, resA);
  assert.equal(fdc2.drives[0].track, 0);
  const fdc3 = new Fdc();
  fdc3.loadState(JSON.parse(JSON.stringify(state)));
  assert.ok(fdc3.command instanceof Uint8Array);
  fdc3.insert(0, img);
  assert.deepEqual(execRead(fdc3), restA);
});

test('motor off clears busy', () => {
  fdc.setMotor(0);
  assert.equal(fdc.busy, false);
  fdc.reset();
  assert.equal(fdc.readStatus(), 0x80);
});

test('toBytes/parse round trip', () => {
  const bytes = img.toBytes();
  assert.equal(String.fromCharCode(...bytes.subarray(0, 8)), 'EXTENDED');
  const back = DskImage.parse(bytes);
  assert.equal(back.tracks, img.tracks);
  assert.equal(back.dirty, false);
  for (let t = 0; t < img.tracks; t++) {
    const a = img.getTrack(t, 0);
    const b = back.getTrack(t, 0);
    assert.deepEqual(b.sectors.map((s) => [s.c, s.h, s.r, s.n, s.st1, s.st2]),
      a.sectors.map((s) => [s.c, s.h, s.r, s.n, s.st1, s.st2]));
    assert.deepEqual(b.data, a.data);
  }
  assert.deepEqual(back.toBytes(), bytes);
  assert.throws(() => DskImage.parse(new Uint8Array(512)), /Not a CPC disk image/);
  assert.throws(() => DskImage.parse(new Uint8Array(10)), /too short/);
});

test('standard DSK parse', () => {
  const trackSize = 0x100 + 9 * 512;
  const b = new Uint8Array(0x100 + 2 * trackSize);
  const put = (p, s) => { for (let i = 0; i < s.length; i++) b[p + i] = s.charCodeAt(i); };
  put(0, 'MV - CPCEMU Disk-File\r\nDisk-Info\r\n');
  b[0x30] = 2; b[0x31] = 1; b[0x32] = trackSize & 0xff; b[0x33] = trackSize >> 8;
  for (let t = 0; t < 2; t++) {
    const p = 0x100 + t * trackSize;
    put(p, 'Track-Info\r\n');
    b[p + 0x10] = t; b[p + 0x14] = 2; b[p + 0x15] = 9; b[p + 0x16] = 0x4e; b[p + 0x17] = 0xe5;
    for (let s = 0; s < 9; s++) b.set([t, 0, 0xc1 + s, 2, 0, 0], p + 0x18 + s * 8);
    b.fill(t + 1, p + 0x100, p + trackSize);
    b[p + 0x100 + 512] = 0xaa;
  }
  const d = DskImage.parse(b);
  assert.equal(d.tracks, 2);
  assert.equal(d.readSector(1, 0, 0xc2)[0], 0xaa);
  assert.equal(d.readSector(1, 0, 0xc3)[0], 2);
});

test('weak sector returns alternating copies', () => {
  const w = DskImage.blank('data');
  const tr = w.getTrack(0, 0);
  tr.sectors[0].total = 1024;
  const data = new Uint8Array(tr.data.length + 512);
  data.fill(0x11, 0, 512); data.fill(0x99, 512, 1024); data.fill(0xe5, 1024);
  tr.data = data;
  tr.sectors.forEach((s, i) => { if (i > 0) s.off += 512; });
  const again = DskImage.parse(w.toBytes());
  const f = new Fdc();
  f.insert(0, again);
  f.setMotor(1);
  const seen = [];
  for (let i = 0; i < 3; i++) {
    send(f, rw(0x66, 0, 0xc1, 0xc1));
    seen.push(execRead(f)[0]);
    results(f);
  }
  assert.deepEqual(seen, [0x99, 0x11, 0x99]);
});

test('listFiles/readFile on a hand-written data disk', () => {
  const d = DskImage.blank('data');
  const len = 20000;
  const body = Uint8Array.from({ length: len }, (_, i) => (i * 13) & 0xff);
  body.set(amsdosHeader('HELLO', 'BIN', 2, len - 128, 0x4000, 0x4000));
  writeFile(d, DATA, 0, 0, 'HELLO', 'BIN', body, 2);
  writeFile(d, DATA, 4, 3, 'notes', 'txt', new TextEncoder().encode('hi there'), 30, { readOnly: true, system: true });
  const sec = d.readSector(0, 0, 0xc1);
  sec.set(dirEntry(0xe5, 'GONE', 'BAS', 0, 1, [40]), 6 * 32);
  d.writeSector(0, 0, 0xc1, sec);
  const files = d.listFiles();
  assert.deepEqual(files, [
    { user: 0, name: 'HELLO', ext: 'BIN', size: 157 * 128, system: false, readOnly: false, hidden: false },
    { user: 3, name: 'NOTES', ext: 'TXT', size: 128, system: true, readOnly: true, hidden: true },
  ]);
  const got = d.readFile(0, 'hello', 'bin');
  assert.equal(got.length, 157 * 128);
  assert.deepEqual(got.subarray(0, len), body);
  assert.ok(hasAmsdosHeader(got));
  assert.equal(d.readFile(1, 'HELLO', 'BIN'), null);
  assert.equal(new TextDecoder().decode(d.readFile(null, 'NOTES', 'TXT').subarray(0, 8)), 'hi there');
  assert.equal(d.isCpmBoot(), false);
  assert.deepEqual(DskImage.parse(d.toBytes()).readFile(0, 'HELLO', 'BIN'), got);
});

test('system disk: directory on track 2, isCpmBoot', () => {
  const d = DskImage.blank('system');
  assert.equal(d.format(), 'system');
  assert.equal(d.isCpmBoot(), false);
  const boot = Uint8Array.from({ length: 512 }, (_, i) => i & 0xff);
  d.writeSector(0, 0, 0x41, boot);
  writeFile(d, SYSTEM, 0, 0, 'PIP', 'COM', new Uint8Array(3000).fill(0xc9), 2);
  assert.deepEqual(d.listFiles().map((f) => `${f.name}.${f.ext}`), ['PIP.COM']);
  assert.equal(d.readFile(0, 'PIP', 'COM')[2999], 0xc9);
  assert.equal(d.isCpmBoot(), true);
  writeFile(d, SYSTEM, 1, 0, 'DISC', 'BAS', new Uint8Array(200), 10);
  assert.equal(d.isCpmBoot(), false);
});

const candidates = [
  'C:/src/echo-cpc/build/echo.dsk',
  'C:/src/VIC20-MPAGD-Suite/Suite CPC/WinAPE/AGDgames.dsk',
  'C:/src/VIC20-MPAGD-Suite/Suite CPC/WinAPE/agd.dsk',
];
for (const path of candidates.filter((p) => existsSync(p))) {
  test(`real image ${path}`, () => {
    const bytes = new Uint8Array(readFileSync(path));
    const d = DskImage.parse(bytes);
    const files = d.listFiles();
    console.log(`     ${String.fromCharCode(...bytes.subarray(0, 8))}, ${d.tracks} tracks, ${d.sides} side(s), format ${d.format()}, cpmBoot ${d.isCpmBoot()}`);
    for (const f of files) {
      const data = d.readFile(f.user, f.name, f.ext);
      const hdr = data.length >= 128 && hasAmsdosHeader(data) ? ` hdr type ${data[18]} load &${hex([data[22], data[21]]).replace(' ', '')}` : '';
      console.log(`     ${f.user}:${(f.name + '.' + f.ext).padEnd(12)} ${String(f.size).padStart(6)}${f.system ? ' SYS' : ''}${f.readOnly ? ' R/O' : ''}${hdr}`);
    }
    const back = DskImage.parse(d.toBytes());
    for (const f of files) assert.deepEqual(back.readFile(f.user, f.name, f.ext), d.readFile(f.user, f.name, f.ext));
    const f = new Fdc();
    f.insert(0, d);
    f.setMotor(1);
    const first = d.getTrack(0, 0).sectors[0];
    send(f, [0x66, 0, first.c, first.h, first.r, first.n, first.r, 0x2a, 0xff]);
    assert.equal(execRead(f).length, 128 << first.n);
    assert.equal(results(f)[0], 0x40);
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
