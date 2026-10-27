class AmsAudio extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(65536);
    this.read = 0;
    this.write = 0;
    this.count = 0;
    this.lastL = 0;
    this.lastR = 0;
    this.frames = 0;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d === 'clear') { this.read = this.write = this.count = 0; return; }
      const n = d.length & ~1, buf = this.buf, size = buf.length;
      for (let i = 0; i < n; i++) {
        if (this.count === size) { this.read = (this.read + 1) % size; this.count--; }
        buf[this.write] = d[i];
        this.write = (this.write + 1) % size;
        this.count++;
      }
    };
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const left = out[0], right = out[1] || out[0];
    const buf = this.buf, size = buf.length;
    for (let i = 0; i < left.length; i++) {
      if (this.count >= 2) {
        this.lastL = buf[this.read];
        this.lastR = buf[(this.read + 1) % size];
        this.read = (this.read + 2) % size;
        this.count -= 2;
      } else {
        this.lastL *= 0.995;
        this.lastR *= 0.995;
      }
      left[i] = this.lastL;
      right[i] = this.lastR;
    }
    if (++this.frames % 8 === 0) this.port.postMessage(this.count >> 1);
    return true;
  }
}

registerProcessor('ams-audio', AmsAudio);
