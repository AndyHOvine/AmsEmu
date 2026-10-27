import { Z80 } from '../../web/js/emu/z80.js';

let passed = 0;
let failed = 0;

const hex = (v) => (typeof v === 'number' ? '0x' + v.toString(16) : JSON.stringify(v));

function check(name, actual, expected) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.log(`FAIL ${name}: got ${hex(actual)}, expected ${hex(expected)}`);
  }
}

function machine(program, org = 0) {
  const mem = new Uint8Array(65536);
  mem.set(program, org);
  const log = [];
  const bus = {
    tstates: 0,
    vector: 0xff,
    ioValue: 0xff,
    acks: 0,
    read: (a) => mem[a],
    write: (a, v) => { mem[a] = v; },
    ioIn(port) { log.push(`in ${port.toString(16)}`); return this.ioValue; },
    ioOut(port, v) { log.push(`out ${port.toString(16)} ${v.toString(16)}`); },
    waitStates(t) { this.tstates += t; log.push(`ws ${t}`); },
    intAck() { this.acks++; log.push('ack'); },
    intVector() { return this.vector; },
  };
  const cpu = new Z80(bus);
  cpu.pc = org;
  return { cpu, mem, bus, log };
}

function run(cpu, n) {
  for (let i = 0; i < n; i++) cpu.step();
}

function alu(opcodes, a, b, f = 0) {
  const { cpu } = machine(opcodes);
  cpu.a = a; cpu.b = b; cpu.f = f;
  cpu.step();
  return cpu;
}

{
  const { cpu } = machine([]);
  cpu.a = 5; cpu.pc = 0x1234; cpu.iff1 = 1; cpu.im = 2;
  cpu.reset();
  check('reset pc', cpu.pc, 0);
  check('reset f', cpu.f, 0x40);
  check('reset ix', cpu.ix, 0xffff);
  check('reset iy', cpu.iy, 0xffff);
  check('reset a', cpu.a, 0);
  check('reset im', cpu.im, 0);
  check('reset iff1', cpu.iff1, 0);
}

{
  let c = alu([0x80], 0x0f, 0x01);
  check('ADD 0f+01 a', c.a, 0x10); check('ADD 0f+01 f', c.f, 0x10);
  c = alu([0x80], 0x7f, 0x01);
  check('ADD 7f+01 a', c.a, 0x80); check('ADD 7f+01 f (S H V)', c.f, 0x94);
  c = alu([0x80], 0xff, 0x01);
  check('ADD ff+01 a', c.a, 0x00); check('ADD ff+01 f (Z H C)', c.f, 0x51);
  c = alu([0x88], 0x10, 0x0f, 0x01);
  check('ADC 10+0f+1 a', c.a, 0x20); check('ADC 10+0f+1 f (Y H)', c.f, 0x30);
  c = alu([0x90], 0x10, 0x01);
  check('SUB 10-01 a', c.a, 0x0f); check('SUB 10-01 f (X H N)', c.f, 0x1a);
  c = alu([0x90], 0x80, 0x01);
  check('SUB 80-01 a', c.a, 0x7f); check('SUB 80-01 f (XY H V N)', c.f, 0x3e);
  c = alu([0x98], 0x00, 0x00, 0x01);
  check('SBC 00-00-1 a', c.a, 0xff); check('SBC 00-00-1 f', c.f, 0xbb);
  c = alu([0xb8], 0x10, 0x20);
  check('CP 10,20 a unchanged', c.a, 0x10); check('CP 10,20 f', c.f, 0xa3);
  c = alu([0xb8], 0x42, 0x42);
  check('CP equal f (Z N)', c.f, 0x42);
  c = alu([0x04], 0, 0x7f, 0x01);
  check('INC 7f b', c.b, 0x80); check('INC 7f f', c.f, 0x95);
  c = alu([0x05], 0, 0x01, 0x01);
  check('DEC 01 b', c.b, 0x00); check('DEC 01 f', c.f, 0x43);
  c = alu([0x05], 0, 0x80);
  check('DEC 80 b', c.b, 0x7f); check('DEC 80 f', c.f, 0x3e);
  c = alu([0xed, 0x44], 0x01, 0);
  check('NEG 01 a', c.a, 0xff); check('NEG 01 f', c.f, 0xbb);
  c = alu([0xed, 0x4c], 0x80, 0);
  check('NEG 80 a', c.a, 0x80); check('NEG 80 f (S V N C)', c.f, 0x87);
}

