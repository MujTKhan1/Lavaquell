import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { CAUSTICS_GLSL } from './common.js';

/*
 * Interactive pool: a height-field wave simulation (ping-pong half-float
 * render targets) shaded as a reflective water surface. Drops come from the
 * pointer, taps and scene events; circular obstacles reflect the waves.
 */

const SIM_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const SIM_UPDATE = /* glsl */ `
  uniform sampler2D tex;
  uniform vec2 delta;
  uniform vec4 uObs[2]; // xy uv centre, z radius (uv), w active
  varying vec2 vUv;
  void main() {
    vec4 info = texture2D(tex, vUv);
    vec2 dx = vec2(delta.x, 0.0), dy = vec2(0.0, delta.y);
    float avg = (texture2D(tex, vUv - dx).r + texture2D(tex, vUv + dx).r +
                 texture2D(tex, vUv - dy).r + texture2D(tex, vUv + dy).r) * 0.25;
    info.g += (avg - info.r) * 0.32;
    info.g *= 0.988;
    info.r += info.g;
    info.r *= 0.9992;
    float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    info.rg *= mix(0.94, 1.0, smoothstep(0.0, 0.08, edge));
    for (int i = 0; i < 2; i++) {
      if (uObs[i].w > 0.5 && length(vUv - uObs[i].xy) < uObs[i].z) info.rg = vec2(0.0);
    }
    gl_FragColor = info;
  }`;

const SIM_DROP = /* glsl */ `
  #define MAX_DROPS 8
  uniform sampler2D tex;
  uniform vec4 uDrops[MAX_DROPS];
  uniform int uCount;
  varying vec2 vUv;
  void main() {
    vec4 info = texture2D(tex, vUv);
    for (int i = 0; i < MAX_DROPS; i++) {
      if (i >= uCount) break;
      vec4 d = uDrops[i];
      float k = max(0.0, 1.0 - length(d.xy - vUv) / d.z);
      k = 0.5 - cos(k * 3.14159265) * 0.5;
      info.r += k * d.w;
    }
    gl_FragColor = info;
  }`;

