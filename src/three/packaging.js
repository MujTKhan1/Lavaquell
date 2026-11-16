import * as THREE from 'three';
import { makeVerticalPrint } from '../textures.js';
import { lathe } from './glassBottle.js';

/*
 * LAVAQUELL slim 250 ml can and aluminium bottle. Shapes follow the product
 * photos on airowaterglobal.com; sizes are estimated relative to the 1 L
 * glass bottle (height 4 units), since no dimensions are published.
 */

const V = (pts) => pts.map(([r, y]) => new THREE.Vector2(r, y));

const metal = () =>
  new THREE.MeshPhysicalMaterial({ color: 0xd9dde1, metalness: 1, roughness: 0.28, envMapIntensity: 1.8, clearcoat: 0.3 });
const painted = (map) =>
  new THREE.MeshPhysicalMaterial({
    map,
    color: 0xffffff,
    metalness: 0.04,
    roughness: 0.38,
    clearcoat: 0.8,
    clearcoatRoughness: 0.14,
    envMapIntensity: 0.85,
  });

const INK = { still: '#1c4f9e', sparkling: '#2f6a35' };

export async function createCan(renderer, { variant = 'still', lowPower = false } = {}) {
  const segs = lowPower ? 56 : 96;
  const R = 0.34, Y0 = 0.1, Y1 = 1.58;
  const print = await makeVerticalPrint(renderer, {
    radius: R,
    height: Y1 - Y0,
    ink: INK[variant],
    variety: variant === 'sparkling' ? 'SPARKLING WATER' : 'STILL WATER',
    capacity: '250 ml',
    scale: lowPower ? 0.6 : 1,
  });
  const g = new THREE.Group();
  g.add(new THREE.Mesh(lathe(V([[R, Y0], [R, Y1]]), segs), painted(print)));
  const m = metal();
  g.add(new THREE.Mesh(lathe(V([[0, 0.05], [0.24, 0.035], [0.3, 0.004], [0.325, 0.02], [0.34, 0.08], [R, Y0]]), segs), m));
  g.add(
    new THREE.Mesh(
      lathe(V([[R, Y1], [0.33, 1.63], [0.305, 1.68], [0.296, 1.7], [0.3, 1.718], [0.288, 1.728], [0.276, 1.71], [0.27, 1.695], [0, 1.695]]), segs),
      m
    )
  );
  // tab
  const tab = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.008, 0.07), m);
  tab.position.set(0, 1.702, 0.12);
  g.add(tab);
  g.traverse((o) => (o.castShadow = false));
  return { group: g, radius: R };
}

export async function createAluBottle(renderer, { lowPower = false } = {}) {
  const segs = lowPower ? 56 : 96;
  const R = 0.42, Y0 = 0.08, Y1 = 1.8;
  const print = await makeVerticalPrint(renderer, {
    radius: R,
    height: Y1 - Y0,
    ink: INK.still,
    variety: 'STILL WATER',
    capacity: '500 ml',
    scale: lowPower ? 0.6 : 1,
  });
  const white = new THREE.MeshPhysicalMaterial({
    color: 0xf5f7f8,
    metalness: 0.04,
    roughness: 0.38,
    clearcoat: 0.8,
    clearcoatRoughness: 0.14,
    envMapIntensity: 0.85,
  });
  const g = new THREE.Group();
  g.add(new THREE.Mesh(lathe(V([[R, Y0], [R, Y1]]), segs), painted(print)));
  g.add(new THREE.Mesh(lathe(V([[0, 0.03], [0.3, 0.012], [0.39, 0.0], [0.415, 0.025], [R, Y0]]), segs), white));
  const shoulder = [[R, Y1], [0.415, 1.9], [0.39, 2.0], [0.33, 2.1], [0.25, 2.18], [0.19, 2.24], [0.165, 2.29], [0.162, 2.36]];
  g.add(new THREE.Mesh(lathe(V(shoulder), segs), white));
  // threaded neck + cap
  const capM = metal();
  g.add(new THREE.Mesh(lathe(V([[0.162, 2.36], [0.175, 2.38], [0.175, 2.4], [0, 2.4]]), segs), white));
  g.add(new THREE.Mesh(lathe(V([[0.18, 2.36], [0.188, 2.38], [0.188, 2.6], [0.18, 2.62], [0, 2.625]]), segs), capM));
  return { group: g, radius: R };
}
