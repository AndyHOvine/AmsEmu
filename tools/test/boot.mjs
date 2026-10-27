import { makeMachine, runSeconds, runUntilText, screenText, hasSystemCart } from './util.mjs';
import { DskImage } from '../../web/js/emu/dsk.js';
import { planAutostart } from '../../web/js/emu/autostart.js';
import { JOY } from '../../web/js/emu/cpc.js';

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) passed++;
  else {
    failed++;
    console.log(`FAIL ${name}${detail ? ': ' + detail : ''}`);
  }
}

const shows = (m, text) => screenText(m).some((l) => l.includes(text));

for (const [model, text, plusSystem] of [['464', 'BASIC 1.0'], ['664', 'BASIC 1.1'], ['6128', 'BASIC 1.1'],
  ['464plus', 'BASIC 1.1'], ['6128plus', 'BASIC 1.1'], ['gx4000', 'BASIC 1.1'],
  ['6128plus', 'f1 Amstrad BASIC', 'cartridge'], ['gx4000', 'f1 Amstrad BASIC', 'cartridge']]) {
  if (plusSystem && !hasSystemCart) continue;
  const m = makeMachine({ model, plusSystem });
  check(`${model}${plusSystem ? ' system cartridge' : ''} boots`, runUntilText(m, text, 4), screenText(m).join('|'));
}

{
  const m = makeMachine({ model: '6128' });
  m.typeText('PRINT 6*7\r');
  check('typed PRINT 6*7 shows 42', runUntilText(m, ' 42', 6), screenText(m).join('|'));
}

if (hasSystemCart) {
  const m = makeMachine({ model: '6128plus', plusSystem: 'cartridge' });
  planAutostart(m, {}, { autostart: true, type: 'PRINT 2+2\r' });
  check('Plus menu f1 then typing', runUntilText(m, ' 4', 8), screenText(m).join('|'));
}

{
  const disk = DskImage.blank('data');
  const m = makeMachine({ model: '6128' });
  m.insertDisk(disk);
  m.typeText('10 PRINT "HELLO FROM DISK"\r20 GOTO 20\rSAVE"HELLO"\r');
  runSeconds(m, 12);
  const files = disk.listFiles();
  check('SAVE wrote HELLO.BAS', files.some((f) => f.name === 'HELLO' && f.ext === 'BAS'), JSON.stringify(files));
  check('disk marked dirty', disk.dirty);

  const copy = DskImage.parse(disk.toBytes());
  const m2 = makeMachine({ model: '6128' });
  m2.insertDisk(copy);
  planAutostart(m2, { disk: copy }, {});
  check('disk autostart runs HELLO', runUntilText(m2, 'HELLO FROM DISK', 10), screenText(m2).join('|'));

  const mp = makeMachine({ model: '6128plus' });
  mp.insertDisk(copy);
  planAutostart(mp, { disk: copy }, {});
  check('6128 Plus disk autostart', runUntilText(mp, 'HELLO FROM DISK', 10), screenText(mp).join('|'));

  const m3 = makeMachine({ model: '464', fdc: true });
  m3.insertDisk(copy);
  planAutostart(m3, { disk: copy }, {});
  check('464 + DDI-1 disk autostart', runUntilText(m3, 'HELLO FROM DISK', 10), screenText(m3).join('|'));
}

if (hasSystemCart) {
  const m = makeMachine({ model: '6128plus', plusSystem: 'cartridge' });
  runSeconds(m, 2);
  m.ready = true;
  m.typeKey('F2');
  runSeconds(m, 8);
  m.setJoystick(JOY.FIRE);
  runSeconds(m, 0.2);
  m.setJoystick(0);
  runSeconds(m, 3);
  const m2 = makeMachine({ model: '6128plus', plusSystem: 'cartridge' });
  m2.loadState(structuredClone(m.saveState()));
  runSeconds(m, 1);
  runSeconds(m2, 1);
  let diff = 0;
  for (let i = 0; i < m.video.fb.length; i++) if (m.video.fb[i] !== m2.video.fb[i]) diff++;
  check('save state restores exactly', diff === 0 && m.cpu.pc === m2.cpu.pc, `${diff} pixels differ`);
  check('Plus sprites in use', m.asic.spritesOn);
}

if (!hasSystemCart) console.log('Skipped the Plus system cartridge tests: web/roms/system.cpr is not installed');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
