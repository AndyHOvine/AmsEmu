export function diskCommand(disk, file = '') {
  if (file) return `RUN"${file}\r`;
  const files = disk.listFiles().filter((f) => !f.hidden && f.user === 0);
  if (!files.length && disk.isCpmBoot()) return '|CPM\r';
  const runnable = files.filter((f) => ['BAS', 'BIN', ''].includes(f.ext));
  const pick = runnable.find((f) => f.name === 'DISC') || runnable.find((f) => f.name === 'DISK') ||
    (runnable.length === 1 ? runnable[0] : null) ||
    runnable.find((f) => f.ext === 'BAS') || runnable[0];
  if (pick) return `RUN"${pick.name}${pick.ext ? '.' + pick.ext : ''}\r`;
  return disk.isCpmBoot() ? '|CPM\r' : 'CAT\r';
}

export function planAutostart(m, media, opts) {
  if (media.cart) return '';
  const auto = opts.autostart ?? true;
  if (m.plusMenu && (auto !== false || opts.type)) {
    m.typeKey('F1');
    m.typeWait(60);
  }
  let note = '';
  if (auto === false) {
  } else if (typeof auto === 'string') {
    if (media.tape) m.tape.play();
    m.typeText(auto);
  } else if (media.bin) {
    const bin = media.bin;
    if (bin.type === 2) {
      m.onReady(() => {
        for (let i = 0; i < bin.data.length; i++) m.poke((bin.load + i) & 0xFFFF, bin.data[i]);
      });
      m.typeText(`CALL &${bin.exec.toString(16).toUpperCase()}\r`);
    } else {
      note = 'BASIC programs need a disk or tape image';
    }
  } else if (media.disk) {
    m.typeText(diskCommand(media.disk, opts.autostartFile));
  } else if (media.tape) {
    m.tape.play();
    if (m.fdc) m.typeText('|TAPE\r');
    m.typeText('RUN"\r');
    m.typeWait(25);
    m.typeText(' ');
  }
  if (opts.type) m.typeText(opts.type);
  return note;
}