{
  const { cpu } = machine([0x80, 0x27, 0x90, 0x27]);
  cpu.a = 0x15; cpu.b = 0x27;
  run(cpu, 2);
  check('DAA after add a', cpu.a, 0x42); check('DAA after add f', cpu.f, 0x14);
  cpu.b = 0x15;
  run(cpu, 2);
  check('DAA after sub a', cpu.a, 0x27); check('DAA after sub f', cpu.f, 0x26);
}

{
  const { cpu } = machine([0x09, 0xed, 0x42, 0xed, 0x5a]);
  cpu.h = 0x0f; cpu.l = 0xff; cpu.b = 0x00; cpu.c = 0x01; cpu.f = 0;
  cpu.step();
  check('ADD HL,BC hl', (cpu.h << 8) | cpu.l, 0x1000); check('ADD HL,BC f (H)', cpu.f, 0x10);
  cpu.f = 0x01;
  cpu.step();
  check('SBC HL,BC hl', (cpu.h << 8) | cpu.l, 0x0ffe); check('SBC HL,BC f', cpu.f, 0x1a);
  cpu.h = 0x7f; cpu.l = 0xff; cpu.d = 0; cpu.e = 1; cpu.f = 0;
  cpu.step();
  check('ADC HL,DE hl', (cpu.h << 8) | cpu.l, 0x8000); check('ADC HL,DE f (S H V)', cpu.f, 0x94);
}

{
  let c = alu([0xcb, 0x7f], 0x80, 0);
  check('BIT 7 set f', c.f, 0x90);
  c = alu([0xcb, 0x47], 0x80, 0, 0x01);
  check('BIT 0 clear f (Z H P C)', c.f, 0x55);
  c = alu([0xcb, 0x00], 0, 0x81);
  check('RLC 81 b', c.b, 0x03); check('RLC 81 f (P C)', c.f, 0x05);
  c = alu([0xcb, 0x30], 0, 0x80);
  check('SLL 80 b', c.b, 0x01); check('SLL 80 f (C)', c.f, 0x01);
  c = alu([0xcb, 0xd8], 0, 0x00);
  check('SET 3,B', c.b, 0x08);
}

{
  const { cpu, mem } = machine([0xed, 0x6f, 0xed, 0x67]);
  cpu.h = 0x40; cpu.l = 0x00; mem[0x4000] = 0x34; cpu.a = 0x12; cpu.f = 0x01;
  cpu.step();
  check('RLD a', cpu.a, 0x13); check('RLD (hl)', mem[0x4000], 0x42); check('RLD f', cpu.f, 0x01);
  cpu.step();
  check('RRD a', cpu.a, 0x12); check('RRD (hl)', mem[0x4000], 0x34);
}

