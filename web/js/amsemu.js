import { Cpc, MODELS, ROM_FILES, resolveModel, romsFor, autoModel } from './emu/cpc.js';
import { FB_WIDTH, FB_HEIGHT } from './emu/video.js';
import { parseCpr } from './emu/asic.js';
import { DskImage } from './emu/dsk.js';
import { expand, parseBinary } from './emu/media.js';
import { planAutostart } from './emu/autostart.js';
import { Renderer, CRT_DEFAULTS } from './host/renderer.js';
import { FILTER_DEFAULTS } from './host/crtfilter.js';
import { Audio } from './host/audio.js';
import { Input, DEFAULT_JOY_KEYS } from './host/input.js';
import { createUi } from './host/ui.js';
import { SaveStates } from './host/savestates.js';
import { hardwareColours, plusColours } from './host/palettes.js';

export const DEFAULTS = {
  romPath: 'roms/',
  romsIncluded: null,
  model: 'auto',
  plusSystem: 'cpc6128',
  ram: 'auto',
  media: {},
  autostart: true,
  autostartFile: '',
  type: '',
  warp: { auto: true },
  joystick: { keyboard: true, keys: DEFAULT_JOY_KEYS, gamepad: true, buttons: {} },
  keyboardMap: 'symbolic',
  video: { crt: true, filter: true, palette: 'ctm644', border: 'normal', aspect: 'tv', integerScale: false },
  audio: { volume: 0.7, muted: false, stereo: true },
  ui: {
    toolbar: true, settings: true, minimal: false, clickToStart: true, touchControls: 'auto',
    title: 'Amstrad CPC', allowFileDrop: true, touchKeys: ['F1', 'F2', 'F3', 'SPACE', 'RETURN', 'Y', 'N', 'ESC'],
    saveStates: true,
  },
  hotkeys: { joystickToggle: 'F9', warp: 'F10', fullscreen: 'F11', reset: '', saveState: 'Shift+F9', loadState: 'Shift+F10' },
  persist: true,
  persistShared: true,
  urlParams: true,
};

const PREF_KEYS = ['crt', 'filter', 'joyKeyMap', 'palette', 'border', 'aspect', 'integerScale', 'volume', 'muted', 'stereo', 'joyKeys', 'keyboardMap'];

const SHARED_PREF_KEYS = ['crt', 'filter', 'palette', 'border', 'aspect', 'integerScale', 'volume', 'muted', 'stereo', 'joyKeys', 'keyboardMap'];
const SHARED_PREFS_KEY = 'amsemu:shared';

