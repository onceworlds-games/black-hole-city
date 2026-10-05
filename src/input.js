// Steering: WASD and arrows, dragging the mouse or a finger (the hole heads toward the pointer from the middle of the
// screen), and the platform's analog stick on touch screens. Everything is added together and capped at full speed.

const KEYS = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

export class Input {
  /** `ow` gives the stick; `isUi(target)` says whether a pointer landed on a button of ours (then it isn't steering). */
  constructor(ow, isUi) {
    this.ow = ow;
    this.isUi = isUi;
    this.down = new Set();
    this.drag = null; // { id, x, y }
    this.x = 0;
    this.z = 0;
    this.enabled = true;
    this.onTap = null; // called for a tap that isn't steering (spectators: next hole)
    this.moved = false;
    const clear = () => {
      this.down.clear();
      this.drag = null;
    };
    addEventListener('keydown', (e) => {
      if (e.code in KEYS) {
        this.down.add(e.code);
        if (!e.repeat) this.moved = true;
        e.preventDefault();
      }
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', clear);
    document.addEventListener('visibilitychange', () => document.hidden && clear());
    addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (this.isUi?.(e.target)) return;
        const touch = this.ow.controls?.touch;
        // the platform's stick owns the lower left of a touch screen
        if (touch && e.clientX < innerWidth * 0.45 && e.clientY > innerHeight * 0.45) return;
        if (this.drag) return;
        this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, at: performance.now() };
        this.moved = true;
      },
      { passive: true },
    );
    addEventListener(
      'pointermove',
      (e) => {
        if (this.drag && this.drag.id === e.pointerId) {
          this.drag.x = e.clientX;
          this.drag.y = e.clientY;
        }
      },
      { passive: true },
    );
    const up = (e) => {
      if (this.drag && this.drag.id === e.pointerId) {
        const d = this.drag;
        this.drag = null;
        if (performance.now() - d.at < 280 && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 12) this.onTap?.();
      }
    };
    addEventListener('pointerup', up, { passive: true });
    addEventListener('pointercancel', up, { passive: true });
  }

  /** Reads everything into (x, z): x right, z toward the bottom of the screen. */
  read() {
    let x = 0;
    let z = 0;
    if (this.enabled) {
      for (const code of this.down) {
        x += KEYS[code][0];
        z += KEYS[code][1];
      }
      const stick = this.ow.controls?.stick;
      if (stick && (stick.x || stick.y)) {
        x += stick.x;
        z += stick.y;
      }
      if (this.drag) {
        const m = Math.min(innerWidth, innerHeight);
        const dx = (this.drag.x - innerWidth / 2) / (m * 0.2);
        const dy = (this.drag.y - innerHeight / 2) / (m * 0.2);
        const len = Math.hypot(dx, dy);
        if (len > 0.18) {
          const k = Math.min(1, len) / len;
          x += dx * k;
          z += dy * k;
        }
      }
    }
    const len = Math.hypot(x, z);
    if (len > 1) {
      x /= len;
      z /= len;
    }
    this.x = x;
    this.z = z;
    return this;
  }

  get touch() {
    return !!this.ow.controls?.touch;
  }
}