{
  const { cpu, mem, log } = machine([0xed, 0xb0]);
  mem.set([1, 2, 3, 4], 0x4000);
  cpu.h = 0x40; cpu.l = 0x00; cpu.d = 0x50; cpu.e = 0x00; cpu.b = 0; cpu.c = 4; cpu.a = 0; cpu.f = 0xc1;
  run(cpu, 4);
  check('LDIR copied', [...mem.slice(0x5000, 0x5004)].join(), '1,2,3,4');
  check('LDIR bc', (cpu.b << 8) | cpu.c, 0);
  check('LDIR hl', (cpu.h << 8) | cpu.l, 0x4004);
  check('LDIR de', (cpu.d << 8) | cpu.e, 0x5004);
  check('LDIR pc', cpu.pc, 2);
  check('LDIR f (S Z C kept, P/V clear)', cpu.f, 0xc1);
  check('LDIR timing 24/24/24/20', log.join(), 'ws 24,ws 24,ws 24,ws 20');
}
{
  const { cpu, mem, log } = machine([0xed, 0xb1]);
  mem.set([0x11, 0x22, 0x33, 0x44], 0x4000);
  cpu.h = 0x40; cpu.l = 0x00; cpu.b = 0; cpu.c = 4; cpu.a = 0x33; cpu.f = 0;
  run(cpu, 3);
  check('CPIR hl', (cpu.h << 8) | cpu.l, 0x4003);
  check('CPIR bc', (cpu.b << 8) | cpu.c, 1);
  check('CPIR pc', cpu.pc, 2);
  check('CPIR f (Z P/V N)', cpu.f, 0x46);
  check('CPIR timing 24/24/16', log.join(), 'ws 24,ws 24,ws 16');
}

{
  const prog = [
    0xdd, 0x21, 0x00, 0x40,
    0xdd, 0x7e, 0x05,
    0xdd, 0x77, 0xfe,
    0xdd, 0x86, 0x05,
    0xfd, 0x21, 0x10, 0x40,
    0xfd, 0x36, 0x01, 0x99,
    0xdd, 0x26, 0x12,
    0xdd, 0x7d,
    0xdd, 0xcb, 0x05, 0xde,
    0xdd, 0xcb, 0x06, 0x00,
    0xfd, 0xcb, 0x01, 0x7e,
  ];
  const { cpu, mem, log } = machine(prog);
  mem[0x4005] = 0x21;
  mem[0x1206] = 0x81;
  run(cpu, 4);
  check('LD IX,nn', cpu.ix, 0x4000);
  check('LD (IX-2),A', mem[0x3ffe], 0x21);
  check('ADD A,(IX+5)', cpu.a, 0x42);
  run(cpu, 2);
  check('LD (IY+1),n', mem[0x4011], 0x99);
  run(cpu, 2);
  check('LD IXH,n', cpu.ix, 0x1200);
  check('LD A,IXL', cpu.a, 0x00);
  run(cpu, 1);
  check('SET 3,(IX+5)', mem[0x1205], 0x08);
  cpu.f = 0;
  run(cpu, 1);
  check('RLC (IX+6) memory', mem[0x1206], 0x03);
  check('RLC (IX+6),B copies to B', cpu.b, 0x03);
  check('RLC (IX+6) f', cpu.f, 0x05);
  run(cpu, 1);
  check('BIT 7,(IY+1) f (S H, C kept)', cpu.f, 0x91);
  check('IX/IY timing', log.join(), 'ws 16,ws 20,ws 20,ws 20,ws 16,ws 24,ws 12,ws 8,ws 28,ws 28,ws 24');
  check('R counts prefixes (DDCB opcode excluded)', cpu.getR(), 22);
}

