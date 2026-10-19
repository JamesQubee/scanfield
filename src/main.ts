import * as THREE from "three";

// Day-0 smoke scene: proves WebGL, the build and the Worker API work together.
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#2f8f4e");
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 2, 5);
camera.lookAt(0, 0, 0);
scene.add(new THREE.HemisphereLight("#ffffff", "#335533", 2));
const cube = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshLambertMaterial({ color: "#f5f5f5" }));
scene.add(cube);

const gl = renderer.getContext();
(window as unknown as { __smoke: object }).__smoke = {
  webgl2: typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext,
  renderer: gl.getParameter(gl.getExtension("WEBGL_debug_renderer_info")?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER),
};

renderer.setAnimationLoop((t) => {
  cube.rotation.y = t / 1000;
  renderer.render(scene, camera);
});

fetch("/api/health")
  .then((r) => r.json())
  .then((j) => ((window as unknown as { __health: unknown }).__health = j));
