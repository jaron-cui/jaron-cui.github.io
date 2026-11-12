/**
 * three.js rendering of the MuJoCo scene from geom poses: the rat's visual and body primitives
 * (groups 1-2), a large checkered floor (the trained arena's floor is only 10 m wide, while MuJoCo's
 * collision plane is infinite), and a camera that follows the rat. MuJoCo's world is z-up.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Geoms, SceneRenderer } from './protocol';

// mjtGeom values.
const GEOM = { PLANE: 0, HFIELD: 1, SPHERE: 2, CAPSULE: 3, ELLIPSOID: 4, CYLINDER: 5, BOX: 6, MESH: 7 };
const VISIBLE_GROUPS = new Set([1, 2]);

function geometry(type: number, size: number[]): THREE.BufferGeometry | null {
  switch (type) {
    case GEOM.SPHERE:
      return new THREE.SphereGeometry(size[0], 24, 16);
    case GEOM.ELLIPSOID:
      return new THREE.SphereGeometry(1, 24, 16).scale(size[0], size[1], size[2]);
    case GEOM.CAPSULE:  // MuJoCo capsules/cylinders are along local z; three.js along y.
      return new THREE.CapsuleGeometry(size[0], 2 * size[1], 8, 16).rotateX(Math.PI / 2);
    case GEOM.CYLINDER:
      return new THREE.CylinderGeometry(size[0], size[0], 2 * size[1], 24).rotateX(Math.PI / 2);
    case GEOM.BOX:
      return new THREE.BoxGeometry(2 * size[0], 2 * size[1], 2 * size[2]);
    default:
      return null;
  }
}

function checker_texture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      ctx.fillStyle = (i + j) % 2 ? '#a9a6a3' : '#b9b6b3';
      ctx.fillRect(i * 128, j * 128, 128, 128);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** Geom poses of one simulation frame, for interpolation. */
interface Pose {
  time: number;  // Arrival time (ms).
  positions: THREE.Vector3[];
  quaternions: THREE.Quaternion[];
  follow: THREE.Vector3;
}

export class Renderer implements SceneRenderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, 1, 0.01, 200);
  controls: OrbitControls;
  meshes: (THREE.Mesh | null)[] = [];
  floor: THREE.Mesh;
  private follow: THREE.Vector3 | null = null;
  // The last two frames: the display interpolates from `previous` to `current` over the interval at
  // which frames arrive (one frame of lag), so slow motion (few frames per second) stays smooth.
  private previous: Pose | null = null;
  private current: Pose | null = null;
  private resize_observer: ResizeObserver;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);

    THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(-0.45, -0.55, 0.3);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 0.05);
    this.controls.enableDamping = true;

    this.scene.background = new THREE.Color('#e9eef3');
    this.scene.fog = new THREE.Fog('#e9eef3', 6, 30);
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#8a8580', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 2.0);
    sun.position.set(1, -1.5, 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -1, right: 1, top: 1, bottom: -1, near: 0.1, far: 10 });
    this.scene.add(sun, sun.target);

    // Floor: 1 m checkers (matching the trained arena), 200 m wide.
    const texture = checker_texture();
    texture.repeat.set(100, 100);
    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9 }),
    );
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    // Keep the shadow-casting light over the rat.
    this.scene.userData.sun = sun;

    this.resize_observer = new ResizeObserver(() => this.resize(container));
    this.resize_observer.observe(container);
    this.resize(container);
    this.renderer.setAnimationLoop(() => this.render());
  }

  set_geoms(geoms: Geoms) {
    for (const mesh of this.meshes) if (mesh) this.scene.remove(mesh);
    this.meshes = geoms.type.map((type, i) => {
      if (!VISIBLE_GROUPS.has(geoms.group[i])) return null;
      const geom = geometry(type, geoms.size.slice(3 * i, 3 * i + 3));
      if (geom === null) return null;
      const [r, g, b, a] = geoms.rgba.slice(4 * i, 4 * i + 4);
      const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({
        color: new THREE.Color(r, g, b),
        transparent: a < 1,
        opacity: a,
        roughness: 0.6,
      }));
      mesh.castShadow = true;
      mesh.matrixAutoUpdate = false;
      this.scene.add(mesh);
      return mesh;
    });
  }

  /**
   * Receives geom poses (positions [ngeom*3], row-major rotation matrices [ngeom*9]) and the rat's
   * position (for the camera). With `snap`, shows them immediately instead of interpolating.
   */
  update(xpos: Float32Array, xmat: Float32Array, position: number[], snap: boolean = false) {
    const matrix = new THREE.Matrix4();
    const pose: Pose = {
      time: performance.now(),
      positions: this.meshes.map((_, i) => new THREE.Vector3(xpos[3 * i], xpos[3 * i + 1], xpos[3 * i + 2])),
      quaternions: this.meshes.map((_, i) => {
        const r = 9 * i;
        matrix.set(
          xmat[r], xmat[r + 1], xmat[r + 2], 0,
          xmat[r + 3], xmat[r + 4], xmat[r + 5], 0,
          xmat[r + 6], xmat[r + 7], xmat[r + 8], 0,
          0, 0, 0, 1,
        );
        return new THREE.Quaternion().setFromRotationMatrix(matrix);
      }),
      follow: new THREE.Vector3(position[0], position[1], 0.05),
    };
    this.previous = snap || this.current === null ? pose : this.current;
    this.current = pose;
  }

  /** Applies the interpolated pose for the current display time. */
  private apply_pose() {
    const [a, b] = [this.previous, this.current];
    if (a === null || b === null) return;
    const interval = b.time - a.time;
    const alpha = interval > 0 ? Math.min(1, (performance.now() - b.time) / interval) : 1;
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    this.meshes.forEach((mesh, i) => {
      if (!mesh || !a.positions[i] || !b.positions[i]) return;
      position.lerpVectors(a.positions[i], b.positions[i], alpha);
      quaternion.slerpQuaternions(a.quaternions[i], b.quaternions[i], alpha);
      mesh.matrix.compose(position, quaternion, one);
    });
    // Follow the rat: move the camera and orbit target by the rat's displacement.
    const target = new THREE.Vector3().lerpVectors(a.follow, b.follow, alpha);
    if (this.follow !== null) {
      const delta = target.clone().sub(this.follow);
      this.camera.position.add(delta);
      this.controls.target.add(delta);
    } else {
      this.controls.target.copy(target);
    }
    this.follow = target;
    const sun = this.scene.userData.sun as THREE.DirectionalLight;
    sun.position.set(target.x + 1, target.y - 1.5, 3);
    sun.target.position.copy(target);
  }

  private resize(container: HTMLElement) {
    const { clientWidth: w, clientHeight: h } = container;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private render() {
    this.apply_pose();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.resize_observer.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
