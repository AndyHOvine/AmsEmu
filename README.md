# AmsEmu

An Amstrad CPC emulator in plain JavaScript for the web browser, made for
publishing CPC games on itch.io. The published game has no dependencies and
needs no server code: it is a folder of static files.

- CPC 464, 664 and 6128, and the Plus range: 464 Plus, 6128 Plus and GX4000
- Z80 with the CPC's exact wait-state timing, CRTC and Gate Array, AY-3-8912
  sound in stereo, ported from Caprice32 (the Z80 matches Caprice32's on
  46 million test instructions)
- Plus features: hardware sprites, 4096-colour palette, soft scrolling, split
  screen, raster interrupts, DMA sound, cartridges (`.cpr`)
- Disks (`.dsk`, standard and extended, read and write, drives A and B; a 464
  gets a DDI-1 disk interface), tapes (`.cdt`, `.tzx`, `.csw`, `.voc`, `.wav`),
  snapshots (`.sna`), binaries (`.bin`), ZIP files
- Starts games by itself: `RUN"name` for disks, `RUN"` for tapes, `|CPM` for
  CP/M boot disks, cartridges boot as they would
- CRT emulation and CRT filter (bulge, rounded corners, scanlines, RGB mask, tint)
- CTM644 colour monitor, ideal-level, GT65 green screen and grey palettes
- Keyboard joystick (switch with F9), gamepads, touch controls on phones
- Save states: four save and load slots per game, kept in the player's browser

---

## 1. Set up

1. Install **Node.js 18 or newer** from https://nodejs.org/ (the LTS version is fine).
   Check it in a terminal:
   ```
   node --version
   ```
2. Open a terminal in the project folder (the one with `run.bat` in it).
3. Linux and macOS only, once: make the scripts runnable.
   ```
   chmod +x run.sh build.sh
   ```

Nothing else needs installing.

---

## 2. Running

Start AmsEmu in your browser:

| | Windows | Linux / macOS |
| --- | --- | --- |
| Boot into BASIC | `run.bat` | `./run.sh` |
| Load a game | `run.bat C:\games\mygame.dsk` | `./run.sh ~/games/mygame.dsk` |
| Load with settings | `run.bat mygame.cdt model=464 crt=0` | `./run.sh mygame.cdt model=464 crt=0` |

The game file can be anywhere on your disk: DSK, CDT, TZX, CSW, VOC, WAV, SNA,
CPR, BIN or a ZIP. Its type is worked out from its contents. The browser
opens on its own; press **Ctrl+C** in the terminal to stop.

Settings you can add after the file:

| Setting | Example | Meaning |
| --- | --- | --- |
| `model` | `model=464` | `464`, `664`, `6128`, `464plus`, `6128plus`, `gx4000` or `auto` |
| `ram` | `ram=576` | RAM in KB: `64`, `128` ... `576`, or `auto` |
| `plussystem` | `plussystem=cartridge` | what a Plus runs without a game cartridge: `cpc6128` or `cartridge` (see *A Plus without a cartridge*) |
| `run` | `run=GAME` | the disk program to `RUN"` |
| `load`, `exec` | `load=&4000` | addresses for a `.bin` without an AMSDOS header |
| `joykeys` | `joykeys=0` | keyboard joystick on (`1`) or off (`0`) at start |
| `crt` / `filter` | `crt=0 filter=0` | CRT emulation / CRT filter on or off |
| `palette` | `palette=gt65` | `ctm644`, `cpc`, `gt65` (green screen), `grey` |
| `border` | `border=none` | `normal`, `full`, `tight` or `none` (see *All config options*) |
| `autostart` | `autostart=0` | `1`, `0`, or text to type |
| `title` | `title="My Game"` | name on the start screen |
| `minimal` | `minimal=1` | minimal toolbar (see below) |
| `touchkeys` | `touchkeys=F1,SPACE,Y,N` | CPC keys shown as buttons on phones and tablets, or `none` (see *On-screen keys*) |

