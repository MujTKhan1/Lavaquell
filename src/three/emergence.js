import * as THREE from 'three';
import { webgl2, createRenderer, fontsReady, makeEnvironment, range, lerp, easeInOut, smoother } from './common.js';
import { createPool } from './pool.js';
import { createGlbBottle } from './glbBottle.js';

/*
 * Section two: a calm pool; as the visitor scrolls through this section, the
 * water-filled Lavaquell bottle rises through the surface (with its own
 * ripple), turns once to show glass, water and air, and settles label-forward.
 * Progress is driven only by this section's own scroll position.
 */

const SKY = {
  vertexShader: /* glsl */ `
    varying vec3 vDir;
    void main() {
      vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform float uLight;
    uniform float uTime;
    varying vec3 vDir;
    void main() {
      vec3 d = normalize(vDir);
      float y = d.y;
      vec3 topD = vec3(0.50, 0.76, 0.86), horD = vec3(0.42, 0.74, 0.86);
      vec3 topL = vec3(0.80, 0.92, 0.96), horL = vec3(0.60, 0.86, 0.93);
      vec3 top = mix(topD, topL, uLight), hor = mix(horD, horL, uLight);
      vec3 c = mix(hor, top, smoothstep(-0.02, 0.6, y));
      c += vec3(0.08, 0.1, 0.1) * pow(max(dot(d, normalize(vec3(0.0, 0.12, -1.0))), 0.0), 10.0);
      float ang = atan(d.x, -d.z);
      float cols = pow(0.5 + 0.5 * sin(ang * 14.0 + 0.6), 10.0) * 0.7
                 + pow(0.5 + 0.5 * sin(ang * 31.0 + 2.1 + uTime * 0.02), 14.0) * 0.4;
      c += vec3(0.08, 0.12, 0.13) * cols * smoothstep(0.0, 0.3, y) * (1.0 - smoothstep(0.35, 0.9, y));
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

export async function createEmergence(container, { reducedMotion = false, lowPower = false } = {}) {
  if (!webgl2()) return null;
  const renderer = createRenderer(container, { lowPower });
  if (!renderer) return null;
  renderer.toneMapping = THREE.NeutralToneMapping;
  await fontsReady();

  const scene = new THREE.Scene();
  // studio lighting for glass: crisp strip highlights against darker surroundings
  scene.environment = makeEnvironment(renderer, { studio: true });
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  const skyMat = new THREE.ShaderMaterial({ ...SKY, uniforms: { uLight: { value: 0 }, uTime: { value: 0 } }, side: THREE.BackSide, depthWrite: false });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(90, 48, 24), skyMat));

  const pool = createPool(renderer, { lowPower, reflect: true, simSize: 22, simCenter: [0, 1.5], caustics: 0.25 });
  pool.uniforms.uDeepLight.value.set(0.1, 0.5, 0.62);
  pool.uniforms.uFogLight.value.set(0.6, 0.86, 0.93);
  pool.uniforms.uFresScale.value = 0.8;
  scene.add(pool.mesh);

  const bottle = await createGlbBottle(renderer, { light: 0.6 });
  scene.add(bottle.group, bottle.surface);
  const B = bottle.group;

  const L = { cam: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], tgt: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] };
  let sized = false, needsRender = true;
  function layout() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    sized = true;
    renderer.setSize(w, h, false);
    const aspect = w / h;
    camera.aspect = aspect;
    if (aspect < 0.95) {
      camera.fov = 38;
      const z = 11.6 + Math.max(0, 0.6 - aspect) * 5;
      L.cam[0].set(0, 1.6, z);       L.tgt[0].set(0, 1.4, 0);
      L.cam[1].set(0.4, 1.5, z - 1.0); L.tgt[1].set(0, 2.7, 0);
      L.cam[2].set(0, 1.9, z - 1.4); L.tgt[2].set(0, 2.5, 0);
    } else {
      camera.fov = 30;
      const narrow = aspect < 1.65 ? (1.65 - aspect) * 2.4 : 0;
      L.cam[0].set(0, 1.9, 11.2 + narrow); L.tgt[0].set(0, 1.0, 0);
      L.cam[1].set(1.0, 1.4, 10.8 + narrow); L.tgt[1].set(0, 2.0, 0);
      L.cam[2].set(0, 1.7, 10.6 + narrow); L.tgt[2].set(0, 2.05, 0);
    }
    camera.updateProjectionMatrix();
    pool.resize(w * renderer.getPixelRatio(), h * renderer.getPixelRatio(), lowPower ? 0.33 : 0.5);
    needsRender = true;
  }

  let frames = 0;
  let progress = 0, smoothP = 0, active = false, time = 0, last = performance.now(), prevY = null, raf = 0;
  const tmpT = new THREE.Vector3();
  const camAt = (e, out, arr) =>
    e < 0.5 ? out.lerpVectors(arr[0], arr[1], smoother(e / 0.5)) : out.lerpVectors(arr[1], arr[2], smoother((e - 0.5) / 0.5));

  function update(dt) {
    const follow = reducedMotion ? 1 : 1 - Math.exp(-dt * 6);
    smoothP += (progress - smoothP) * follow;
    const p = smoothP;
    if (!reducedMotion) time += dt;
    const rm = reducedMotion;
    // calm surface first, then the rise, the turn, and the settle
    const rise = rm ? 1 : easeInOut(range(p, 0.08, 0.45));
    const turn = rm ? 1 : easeInOut(range(p, 0.35, 0.9));
    const camE = rm ? 1 : range(p, 0.05, 1);

    camAt(camE, camera.position, L.cam);
    camAt(camE, tmpT, L.tgt);
    camera.lookAt(tmpT);

    const bob = rm ? 0 : Math.sin(time * 0.9) * 0.02 * rise;
    const y = lerp(-4.3, -0.05, rise) + bob;
    B.position.set(0, y, 0);
    B.visible = y > -4.25;
    const face = Math.atan2(camera.position.x, camera.position.z);
    B.rotation.y = face - 0.55 + turn * (Math.PI * 2 + 0.55);
    const tiltT = rm ? 0 : range(p, 0.35, 0.92);
    B.rotation.z = Math.sin(tiltT * Math.PI) * 0.14;
    B.rotation.x = Math.sin(tiltT * Math.PI * 2) * -0.05;
    bottle.update(dt, { hideBelow: 0.02 });

    if (dt > 0 && prevY !== null) {
      const speed = Math.abs(y - prevY) / dt;
      if (y < 0.2 && y > -4.2 && speed > 0.02) pool.addDrop(0, 0, bottle.radius + 0.35, Math.min(0.02, speed * 0.01));
    }
    prevY = y;
    if (!rm && Math.random() < dt * 0.5) pool.addDrop((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, 0.3, 0.008);
    pool.setObstacle(0, 0, 0, bottle.radius - 0.02, B.visible);
    pool.setRing(0, 0, 0, bottle.radius + 0.01, B.visible ? 1 : 0);

    const light = rm ? 1 : 0.55 + 0.45 * easeInOut(range(p, 0.4, 1));
    skyMat.uniforms.uLight.value = light;
    pool.uniforms.uLight.value = light;
    bottle.setLight(light);
    skyMat.uniforms.uTime.value = time;
    pool.uniforms.uTime.value = time;
    renderer.toneMappingExposure = 1.0;
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    frames++;
    if (!active || !sized) return;
    const settling = Math.abs(progress - smoothP) > 1e-4;
    const waves = pool.step(dt);
    if (reducedMotion && !needsRender && !settling && !waves) return;
    update(dt);
    renderer.render(scene, camera);
    needsRender = false;
  }

  /* taps ripple the pool */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  let lastHit = null;
  const poolPoint = (x, y) => {
    const r = container.getBoundingClientRect();
    if (y < r.top || y > r.bottom) return null;
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    camera.updateMatrixWorld();
    ray.setFromCamera(ndc, camera);
    return ray.ray.intersectPlane(plane, hit) ? hit.clone() : null;
  };
  const onDown = (e) => {
    if (!active) return;
    const pt = poolPoint(e.clientX, e.clientY);
    if (pt) { pool.addDrop(pt.x, pt.z, 0.5, 0.4); needsRender = true; }
  };
  const onMove = (e) => {
    if (!active || e.pointerType === 'touch') return;
    const pt = poolPoint(e.clientX, e.clientY);
    if (!pt) { lastHit = null; return; }
    if (lastHit && pt.distanceTo(lastHit) > 0.1) {
      const d = pt.distanceTo(lastHit);
      pool.addDrop(pt.x, pt.z, 0.3, Math.min(0.08, 0.025 + d * 0.025));
    }
    lastHit = pt;
  };
  window.addEventListener('pointerdown', onDown, { passive: true });
  window.addEventListener('pointermove', onMove, { passive: true });

  const ro = new ResizeObserver(layout);
  ro.observe(container);
  layout();
  if (sized) { update(0); renderer.render(scene, camera); }
  container.classList.add('is-ready');
  raf = requestAnimationFrame(frame);

  return {
    setProgress(p) { if (Math.abs(p - progress) > 1e-4) { progress = p; needsRender = true; } },
    setActive(v) { active = v; if (v) { last = performance.now(); needsRender = true; } },
    debug: () => { const bb = new THREE.Box3().setFromObject(B); return { progress, smoothP: +smoothP.toFixed(3), active, sized, y: +B.position.y.toFixed(2), frames, box: [bb.min.toArray().map((v) => +v.toFixed(2)), bb.max.toArray().map((v) => +v.toFixed(2))] }; },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      renderer.dispose();
    },
  };
}
