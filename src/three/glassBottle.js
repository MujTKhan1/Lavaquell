import * as THREE from 'three';
import { makeLabelTexture, makeNeckBandTexture, makeDropletNormalMap, makeKnurlMap } from '../textures.js';
import { lerp } from './common.js';

/*
 * Lavaquell 1000 mL returnable glass bottle, built in layers so glass, water
 * and air read separately (units: bottle height = 4):
 *   outer + inner glass shells  reflective, darkening at grazing angles (wall thickness)
 *   thick glass base            transmissive, ior 1.5
 *   water volume                transmissive, ior 1.333, pale aqua, clipped by a
 *                               world-space plane that stays level (with spring lag)
 *   water surface disc          meniscus at the fill line; air above it
 *   print, cap                  print recomposed from the real Lavaquell logo files
 */

// Silhouette traced from "Lavaquell - Still.jpg" (radius, height)
const PROFILE = [
  [0.0, 0.06], [0.2, 0.04], [0.38, 0.008], [0.455, 0.012], [0.478, 0.04],
  [0.486, 0.1], [0.486, 0.5], [0.484, 0.9], [0.479, 1.3], [0.468, 1.62],
  [0.449, 1.95], [0.418, 2.26], [0.378, 2.56], [0.33, 2.86], [0.281, 3.11],
  [0.236, 3.33], [0.199, 3.5], [0.18, 3.6], [0.175, 3.66], [0.186, 3.675],
  [0.19, 3.7], [0.19, 3.735], [0.178, 3.755],
];
export const BOTTLE_RADIUS = 0.486;
const WALL = 0.032;
const BASE_TOP = 0.17;
const FILL = 2.62;

export function sampleProfile(n) {
  const curve = new THREE.CatmullRomCurve3(PROFILE.map(([r, y]) => new THREE.Vector3(r, y, 0)), false, 'centripetal');
  return curve.getSpacedPoints(n).map((p) => new THREE.Vector2(Math.max(0, p.x), p.y));
}
export function radiusAt(points, y) {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (a.y > 0.1 && a.y <= y && b.y >= y && b.y > a.y) return lerp(a.x, b.x, (y - a.y) / (b.y - a.y));
  }
  return points[points.length - 1].x;
}
export const lathe = (pts, segs) => new THREE.LatheGeometry(pts, segs, Math.PI, Math.PI * 2);
export function bandPoints(points, y0, y1, offset = 0, scale = 1, steps = 48) {
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const y = lerp(y0, y1, i / steps);
    out.push(new THREE.Vector2(Math.max(0.001, radiusAt(points, y) * scale + offset), y));
  }
  return out;
}

/** Reflective glass shell: reflections add, the body darkens near grazing angles. */
export function makeGlassMaterial(droplets, { rimMin, rimMax, light = 0 }) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0x000000,
    metalness: 0,
    roughness: 0.03,
    ior: 1.5,
    specularIntensity: 1,
    envMapIntensity: 1.7,
    clearcoat: droplets ? 1 : 0,
    clearcoatRoughness: 0.04,
    clearcoatNormalMap: droplets || null,
    clearcoatNormalScale: new THREE.Vector2(0.45, 0.45),
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  m.userData.uLight = { value: light };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uLight = m.userData.uLight;
    sh.fragmentShader = 'uniform float uLight;\n' + sh.fragmentShader.replace(
      '#include <opaque_fragment>',
      `float nv = clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0);
       float rim = pow(1.0 - nv, 2.0);
       diffuseColor.a = mix(${rimMin.toFixed(3)}, ${rimMax.toFixed(3)}, rim) * (1.0 + uLight * 0.6);
       outgoingLight += vec3(0.015, 0.05, 0.06) * rim * (1.0 - uLight);
       #include <opaque_fragment>`
    );
  };
  return m;
}

let shared = null;
function sharedResources(renderer, lowPower) {
  if (shared && shared.renderer === renderer) return shared;
  const segs = lowPower ? 72 : 128;
  const outer = sampleProfile(lowPower ? 100 : 160);
  const innerPts = [new THREE.Vector2(0.0, BASE_TOP), ...bandPoints(outer, BASE_TOP + 0.02, 3.68, -WALL, 1, 90)];
  innerPts[1] = new THREE.Vector2(radiusAt(outer, BASE_TOP + 0.02) - WALL - 0.03, BASE_TOP);
  const waterPts = [new THREE.Vector2(0.0, BASE_TOP + 0.004), ...bandPoints(outer, BASE_TOP + 0.03, 3.6, -WALL - 0.004, 1, 80)];
  waterPts[1] = new THREE.Vector2(radiusAt(outer, BASE_TOP + 0.03) - WALL - 0.04, BASE_TOP + 0.004);
  const droplets = makeDropletNormalMap(renderer, lowPower ? 512 : 1024, lowPower ? 700 : 1300);
  droplets.repeat.set(3, 1);

  const mc = document.createElement('canvas');
  mc.width = mc.height = 256;
  const mg = mc.getContext('2d');
  const grd = mg.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, 'rgba(225,245,255,0.28)');
  grd.addColorStop(0.82, 'rgba(225,245,255,0.38)');
  grd.addColorStop(0.95, 'rgba(255,255,255,0.95)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  mg.fillStyle = grd;
  mg.fillRect(0, 0, 256, 256);
  const surfTex = new THREE.CanvasTexture(mc);
  surfTex.colorSpace = THREE.SRGBColorSpace;

  shared = {
    renderer,
    segs,
    outer,
    outerGeo: lathe(outer, segs),
    innerGeo: lathe(innerPts, segs),
    waterGeo: lathe(waterPts, segs),
    baseGeo: lathe(
      [[0, 0.06], [0.2, 0.04], [0.38, 0.01], [0.455, 0.014], [0.478, 0.042], [0.484, 0.1], [0.48, BASE_TOP], [0.0, BASE_TOP]].map(
        ([r, y]) => new THREE.Vector2(r, y)
      ),
      segs
    ),
    capGeo: lathe(
      [[0.183, 3.745], [0.198, 3.76], [0.2, 3.8], [0.2, 3.86], [0.2, 3.92], [0.2, 3.965], [0.196, 3.988], [0.17, 3.998], [0.0, 4.0]].map(
        ([r, y]) => new THREE.Vector2(r, y)
      ),
      segs
    ),
    labelGeo: lathe(bandPoints(outer, 0.18, 1.45, 0, 1.0035), segs),
    neckGeo: lathe(bandPoints(outer, 3.22, 3.5, 0, 1.004), segs),
    discGeo: new THREE.CircleGeometry(1, lowPower ? 48 : 96),
    droplets,
    surfTex,
    capMat: new THREE.MeshPhysicalMaterial({
      color: 0xe3e7eb,
      metalness: 1,
      roughness: 0.24,
      bumpMap: makeKnurlMap(renderer),
      bumpScale: 2.5,
      clearcoat: 0.4,
      clearcoatRoughness: 0.2,
      envMapIntensity: 2.2,
    }),
    baseMat: new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.02,
      transmission: 1,
      ior: 1.5,
      thickness: 0.35,
      attenuationColor: new THREE.Color(0xcdeee6),
      attenuationDistance: 0.6,
      envMapIntensity: 1.4,
    }),
    labels: {},
  };
  return shared;
}