const POOL_VERT = /* glsl */ `
  uniform mat4 textureMatrix;
  varying vec4 vUvR;
  varying vec3 vWorld;
  void main() {
    vUvR = textureMatrix * vec4(position, 1.0);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const POOL_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform sampler2D tSim;
  uniform vec2 uSimCenter;
  uniform float uSimSize;
  uniform float uTexel;
  uniform float uTime;
  uniform float uLight;
  uniform float uCaustics;
  uniform float uFresScale;
  uniform vec3 uDeepLight;
  uniform vec2 uFogRange;
  uniform vec3 uFogLight;
  uniform vec4 uRings[2]; // x, z, radius, presence
  varying vec4 vUvR;
  varying vec3 vWorld;
  ${CAUSTICS_GLSL}

  float swell(vec2 p) {
    return sin(dot(p, vec2(0.8, 0.6)) * 1.3 + uTime * 0.7) * 0.006
         + sin(dot(p, vec2(-0.5, 0.9)) * 2.4 + uTime * 1.05) * 0.0035
         + sin(dot(p, vec2(0.95, -0.3)) * 5.0 + uTime * 1.6) * 0.0015;
  }

  void main() {
    vec2 p = vWorld.xz;
    float e = 0.02;
    vec2 g = vec2(swell(p + vec2(e, 0.0)) - swell(p - vec2(e, 0.0)),
                  swell(p + vec2(0.0, e)) - swell(p - vec2(0.0, e))) / (2.0 * e);

    vec2 suv = (p - uSimCenter) / uSimSize + 0.5;
    float inSim = step(0.0, suv.x) * step(suv.x, 1.0) * step(0.0, suv.y) * step(suv.y, 1.0);
    float worldTexel = uSimSize * uTexel;
    float hL = texture2D(tSim, suv - vec2(uTexel, 0.0)).r;
    float hR = texture2D(tSim, suv + vec2(uTexel, 0.0)).r;
    float hD = texture2D(tSim, suv - vec2(0.0, uTexel)).r;
    float hU = texture2D(tSim, suv + vec2(0.0, uTexel)).r;
    vec2 gs = vec2(hR - hL, hU - hD) / (2.0 * worldTexel) * 1.6 * inSim;
    g += gs;

    vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
    vec3 V = normalize(cameraPosition - vWorld);
    float dist = length(cameraPosition - vWorld);

    vec3 fogD = vec3(0.012, 0.075, 0.16);
    vec3 fog = mix(fogD, uFogLight, uLight);
  #ifdef NO_REFLECT
    vec3 R = reflect(-V, N);
    vec3 refl = mix(fog, mix(vec3(0.002, 0.012, 0.03), vec3(0.3, 0.6, 0.82), uLight), clamp(R.y * 1.6, 0.0, 1.0));
  #else
    vec2 ruv = vUvR.xy / vUvR.w + N.xz * 0.22;
    vec3 refl = texture2D(tDiffuse, ruv).rgb;
  #endif

    float fres = 0.03 + 0.97 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
    fres = clamp(fres * 1.1 * uFresScale, 0.0, 1.0);

    vec3 deep = mix(vec3(0.004, 0.02, 0.04), uDeepLight, uLight);
    vec3 col = mix(deep, refl, fres);

    // caustic light dancing on the shallow floor, bent by the ripples
    if (uCaustics > 0.0) {
      float c = lavCaustic(p * 0.16 + gs * 0.6, uTime * 0.35);
      col += vec3(0.75, 0.95, 1.0) * c * uCaustics * (1.0 - fres) * smoothstep(30.0, 6.0, dist);
    }

    float lit = dot(gs, normalize(vec2(-0.35, 0.94)));
    col += mix(vec3(0.35, 0.65, 0.9), vec3(0.9, 0.97, 1.0), uLight) * clamp(lit, -0.6, 1.2) * 0.32;
    col += vec3(0.55, 0.85, 1.0) * smoothstep(0.03, 0.35, length(gs)) * 0.22 * (1.0 - uLight * 0.4);

    for (int i = 0; i < 2; i++) {
      vec4 r = uRings[i];
      float d = length(p - r.xy);
      col += vec3(0.6, 0.85, 1.0) * exp(-pow((d - r.z) * 45.0, 2.0)) * 0.3 * r.w;
    }

    vec3 L = normalize(vec3(-0.45, 0.4, -0.8));
    float spec = pow(max(dot(reflect(-V, N), L), 0.0), 380.0);
    col += vec3(1.0, 0.97, 0.92) * spec * 2.4;

    col = mix(col, fog, smoothstep(uFogRange.x, uFogRange.y, dist));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export function createPool(renderer, { lowPower = false, reflect = true, simSize = 22, simCenter = [0, 1.5], caustics = 0 } = {}) {
  const gl = renderer.getContext();
  const floatOK = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
  const SIM = lowPower ? 192 : 256;
  const center = new THREE.Vector2(...simCenter);

  const uniforms = {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    tSim: { value: null },
    uSimCenter: { value: center.clone() },
    uSimSize: { value: simSize },
    uTexel: { value: 1 / SIM },
    uTime: { value: 0 },
    uLight: { value: 0 },
    uCaustics: { value: caustics },
    uFresScale: { value: 1 },
    uDeepLight: { value: new THREE.Vector3(0.12, 0.40, 0.55) },
    uFogRange: { value: new THREE.Vector2(9, 36) },
    uFogLight: { value: new THREE.Vector3(0.56, 0.80, 0.92) },
    uRings: { value: [new THREE.Vector4(), new THREE.Vector4()] },
  };

  let mesh;
  if (reflect) {
    mesh = new Reflector(new THREE.PlaneGeometry(160, 160), {
      shader: { uniforms, vertexShader: POOL_VERT, fragmentShader: POOL_FRAG },
      textureWidth: 512,
      textureHeight: 512,
      clipBias: 0.002,
      multisample: lowPower ? 0 : 4,
    });
  } else {
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...uniforms, textureMatrix: { value: new THREE.Matrix4() } },
      vertexShader: POOL_VERT,
      fragmentShader: POOL_FRAG,
      defines: { NO_REFLECT: '' },
    });
    mesh = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), mat);
  }
  mesh.rotation.x = -Math.PI / 2;
  const u = mesh.material.uniforms;

  // simulation
  const rtOpts = {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
  };
  let simA = floatOK ? new THREE.WebGLRenderTarget(SIM, SIM, rtOpts) : null;
  let simB = floatOK ? new THREE.WebGLRenderTarget(SIM, SIM, rtOpts) : null;
  const simScene = new THREE.Scene();
  const simCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  simScene.add(quad);
  const updateMat = new THREE.ShaderMaterial({
    vertexShader: SIM_VERT,
    fragmentShader: SIM_UPDATE,
    uniforms: {
      tex: { value: null },
      delta: { value: new THREE.Vector2(1 / SIM, 1 / SIM) },
      uObs: { value: [new THREE.Vector4(), new THREE.Vector4()] },
    },
  });
  const dropMat = new THREE.ShaderMaterial({
    vertexShader: SIM_VERT,
    fragmentShader: SIM_DROP,
    uniforms: { tex: { value: null }, uDrops: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) }, uCount: { value: 0 } },
  });
  const pending = [];
  if (floatOK) {
    const prev = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(simA); renderer.clear();
    renderer.setRenderTarget(simB); renderer.clear();
    renderer.setRenderTarget(null);
    renderer.setClearAlpha(prev);
  }
  function pass(mat) {
    mat.uniforms.tex.value = simA.texture;
    quad.material = mat;
    renderer.setRenderTarget(simB);
    renderer.render(simScene, simCam);
    [simA, simB] = [simB, simA];
  }
  const toSim = (x, z) => new THREE.Vector2((x - center.x) / simSize + 0.5, (z - center.y) / simSize + 0.5);
  let energy = 0;

  return {
    mesh,
    uniforms: u,
    interactive: floatOK,
    toSim,
    addDrop(x, z, radiusWorld, strength) {
      if (!floatOK) return false;
      const uv = toSim(x, z);
      if (uv.x < 0 || uv.x > 1 || uv.y < 0 || uv.y > 1) return false;
      if (pending.length >= 8) pending.shift();
      pending.push(new THREE.Vector4(uv.x, uv.y, radiusWorld / simSize, strength));
      return true;
    },
    /** i: 0|1, world x/z, world radius, active */
    setObstacle(i, x, z, r, on = true) {
      const uv = toSim(x, z);
      updateMat.uniforms.uObs.value[i].set(uv.x, uv.y, r / simSize, on ? 1 : 0);
    },
    setRing(i, x, z, r, presence) {
      u.uRings.value[i].set(x, z, r, presence);
    },
    /** advance one simulation step; returns true while waves are still settling */
    step(dt) {
      energy = Math.max(0, energy - dt);
      if (!floatOK) return false;
      if (pending.length) {
        dropMat.uniforms.uCount.value = pending.length;
        pending.forEach((d, i) => dropMat.uniforms.uDrops.value[i].copy(d));
        pending.length = 0;
        pass(dropMat);
        energy = 5;
      }
      pass(updateMat);
      renderer.setRenderTarget(null);
      u.tSim.value = simA.texture;
      return energy > 0;
    },
    resize(w, h, scale) {
      if (mesh.getRenderTarget) mesh.getRenderTarget().setSize(Math.max(2, Math.round(w * scale)), Math.max(2, Math.round(h * scale)));
    },
  };
}
