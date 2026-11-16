import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { makeGlassMaterial } from './glassBottle.js';

/*
 * The supplied Lavaquell bottle model (public/models/lavaquell-bottle.glb).
 * Parts: Glass, Water, Silver_Cap, Lavaquell_Original_Branding (root
 * Lavaquell_Bottle, metres, ~0.229 m tall). It is scaled so the bottle is
 * 4 scene units tall, matching the reveal's camera and pool.
 *
 * Materials:
 *   Silver_Cap, Branding   kept as authored (cap gets stronger reflections)
 *   Water                  kept as authored (transmission, IOR 1.333, roughness
 *                          0.025), plus a pale aqua attenuation and a level
 *                          clipping plane so the liquid stays horizontal when
 *                          the bottle tilts
 *   Glass                  authored IOR 1.46 / roughness 0.055 / tint kept, but
 *                          drawn as a reflective, rim-darkened shell instead
 *                          of a second transmissive layer: three.js cannot
 *                          show one transmissive object through another, so
 *                          a transmissive glass would hide the water.
 */

const TARGET_HEIGHT = 4;
let cache = null;

// Real-shape Lavaquell bottle exported from render/lavaquell_scene.py (--mode glb):
// silhouette traced from the official product photo, solid glass with wall
// thickness, water to the shoulder, knurled cap, print from the real logo files.
const MODEL = 'models/lavaquell-bottle-real.glb';
const PRINT = 'models/lavaquell-print.png';
function loadModel() {
  if (!cache) cache = new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}${MODEL}`);
  return cache;
}

export async function createGlbBottle(renderer, { light = 0 } = {}) {
  const gltf = await loadModel();
  const root = (gltf.scene.getObjectByName('Bottle') || gltf.scene.getObjectByName('Lavaquell_Bottle') || gltf.scene).clone(true);
  const part = (...names) => names.map((n) => root.getObjectByName(n)).find(Boolean);
  const glass = part('Glass'), water = part('Water'), cap = part('Cap', 'Silver_Cap'), brand = part('Print', 'Lavaquell_Original_Branding');
  if (!glass || !water) throw new Error('GLB is missing its Glass or Water mesh');

  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const S = TARGET_HEIGHT / (box.max.y - box.min.y);
  root.scale.setScalar(S);
  root.position.y = -box.min.y * S;
  const group = new THREE.Group();
  group.add(root);

  // --- glass: keep authored optical values, render as a reflective shell
  const g0 = glass.material;
  const glassMat = makeGlassMaterial(null, { rimMin: 0.035, rimMax: 0.55, light });
  glassMat.ior = g0.ior ?? 1.46;
  glassMat.roughness = g0.roughness ?? 0.055;
  glassMat.side = THREE.DoubleSide;
  glassMat.envMapIntensity = 2.0;
  glass.material = glassMat;
  glass.renderOrder = 3;

  // --- water: authored transmissive material, tuned for depth + kept level
  const fillPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  const w0 = water.material;
  const waterMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.0, transmission: 1, ior: w0.ior ?? 1.333 });
  water.material = waterMat;
  waterMat.side = THREE.FrontSide;
  waterMat.thickness = 0.06; // local metres; scaled with the model
  // attenuation distance is applied in world units (thickness is scaled by the model)
  waterMat.attenuationColor = new THREE.Color(0xc4ecf3);
  waterMat.attenuationDistance = 7;
  waterMat.specularIntensity = 0.6;
  waterMat.envMapIntensity = 0.9;
  waterMat.clippingPlanes = [fillPlane];
  waterMat.needsUpdate = true;
  water.renderOrder = 0;

  // --- cap + branding: as authored
  if (cap) {
    // brushed aluminium screw cap
    cap.material = new THREE.MeshPhysicalMaterial({ color: 0xe6e9ec, metalness: 1, roughness: 0.24, envMapIntensity: 2.4, clearcoat: 0.3, clearcoatRoughness: 0.2 });
  }
  if (brand) {
    // print artwork (the exporter can't carry Blender's mix-shader print, so it is applied here)
    const map = await new THREE.TextureLoader().loadAsync(`${import.meta.env.BASE_URL}${PRINT}`);
    map.colorSpace = THREE.SRGBColorSpace;
    map.flipY = false;
    map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    brand.material = new THREE.MeshStandardMaterial({ map, transparent: true, roughness: 0.5, metalness: 0, depthWrite: false, envMapIntensity: 0.5, side: THREE.FrontSide });
    brand.renderOrder = 4;
  }

  // fill line just under the authored water top; measure the water radius there
  const wg = water.geometry, wp = wg.attributes.position;
  wg.computeBoundingBox();
  const fillLocal = wg.boundingBox.max.y - 0.0035;
  let rFill = 0;
  for (let i = 0; i < wp.count; i++) {
    if (Math.abs(wp.getY(i) - fillLocal) < 0.004) rFill = Math.max(rFill, Math.hypot(wp.getX(i), wp.getZ(i)));
  }
  if (!rFill) rFill = 0.034;
  glass.geometry.computeBoundingBox();
  const radius = glass.geometry.boundingBox.max.x * S;

  // meniscus disc: faint silver body, bright rim
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const gx = c.getContext('2d');
  const grd = gx.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, 'rgba(225,245,255,0.22)');
  grd.addColorStop(0.84, 'rgba(225,245,255,0.32)');
  grd.addColorStop(0.95, 'rgba(255,255,255,0.9)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  gx.fillStyle = grd;
  gx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const surface = new THREE.Mesh(
    new THREE.CircleGeometry(1, 96),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide })
  );
  surface.renderOrder = 2;

  const slosh = { x: 0, z: 0, vx: 0, vz: 0, prz: 0, prx: 0 };
  const nUp = new THREE.Vector3(), P = new THREE.Vector3(), zAxis = new THREE.Vector3(0, 0, 1);

  return {
    group,
    surface,
    radius,
    setLight(v) {
      glassMat.userData.uLight.value = v;
    },
    update(dt, { hideBelow = -Infinity } = {}) {
      group.updateMatrixWorld(true);
      if (dt > 0) {
        slosh.vz += (group.rotation.z - slosh.prz) * 9;
        slosh.vx += (group.rotation.x - slosh.prx) * 9;
        const k = 38, damp = 2.6;
        slosh.vz += (-k * slosh.z - damp * slosh.vz) * dt;
        slosh.vx += (-k * slosh.x - damp * slosh.vx) * dt;
        slosh.z = THREE.MathUtils.clamp(slosh.z + slosh.vz * dt, -0.18, 0.18);
        slosh.x = THREE.MathUtils.clamp(slosh.x + slosh.vx * dt, -0.18, 0.18);
        slosh.prz = group.rotation.z;
        slosh.prx = group.rotation.x;
      }
      nUp.set(Math.sin(slosh.z), 1, Math.sin(slosh.x)).normalize();
      P.set(0, fillLocal, 0);
      water.localToWorld(P);
      fillPlane.normal.copy(nUp).negate();
      fillPlane.constant = nUp.dot(P);
      surface.position.copy(P);
      surface.quaternion.setFromUnitVectors(zAxis, nUp);
      surface.scale.setScalar(rFill * S * 0.985);
      surface.visible = group.visible && P.y > hideBelow;
    },
  };
}