You can also drag a file onto the emulator, or use the folder button in the
toolbar. Hold **Shift** while clicking the folder button (or while dropping a
file) to attach it without running it: AmsEmu stops at `Ready` with the disk
in the drive or the tape inserted (PLAY already pressed), so you can type
`CAT`, `RUN"` or `|CPM` yourself. Cartridges and snapshots always start by
themselves.

**Save and load.** The floppy disk button in the toolbar opens four save slots. The
game pauses while they are open; each slot shows a picture of the screen and when it
was saved. **Shift+F9** saves and **Shift+F10** loads the last slot used, without
opening the slots. Saves are kept in the browser (IndexedDB), separately for each
game: a game is recognised by the contents of its files, so it keeps its slots after
an update only if the files are unchanged. A save holds the whole machine, including
the disks' contents and the tape position.

To run the tests: `npm test`.

---

## 3. Building

Building makes a folder and a ZIP in `dist/`, ready to upload.

| What | Windows | Linux / macOS |
| --- | --- | --- |
| Package as set up in `web/config.js` | `build.bat` | `./build.sh` |
| Package one game file | `build.bat C:\games\mygame.dsk title="My Game"` | `./build.sh ~/games/mygame.dsk title="My Game"` |
| Choose the package name | `build.bat mygame.dsk --name mygame` | `./build.sh mygame.dsk --name mygame` |
| ROMs for every model | add `--all-roms` | add `--all-roms` |

Examples:

```
build.bat
build.bat C:\games\mygame.dsk title="My Game" model=6128
./build.sh ~/games/mygame.cdt model=464 joykeys=1
./build.sh ~/games/mygame.bin load=&4000 exec=&4000
```

