// Darkroom 3D engine v0 — "one room, three depths", real camera.
// Deterministic: scenes expose renderAt(t); nothing depends on wall-clock time or Math.random.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

export const W = 1920, H = 1080;

// ---------- palette (provisional; see channel/bible.md §2) ----------
export const PAL = {
  black: 0x060708,
  desk: 0x0d0d0e,
  key: 0xffe6c8,          // warm key light
  usBlue: new THREE.Color(0.30, 0.62, 1.0),
  inOrange: new THREE.Color(1.0, 0.52, 0.16),
  border: new THREE.Color(0.26, 0.30, 0.36),
  paper: '#e8dfcd',
  ink: '#1b1a17',
  accent: '#c9412a',
};

// ---------- small math ----------
export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, k) => a + (b - a) * k;
export const seg = (t, a, b) => clamp((t - a) / (b - a));
export const smooth = k => { k = clamp(k); return k * k * (3 - 2 * k); };
export const easeInOut = k => { k = clamp(k); return k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; };
export const easeOut = k => 1 - Math.pow(1 - clamp(k), 3);
export function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1e9) / 1e9; }; }

// ---------- renderer + post chain ----------
export function makeStage(canvasParent) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1); renderer.setSize(W, H);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  canvasParent.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PAL.black);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.12;

  const camera = new THREE.PerspectiveCamera(30, W / H, 0.05, 200);
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(1); composer.setSize(W, H);
  composer.addPass(new RenderPass(scene, camera));
  const bokeh = new BokehPass(scene, camera, { focus: 3, aperture: 0.002, maxblur: 0.012 });
  composer.addPass(bokeh);
  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.75, 0.5, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  return { renderer, scene, camera, composer, bokeh, bloom, grade, env };
}

