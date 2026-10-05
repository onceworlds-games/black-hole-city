// A Web Audio stand-in that records what was made, so the sound code runs (and can't throw) in node.
export class FakeParam {
  constructor() {
    this.value = 0;
    this.calls = 0;
  }
  setValueAtTime(v) {
    this.calls++;
    this.value = v;
    if (!(v > -1e9 && v < 1e9)) throw new Error(`bad param value ${v}`);
  }
  exponentialRampToValueAtTime(v) {
    this.calls++;
    if (!(v > 0)) throw new Error(`exponential ramp to ${v}`);
  }
  linearRampToValueAtTime() {
    this.calls++;
  }
  setTargetAtTime() {
    this.calls++;
  }
}

class FakeNode {
  constructor(ctx, kind) {
    this.ctx = ctx;
    this.kind = kind;
    this.frequency = new FakeParam();
    this.gain = new FakeParam();
    this.Q = new FakeParam();
    this.threshold = new FakeParam();
    this.knee = new FakeParam();
    this.ratio = new FakeParam();
    this.attack = new FakeParam();
    this.release = new FakeParam();
    this.started = false;
  }
  connect(n) {
    return n;
  }
  disconnect() {}
  start(when = 0) {
    this.started = true;
    this.ctx.started++;
    if (when < 0) throw new Error('negative start time');
  }
  stop() {}
}

export class FakeAudioContext {
  static last = null;
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.state = 'suspended';
    this.destination = {};
    this.started = 0;
    this.nodes = 0;
    FakeAudioContext.last = this;
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  make(kind) {
    this.nodes++;
    return new FakeNode(this, kind);
  }
  createOscillator() {
    return this.make('osc');
  }
  createGain() {
    return this.make('gain');
  }
  createBiquadFilter() {
    return this.make('filter');
  }
  createDynamicsCompressor() {
    return this.make('comp');
  }
  createBufferSource() {
    return this.make('src');
  }
  createBuffer(channels, length) {
    return { getChannelData: () => new Float32Array(length) };
  }
}
