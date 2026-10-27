const LAYOUT = [
  ['CURUP', 0, 0], ['CURRIGHT', 0, 1], ['CURDOWN', 0, 2], ['F9', 0, 3], ['F6', 0, 4], ['F3', 0, 5], ['ENTER', 0, 6], ['F.', 0, 7],
  ['CURLEFT', 1, 0], ['COPY', 1, 1], ['F7', 1, 2], ['F8', 1, 3], ['F5', 1, 4], ['F1', 1, 5], ['F2', 1, 6], ['F0', 1, 7],
  ['CLR', 2, 0], ['[', 2, 1], ['RETURN', 2, 2], [']', 2, 3], ['F4', 2, 4], ['SHIFT', 2, 5], ['\\', 2, 6], ['CONTROL', 2, 7],
  ['^', 3, 0], ['-', 3, 1], ['@', 3, 2], ['P', 3, 3], [';', 3, 4], [':', 3, 5], ['/', 3, 6], ['.', 3, 7],
  ['0', 4, 0], ['9', 4, 1], ['O', 4, 2], ['I', 4, 3], ['L', 4, 4], ['K', 4, 5], ['M', 4, 6], [',', 4, 7],
  ['8', 5, 0], ['7', 5, 1], ['U', 5, 2], ['Y', 5, 3], ['H', 5, 4], ['J', 5, 5], ['N', 5, 6], ['SPACE', 5, 7],
  ['6', 6, 0], ['5', 6, 1], ['R', 6, 2], ['T', 6, 3], ['G', 6, 4], ['F', 6, 5], ['B', 6, 6], ['V', 6, 7],
  ['4', 7, 0], ['3', 7, 1], ['E', 7, 2], ['W', 7, 3], ['S', 7, 4], ['D', 7, 5], ['C', 7, 6], ['X', 7, 7],
  ['1', 8, 0], ['2', 8, 1], ['ESC', 8, 2], ['Q', 8, 3], ['TAB', 8, 4], ['A', 8, 5], ['CAPSLOCK', 8, 6], ['Z', 8, 7],
  ['JOY_UP', 9, 0], ['JOY_DOWN', 9, 1], ['JOY_LEFT', 9, 2], ['JOY_RIGHT', 9, 3], ['JOY_FIRE1', 9, 4], ['JOY_FIRE2', 9, 5], ['JOY_FIRE3', 9, 6], ['DEL', 9, 7],
];

export const CPC_KEYS = {};
for (const [name, line, bit] of LAYOUT) CPC_KEYS[name] = line * 8 + bit;

Object.assign(CPC_KEYS, {
  CTRL: CPC_KEYS.CONTROL, LSHIFT: CPC_KEYS.SHIFT, RSHIFT: CPC_KEYS.SHIFT,
  FDOT: CPC_KEYS['F.'],DOT: CPC_KEYS['.'], COMMA: CPC_KEYS[','],
  CAPS: CPC_KEYS.CAPSLOCK, ESCAPE: CPC_KEYS.ESC, BACKSPACE: CPC_KEYS.DEL,
  UP: CPC_KEYS.CURUP, DOWN: CPC_KEYS.CURDOWN, LEFT: CPC_KEYS.CURLEFT, RIGHT: CPC_KEYS.CURRIGHT,
});

export const CHAR_TO_KEYS = (() => {
  const m = {};
  for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    m[c.toLowerCase()] = [c, false];
    m[c] = [c, true];
  }
  for (const c of '0123456789') m[c] = [c, false];
  Object.assign(m, {
    ' ': ['SPACE', false], '\r': ['RETURN', false], '\n': ['RETURN', false],
    '!': ['1', true], '"': ['2', true], '#': ['3', true], '$': ['4', true], '%': ['5', true],
    '&': ['6', true], "'": ['7', true], '(': ['8', true], ')': ['9', true], '_': ['0', true],
    '-': ['-', false], '=': ['-', true], '^': ['^', false], '£': ['^', true],
    '@': ['@', false], '|': ['@', true], '[': ['[', false], '{': ['[', true],
    ']': [']', false], '}': [']', true], ':': [':', false], '*': [':', true],
    ';': [';', false], '+': [';', true], '\\': ['\\', false], '`': ['\\', true],
    ',': [',', false], '<': [',', true], '.': ['.', false], '>': ['.', true],
    '/': ['/', false], '?': ['/', true],
  });
  return m;
})();