function merge(base, over) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = merge(base[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

function fingerprint(bytes) {
  let h = 0x811C9DC5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0') + bytes.length.toString(16);
}

function fileName(url) {
  return decodeURIComponent(String(url).split(/[?#]/)[0].split('/').pop());
}

function touchKeyList(s) {
  return s.toLowerCase() === 'none' ? [] : s.split(',').map((k) => k.trim()).filter(Boolean);
}

export function parseAddress(v) {
  if (typeof v === 'number') return v;
  if (v === undefined || v === null || v === '') return undefined;
  const s = String(v).trim();
  const m = /^(?:&|\$|0x)([0-9a-f]+)$/i.exec(s);
  return m ? parseInt(m[1], 16) : parseInt(s, 10);
}

function urlOptions() {
  const p = new URLSearchParams(location.search);
  const o = {};
  const media = {};
  for (const k of ['disk', 'tape', 'snapshot', 'cart', 'bin', 'file']) if (p.has(k)) media[k] = p.get(k);
  if (Object.keys(media).length) o.media = media;
  if (p.has('model')) o.model = p.get('model');
  if (p.has('plussystem')) o.plusSystem = p.get('plussystem');
  if (p.has('run')) o.autostartFile = p.get('run');
  if (p.has('load')) o.load = p.get('load');
  if (p.has('exec')) o.exec = p.get('exec');
  if (p.has('ram')) o.ram = p.get('ram') === 'auto' ? 'auto' : Number(p.get('ram'));
  if (p.has('crt') || p.has('palette') || p.has('filter') || p.has('border')) {
    o.video = {};
    if (p.has('crt')) o.video.crt = p.get('crt') !== '0';
    if (p.has('filter')) o.video.filter = p.get('filter') !== '0';
    if (p.has('palette')) o.video.palette = p.get('palette');
    if (p.has('border')) o.video.border = p.get('border');
  }
  if (p.has('title') || p.has('minimal') || p.has('touchkeys')) {
    o.ui = {};
    if (p.has('title')) o.ui.title = p.get('title');
    if (p.has('minimal')) o.ui.minimal = p.get('minimal') !== '0';
    if (p.has('touchkeys')) o.ui.touchKeys = touchKeyList(p.get('touchkeys'));
  }
  if (p.has('joykeys')) o.joystick = { keyboard: p.get('joykeys') !== '0' };
  if (p.has('autostart')) o.autostart = p.get('autostart') === '0' ? false : p.get('autostart') === '1' ? true : p.get('autostart');
  return o;
}

export class AmsEmu {
  static async create(container, options = {}) {
    const a = new AmsEmu(container, options);
    await a.init();
    return a;
  }

  constructor(container, options) {
    let opts = merge(DEFAULTS, options);
    if (opts.urlParams) {
      const fromUrl = urlOptions();
      opts = merge(opts, fromUrl);
      if (fromUrl.media) opts.media = fromUrl.media;
    }
    this.opts = opts;
    this.container = container;
    this.prefsKey = 'amsemu:' + location.pathname;
    this.prefs = this.loadPrefs();
    this.paused = false;
    this.warp = false;
    this.started = false;
    this.media = { disk: null, diskB: null, tape: null, snapshot: null, cart: null, bin: null };
    this.mediaIds = new WeakMap();
    this.states = new SaveStates();
    this.quickSlot = 1;
    this.listeners = {};
  }

  isShared(key) {
    return this.opts.persistShared && SHARED_PREF_KEYS.includes(key);
  }

  loadPrefs() {
    if (!this.opts.persist) return {};
    const read = (k) => {
      try { return JSON.parse(localStorage.getItem(k)) || {}; } catch { return {}; }
    };
    const page = read(this.prefsKey), shared = read(SHARED_PREFS_KEY);
    const prefs = {};
    for (const [k, v] of Object.entries(page)) if (!this.isShared(k)) prefs[k] = v;
    for (const [k, v] of Object.entries(shared)) if (this.isShared(k)) prefs[k] = v;
    return prefs;
  }

  savePref(key, value) {
    this.prefs[key] = value;
    if (!this.opts.persist) return;
    const store = this.isShared(key) ? SHARED_PREFS_KEY : this.prefsKey;
    try {
      const saved = JSON.parse(localStorage.getItem(store)) || {};
      if (value === undefined) delete saved[key]; else saved[key] = value;
      localStorage.setItem(store, JSON.stringify(saved));
    } catch { }
  }

  pref(key, fallback) {
    return PREF_KEYS.includes(key) && this.prefs[key] !== undefined ? this.prefs[key] : fallback;
  }

  async init() {
    const o = this.opts;
    this.ui = createUi(this, this.container);
    this.ui.message('Loading…');
    this.roms = {};

    const crtPref = this.pref('crt', null);
    const videoCrt = typeof o.video.crt === 'object' ? o.video.crt : { enabled: !!o.video.crt };
    const videoFilter = typeof o.video.filter === 'object' ? o.video.filter : { enabled: !!o.video.filter };
    this.renderer = new Renderer(this.ui.canvas);
    this.renderer.configure({
      palette: this.pref('palette', o.video.palette),
      border: this.pref('border', o.video.border),
      aspect: this.pref('aspect', o.video.aspect),
      integerScale: this.pref('integerScale', o.video.integerScale),
      crt: { ...CRT_DEFAULTS, ...videoCrt, ...(crtPref || {}) },
      filter: { ...FILTER_DEFAULTS, ...videoFilter, ...(this.pref('filter', null) || {}) },
    });

    this.stereo = this.pref('stereo', o.audio.stereo);
    this.audio = new Audio();
    this.audio.setVolume(this.pref('volume', o.audio.volume));
    this.audio.setMuted(this.pref('muted', o.audio.muted));
    this.audio.onReady = (rate) => { if (this.machine) this.machine.psg.setSampleRate(rate); };

    this.input = new Input(null, {
      keyboardMap: this.pref('keyboardMap', o.keyboardMap),
      joyKeys: this.pref('joyKeys', o.joystick.keyboard),
      joyKeyMap: this.pref('joyKeyMap', o.joystick.keys),
      gamepad: o.joystick.gamepad,
      gamepadButtons: o.joystick.buttons,
    });
    this.setupHotkeys();

    try {
      await this.loadConfiguredMedia();
    } catch (e) {
      console.error(e);
      this.ui.message(String(e.message || e), 6000);
    }
    await this.boot();

    this.input.attach(window);
    this.ui.attachInput();
    this.ui.resize();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.audio.suspend(); else { this.audio.resume(); this.lastTime = 0; }
    });

    if (!o.ui.clickToStart) this.start();
    else this.ui.showStart();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  setupHotkeys() {
    const h = this.opts.hotkeys, hk = this.input.hotkeys;
    if (h.joystickToggle) hk[h.joystickToggle] = () => this.setJoystickKeys(!this.input.joyKeysEnabled);
    const minimal = this.opts.ui.minimal;
    if (h.warp && !minimal) hk[h.warp] = () => this.setWarp(!this.warp);
    if (h.fullscreen) hk[h.fullscreen] = () => this.ui.toggleFullscreen();
    if (h.reset && !minimal) hk[h.reset] = () => this.reset();
    if (this.opts.ui.saveStates) {
      if (h.saveState) hk[h.saveState] = () => this.saveState(this.quickSlot);
      if (h.loadState) hk[h.loadState] = () => this.loadState(this.quickSlot);
    }
  }

  async start() {
    if (this.started) return;
    this.started = true;
    this.ui.hideStart();
    try { await this.audio.start(); } catch (e) { console.warn(e); }
  }

  async loadConfiguredMedia() {
    const m = this.opts.media || {};
    const spec = (v) => (typeof v === 'string' ? { url: v } : v);
    if (m.file) await this.addFile(fileName(m.file), await fetchBytes(m.file));
    for (const t of ['disk', 'tape', 'snapshot', 'cart']) {
      if (m[t]) await this.addFile(fileName(spec(m[t]).url), await fetchBytes(spec(m[t]).url), t);
    }
    if (m.diskB) await this.addFile(fileName(m.diskB), await fetchBytes(m.diskB), 'diskB');
    if (m.bin) {
      const b = spec(m.bin);
      await this.addFile(fileName(b.url), await fetchBytes(b.url), 'bin', b);
    }
  }

  async addFile(name, bytes, forceType, binSpec = { load: this.opts.load, exec: this.opts.exec }) {
    const items = await expand(name, bytes);
    if (!items.length && forceType === 'bin') items.push({ name, type: 'bin', data: bytes });
    if (!items.length) throw new Error(`Unrecognised file: ${name}`);
    const added = [];
    for (const it of items) {
      let type = forceType && forceType !== 'zip' ? forceType : it.type;
      if (type === 'diskB' && it.type !== 'disk') type = it.type;
      const id = fingerprint(it.data);
      let item;
      if (type === 'disk' || type === 'diskB') item = DskImage.parse(it.data);
      else if (type === 'cart') item = { ...parseCpr(it.data), bytes: it.data };
      else if (type === 'bin') item = parseBinary(it.data, parseAddress(binSpec.load), parseAddress(binSpec.exec));
      else item = it.data;
      this.media[type] = item;
      this.mediaIds.set(item, id);
      added.push(type);
    }
    this.mediaNames = this.mediaNames || {};
    for (const t of added) this.mediaNames[t] = name;
    return added;
  }

  async loadFile(file, { run = true } = {}) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const items = await expand(file.name, bytes);
    if (!items.length) { this.ui.message(`Unrecognised file: ${file.name}`, 4000); return; }
    this.media = { disk: null, diskB: null, tape: null, snapshot: null, cart: null, bin: null };
    await this.addFile(file.name, bytes);
    if (run) {
      if (await this.boot()) this.ui.message(`Loaded ${file.name}`, 2500);
    } else {
      if (!await this.boot({ autostart: false, typeText: false })) return;
      const m = this.machine;
      if (this.media.tape) m.tape.play();
      const hint = this.media.disk ? 'type CAT or RUN"name' : this.media.tape ? 'type RUN"' :
        this.media.cart || this.media.snapshot ? 'it starts by itself' : '';
      this.ui.message(`Attached ${file.name}${hint ? ': ' + hint : ''}`, 4000);
    }
    this.start();
  }

  pickModel() {
    const want = this.modelOverride || this.opts.model;
    const model = want && want !== 'auto' ? resolveModel(want)
      : autoModel({ cartridge: !!this.media.cart, snapshot: this.media.snapshot });
    return this.media.cart && !MODELS[model].plus ? '6128plus' : model;
  }

  async ensureRoms(model, { cartridge = false, disk = false, plusSystem = this.opts.plusSystem } = {}) {
    const o = this.opts;
    const rp = o.romPath.endsWith('/') ? o.romPath : o.romPath + '/';
    for (const key of romsFor(model, { plusSystem, cartridge, disk })) {
      if (this.roms[key]) continue;
      if (o.romsIncluded && !o.romsIncluded.includes(key)) {
        throw new Error(`This package doesn't include the ROMs for the ${MODELS[model].name}`);
      }
      try {
        this.roms[key] = await fetchBytes(rp + ROM_FILES[key]);
      } catch (e) {
        if (key !== 'system') throw e;
        throw new Error('The Plus system cartridge (roms/system.cpr) is not installed');
      }
    }
  }

  modelAvailable(model) {
    const inc = this.opts.romsIncluded;
    return !inc || romsFor(model, { plusSystem: this.opts.plusSystem, cartridge: !!this.media.cart })
      .every((k) => inc.includes(k));
  }

  async boot({ autostart = true, typeText = true } = {}) {
    const o = this.opts, media = this.media;
    const model = this.pickModel();
    const ram = (this.ramOverride ?? o.ram) === 'auto' ? undefined : Number(this.ramOverride ?? o.ram);
    const fdc = MODELS[model].fdc || !!(media.disk || media.diskB);
    let m;
    try {
      await this.ensureRoms(model, { cartridge: !!media.cart, disk: fdc });
      m = new Cpc({
        roms: this.roms, model, ram, fdc, plusSystem: o.plusSystem,
        cartridge: media.cart, sampleRate: this.audio.sampleRate,
      });
    } catch (e) {
      console.error(e);
      this.ui.message(String(e.message || e), 6000);
      return false;
    }
    this.model = model;
    m.psg.stereo = this.stereo;
    if (media.disk) m.insertDisk(media.disk, 0);
    if (media.diskB) m.insertDisk(media.diskB, 1);
    if (media.tape) m.insertTape(media.tape, this.mediaNames && this.mediaNames.tape);
    this.machine = m;
    this.applyColours();
    this.input.setMachine(m);
    this.audio.clear();
    this.lastTime = 0;
    this.acc = 0;
    if (media.snapshot) {
      m.loadSna(media.snapshot);
      if (typeText && o.type) m.typeText(o.type);
    } else if (autostart) {
      this.planAutostart();
    } else if (typeText && o.type) {
      m.typeText(o.type);
    }
    this.ui.update();
    this.ui.refreshPanel();
    this.emit('boot', m);
    return true;
  }

  applyColours() {
    const p = this.renderer.palette;
    this.machine.video.setColours(hardwareColours(p), plusColours(p));
  }

  planAutostart() {
    const note = planAutostart(this.machine, this.media, this.opts);
    if (note) this.ui.message(note, 5000);
  }

  async reset() {
    if (await this.boot()) this.ui.message('Reset', 1200);
  }

  async unload() {
    const had = Object.values(this.media).some(Boolean);
    this.media = { disk: null, diskB: null, tape: null, snapshot: null, cart: null, bin: null };
    this.mediaNames = {};
    if (await this.boot({ autostart: false, typeText: false })) {
      this.ui.message(had ? 'Unloaded: starting in BASIC' : 'Nothing loaded', 2000);
    }
  }

  resetToBasic() {
    return this.boot({ autostart: false });
  }

  setModel(model) {
    this.modelOverride = resolveModel(model);
    return this.boot();
  }

  setRam(ram) {
    this.ramOverride = ram;
    return this.boot();
  }

  setStereo(on) {
    this.stereo = !!on;
    this.machine.psg.stereo = this.stereo;
    this.savePref('stereo', this.stereo);
  }

  setJoystickKeys(on) {
    this.input.setJoyKeysEnabled(!!on);
    this.savePref('joyKeys', !!on);
    this.ui.message(on ? 'Keyboard joystick ON' : 'Keyboard joystick OFF', 1500);
    this.ui.update();
  }

  setJoystickKey(dir, code, slot = 0) {
    const map = {};
    for (const [d, codes] of Object.entries(this.input.joyKeyConfig)) {
      map[d] = [].concat(codes).filter((c) => c !== code);
    }
    const pair = [].concat(this.input.joyKeyConfig[dir] || []).slice(0, 2);
    pair[slot] = code;
    map[dir] = pair.filter((c, i) => c && (c !== code || i === slot));
    this.input.setJoyKeys(map);
    this.savePref('joyKeyMap', map);
  }

  resetJoystickKeys() {
    this.input.setJoyKeys(this.opts.joystick.keys);
    this.savePref('joyKeyMap', undefined);
  }

  setWarp(on) {
    this.warp = !!on;
    this.ui.message(on ? 'Warp ON' : 'Warp OFF', 1200);
    this.ui.update();
  }

  setVideo(opts) {
    this.renderer.configure(opts);
    if (opts.palette !== undefined) this.applyColours();
    for (const k of ['palette', 'border', 'aspect', 'integerScale']) if (opts[k] !== undefined) this.savePref(k, opts[k]);
    const changed = (v) => (typeof v === 'object' ? v : { enabled: !!v });
    if (opts.crt !== undefined) this.savePref('crt', { ...(this.prefs.crt || {}), ...changed(opts.crt) });
    if (opts.filter !== undefined) this.savePref('filter', { ...(this.prefs.filter || {}), ...changed(opts.filter) });
    this.ui.update();
  }

  setVolume(v) { this.audio.setVolume(v); this.savePref('volume', this.audio.volume); }
  setMuted(m) { this.audio.setMuted(m); this.savePref('muted', !!m); this.ui.update(); }

  setKeyboardMap(map) { this.input.keyboardMap = map; this.savePref('keyboardMap', map); }

  pause(p = true) { this.paused = p; if (p) this.audio.suspend(); else { this.audio.resume(); this.lastTime = 0; } this.ui.update(); }

  typeText(text) { this.machine.typeText(text); }

  on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  emit(ev, ...args) { for (const fn of this.listeners[ev] || []) fn(...args); }

  diskImage() { return this.machine.diskImage(0); }

  gameId() {
    const m = this.media;
    const ids = [m.disk, m.diskB, m.tape, m.snapshot, m.cart, m.bin].filter(Boolean).map((x) => this.mediaIds.get(x) || 'x');
    return ids.length ? ids.join('+') : 'basic';
  }

  listStates() { return this.states.list(this.gameId()); }

  async saveState(slot) {
    try {
      const state = this.machine.saveState();
      await this.states.save(this.gameId(), slot, { time: Date.now(), thumb: this.thumbnail() }, state);
      this.quickSlot = slot;
      this.ui.message(`Saved to slot ${slot}`, 1500);
    } catch (e) {
      console.error(e);
      this.ui.message(`Could not save: ${e.message || e}`, 4000);
    }
    this.ui.refreshStates();
  }

  async loadState(slot) {
    try {
      const state = await this.states.load(this.gameId(), slot);
      if (!state) { this.ui.message(`Slot ${slot} is empty`, 1500); return false; }
      await this.restoreState(state);
      this.quickSlot = slot;
      this.ui.message(`Loaded slot ${slot}`, 1500);
      return true;
    } catch (e) {
      console.error(e);
      this.ui.message(`Could not load: ${e.message || e}`, 4000);
      return false;
    } finally {
      this.ui.refreshStates();
    }
  }

  async deleteState(slot) {
    try { await this.states.remove(this.gameId(), slot); } catch (e) { console.error(e); }
    this.ui.refreshStates();
  }

  async restoreState(state) {
    const plusSystem = state.plusSystem || 'cartridge';
    await this.ensureRoms(state.model, { cartridge: !!this.media.cart, disk: state.fdcPresent, plusSystem });
    const m = new Cpc({
      roms: this.roms, model: state.model, ram: state.ramKB, fdc: state.fdcPresent, plusSystem,
      cartridge: this.media.cart, sampleRate: this.audio.sampleRate,
    });
    m.psg.stereo = this.stereo;
    m.loadState(state);
    if (m.disks[0] && this.media.disk) {
      this.mediaIds.set(m.disks[0], this.mediaIds.get(this.media.disk));
      this.media.disk = m.disks[0];
    }
    this.model = state.model;
    this.machine = m;
    this.applyColours();
    this.input.setMachine(m);
    this.audio.clear();
    this.lastTime = 0;
    this.acc = 0;
    this.renderer.draw(m.video.fb, FB_WIDTH, FB_HEIGHT, m.video.window);
    this.ui.update();
    this.ui.refreshPanel();
    this.emit('boot', m);
  }

  thumbnail() {
    const r = this.renderer, c = r.crop, fb = this.machine.video.fb;
    const src = document.createElement('canvas');
    src.width = c.w; src.height = c.h;
    const img = src.getContext('2d').createImageData(c.w, c.h);
    const px = new Uint32Array(img.data.buffer);
    for (let y = 0; y < c.h; y++) {
      const i = (c.y + y) * FB_WIDTH + c.x;
      px.set(fb.subarray(i, i + c.w), y * c.w);
    }
    src.getContext('2d').putImageData(img, 0, 0);
    const out = document.createElement('canvas');
    out.height = 96;
    out.width = Math.round(96 * r.displayAspect);
    out.getContext('2d').drawImage(src, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  }

  loop(now) {
    requestAnimationFrame(this.loop);
    const m = this.machine;
    if (!m || this.paused || document.hidden) return;
    this.input.pollGamepads();
    if (!this.lastTime) this.lastTime = now;
    const dt = Math.min(now - this.lastTime, 100);
    this.lastTime = now;

    const frameMs = (1000 * m.cyclesPerFrame) / m.clock;
    const autoWarp = this.opts.warp.auto && (m.busy || m.typing);
    let ran = 0;
    if (this.warp || autoWarp) {
      m.psg.enabled = false;
      const t0 = performance.now();
      do { this.input.service(); m.runFrame(); ran++; } while (performance.now() - t0 < 14);
      this.acc = 0;
      this.audio.clear();
      m.psg.take();
    } else {
      m.psg.enabled = this.started && this.audio.ready;
      this.acc += dt;
      while (this.acc >= frameMs && ran < 4) {
        m.psg.setRateTrim(this.audio.trim(this.audio.sampleRate * 0.06));
        this.input.service();
        m.runFrame();
        this.acc -= frameMs;
        ran++;
      }
      if (ran === 4) this.acc = 0;
      const samples = m.psg.take();
      if (m.psg.enabled) this.audio.push(samples);
    }
    if (ran) {
      this.renderer.draw(m.video.fb, FB_WIDTH, FB_HEIGHT, m.video.window);
      this.ui.tick(autoWarp || this.warp);
    }
  }
}

export default AmsEmu;
