export default {
  ui: { title: 'Racer' },
  model: '6128',
  media: { disk: 'games/racer.dsk' },
  autostart: 'RUN"RACER\r',
  joystick: {
    keyboard: true,
    keys: {
      up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'],
      left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
      fire: ['Space', 'KeyJ'], fire2: ['KeyK'],
    },
  },
};
