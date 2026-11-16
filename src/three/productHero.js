import * as THREE from 'three';
import { webgl2, createRenderer, fontsReady, makeEnvironment, CAUSTICS_GLSL, clamp01, easeOut, lerp } from './common.js';
import { createPool } from './pool.js';
import { createGlassBottle, BOTTLE_RADIUS } from './glassBottle.js';
import { createCan, createAluBottle } from './packaging.js';
import { createWave } from './wave.js';

/*
 * Opening hero: the Lavaquell family on a low stone platform in a bright
 * pool, with a sculpted water wave sweeping behind. The products are static
 * and fully visible from the first frame; only the water moves.
 */

const SKY = {
  vertexShader: /* glsl */ `
    varying vec3 vDir;
    void main() {
      vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    varying vec3 vDir;
    void main() {
      vec3 d = normalize(vDir);
      vec3 top = vec3(0.86, 0.95, 0.98);
      vec3 hor = vec3(0.56, 0.86, 0.93);
      vec3 c = mix(hor, top, smoothstep(-0.02, 0.4, d.y));
      // soft daylight bloom behind the headline side
      c = mix(c, vec3(1.0), 0.55 * pow(max(dot(d, normalize(vec3(-0.6, 0.2, -1.0))), 0.0), 5.0));
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

function marbleTexture(renderer, size = 1024) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  // value noise + fbm
  const N = 256, perm = new Uint8Array(N * 2), grad = new Float32Array(N);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < N; i++) { perm[i] = i; grad[i] = rnd(); }
  for (let i = N - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < N; i++) perm[N + i] = perm[i];
  const v = (x, y) => grad[perm[(perm[x & 255] + y) & 255]];
  const sm = (t) => t * t * (3 - 2 * t);
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const a = v(xi, yi), b = v(xi + 1, yi), c2 = v(xi, yi + 1), d = v(xi + 1, yi + 1);
    const u = sm(xf), w = sm(yf);
    return a + (b - a) * u + (c2 - a) * w + (a - b - c2 + d) * u * w;
  };
  const fbm = (x, y) => { let s = 0, a = 0.5; for (let o = 0; o < 5; o++) { s += a * noise(x, y); x *= 2; y *= 2; a *= 0.5; } return s; };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / size * 6, ny = y / size * 6;
      const t = fbm(nx, ny);
      const vein = Math.pow(Math.abs(Math.sin((nx * 1.4 + ny * 0.6 + t * 5.0) * 1.8)), 0.22);
      const fine = Math.pow(Math.abs(Math.sin((nx * 3.1 - ny * 1.2 + fbm(nx * 2, ny * 2) * 6.0) * 2.4)), 0.12);
      const k = 0.86 + 0.14 * vein * (0.75 + 0.25 * fine) - (1 - fine) * 0.05;
      const i = (y * size + x) * 4;
      img.data[i] = 236 * k + 12;
      img.data[i + 1] = 238 * k + 12;
      img.data[i + 2] = 240 * k + 12;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(10,40,60,0.5)');
  grd.addColorStop(0.35, 'rgba(10,40,60,0.28)');
  grd.addColorStop(1, 'rgba(10,40,60,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export async function createProductHero(container, { reducedMotion = false, lowPower = false } = {}) {
  if (!webgl2()) return null;
  const renderer = createRenderer(container, { lowPower });
  if (!renderer) return null;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  await fontsReady();

  const scene = new THREE.Scene();
  scene.environment = makeEnvironment(renderer, { bright: true });
  const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 300);
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(140, 48, 24), new THREE.ShaderMaterial({ ...SKY, side: THREE.BackSide, depthWrite: false })));

  /* pool */
  const PLATFORM_R = 3.35, TOP = 0.36;
  const pool = createPool(renderer, { lowPower, reflect: !lowPower, simSize: 26, simCenter: [0, 3], caustics: 1.1 });
  pool.uniforms.uLight.value = 1;
  pool.uniforms.uFresScale.value = 0.45;
  pool.uniforms.uDeepLight.value.set(0.12, 0.62, 0.72);
  pool.uniforms.uFogRange.value.set(13, 32);
  pool.uniforms.uFogLight.value.set(0.56, 0.86, 0.93);
  pool.setObstacle(0, 0, 0, PLATFORM_R);
  pool.setRing(0, 0, 0, PLATFORM_R - 0.02, 1);
  scene.add(pool.mesh);

  /* platform: low stone disc with live caustics on its surface */
  const causticU = { uTime: { value: 0 } };
  const marble = marbleTexture(renderer, lowPower ? 512 : 1024);
  const stone = new THREE.MeshPhysicalMaterial({ map: marble, roughness: 0.42, clearcoat: 0.25, clearcoatRoughness: 0.3, envMapIntensity: 0.75 });
  stone.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = causticU.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWP;\nuniform float uTime;\n${CAUSTICS_GLSL}`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         float topMask = smoothstep(${(TOP - 0.03).toFixed(3)}, ${TOP.toFixed(3)}, vWP.y);
         float c = lavCaustic(vWP.xz * 0.2 + vec2(0.0, uTime * 0.01), uTime * 0.35);
         float c2 = lavCaustic(vWP.xz * 0.33 + 3.1, uTime * 0.27 + 2.0);
         totalEmissiveRadiance += vec3(0.55, 0.85, 1.0) * (c * 0.42 + c2 * 0.22) * mix(0.15, 1.0, topMask);
         diffuseColor.rgb *= mix(0.8, 1.0, topMask);`
      );
  };
  const platGeo = new THREE.LatheGeometry(
    [[PLATFORM_R, -0.4], [PLATFORM_R, TOP - 0.06], [PLATFORM_R - 0.04, TOP - 0.015], [PLATFORM_R - 0.12, TOP], [0, TOP]].map(
      ([r, y]) => new THREE.Vector2(r, y)
    ),
    lowPower ? 96 : 160
  );
  // planar UVs on the top so the marble doesn't swirl
  const pp = platGeo.attributes.position, puv = platGeo.attributes.uv;
  for (let i = 0; i < pp.count; i++) {
    const y = pp.getY(i);
    if (y > TOP - 0.02) puv.setXY(i, pp.getX(i) / 9 + 0.5, pp.getZ(i) / 9 + 0.5);
    else puv.setXY(i, Math.atan2(pp.getX(i), pp.getZ(i)) / Math.PI, y * 0.3);
  }
  scene.add(new THREE.Mesh(platGeo, stone));

  /* products (actual Lavaquell packaging) */
  const [still, sparkling, canStill, canSparkling, alu] = await Promise.all([
    createGlassBottle(renderer, { variant: 'still', lowPower, light: 1 }),
    createGlassBottle(renderer, { variant: 'sparkling', lowPower, light: 1 }),
    createCan(renderer, { variant: 'still', lowPower }),
    createCan(renderer, { variant: 'sparkling', lowPower }),
    createAluBottle(renderer, { lowPower }),
  ]);
  const shadowTex = shadowTexture();
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, toneMapped: false });
  const items = [
    { o: canStill.group, r: canStill.radius, x: -2.35, z: 0.55 },
    { o: still.group, r: BOTTLE_RADIUS, x: -1.12, z: -0.2, glass: still },
    { o: sparkling.group, r: BOTTLE_RADIUS, x: 0.22, z: -0.55, glass: sparkling },
    { o: canSparkling.group, r: canSparkling.radius, x: 1.42, z: 0.15 },
    { o: alu.group, r: alu.radius, x: 2.48, z: 0.6 },
  ];
  for (const it of items) {
    it.o.position.set(it.x, TOP, it.z);
    scene.add(it.o);
    if (it.glass) scene.add(it.glass.surface);
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadowMat);
    sh.rotation.x = -Math.PI / 2;
    sh.position.set(it.x + 0.12, TOP + 0.004, it.z - 0.1);
    sh.scale.set(it.r * 3.4, it.r * 2.8, 1);
    sh.renderOrder = -1;
    scene.add(sh);
  }

  /* sculpted water */
  const wave = createWave({ lowPower });
  scene.add(wave.group);

  /* droplets */
  const dropMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0, transmission: 1, thickness: 0.08, ior: 1.33, envMapIntensity: 2, clearcoat: 1 });
  const dropGeo = new THREE.SphereGeometry(0.06, 20, 14);
  const floaters = [0.14, 0.3, 0.7, 0.86].map((t, i) => {
    const m = new THREE.Mesh(dropGeo, dropMat);
    const base = wave.curves[0].getPointAt(t);
    base.z += 0.9;
    base.y += i % 2 ? 0.35 : -0.25;
    m.scale.setScalar(0.6 + (i % 3) * 0.25);
    scene.add(m);
    return { m, base, ph: i * 1.7 };
  });
  const drip = { m: new THREE.Mesh(dropGeo, dropMat), state: 'grow', t: 0, y: 0, v: 0, wait: 1.5 };
  drip.m.visible = false;
  scene.add(drip.m);

  /* layout */
  let sized = false;
  const look = new THREE.Vector3();
  const camBase = new THREE.Vector3();
  function layout() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    sized = true;
    renderer.setSize(w, h, false);
    const aspect = w / h;
    camera.aspect = aspect;
    if (aspect < 0.95) {
      // portrait: headline above, products in the lower half
      // fit the whole product row (plus a margin) across the stage width
      camera.fov = 30;
      const d = 7.4 / (2 * Math.tan(THREE.MathUtils.degToRad(15)) * aspect);
      camBase.set(0, 3.4, d);
      look.set(0, 2.55, 0);
      camera.filmOffset = 0;
    } else {
      camera.fov = 24;
      const fx = aspect > 1.6 ? 0.705 : 0.715;
      const d = 17.5 + Math.max(0, 1.75 - aspect) * 6;
      camBase.set(-0.8, 3.3, d);
      look.set(0, 2.45, 0);
      camera.updateProjectionMatrix();
      camera.filmOffset = -(fx - 0.5) * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect * camera.getFilmWidth();
    }
    camera.updateProjectionMatrix();
    pool.resize(w * renderer.getPixelRatio(), h * renderer.getPixelRatio(), lowPower ? 0.3 : 0.4);
    for (const it of items) it.o.rotation.y = Math.atan2(camBase.x - it.x, camBase.z - it.z);
    still.update(0); sparkling.update(0);
    needsRender = true;
  }

  /* pointer: disturb the wave locally, ripple the pool */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitP = new THREE.Vector3();
  let pointer = null, lastPool = null, pokeTarget = 0, active = true, needsRender = true;
  function cast(x, y) {
    const r = container.getBoundingClientRect();
    if (y < r.top || y > r.bottom) return null;
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    camera.updateMatrixWorld();
    ray.setFromCamera(ndc, camera);
    return ray;
  }
  const onMove = (e) => {
    if (!active || e.pointerType === 'touch') return;
    pointer = { x: e.clientX, y: e.clientY };
  };
  const onDown = (e) => {
    if (!active) return;
    const r = cast(e.clientX, e.clientY);
    if (!r) return;
    const hit = r.intersectObjects(wave.meshes, false)[0];
    if (hit) {
      wave.uniforms.uPointer.value.copy(hit.point);
      pokeTarget = 1.6;
    }
    if (r.ray.intersectPlane(plane, hitP) && Math.hypot(hitP.x, hitP.z) > PLATFORM_R + 0.1) pool.addDrop(hitP.x, hitP.z, 0.5, 0.35);
    needsRender = true;
  };
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerdown', onDown, { passive: true });

  function handlePointer() {
    if (!pointer) return;
    const r = cast(pointer.x, pointer.y);
    pointer = null;
    if (!r) { pokeTarget = 0; return; }
    const hit = r.intersectObjects(wave.meshes, false)[0];
    if (hit) {
      wave.uniforms.uPointer.value.lerp(hit.point, 0.5);
      pokeTarget = 1;
    } else pokeTarget = 0;
    if (r.ray.intersectPlane(plane, hitP) && Math.hypot(hitP.x, hitP.z) > PLATFORM_R + 0.1) {
      const p = hitP.clone();
      if (lastPool) {
        const d = p.distanceTo(lastPool);
        if (d > 0.1) {
          const steps = Math.min(4, Math.ceil(d / 0.35));
          for (let i = 1; i <= steps; i++) {
            const q = lastPool.clone().lerp(p, i / steps);
            pool.addDrop(q.x, q.z, 0.3, Math.min(0.08, 0.025 + d * 0.025));
          }
          lastPool = p;
        }
      } else lastPool = p;
    } else lastPool = null;
  }

  /* loop */
  let time = reducedMotion ? 4 : 0, intro = reducedMotion ? 1 : 0, last = performance.now(), raf = 0, frames = 0;
  function update(dt) {
    if (!reducedMotion) time += dt;
    intro = Math.min(1, intro + dt / 2.8);
    const e = easeOut(intro);
    wave.uniforms.uReveal.value = lerp(0.0, 1.16, e);
    wave.uniforms.uTime.value = time;
    causticU.uTime.value = time;
    pool.uniforms.uTime.value = time;
    // the pointer bulge eases in and settles back smoothly
    const amt = wave.uniforms.uPointerAmt;
    amt.value += (pokeTarget - amt.value) * Math.min(1, dt * (pokeTarget > amt.value ? 3 : 1.2));
    if (pokeTarget > 1) pokeTarget = Math.max(0, pokeTarget - dt * 1.5);

    camera.position.copy(camBase);
    camera.position.z += (1 - e) * 1.2;
    camera.position.y += (1 - e) * 0.25;
    camera.lookAt(look);

    if (!reducedMotion) {
      for (const f of floaters) {
        f.m.position.set(
          f.base.x + Math.sin(time * 0.35 + f.ph) * 0.18,
          f.base.y + Math.sin(time * 0.5 + f.ph * 1.3) * 0.14,
          f.base.z + Math.cos(time * 0.3 + f.ph) * 0.1
        );
        f.m.visible = e > 0.7;
      }
      // a single drip forms at the crest tip, falls, and ripples the pool
      const tip = wave.tip;
      drip.wait -= dt;
      if (drip.wait <= 0) {
        if (drip.state === 'grow') {
          drip.t += dt / 1.1;
          drip.m.visible = true;
          drip.m.position.set(tip.x, tip.y - 0.08 - drip.t * 0.08, tip.z);
          drip.m.scale.set(0.8 * drip.t, 0.95 * drip.t, 0.8 * drip.t);
          if (drip.t >= 1) { drip.state = 'fall'; drip.y = drip.m.position.y; drip.v = 0; }
        } else {
          drip.v += 9.8 * 0.6 * dt;
          drip.y -= drip.v * dt;
          drip.m.position.y = drip.y;
          drip.m.scale.set(0.75, 1.15, 0.75);
          if (drip.y <= 0) {
            pool.addDrop(tip.x, tip.z, 0.32, 0.12);
            drip.m.visible = false;
            drip.state = 'grow';
            drip.t = 0;
            drip.wait = 3.5 + Math.random() * 2.5;
          }
        }
      }
      // faint lapping at the platform edge
      if (Math.random() < dt * 0.6) {
        const a = Math.random() * Math.PI * 2;
        pool.addDrop(Math.cos(a) * (PLATFORM_R + 0.4), Math.sin(a) * (PLATFORM_R + 0.4), 0.3, 0.02);
      }
    }
  }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    frames++;
    if (!active || !sized) return;
    handlePointer();
    const settling = pool.step(dt);
    if (reducedMotion && !needsRender && !settling && Math.abs(wave.uniforms.uPointerAmt.value - pokeTarget) < 0.01) return;
    update(dt);
    renderer.render(scene, camera);
    needsRender = false;
  }

  const ro = new ResizeObserver(layout);
  ro.observe(container);
  layout();
  if (sized) { update(0); renderer.render(scene, camera); }
  container.classList.add('is-ready');
  raf = requestAnimationFrame(frame);

  return {
    interactive: pool.interactive,
    setActive(v) { active = v; if (v) last = performance.now(); },
    debug: () => ({ frames, sized, active, poke: +wave.uniforms.uPointerAmt.value.toFixed(3), pointer: wave.uniforms.uPointer.value.toArray().map((v) => +v.toFixed(2)) }),
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      renderer.dispose();
    },
  };
}