{
  const prog = [
    0x31, 0x00, 0x80,
    0x01, 0x34, 0x12,
    0xc5,
    0xd1,
    0xcd, 0x00, 0x01,
    0x76,
  ];
  const { cpu, mem } = machine(prog);
  mem[0x100] = 0xc9;
  run(cpu, 4);
  check('POP DE', (cpu.d << 8) | cpu.e, 0x1234);
  check('PUSH stack hi', mem[0x7fff], 0x12);
  check('PUSH stack lo', mem[0x7ffe], 0x34);
  check('SP balanced', cpu.sp, 0x8000);
  run(cpu, 1);
  check('CALL pc', cpu.pc, 0x100);
  check('CALL sp', cpu.sp, 0x7ffe);
  check('CALL return address', mem[0x7ffe] | (mem[0x7fff] << 8), 0x000b);
  run(cpu, 1);
  check('RET pc', cpu.pc, 0x000b);
  check('RET sp', cpu.sp, 0x8000);
}
{
  const prog = [0x08, 0xd9, 0xeb, 0xe3];
  const { cpu, mem } = machine(prog);
  cpu.a = 1; cpu.f = 2; cpu.a_ = 3; cpu.f_ = 4;
  cpu.b = 0x11; cpu.c = 0x22; cpu.b_ = 0x33; cpu.c_ = 0x44;
  cpu.d = 0x55; cpu.e = 0x66; cpu.h = 0x77; cpu.l = 0x88; cpu.d_ = 0x99; cpu.e_ = 0xaa; cpu.h_ = 0xbb; cpu.l_ = 0xcc;
  cpu.sp = 0x9000; mem[0x9000] = 0xef; mem[0x9001] = 0xbe;
  run(cpu, 1);
  check('EX AF,AF\'', [cpu.a, cpu.f, cpu.a_, cpu.f_].join(), '3,4,1,2');
  run(cpu, 1);
  check('EXX bc', (cpu.b << 8) | cpu.c, 0x3344);
  check('EXX de', (cpu.d << 8) | cpu.e, 0x99aa);
  check('EXX hl\'', (cpu.h_ << 8) | cpu.l_, 0x7788);
  run(cpu, 1);
  check('EX DE,HL de', (cpu.d << 8) | cpu.e, 0xbbcc);
  check('EX DE,HL hl', (cpu.h << 8) | cpu.l, 0x99aa);
  run(cpu, 1);
  check('EX (SP),HL hl', (cpu.h << 8) | cpu.l, 0xbeef);
  check('EX (SP),HL mem', mem[0x9000] | (mem[0x9001] << 8), 0x99aa);
}

{
  const { cpu, mem, bus, log } = machine([0xed, 0x5e, 0xfb, 0x00, 0x00]);
  cpu.sp = 0xc000; cpu.i = 0x80; bus.vector = 0xfe;
  mem[0x80fe] = 0x34; mem[0x80ff] = 0x12;
  cpu.intPending = 1;
  run(cpu, 1);
  check('IM 2 set', cpu.im, 2);
  check('int held while IFF1=0', cpu.intPending, 1);
  run(cpu, 1);
  check('no int straight after EI', cpu.pc, 3);
  check('IFF still 0 after EI', cpu.iff1, 0);
  run(cpu, 1);
  check('IM2 pc from vector', cpu.pc, 0x1234);
  check('IM2 pushed pc', mem[0xbffe] | (mem[0xbfff] << 8), 4);
  check('IM2 sp', cpu.sp, 0xbffe);
  check('IM2 iff cleared', cpu.iff1 + cpu.iff2, 0);
  check('IM2 intPending cleared', cpu.intPending, 0);
  check('IM2 acked once', bus.acks, 1);
  check('IM2 timing (8, 4, 4 then 28)', log.join(), 'ws 8,ws 4,ws 4,ack,ws 28');
}
{
  const { cpu, mem, log } = machine([0xed, 0x56, 0xfb, 0x76, 0x00]);
  cpu.sp = 0xc000;
  run(cpu, 3);
  check('halted', cpu.halt, 1);
  check('HALT holds pc', cpu.pc, 3);
  check('IFF set after EI', cpu.iff1, 1);
  run(cpu, 5);
  check('still halted', cpu.halt, 1);
  cpu.intPending = 1;
  run(cpu, 1);
  check('halt cleared', cpu.halt, 0);
  check('IM1 pc', cpu.pc, 0x38);
  check('IM1 return address skips HALT', mem[0xbffe] | (mem[0xbfff] << 8), 4);
  check('IM1 timing 20', log[log.length - 1], 'ws 20');
}
{
  const { cpu, log } = machine([0xed, 0x56, 0xfb, 0x00, 0x03]);
  cpu.sp = 0xc000;
  run(cpu, 3);
  cpu.intPending = 1;
  run(cpu, 1);
  check('ws-adjusted IM1 timing', log.slice(-3).join(), 'ws 8,ack,ws 16');
  check('wsAdjust reset', cpu.wsAdjust, 0);
}