// final grade in display space: radial chromatic aberration, vignette, film grain
export const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uCA: { value: 0.0016 }, uVig: { value: 0.55 }, uGrain: { value: 0.045 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uCA, uVig, uGrain; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime*61.7) * 43758.5453); }
    void main(){
      vec2 d = vUv - 0.5; float r2 = dot(d,d);
      vec2 off = d * uCA * (0.4 + 3.0*r2);
      vec3 c;
      c.r = texture2D(tDiffuse, vUv + off).r;
      c.g = texture2D(tDiffuse, vUv).g;
      c.b = texture2D(tDiffuse, vUv - off).b;
      c *= 1.0 - uVig * smoothstep(0.08, 0.62, r2*1.6);
      float g = h(vUv*vec2(1920.0,1080.0)) - 0.5;
      c += g * uGrain * (0.35 + 0.65*(1.0 - dot(c, vec3(0.333))));
      gl_FragColor = vec4(c, 1.0);
    }`,
};

// ---------- desk ----------
export function makeDesk() {
  const c = document.createElement('canvas'); c.width = c.height = 2048;
  const g = c.getContext('2d'); const r = rng(7);
  g.fillStyle = '#1a1918'; g.fillRect(0, 0, 2048, 2048);
  for (let i = 0; i < 5000; i++) {
    const y = r() * 2048, x = r() * 2048, len = 120 + r() * 700, a = .02 + r() * .05;
    g.strokeStyle = r() < .5 ? `rgba(255,240,220,${a})` : `rgba(0,0,0,${a * 2})`; g.lineWidth = .5 + r() * 2;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + len, y + (r() - .5) * 6); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(6, 6);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const mat = new THREE.MeshStandardMaterial({ color: 0x555049, map: tex, roughness: 0.82, metalness: 0.0, envMapIntensity: 0.0 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(120, 80), mat);
  m.rotation.x = -Math.PI / 2; m.receiveShadow = true;
  return m;
}

// ---------- canvas helpers ----------
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

// ---------- the vial ----------
// height ~1.2 units; label faces +z at rotation 0
export function makeVial(opts = {}) {
  const grp = new THREE.Group();
  const R = 0.30, bodyH = 0.78, sh = 0.08, neckR = 0.17, neckH = 0.07;
  const prof = [[0, 0], [R - .03, 0], [R, .03], [R, bodyH], [R - .03, bodyH + sh * .55], [neckR + .02, bodyH + sh], [neckR, bodyH + sh + .01], [neckR, bodyH + sh + neckH], [neckR + .025, bodyH + sh + neckH + .015], [neckR + .025, bodyH + sh + neckH + .04], [0, bodyH + sh + neckH + .04]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 1, thickness: 0.12, roughness: 0.04, ior: 1.5, metalness: 0, envMap: opts.env || null, envMapIntensity: 2.2, specularIntensity: 1, clearcoat: 1, clearcoatRoughness: 0.05, attenuationColor: new THREE.Color(0.92, 0.96, 1.0), attenuationDistance: 2 });
  const body = new THREE.Mesh(new THREE.LatheGeometry(prof, 96), glass); body.castShadow = true;
  grp.add(body);
  // liquid
  const liq = new THREE.Mesh(new THREE.CylinderGeometry(R - .028, R - .028, bodyH * .7, 72),
    new THREE.MeshPhysicalMaterial({ color: 0xf0d27a, transmission: 0.75, thickness: 0.5, roughness: .08, ior: 1.34, attenuationColor: new THREE.Color(0.95, 0.75, 0.3), attenuationDistance: 0.6 }));
  liq.position.y = .03 + bodyH * .35; grp.add(liq);
  // label (wrapped, front-facing)
  const labelTex = canvasTex(1024, 380, (g, w, h) => {
    g.fillStyle = PAL.paper; g.fillRect(0, 0, w, h);
    g.fillStyle = PAL.ink; g.textAlign = 'center';
    g.font = '600 92px "Inter Tight"'; g.fillText('LENACAPAVIR', w / 2, 132);
    g.font = '400 40px "Inter Tight"'; g.fillStyle = 'rgba(27,26,23,.78)';
    g.fillText('injection · for subcutaneous use', w / 2, 200);
    g.fillText('463.5 mg / 1.5 mL', w / 2, 252);
    g.fillStyle = PAL.ink; g.fillRect(w * .16, 286, w * .68, 4);
    g.font = '500 30px "IBM Plex Mono"'; g.fillStyle = 'rgba(27,26,23,.62)';
    g.fillText('LOT 2026-0417      EXP 05/28', w / 2, 340);
  });
  const label = new THREE.Mesh(new THREE.CylinderGeometry(R + .004, R + .004, .34, 96, 1, true, -Math.PI * .62, Math.PI * 1.24),
    new THREE.MeshStandardMaterial({ map: labelTex, roughness: .55, side: THREE.FrontSide }));
  label.rotation.y = Math.PI / 2 + Math.PI * 0; // theta 0 = +z after this
  label.position.y = .37; grp.add(label);
  // aluminium crimp + flip-off cap
  const capY = bodyH + sh + neckH - .03;
  const crimp = new THREE.Mesh(new THREE.CylinderGeometry(neckR + .045, neckR + .045, .17, 72), new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 1, roughness: .28 }));
  crimp.position.y = capY + .06; crimp.castShadow = true; grp.add(crimp);
  const groove = new THREE.Mesh(new THREE.CylinderGeometry(neckR + .047, neckR + .047, .012, 72), new THREE.MeshStandardMaterial({ color: 0x55585e, metalness: 1, roughness: .4 }));
  groove.position.y = capY + .015; grp.add(groove);
  const flip = new THREE.Mesh(new THREE.CylinderGeometry(neckR + .035, neckR + .04, .07, 72), new THREE.MeshStandardMaterial({ color: opts.capColor || 0x3c4a5e, roughness: .38, metalness: 0 }));
  flip.position.y = capY + .18; flip.castShadow = true; grp.add(flip);
  grp.userData.neck = new THREE.Vector3(0, bodyH + sh + neckH * .5, 0);
  grp.userData.top = capY + .22;
  return grp;
}

// cheap vial for instanced fields: opaque-ish glass, liquid and cap merged as separate instanced meshes
export function makeVialField(n) {
  const R = 0.30 * .92, bodyH = 0.78;
  const glassG = new THREE.CylinderGeometry(R, R, bodyH, 24); glassG.translate(0, bodyH / 2, 0);
  const capG = new THREE.CylinderGeometry(.21, .21, .2, 24); capG.translate(0, bodyH + .2, 0);
  const labG = new THREE.CylinderGeometry(R + .006, R + .006, .3, 24, 1, true); labG.translate(0, .37, 0);
  const mk = (geo, mat) => { const m = new THREE.InstancedMesh(geo, mat, n); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.castShadow = false; return m; };
  const glass = mk(glassG, new THREE.MeshStandardMaterial({ color: 0xb59a52, roughness: .25, metalness: 0, envMapIntensity: .6 }));
  const cap = mk(capG, new THREE.MeshStandardMaterial({ color: 0x9a9ea6, metalness: .9, roughness: .35 }));
  const lab = mk(labG, new THREE.MeshStandardMaterial({ color: 0xd9cfbd, roughness: .7 }));
  const grp = new THREE.Group(); grp.add(glass, lab, cap);
  grp.userData.meshes = [glass, lab, cap];
  return grp;
}

// ---------- price tag (flat on the desk) + string ----------
export function makeTag({ kicker, price, priceColor, sub }, seed = 3) {
  const tex = canvasTex(900, 500, (g, w, h) => {
    const r = rng(seed);
    g.clearRect(0, 0, w, h);
    const c = 70; g.beginPath(); g.moveTo(c, 0); g.lineTo(w, 0); g.lineTo(w, h); g.lineTo(c, h); g.lineTo(0, h - c); g.lineTo(0, c); g.closePath();
    const grd = g.createLinearGradient(0, 0, w, h); grd.addColorStop(0, '#efe6d3'); grd.addColorStop(1, '#d2c5a7'); g.fillStyle = grd; g.fill();
    g.save(); g.clip();
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(90,70,40,${r() * .07})`; g.fillRect(r() * w, r() * h, r() * 40, 2); }
    g.restore();
    g.fillStyle = '#d6c8ab'; g.beginPath(); g.arc(80, h / 2, 34, 0, 7); g.fill();
    g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(80, h / 2, 15, 0, 7); g.fill(); g.globalCompositeOperation = 'source-over';
    g.fillStyle = 'rgba(27,26,23,.72)'; g.font = '500 40px "IBM Plex Mono"'; g.fillText(kicker, 150, 100);
    if (sub) { g.font = '500 32px "IBM Plex Mono"'; g.fillStyle = 'rgba(27,26,23,.55)'; g.fillText(sub, 150, 150); }
    g.save(); g.translate(150, h - 70); g.rotate(-0.025);
    g.fillStyle = priceColor; g.font = `600 ${price.length > 4 ? 150 : 190}px "IBM Plex Mono"`; g.fillText(price, 0, 0);
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(0,0,0,${r() * .7})`; g.fillRect(r() * 720, -170 + r() * 190, r() * 6, r() * 4); }
    g.restore();
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: .85, alphaTest: .02 }));
  m.rotation.x = -Math.PI / 2; m.receiveShadow = true; m.castShadow = true;
  m.userData.hole = new THREE.Vector3(-0.45 + 0.08, 0, 0); // local (plane x), on paper
  return m;
}
export function makeString(points) {
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 80, 0.0045, 6), new THREE.MeshStandardMaterial({ color: 0xe6d9bd, roughness: .9 }));
}

// ---------- map: country outlines as fat lines ----------
// groups: returns {base, us, india, lmic[]}; each LineSegments2 with its own material so brightness can animate
export function makeMap(data, { lmicSet }) {
  const out = { lmic: [] };
  const mat = (color, width, opacity) => {
    const m = new LineMaterial({ color, linewidth: width, worldUnits: false, transparent: true, opacity, depthWrite: false, toneMapped: false });
    m.resolution.set(W, H); return m;
  };
  const build = (segs, material) => {
    const pos = new Float32Array(segs.length / 4 * 6);
    for (let i = 0, j = 0; i < segs.length; i += 4, j += 6) {
      pos[j] = segs[i]; pos[j + 1] = 0.004; pos[j + 2] = segs[i + 1];
      pos[j + 3] = segs[i + 2]; pos[j + 4] = 0.004; pos[j + 5] = segs[i + 3];
    }
    const g = new LineSegmentsGeometry(); g.setPositions(pos);
    const l = new LineSegments2(g, material); l.computeLineDistances(); l.renderOrder = 1; return l;
  };
  const baseSegs = [];
  for (const c of data) {
    if (c.a3 === 'USA') out.us = build(c.s, mat(PAL.usBlue.clone().multiplyScalar(2.6), 2.0, 1));
    else if (c.a3 === 'IND') out.india = build(c.s, mat(PAL.inOrange.clone().multiplyScalar(2.6), 2.0, 1));
    else if (lmicSet.has(c.a3)) { const l = build(c.s, mat(PAL.inOrange.clone().multiplyScalar(1.4), 1.2, 0)); l.userData.lon = c.lon; out.lmic.push(l); baseSegs.push(...c.s); }
    else baseSegs.push(...c.s);
  }
  out.base = build(baseSegs, mat(PAL.border.clone().multiplyScalar(1.1), 1.0, .55));
  // graticule every 15°
  const gs = [];
  for (let lon = -180; lon <= 180; lon += 15) gs.push(lon * .1, 9, lon * .1, -9);
  for (let lat = -75; lat <= 75; lat += 15) gs.push(-18, -lat * .1, 18, -lat * .1);
  out.grat = build(gs, mat(new THREE.Color(0.22, 0.24, 0.28), 0.8, .28));
  return out;
}

// text lying on the desk (map labels)
export function makeDeskText(text, { color = '#ffffff', size = 0.28, font = '500 64px "IBM Plex Mono"', spacing = 8 } = {}) {
  const pad = 20, measure = document.createElement('canvas').getContext('2d'); measure.font = font;
  const wpx = Math.ceil(measure.measureText(text).width + spacing * text.length) + pad * 2, hpx = 100;
  const tex = canvasTex(wpx, hpx, (g) => {
    g.font = font; g.fillStyle = color; g.textBaseline = 'middle';
    let x = pad; for (const ch of text) { g.fillText(ch, x, hpx / 2); x += g.measureText(ch).width + spacing; }
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size * wpx / hpx, size), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
  m.rotation.x = -Math.PI / 2; m.renderOrder = 2;
  return m;
}

// ---------- camera rig: cubic Hermite through timed keys ----------
// key: {t, pos:[x,y,z], tgt:[x,y,z], fov, stop?:bool}. stop -> zero velocity at that key (ease in/out).
export function cameraAt(keys, t) {
  if (t <= keys[0].t) return pack(keys[0]);
  if (t >= keys[keys.length - 1].t) return pack(keys[keys.length - 1]);
  let i = 0; while (keys[i + 1].t < t) i++;
  const k0 = keys[i], k1 = keys[i + 1], dt = k1.t - k0.t, u = (t - k0.t) / dt;
  const tan = (j, prop) => {
    const k = keys[j]; if (k.stop || j === 0 || j === keys.length - 1) return [0, 0, 0];
    const a = keys[j - 1], b = keys[j + 1];
    return k[prop].map((_, d) => (b[prop][d] - a[prop][d]) / (b.t - a.t));
  };
  const herm = (prop) => {
    const p0 = k0[prop], p1 = k1[prop], m0 = tan(i, prop), m1 = tan(i + 1, prop);
    const u2 = u * u, u3 = u2 * u, h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    return p0.map((_, d) => h00 * p0[d] + h10 * dt * m0[d] + h01 * p1[d] + h11 * dt * m1[d]);
  };
  const fu = smooth(u);
  return { pos: herm('pos'), tgt: herm('tgt'), fov: lerp(k0.fov, k1.fov, fu), ap: lerp(k0.ap ?? 0.002, k1.ap ?? 0.002, fu) };
  function pack(k) { return { pos: k.pos, tgt: k.tgt, fov: k.fov, ap: k.ap ?? 0.002 }; }
}

export { THREE };
