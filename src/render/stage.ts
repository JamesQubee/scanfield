// Renderer, scene and camera, plus a snapshot of the camera as it was for the last
// frame on screen. Input uses that snapshot, so a tap is resolved against what the
// player actually saw, not against a camera that has moved on since.

import { Matrix4, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer, NoToneMapping, Color } from "three";

export interface FrameCamera {
  viewProj: Matrix4;
  projInv: Matrix4;
  world: Matrix4;
  position: Vector3;
  /** Canvas size in CSS pixels at that frame. */
  width: number;
  height: number;
}

export class Stage {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(50, 1, 0.5, 600);
  readonly canvas: HTMLCanvasElement;
  readonly frame: FrameCamera = {
    viewProj: new Matrix4(),
    projInv: new Matrix4(),
    world: new Matrix4(),
    position: new Vector3(),
    width: 1,
    height: 1,
  };
  width = 1;
  height = 1;
  /** Pixel ratio cap chosen by the quality controller. */
  pixelRatio = 1;
  contextLost = false;
  private readonly onLost: (() => void)[] = [];
  private readonly onRestored: (() => void)[] = [];

  constructor(host: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance", stencil: false });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.setClearColor(new Color("#9cc9ef"));
    this.canvas = this.renderer.domElement;
    this.canvas.className = "stage";
    this.canvas.setAttribute("aria-label", "Football pitch");
    host.prepend(this.canvas);
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.resize();
    window.addEventListener("resize", () => this.resize());
    window.visualViewport?.addEventListener("resize", () => this.resize());
    this.canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.contextLost = true;
      for (const f of this.onLost) f();
    });
    this.canvas.addEventListener("webglcontextrestored", () => {
      this.contextLost = false;
      for (const f of this.onRestored) f();
    });
  }

  onContextLost(f: () => void): void {
    this.onLost.push(f);
  }
  onContextRestored(f: () => void): void {
    this.onRestored.push(f);
  }

  resize(): void {
    const w = Math.max(1, Math.round(this.canvas.parentElement?.clientWidth ?? window.innerWidth));
    const h = Math.max(1, Math.round(this.canvas.parentElement?.clientHeight ?? window.innerHeight));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, true);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Changes resolution. Reallocates the drawing buffer, so call it only between moments. */
  setPixelRatio(pr: number): void {
    if (Math.abs(pr - this.pixelRatio) < 0.01) return;
    this.pixelRatio = pr;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.width, this.height, true);
  }

  render(): void {
    if (this.contextLost) return;
    this.camera.updateMatrixWorld();
    this.renderer.render(this.scene, this.camera);
    const f = this.frame;
    f.viewProj.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    f.projInv.copy(this.camera.projectionMatrixInverse);
    f.world.copy(this.camera.matrixWorld);
    f.position.setFromMatrixPosition(this.camera.matrixWorld);
    f.width = this.width;
    f.height = this.height;
  }
}