{
  const { cpu } = machine([0x3e, 0xff, 0xed, 0x4f, 0x00, 0xed, 0x5f, 0xed, 0x57]);
  cpu.iff2 = 1; cpu.i = 0;
  run(cpu, 2);
  check('LD R,A', cpu.getR(), 0xff);
  check('r7', cpu.r7, 0x80);
  run(cpu, 2);
  check('LD A,R keeps bit 7, low 7 bits wrap', cpu.a, 0x82);
  check('LD A,R f (S, P/V=IFF2)', cpu.f, 0x84);
  run(cpu, 1);
  check('LD A,I f (Z, P/V=IFF2)', cpu.f, 0x44);
  cpu.setR(0x7f);
  check('setR/getR', cpu.getR(), 0x7f);
}

{
  const prog = [
    0x3e, 0x7f,
    0xd3, 0x10,
    0xdb, 0x20,
    0x01, 0x00, 0xbc,
    0xed, 0x79,
    0xed, 0x78,
  ];
  const { cpu, bus, log } = machine(prog);
  bus.ioValue = 0x5a;
  run(cpu, 6);
  check('IN A,(C)', cpu.a, 0x5a);
  check('IN A,(C) f', cpu.f, 0x0c);
  check('I/O ordering', log.join(), 'ws 8,ws 8,out 7f10 7f,ws 4,ws 12,in 7f20,ws 12,ws 12,out bc00 5a,ws 4,ws 16,in bc00');
}
{
  const { cpu, mem, log } = machine([0xed, 0xb3]);
  mem.set([0xaa, 0xbb], 0x4000);
  cpu.b = 2; cpu.c = 0x00; cpu.h = 0x40; cpu.l = 0x00;
  run(cpu, 2);
  check('OTIR', log.join(), 'ws 16,out 100 aa,ws 8,ws 16,out 0 bb,ws 4');
  check('OTIR b', cpu.b, 0);
}

{
  const prog = [
    0x00,
    0x01, 0x34, 0x12,
    0xc3, 0x07, 0x00,
    0xcd, 0x0f, 0x00,
    0xaf,
    0x20, 0x00,
    0x28, 0x00,
    0xc9,
  ];
  const { cpu, bus } = machine(prog);
  cpu.sp = 0xc000;
  const times = [];
  for (const n of [1, 1, 1, 1, 1, 1, 1, 1]) {
    const before = bus.tstates;
    run(cpu, n);
    times.push(bus.tstates - before);
  }
  check('sequence T-states', times.join(), '4,12,12,20,12,4,8,12');
  check('sequence total', bus.tstates, 84);
}
{
  const prog = [0xc0, 0xc8, 0xc4, 0x00, 0x00, 0x10, 0xfe];
  const { cpu, mem, bus } = machine(prog);
  cpu.sp = 0xc000; cpu.f = 0x40; cpu.b = 2;
  mem[0xc000] = 0x02; mem[0xc001] = 0x00;
  const times = [];
  for (let i = 0; i < 5; i++) {
    const before = bus.tstates;
    cpu.step();
    times.push(bus.tstates - before);
  }
  check('conditional T-states', times.join(), '8,16,12,16,12');
}

{
  const { cpu, bus } = machine([0x00, 0x00, 0x3c]);
  cpu.trapFlags = new Uint8Array(65536);
  cpu.trapFlags[1] = 1;
  const seen = [];
  cpu.onTrap = (pc) => {
    seen.push(pc);
    cpu.a = 0x55;
    cpu.pc = 2;
    return true;
  };
  run(cpu, 3);
  check('trap called with pc', seen.join(), '1');
  check('trap skipped instruction, then INC A ran', cpu.a, 0x56);
  check('trap step costs no time', bus.tstates, 8);
  cpu.trapFlags[3] = 1;
  cpu.onTrap = () => false;
  run(cpu, 1);
  check('declined trap executes normally', cpu.pc, 4);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