export async function createGlassBottle(renderer, { variant = 'still', lowPower = false, light = 0, condensation = true } = {}) {
  const S = sharedResources(renderer, lowPower);
  if (!S.labels[variant]) {
    S.labels[variant] = await makeLabelTexture(renderer, {
      variant,
      radius: radiusAt(S.outer, 0.8),
      y0: 0.18,
      y1: 1.45,
      scale: lowPower ? 0.5 : 1,
    });
  }

  const outerMat = makeGlassMaterial(condensation ? S.droplets : null, { rimMin: 0.03, rimMax: 0.5, light });
  const innerMat = makeGlassMaterial(null, { rimMin: 0.02, rimMax: 0.32, light });
  innerMat.side = THREE.BackSide;
  const fillPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  const waterMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.0,
    transmission: 1,
    ior: 1.333,
    thickness: 0.95,
    attenuationColor: new THREE.Color(0xb9e6f1),
    attenuationDistance: 2.6,
    specularIntensity: 0.55,
    envMapIntensity: 0.7,
    clippingPlanes: [fillPlane],
  });
  const printMat = (map) =>
    new THREE.MeshStandardMaterial({ map, transparent: true, roughness: 0.45, depthWrite: false, envMapIntensity: 0.5 });

  const group = new THREE.Group();
  const add = (geo, mat, order) => {
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = order;
    group.add(m);
    return m;
  };
  add(S.baseGeo, S.baseMat, 0);
  add(S.waterGeo, waterMat, 0);
  add(S.innerGeo, innerMat, 1);
  add(S.outerGeo, outerMat, 3);
  add(S.labelGeo, printMat(S.labels[variant]), 4);
  if (variant === 'sparkling') {
    S.bandTex ||= makeNeckBandTexture(renderer, { radius: radiusAt(S.outer, 3.36), y0: 3.22, y1: 3.5 });
    add(S.neckGeo, printMat(S.bandTex), 4);
  }
  add(S.capGeo, S.capMat, 0);

  const surface = new THREE.Mesh(
    S.discGeo,
    new THREE.MeshBasicMaterial({ map: S.surfTex, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide })
  );
  surface.renderOrder = 2;
  const fillR = radiusAt(S.outer, FILL) - WALL - 0.006;

  const slosh = { x: 0, z: 0, vx: 0, vz: 0, prz: 0, prx: 0 };
  const nUp = new THREE.Vector3();
  const P = new THREE.Vector3();
  const zAxis = new THREE.Vector3(0, 0, 1);

  return {
    group,
    surface,
    setLight(v) {
      outerMat.userData.uLight.value = v;
      innerMat.userData.uLight.value = v;
    },
    /** keep the water level horizontal; lag the bottle's tilt with a damped spring */
    update(dt, { hideBelow = -Infinity } = {}) {
      group.updateMatrixWorld();
      if (dt > 0) {
        slosh.vz += (group.rotation.z - slosh.prz) * 9;
        slosh.vx += (group.rotation.x - slosh.prx) * 9;
        const k = 38, c = 2.6;
        slosh.vz += (-k * slosh.z - c * slosh.vz) * dt;
        slosh.vx += (-k * slosh.x - c * slosh.vx) * dt;
        slosh.z = THREE.MathUtils.clamp(slosh.z + slosh.vz * dt, -0.18, 0.18);
        slosh.x = THREE.MathUtils.clamp(slosh.x + slosh.vx * dt, -0.18, 0.18);
        slosh.prz = group.rotation.z;
        slosh.prx = group.rotation.x;
      }
      nUp.set(Math.sin(slosh.z), 1, Math.sin(slosh.x)).normalize();
      P.set(0, FILL, 0);
      group.localToWorld(P);
      fillPlane.normal.copy(nUp).negate();
      fillPlane.constant = nUp.dot(P);
      surface.position.copy(P);
      surface.quaternion.setFromUnitVectors(zAxis, nUp);
      surface.scale.setScalar(fillR * group.scale.x);
      surface.visible = group.visible && P.y > hideBelow;
    },
  };
}
