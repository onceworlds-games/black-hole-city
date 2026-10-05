export * from '../../node_modules/three/build/three.module.js';

/** A renderer that renders nothing, and counts how often it was asked to. */
export class WebGLRenderer {
  constructor(options = {}) {
    this.domElement = options.canvas ?? { height: 720, width: 1280 };
    this.shadowMap = { enabled: false, type: 0 };
    this.renders = 0;
    this.toneMappingExposure = 1;
    this.options = options;
  }
  setPixelRatio() {}
  setSize(w, h) {
    this.domElement.width = w;
    this.domElement.height = h;
  }
  render() {
    this.renders++;
  }
}