The result is `dist/<name>/` and `dist/<name>-itch.zip`. When you give a game file,
it is copied into the package and set up to start automatically; the settings are the
same as for running. Without a file, the package uses `web/config.js` and whatever
you put in `web/games/`, with any settings you give applied on top. A file in
`web/games/` is only loaded if `web/config.js` names it in `media` (the build
warns if it doesn't).

**ROMs in the package.** A package only holds the ROMs its game needs: the
model's firmware (`cpc464.rom`, `cpc664.rom` or `cpc6128.rom`) and, with a disk
drive, `amsdos.rom`. A cartridge game needs none. The build prints which ROMs it
included. Players can only pick models in the settings panel whose ROMs are in the
package; `--all-roms` includes them all, so every model is offered.

To try a built package before uploading:

```
node tools/serve.mjs --root dist/mygame --open
```

---

## 4. Setting up a game

For a quick package, `build.bat mygame.dsk title="My Game"` is enough. For full
control, put your game files in `web/games/` and edit `web/config.js`. Then
`run.bat` shows it and `build.bat` packages it.

The [`examples/`](examples/README.md) folder has each config below as a file
ready to copy over `web/config.js`, plus one with every option.

Paths in the config are relative to `index.html`, so they all start with `games/`.

### A disk game

```js
export default {
  ui: { title: 'Space Blaster' },
  model: '6128',
  media: { disk: 'games/spaceblaster.dsk' },
};
```

AmsEmu types `RUN"` and the program to run: `DISC` if there is one, otherwise
the only program on the disk, otherwise the first BASIC program. A CP/M boot
disk gets `|CPM`. To run a particular program, add `autostartFile: 'BLASTER'`.
On a 464, a disk adds the DDI-1 disk interface.

### A tape game on a 464

```js
export default {
  ui: { title: 'Cave Run' },
  model: '464',
  media: { tape: 'games/caverun.cdt' },
};
```

The tape loads with `RUN"` and plays at full speed while its motor runs (a
turbo loader takes a few seconds instead of minutes). On machines with a disk
drive, `|TAPE` is typed first.

### A Plus or GX4000 cartridge

```js
export default {
  ui: { title: 'Mega Racer' },
  model: 'gx4000',
  media: { cart: 'games/megaracer.cpr' },
};
```

### A Plus without a cartridge

The real 464 Plus and 6128 Plus keep their firmware, BASIC and AMSDOS on a
cartridge. Amstrad's system cartridge also holds Ocean's Burnin' Rubber, whose
status is unclear: Amstrad's permission to distribute its ROMs doesn't cover it.
So AmsEmu doesn't include the system cartridge, and a Plus without a game
cartridge runs a cartridge AmsEmu builds from
the 6128's ROMs: it starts straight in BASIC 1.1, and programs can still unlock
and use every Plus feature. On the 464 Plus and GX4000, which have no disk drive,
AMSDOS is left out so that tapes load.

For the genuine article, with its menu (f1 BASIC, f2 Burnin' Rubber) and
firmware version 4, add the system cartridge yourself:

1. Copy `system.cpr` into `web/roms/`. Caprice32 includes it, in its
   [`rom` folder](https://github.com/ColinPitrat/caprice32/tree/master/rom).
2. Set `plusSystem: 'cartridge'` (or `plussystem=cartridge` when building).

AmsEmu then presses f1 at the menu before loading a disk or tape, and the package
includes `system.cpr`. Without the file, the emulator and the build say it is
missing, and the tests skip the system cartridge.

### A machine code program

```js
export default {
  ui: { title: 'Maze' },
  media: { bin: { url: 'games/maze.bin', load: '&4000', exec: '&4000' } },
};
```

A `.bin` with an AMSDOS header carries its own addresses; `media: { bin: 'games/maze.bin' }`
is then enough. The program is put in memory once BASIC is ready and started with `CALL`.

### A snapshot

```js
export default {
  media: { snapshot: 'games/maze.sna' },
};
```

The model comes from the snapshot (version 2 and later) unless you set `model`.

### A game with its own keys and a custom start command

```js
export default {
  ui: { title: 'Racer' },
  model: '6128',
  media: { disk: 'games/racer.dsk' },
  autostart: 'RUN"RACER\r',   // \r is RETURN
  joystick: {
    keyboard: true,
    // A primary and a secondary key for each direction
    keys: {
      up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'],
      left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
      fire: ['Space', 'KeyJ'], fire2: ['KeyK'],
    },
  },
};
```

Key names are browser key codes: `KeyA`–`KeyZ`, `Digit0`–`Digit9`, `ArrowUp`,
`Space`, `ShiftLeft`, `ControlRight` and so on. Give one key, or a list: the first
is the primary key and the second the secondary key that players see in the
settings panel (any more also work). The CPC joystick has two fire buttons;
most games only use the first.

### A locked-down page for players

```js
export default {
  ui: { title: 'Space Blaster', minimal: true },  // pause, joystick, save states, CRT, sound, fullscreen
  media: { disk: 'games/spaceblaster.dsk' },
  video: { crt: true, filter: true },
};
```

The minimal view keeps pause, the keyboard joystick switch, save states, the CRT
on/off button, sound and fullscreen. It hides reset, warp, load, unload and settings,
and turns their hotkeys and drag-and-drop off.

### On-screen keys for phones and tablets

On touch screens, AmsEmu shows a joystick, a fire button and a row of CPC
keys. Choose the keys your game needs with `ui.touchKeys`:

```js
export default {
  ui: {
    title: 'Space Blaster',
    touchKeys: [
      'F1', 'SPACE', 'Y', 'N',                     // CPC key names
      { key: 'F3', label: 'MUSIC' },              // your own label on the button
      { keys: ['SHIFT', 'CLR'], label: 'QUIT' },  // keys pressed together
    ],
  },
  media: { disk: 'games/spaceblaster.dsk' },
};
```

With the build: `build.bat mygame.dsk touchkeys=F1,SPACE,Y,N`. Use `touchKeys: []`
(or `touchkeys=none`) for no keys, only the joystick and fire button. Set
`ui.touchControls: true` to show them on computers too, which helps when trying
the layout.

Key names: `A`–`Z`, `0`–`9`, `F0`–`F9` and `F.` (the numeric keypad), `SPACE`,
`RETURN`, `ENTER`, `ESC`, `TAB`, `CAPSLOCK`, `SHIFT`, `CONTROL` (or `CTRL`),
`COPY`, `CLR`, `DEL`, `CURUP`, `CURDOWN`, `CURLEFT`, `CURRIGHT`, `JOY_FIRE1`,
`JOY_FIRE2`, and `- ^ @ [ ] ; : \ , . /`. A name the emulator does not know is
left out, with a warning in the browser console (the build stops on one).

### Plain pixels, no CRT

```js
export default {
  media: { disk: 'games/maze.dsk' },
  video: { crt: false, filter: false, integerScale: true, aspect: 'square' },
};
```

### No border

```js
export default {
  media: { disk: 'games/spaceblaster.dsk' },
  video: { border: 'none' },
};
```

The picture is cropped to the game's display area, wherever the game puts it and
however big it makes it (overscan included), and follows it if the game changes it.
Anything a game draws in the border (colour bars) is cut off.

---

## 5. Publishing on itch.io

1. **Build the package.**
   ```
   build.bat C:\games\mygame.dsk title="My Game"
   ```
   or, if you set the game up in `web/config.js`:
   ```
   build.bat --name mygame
   ```
   You get `dist\mygame-itch.zip`.
2. **Check it** (optional but worth it):
   ```
   node tools/serve.mjs --root dist/mygame --open
   ```
3. **Create the project** on https://itch.io/game/new:
   - **Kind of project**: **HTML**.
   - **Uploads**: upload the ZIP and tick **This file will be played in the browser**.
4. **Embed options** (further down the same page):
   - **Viewport dimensions**: **960 × 776** fits the picture plus the toolbar
     (any size works; the picture scales to fit).
   - Tick **Fullscreen button**.
   - Tick **Mobile friendly** if you want phone players; touch controls appear on their own.
   - Leave **SharedArrayBuffer support** off; AmsEmu doesn't need it.
5. **Save** and use **View page** to try it. Players click *Click to start*; this is
   needed for sound and keyboard focus.

To update the game later, build again and replace the ZIP on the same itch.io page.

**What players' browsers remember.** When a player turns the CRT or the keyboard
joystick on or off, changes display settings, volume, stereo or keyboard mapping,
AmsEmu remembers it. itch.io serves every HTML game from the same address, so
these choices follow the player to your other AmsEmu games too. A player's choice
overrides your config, but only for the settings they actually changed. Joystick
key bindings are remembered per game. Set `persistShared: false` to keep a game's
choices to itself, or `persist: false` to remember nothing. Private windows forget
everything when closed. Save states are kept per game whatever these settings are;
`ui.saveStates: false` turns them off.

---

## Reference

### All config options

| Option | Values | Default |
| --- | --- | --- |
| `model` | `'auto'`, `'464'`, `'664'`, `'6128'`, `'464plus'`, `'6128plus'`, `'gx4000'` | `'auto'` (a 6128; a 6128 Plus for cartridges; the snapshot's model) |
| `ram` | `'auto'`, or KB: `64`, `128`, `192` ... `576` | `'auto'` (64, or 128 on the 6128 and 6128 Plus) |
| `plusSystem` | what a Plus runs without a game cartridge: `'cpc6128'` (the 6128 firmware) or `'cartridge'` (Amstrad's system cartridge, which you add yourself) | `'cpc6128'` |
| `media.disk`, `media.diskB` | URL of a `.dsk` (or `.zip`) for drive A or B | |
| `media.tape` | URL of a `.cdt`, `.tzx`, `.csw`, `.voc` or `.wav` | |
| `media.snapshot` | URL of a `.sna` | |
| `media.cart` | URL of a `.cpr` | |
| `media.bin` | URL of a `.bin`, or `{ url, load, exec }` for one without an AMSDOS header | |
| `media.file` | URL of any supported file; the type is detected | |
| `autostart` | `true`, `false`, or text to type, e.g. `'RUN"GAME\r'` | `true` |
| `autostartFile` | disk program to `RUN"` | `''` (picked from the disk) |
| `type` | extra text typed once BASIC is ready, after autostart | `''` |
| `warp.auto` | full speed while the tape or disk is busy, and while typing | `true` |
| `joystick.keyboard` | start with the keyboard joystick on | `true` |
| `joystick.keys` | `{ up, down, left, right, fire, fire2 }`: one key code or a list per direction (first = primary, second = secondary) | cursor keys and numpad; fire = Left Ctrl, Right Ctrl, Numpad 0; fire 2 = Right Alt, Numpad . |
| `joystick.buttons` | gamepad button to CPC key, e.g. `{ 9: 'F1', 8: 'SPACE' }` | `{}` |
| `keyboardMap` | `'symbolic'` or `'positional'` | `'symbolic'` |
| `video.crt` | `true`, `false`, or CRT emulation settings | `true` |
| `video.filter` | `true`, `false`, or CRT filter settings | `true` |
| `video.palette` | `'ctm644'`, `'cpc'`, `'gt65'`, `'grey'` | `'ctm644'` |
| `video.border` | `'normal'`, `'full'`, `'tight'` (a thin border), `'none'` (only the game's display area, following its size and position) | `'normal'` |
| `video.aspect` | `'tv'` (the monitor's shape) or `'square'` (square mode 1 pixels) | `'tv'` |
| `video.integerScale` | `true`, `false` | `false` |
| `audio.volume` | 0 to 1 | `0.7` |
| `audio.stereo` | `true` (A left, B centre, C right) or `false` (mono, like the built-in speaker) | `true` |
| `ui.title` | name on the start screen and toolbar | `'Amstrad CPC'` |
| `ui.minimal` | minimal toolbar: pause, keyboard joystick, save states, CRT, sound, fullscreen only | `false` |
| `ui.saveStates` | the save and load slots and their hotkeys | `true` |
| `ui.toolbar`, `ui.settings` | show the toolbar / the settings panel | `true` |
| `ui.clickToStart` | show the start screen (needed for sound) | `true` |
| `ui.touchControls` | `'auto'`, `true`, `false` | `'auto'` |
| `ui.touchKeys` | CPC keys shown as touch buttons: key names, `{ key, label }` or `{ keys: [...], label }` (see *On-screen keys*) | f1 f2 f3 SPACE RETURN Y N ESC |
| `ui.allowFileDrop` | let players load their own files | `true` |
| `hotkeys` | `{ joystickToggle: 'F9', warp: 'F10', fullscreen: 'F11', reset: '', saveState: 'Shift+F9', loadState: 'Shift+F10' }`. A key code, optionally after `Shift+`; `''` turns a hotkey off | |
| `persist` | remember each player's choices in their browser | `true` |
| `persistShared` | share those choices with every page that uses AmsEmu on the same site (on itch.io: all AmsEmu games) | `true` |
| `urlParams` | allow `?disk=` style overrides in the page address | `true` |
| `romPath` | folder of the ROM files | `'roms/'` |
| `romsIncluded` | ROM files in the package; written by the build | `null` (all) |

**CRT emulation settings** (`video.crt`) and defaults: `blur` 100, `scanlineShade` 800,
`saturation`, `contrast`, `brightness`, `tint` 1000 (neutral), `gamma` 2200,
`oddLinesPhase` and `oddLinesOffset` 1125.

**CRT filter settings** (`video.filter`) and defaults: `scale` 1, `everyNLines` 4,
`linesDarkened` 3, `darkness` 10, `direction` `'rows'` (or `'columns'`), `bulge` 8,
`corners` 17, `cornerDot` 2, `bleed` 12, `glow` 5, `mask` 3, `maskShape` `'dots'`
(or `'stripes'`, `'stripes-gaps'`, `'slots'`), `maskWidth` 3, `tintColor` `'#ffb000'`,
`tint` 6, `roll` -1, `rollingBar` 0. Percentages are 0–100.

**Page address overrides** (handy while testing):
`index.html?disk=games/x.dsk&model=464&run=GAME&crt=0&joykeys=1`

### Controls

| PC | CPC |
| --- | --- |
| Esc | ESC |
| Enter / Numpad Enter | RETURN / ENTER |
| Backspace / Delete, Home | DEL / CLR |
| Left Alt, Insert, End | COPY |
| Tab, Caps Lock | TAB, CAPS LOCK |
| Ctrl | CONTROL (joystick fire while the keyboard joystick is on) |
| Cursor keys | cursor keys (joystick while the keyboard joystick is on) |
| Numeric keypad | f0–f9 and f. (joystick while the keyboard joystick is on) |
| F1–F8 | f1–f8 |
| F9 | keyboard joystick on or off |
| F10 | warp |
| F11 | fullscreen |
| Shift+F9 / Shift+F10 | save / load the last save slot used |

Typing is symbolic: what is printed on your key is what the CPC types. Paste text
(Ctrl+V) to type it into BASIC. Gamepads work automatically: stick or d-pad to move,
alternate face buttons for fire 1 and fire 2.

Players can change the joystick keys in the settings panel. Each direction and fire
has a primary and a secondary key: click one, then press the key to use (Backspace
clears it, Esc cancels). A key given to one direction is taken off any other. After
a change the direction keeps just those two keys. The eject button removes the
loaded game and restarts in BASIC.

### Using AmsEmu from your own page

```js
import { AmsEmu } from './js/amsemu.js';
const cpc = await AmsEmu.create(document.getElementById('amsemu'), options);
cpc.reset();              // restart the program
cpc.resetToBasic();
cpc.unload();             // remove all media and start in BASIC
cpc.setJoystickKeys(true);
cpc.setModel('464');
cpc.setRam(128);
cpc.typeText('CAT\r');
await cpc.saveState(1);   // slot 1 to 4
await cpc.loadState(1);
cpc.machine;              // the emulated CPC, for poking at memory
```

---

## Licences and ROMs

- The emulation is a JavaScript port of parts of Caprice32 (Z80, CRTC and Gate
  Array, AY-3-8912, uPD765 disk controller, tape, Plus ASIC, snapshots), which is
  GPL v2 or later. Its CRTC emulation is based on WinAPE's by Richard Wilson.
  AmsEmu is therefore under the GNU General Public License, version 2 or (at your
  option) any later version. See `LICENSE`.
- The CRT emulation, CRT filter and the browser front end come from Viccy H20,
  by HEWCO.
- The CTM644 palette is the measured palette published on CPCWiki.
- `web/roms/` holds the CPC 464, 664 and 6128 firmware and AMSDOS, as
  distributed with Caprice32. The CPC ROMs are copyright Amstrad and Locomotive
  Software. Amstrad allows them to be redistributed with emulators on condition
  that its copyright notices are kept and that they are not sold
  ([Amstrad's statement](https://amstrad.eu/wp-content/uploads/ftp_cpcscene/Resources/Roms/Amstrad/COPYRIGHT.TXT)),
  and asks for this acknowledgement:
  Amstrad has kindly given it's permission for it's copyrighted material to be
  redistributed but Amstrad retains it's copyright.
- The Plus system cartridge is not included: it also holds Burnin' Rubber,
  copyright Ocean Software, which that permission doesn't cover (see *A Plus
  without a cartridge*).
