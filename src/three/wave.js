import * as THREE from 'three';

/*
 * Sculpted water: a sheet of water swept along a curve, with an elliptical,
 * twisting cross-section. It is drawn with a transmissive (refracting)
 * material and animated in the vertex shader:
 *   - travelling waves along its length (slow flow) + gentle breathing
 *   - a local, decaying bulge where the pointer touches it
 *   - a reveal that grows the sheet from its base on load
 * The fragment shader adds flowing normal detail so highlights travel along it.
 */

function sweep(curve, { segments, radial, width, thickness, twist }) {
  const frames = curve.computeFrenetFrames(segments, false);
  const pos = [], ctr = [], uv = [], idx = [];
  const C = new THREE.Vector3(), A1 = new THREE.Vector3(), A2 = new THREE.Vector3(), P = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(t, C);
    const N = frames.normals[i], B = frames.binormals[i];
    const phi = twist(t);
    A1.copy(N).multiplyScalar(Math.cos(phi)).addScaledVector(B, Math.sin(phi));
    A2.copy(N).multiplyScalar(-Math.sin(phi)).addScaledVector(B, Math.cos(phi));
    const a = width(t), b = thickness(t);
    for (let j = 0; j <= radial; j++) {
      const th = (j / radial) * Math.PI * 2;
      P.copy(C).addScaledVector(A1, Math.cos(th) * a).addScaledVector(A2, Math.sin(th) * b);
      pos.push(P.x, P.y, P.z);
      ctr.push(C.x, C.y, C.z);
      uv.push(t, j / radial);
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aCenter', new THREE.Float32BufferAttribute(ctr, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function createWave({ lowPower = false } = {}) {
  const uniforms = {
    uTime: { value: 0 },
    uReveal: { value: 0 },
    uPointer: { value: new THREE.Vector3(0, -100, 0) },
    uPointerAmt: { value: 0 },
  };

  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0,
    roughness: 0.02,
    transmission: 1,
    thickness: 0.55,
    ior: 1.333,
    attenuationColor: new THREE.Color(0x9fdcea),
    attenuationDistance: 1.6,
    specularIntensity: 1,
    envMapIntensity: 1.6,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    side: THREE.FrontSide,
  });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uTime; uniform float uReveal; uniform vec3 uPointer; uniform float uPointerAmt;
         attribute vec3 aCenter;
         varying vec2 vLav;`
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3(position);
         float t = uv.x;
         vLav = uv;
         // grow from the base on load
         float grow = 1.0 - smoothstep(uReveal - 0.12, uReveal, t);
         float tipTaper = smoothstep(1.0, 0.86, t) * smoothstep(0.0, 0.05, t);
         vec3 rel = position - aCenter;
         transformed = aCenter + rel * mix(0.0, 1.0, grow) * (0.35 + 0.65 * tipTaper);
         // slow flow along the sheet + breathing
         float flow = sin(t * 16.0 - uTime * 0.9) * 0.05 + sin(t * 6.0 - uTime * 0.45 + uv.y * 6.2831) * 0.035;
         float breathe = sin(uTime * 0.4 + t * 3.0) * 0.06;
         vec3 wp = (modelMatrix * vec4(aCenter, 1.0)).xyz;
         float pd = distance(wp, uPointer);
         float poke = exp(-pd * pd * 1.2) * uPointerAmt;
         vec3 dir = normalize(rel + 1e-5);
         transformed += dir * (flow * grow + poke * (0.22 + 0.06 * sin(uTime * 3.0 - pd * 5.0)));
         transformed += vec3(0.0, breathe, 0.0) * grow;`
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
         uniform float uTime;
         varying vec2 vLav;`)
      .replace(
        '#include <opaque_fragment>',
        `{
           float fr = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 2.2);
           // aqua body at the thick edges, bright rims, and highlights travelling along the flow
           outgoingLight = mix(outgoingLight, outgoingLight * vec3(0.45, 0.82, 0.92), clamp(fr * 0.85, 0.0, 1.0));
           outgoingLight += vec3(0.85, 1.0, 1.0) * pow(fr, 5.0) * 0.55;
           float st = pow(0.5 + 0.5 * sin(vLav.x * 95.0 - uTime * 1.7 + vLav.y * 22.0), 28.0);
           float st2 = pow(0.5 + 0.5 * sin(vLav.x * 41.0 - uTime * 1.1 - vLav.y * 13.0), 36.0);
           outgoingLight += vec3(1.0) * (st * 0.35 + st2 * 0.25) * (0.25 + fr);
         }
         #include <opaque_fragment>`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
         {
           float a = vLav.x * 70.0 - uTime * 1.6 + vLav.y * 9.0;
           float b = vLav.x * 31.0 - uTime * 0.9 - vLav.y * 14.0;
           normal = normalize(normal + vec3(sin(a) * 0.07 + sin(b) * 0.05, cos(a * 0.7) * 0.05, 0.0));
         }`
      );
  };

  const segs = lowPower ? 140 : 260;
  const radial = lowPower ? 18 : 30;

  // main arch: rises from the pool at front left, sweeps behind the products, falls at right
  const arch = new THREE.CatmullRomCurve3(
    [
      [-3.6, -0.15, 1.3], [-3.2, 1.0, -0.3], [-2.55, 2.6, -1.5], [-1.4, 4.1, -2.2], [0.3, 5.05, -2.45],
      [2.4, 5.1, -2.15], [3.85, 4.1, -1.55], [4.6, 2.5, -0.95], [4.9, 1.0, -0.35], [4.95, -0.15, 0.2],
    ].map((p) => new THREE.Vector3(...p)),
    false,
    'centripetal'
  );
  const archGeo = sweep(arch, {
    segments: segs,
    radial,
    width: (t) => 0.22 + Math.sin(Math.PI * t) * 0.62,
    thickness: (t) => 0.05 + Math.sin(Math.PI * t) * 0.08,
    twist: (t) => 0.9 + t * 2.6,
  });

  // the crest folding forward over the left, dripping from its tip
  const curl = new THREE.CatmullRomCurve3(
    [[-0.7, 4.6, -2.4], [-1.8, 5.25, -1.85], [-2.85, 5.0, -1.1], [-3.4, 4.15, -0.55], [-3.35, 3.4, -0.25]].map(
      (p) => new THREE.Vector3(...p)
    ),
    false,
    'centripetal'
  );
  const curlGeo = sweep(curl, {
    segments: Math.round(segs * 0.45),
    radial,
    width: (t) => 0.5 * (1 - t) + 0.08,
    thickness: (t) => 0.13 * (1 - t) + 0.05,
    twist: (t) => 2.0 + t * 1.8,
  });

  const group = new THREE.Group();
  const arcMesh = new THREE.Mesh(archGeo, mat);
  const curlMesh = new THREE.Mesh(curlGeo, mat);
  group.add(arcMesh, curlMesh);
  return {
    group,
    meshes: [arcMesh, curlMesh],
    uniforms,
    tip: curl.getPointAt(1),
    curves: [arch, curl],
  };
}
