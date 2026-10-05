// Just enough of a browser for the screens to run in node: elements that remember their text, classes and children, a
// canvas whose 2D context does nothing, a manual requestAnimationFrame. Nothing here draws; it lets the game's own code
// run end to end so a typo or a wrong property name throws in a test instead of in a player's browser.

export class FakeNode {
  constructor(tag = 'div', ns = null) {
    this.tagName = String(tag).toUpperCase();
    this.ns = ns;
    this.children = [];
    this.parentNode = null;
    this.attrs = {};
    this.dataset = {};
    this.listeners = new Map();
    this._text = '';
    this._classes = new Set();
    this.hidden = false;
    this.style = { setProperty() {}, cssText: '' };
    this.width = 300;
    this.height = 150;
    this.offsetWidth = 1;
    this.alt = '';
    this.crossOrigin = '';
    this.onload = null;
    this.onclick = null;
    const self = this;
    this.classList = {
      add: (...c) => c.forEach((x) => self._classes.add(x)),
      remove: (...c) => c.forEach((x) => self._classes.delete(x)),
      toggle: (c, force) => {
        const on = force === undefined ? !self._classes.has(c) : !!force;
        if (on) self._classes.add(c);
        else self._classes.delete(c);
        return on;
      },
      contains: (c) => self._classes.has(c),
    };
  }

  get className() {
    return [...this._classes].join(' ');
  }
  set className(v) {
    this._classes = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  get textContent() {
    return this.children.length ? this.children.map((c) => c.textContent).join('') : this._text;
  }
  set textContent(v) {
    for (const c of this.children) c.parentNode = null;
    this.children = [];
    this._text = String(v);
  }
  get firstChild() {
    return this.children[0] ?? null;
  }
  set src(v) {
    this._src = v;
    setTimeout(() => this.onload?.(), 0);
  }
  get src() {
    return this._src;
  }
  append(...nodes) {
    for (const n of nodes) {
      if (typeof n === 'string') {
        const t = new FakeNode('#text');
        t._text = n;
        t.parentNode = this;
        this.children.push(t);
      } else {
        if (n.parentNode) n.remove();
        n.parentNode = this;
        this.children.push(n);
      }
    }
    this._text = '';
  }
  appendChild(n) {
    this.append(n);
    return n;
  }
  remove() {
    if (!this.parentNode) return;
    const i = this.parentNode.children.indexOf(this);
    if (i >= 0) this.parentNode.children.splice(i, 1);
    this.parentNode = null;
  }
  replaceWith(n) {
    const p = this.parentNode;
    if (!p) return;
    const i = p.children.indexOf(this);
    n.parentNode = p;
    p.children[i] = n;
    this.parentNode = null;
  }
  cloneNode(deep) {
    const c = new FakeNode(this.tagName);
    c._text = this._text;
    c._classes = new Set(this._classes);
    c.hidden = this.hidden;
    if (deep) for (const k of this.children) c.append(k.cloneNode(true));
    return c;
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  getAttribute(k) {
    return this.attrs[k] ?? null;
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  dispatch(type, ev = {}) {
    for (const fn of this.listeners.get(type) ?? []) fn({ target: this, preventDefault() {}, ...ev });
  }
  closest(sel) {
    const cls = sel.startsWith('.') ? sel.slice(1) : null;
    for (let n = this; n; n = n.parentNode) if (cls && n._classes.has(cls)) return n;
    return null;
  }
  getContext() {
    return (this._ctx ??= makeContext(this));
  }
  find(cls) {
    const out = [];
    const walk = (n) => {
      if (n._classes.has(cls)) out.push(n);
      n.children.forEach(walk);
    };
    walk(this);
    return out;
  }
}

function makeContext(canvas) {
  const calls = { fillText: 0, strokeText: 0, fill: 0 };
  const target = { canvas, calls };
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'measureText') return (s) => ({ width: String(s).length * 8 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      return (...args) => {
        if (k in calls) calls[k]++;
        void args;
      };
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  });
}

export function installDom({ width = 1280, height = 720 } = {}) {
  const doc = new FakeNode('#document');
  const ids = {};
  const make = (id, tag) => {
    const n = new FakeNode(tag);
    ids[id] = n;
    return n;
  };
  const body = new FakeNode('body');
  body.dataset = {};
  const canvasGame = make('game', 'canvas');
  const canvasOverlay = make('overlay', 'canvas');
  const ui = make('ui', 'div');
  body.append(canvasGame, canvasOverlay, ui);
  const globalListeners = new Map();
  const frames = [];
  const fakeDoc = {
    body,
    hidden: false,
    createElement: (t) => new FakeNode(t),
    createElementNS: (ns, t) => new FakeNode(t, ns),
    getElementById: (id) => ids[id] ?? null,
    fonts: { load: async () => [], ready: Promise.resolve() },
    addEventListener: (type, fn) => {
      if (!globalListeners.has(`doc:${type}`)) globalListeners.set(`doc:${type}`, []);
      globalListeners.get(`doc:${type}`).push(fn);
    },
  };
  Object.assign(globalThis, {
    document: fakeDoc,
    innerWidth: width,
    innerHeight: height,
    devicePixelRatio: 1,
    location: { search: '', reload() {} },
    matchMedia: () => ({ matches: false }),
    Image: class {
      constructor() {
        this.onload = null;
        this.onerror = null;
        this.crossOrigin = '';
      }
      set src(v) {
        this._src = v;
        setTimeout(() => this.onload?.(), 0);
      }
    },
    addEventListener: (type, fn) => {
      if (!globalListeners.has(type)) globalListeners.set(type, []);
      globalListeners.get(type).push(fn);
    },
    requestAnimationFrame: (fn) => {
      frames.push(fn);
      return frames.length;
    },
    HTMLElement: FakeNode,
  });
  globalThis.window = globalThis;
  return {
    ids,
    body,
    frames,
    /** Fires a window or document event at every listener. */
    fire(type, ev = {}) {
      for (const fn of globalListeners.get(type) ?? []) fn({ preventDefault() {}, target: canvasGame, ...ev });
    },
    fireDoc(type, ev = {}) {
      for (const fn of globalListeners.get(`doc:${type}`) ?? []) fn(ev);
    },
    /** Runs the frame the game asked for, at time `t` ms. */
    step(t) {
      const fn = frames.shift();
      if (fn) fn(t);
      return !!fn;
    },
  };
}
