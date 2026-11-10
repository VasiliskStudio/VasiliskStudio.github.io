// Одна WebGL-сцена на весь сайт.
// Hero: объёмный хромовый знак √S рисует себя и при скролле пролетает сквозь камеру.
// Дальше: клипы-версии (8 дорожек) встают справа, собираются в хоровод вокруг камеры и разлетаются.
// В финале знак прилетает из глубины обратно.
import * as THREE from '../vendor/three.module.js';

const canvas = document.getElementById('gl');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const small = () => innerWidth <= 620;

export const state = {
  p: 0, target: 0,           // прогресс всей страницы 0..1
  mx: 0, my: 0, tmx: 0, tmy: 0,
  vel: 0,                    // скорость скролла, для «дыхания» сцены
  boot: 0
};

let renderer, ok = true;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
} catch (e) { ok = false; }
export const alive = ok;
// кадр сцены; app.js зовёт его из общего цикла с уже посчитанной геометрией (без чтения раскладки)
export let render = () => {};
if (ok) document.documentElement.classList.add('gl');

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
const band = (x, a, b) => clamp01((x - a) / (b - a));
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeOut = t => 1 - Math.pow(1 - t, 3);

if (ok) {
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio, small() ? 1.5 : 1.75));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x07070b, 0.026);
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 240);
  camera.position.set(0, 0, 26);
  scene.add(camera);

  /* ───────── окружение для отражений: тёмная студия с фиолетовыми и бирюзовыми софтбоксами ───────── */
  {
    const env = new THREE.Scene();
    env.add(new THREE.Mesh(new THREE.SphereGeometry(30, 32, 16),
      new THREE.MeshBasicMaterial({ color: 0x0a0910, side: THREE.BackSide })));
    const box = (c, w, h, x, y, z) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
      m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m);
    };
    box(0xc4b8ff, 22, 5, -8, 10, 9);         // фиолетовый софтбокс сверху слева
    box(0xffffff, 4, 26, 14, 1, 6);          // белая полоса справа
    box(0xffffff, 26, 1.6, 0, 3, 16);        // тонкая белая линия спереди — кромка на штрихах
    box(0x5ec0a8, 26, 4, 0, -11, 9);         // бирюза снизу
    box(0x8f7fd6, 10, 10, -15, -3, -4);      // фиолет сзади слева
    box(0xffd9b0, 3, 14, 5, 12, -12);        // тёплый блик сверху сзади
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(env, 0.035).texture;
    pm.dispose();
  }

  /* ───────── знак √S ───────── */
  const K = 0.1, CX = 62, CY = 53;
  const P = (x, y, z = 0) => new THREE.Vector3((x - CX) * K, -(y - CY) * K, z);

  // ломаная со скруглёнными углами
  function rounded(pts, r) {
    const path = new THREE.CurvePath();
    let prev = pts[0];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], b = pts[i], c = pts[i + 1];
      const ab = b.clone().sub(a), bc = c.clone().sub(b);
      const r1 = Math.min(r, ab.length() / 2), r2 = Math.min(r, bc.length() / 2);
      const p1 = b.clone().sub(ab.normalize().multiplyScalar(r1));
      const p2 = b.clone().add(bc.normalize().multiplyScalar(r2));
      path.add(new THREE.LineCurve3(prev, p1));
      path.add(new THREE.QuadraticBezierCurve3(p1, b.clone(), p2));
      prev = p2;
    }
    path.add(new THREE.LineCurve3(prev, pts[pts.length - 1]));
    return path;
  }
  const root = rounded([P(10, 60), P(26, 90), P(48, 12), P(114, 12)], 0.55);

  const snake = new THREE.CurvePath();
  [[100, 36, 97, 29, 90, 26, 82, 26], [82, 26, 70, 26, 62, 31, 62, 40],
   [62, 40, 62, 50, 72, 53, 83, 56], [83, 56, 95, 59, 104, 64, 104, 74],
   [104, 74, 104, 84, 95, 90, 83, 90]].forEach(s =>
    snake.add(new THREE.CubicBezierCurve3(P(s[0], s[1]), P(s[2], s[3]), P(s[4], s[5]), P(s[6], s[7]))));

  const tail = new THREE.CatmullRomCurve3([P(84, 90), P(79.5, 89.9), P(74.6, 89.3), P(70, 87.7),
    P(66, 85.5), P(62.5, 82.9), P(59.5, 79.9), P(56.4, 75.6)]);

  const R = 0.4; // толщина штриха: 8 единиц SVG
  const chrome = new THREE.MeshPhysicalMaterial({
    color: 0xe4e0f4, metalness: 1, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.06,
    envMapIntensity: 1.9, emissive: 0x241e3a, emissiveIntensity: 0.5, transparent: true
  });

  // мягкое свечение: оболочка с френелем, рисуется сложением
  const glowMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0x8f7fd6) }, uK: { value: 0.0 } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uK; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(1. - abs(dot(vN, vV)), 1.8); gl_FragColor = vec4(uColor * f * uK, f * uK); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide
  });

  const logo = new THREE.Group();
  const strokes = []; // { g, gg, from, to }

  function tube(curve, segs, r, from, to, taper) {
    const g = new THREE.TubeGeometry(curve, segs, r, 22, false);
    const gg = new THREE.TubeGeometry(curve, segs, r * 2.4, 14, false);
    if (taper) [g, gg].forEach(geo => {
      const pos = geo.attributes.position, rad = geo.parameters.radialSegments;
      for (let i = 0; i <= segs; i++) {
        const c = curve.getPointAt(i / segs), k = taper(i / segs);
        for (let j = 0; j <= rad; j++) {
          const n = i * (rad + 1) + j;
          pos.setXYZ(n, c.x + (pos.getX(n) - c.x) * k, c.y + (pos.getY(n) - c.y) * k, c.z + (pos.getZ(n) - c.z) * k);
        }
      }
      pos.needsUpdate = true; geo.computeVertexNormals();
    });
    logo.add(new THREE.Mesh(g, chrome), new THREE.Mesh(gg, glowMat));
    strokes.push({ g, gg, from, to });
  }
  tube(root, 260, R, 0.0, 0.5);
  tube(snake, 240, R, 0.38, 0.82);
  tube(tail, 80, R * 0.98, 0.8, 0.9, t => Math.max(0.04, 1 - Math.pow(t, 1.3)));
  tube(new THREE.CatmullRomCurve3([P(104.3, 46.1), P(106, 50.2), P(104.4, 53.8)]), 24, 0.085, 0.92, 1);
  tube(new THREE.LineCurve3(P(106, 50.2), P(109, 52.3)), 8, 0.085, 0.94, 1);

  // шарики на концах корня — как stroke-linecap: round
  const capGeo = new THREE.SphereGeometry(R, 24, 16);
  const caps = [P(10, 60), P(114, 12)].map((v, i) => {
    const m = new THREE.Mesh(capGeo, chrome); m.position.copy(v); m.scale.setScalar(0.001); logo.add(m);
    return { m, at: i ? 0.5 : 0.0 };
  });

  // голова гадюки с прорезью глаза
  const headShape = new THREE.Shape();
  [[98.3, 31.8], [106.5, 35.4], [104.3, 46.1], [95.1, 40.2]].forEach(([x, y], i) => {
    const v = P(x, y); i ? headShape.lineTo(v.x, v.y) : headShape.moveTo(v.x, v.y);
  });
  headShape.closePath();
  const ec = P(102.2, 36.9);
  const eyeHole = new THREE.Path();
  eyeHole.absarc(ec.x, ec.y, 0.19, 0, Math.PI * 2, true);
  headShape.holes.push(eyeHole);
  const headGeo = new THREE.ExtrudeGeometry(headShape, { depth: 0.36, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 4, curveSegments: 24 });
  headGeo.translate(0, 0, -0.18);
  headGeo.computeBoundingBox();
  const hc = new THREE.Vector3(); headGeo.boundingBox.getCenter(hc);
  headGeo.translate(-hc.x, -hc.y, 0);
  const head = new THREE.Mesh(headGeo, chrome);
  head.position.set(hc.x, hc.y, 0);
  head.scale.setScalar(0.001);
  logo.add(head);

  // живой глаз в прорези
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 14),
    new THREE.MeshBasicMaterial({ color: 0xc9bfff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  eye.position.copy(ec);
  logo.add(eye);
  const eyeHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: 0x8f7fd6, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  eyeHalo.position.copy(ec); eyeHalo.scale.setScalar(1.6);
  logo.add(eyeHalo);

  // орбиты вокруг знака
  const orbits = new THREE.Group();
  [[6.1, 0x8f7fd6, 1.2, 0], [7.6, 0x5ec0a8, 1.42, 0.7]].forEach(([r, c, rx, rz]) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 6, 220),
      new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.rotation.set(rx, 0, rz); orbits.add(m);
    // бусина, бегущая по орбите
    const b = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    b.scale.setScalar(0.7); m.add(b); m.userData.bead = b; m.userData.r = r;
  });
  logo.add(orbits);

  const rig = new THREE.Group(); // знак живёт в пространстве камеры и привязан к месту в вёрстке
  rig.add(logo);
  camera.add(rig);

  /* ───────── клипы-версии: 8 дорожек ───────── */
  const PAL = [0xc98f5a, 0xc56b9a, 0x7f6bd0, 0x5aa0c9, 0x8f7fd6, 0x5ec0a8, 0x6ec98f, 0xc9b45a];
  const COLS = 8, ROWS = small() ? 5 : 6, N = COLS * ROWS;
  const clipMat = new THREE.MeshBasicMaterial({ map: clipTexture(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const clips = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.6, 0.84), clipMat, N);
  clips.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const home = [], ring = [], far = [], seed = [], col = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const c = i % COLS, r = (i / COLS) | 0;
    home.push(new THREE.Vector3((c - (COLS - 1) / 2) * 1.92, ((ROWS - 1) / 2 - r) * 1.08, 0));
    const a = (i / N) * Math.PI * 2 * 2;                 // два витка спирали
    const rad = 10 + Math.sin(i * 1.7) * 0.8;
    ring.push(new THREE.Vector3(Math.cos(a) * rad, (i / N - 0.5) * 9, Math.sin(a) * rad));
    far.push(new THREE.Vector3((Math.random() - 0.5) * 70, (Math.random() - 0.5) * 40, -24 - Math.random() * 50));
    seed.push(Math.random());
    col.setHex(PAL[c]).multiplyScalar(0.85 + Math.random() * 0.3);
    clips.setColorAt(i, col);
  }
  clips.instanceColor.needsUpdate = true;
  const ringYaw = ring.map(r => Math.atan2(r.x, r.z));
  const clipGroup = new THREE.Group();
  clipGroup.add(clips);
  scene.add(clipGroup);

  /* ───────── пыль ───────── */
  const DN = small() ? 900 : 2000;
  const dpos = new Float32Array(DN * 3), dcol = new Float32Array(DN * 3);
  for (let i = 0; i < DN; i++) {
    dpos[i * 3] = (Math.random() - 0.5) * 100;
    dpos[i * 3 + 1] = (Math.random() - 0.5) * 60;
    dpos[i * 3 + 2] = (Math.random() - 0.5) * 140;
    col.setHex(Math.random() < 0.7 ? 0xb9b2e0 : (Math.random() < 0.5 ? 0x5ec0a8 : 0xc98f5a));
    dcol.set([col.r, col.g, col.b], i * 3);
  }
  const dgeo = new THREE.BufferGeometry();
  dgeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
  dgeo.setAttribute('color', new THREE.BufferAttribute(dcol, 3));
  const dust = new THREE.Points(dgeo, new THREE.PointsMaterial({
    size: 0.22, map: softDot(), vertexColors: true, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  scene.add(dust);

  /* ───────── пол-сетка, уходящая в туман ───────── */
  const floor = new THREE.GridHelper(200, 80, 0x6a5cab, 0x24213a);
  floor.material.transparent = true; floor.material.opacity = 0; floor.material.depthWrite = false;
  floor.position.y = -10;
  scene.add(floor);

  /* ───────── привязка знака к вёрстке ───────── */
  const LOGO_H = 8.8; // высота знака в его единицах

  // ставит знак так, чтобы на экране он был в точке (cx, cy) и высотой hPx, если смотреть с глубины dBase
  function place(cx, cy, hPx, d, dBase, W, H) {
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const wpp = 2 * d * tan / H;          // мир на пиксель на глубине d
    const wppBase = 2 * dBase * tan / H;
    rig.position.set((cx - W / 2) * wpp, -(cy - H / 2) * wpp, -d);
    rig.scale.setScalar(hPx * wppBase / LOGO_H);
  }

  /* ───────── прогрев шейдеров: компилируем заранее и не на главном потоке, чтобы первый кадр не дёрнулся ───────── */
  let ready = false, startAt = Infinity;
  const go = () => { ready = true; startAt = performance.now() + 120; };
  try {
    (renderer.compileAsync ? renderer.compileAsync(scene, camera) : Promise.resolve(renderer.compile(scene, camera)))
      .then(go, go);
  } catch (e) { go(); }

  /* ───────── чёткость: максимум, пока кадры успевают; если мак не тянет — на ступень ниже, потом обратно ───────── */
  const maxDpr = () => Math.min(devicePixelRatio, small() ? 1.5 : 1.75);
  const minDpr = () => Math.min(maxDpr(), devicePixelRatio >= 2 ? 1.25 : 1);
  let dpr = maxDpr(), slow = 0, fast = 0;
  function adapt(ms) {
    if (ms > 120 || ms <= 0) return;                    // пауза, фон — не в счёт
    if (ms > 25) { slow++; fast = 0; }
    else { slow = Math.max(0, slow - 0.5); if (ms < 18) fast++; }
    if (slow > 40 && dpr > minDpr()) { dpr = Math.max(minDpr(), dpr - 0.25); renderer.setPixelRatio(dpr); slow = 0; fast = 0; }
    else if (fast > 900 && dpr < maxDpr()) { dpr = Math.min(maxDpr(), dpr + 0.25); renderer.setPixelRatio(dpr); fast = 0; }
  }

  /* ───────── кадр ───────── */
  const dummy = new THREE.Object3D(), v = new THREE.Vector3();
  let t = 0, visible = true, last = 0;

  render = function frame(now, g) {
    if (!visible || !ready) return;
    const ms = last ? now - last : 16.7; last = now;
    const dt = Math.min(0.05, ms / 1000);
    t += dt;
    adapt(ms);
    const p = state.p, sway = reduce ? 0 : 1, W = g.W, H = g.H;

    /* — знак: рисуется при загрузке — */
    const draw = reduce ? 1 : clamp01((now - startAt) / 2600);
    if (draw < 1 || !frame.drawn) {
      strokes.forEach(s => {
        const k = easeOut(band(draw, s.from, s.to));
        s.g.setDrawRange(0, Math.floor(s.g.index.count * k / 6) * 6);
        s.gg.setDrawRange(0, Math.floor(s.gg.index.count * k / 6) * 6);
      });
      caps.forEach(c => c.m.scale.setScalar(draw > c.at + 0.02 ? Math.max(0.001, easeOut(band(draw, c.at, c.at + 0.08))) : 0.001));
      head.scale.setScalar(Math.max(0.001, easeOut(band(draw, 0.84, 1))));
      frame.drawn = draw >= 1;
    }
    const eyeOn = band(draw, 0.96, 1) * (0.75 + 0.25 * Math.sin(t * 2.2));

    /* — знак: где он — */
    const fly = clamp01(g.y / (H * 0.9));               // 0 — hero на месте, 1 — пролетели
    const er = g.end;
    const arrive = clamp01(1 - (er.cy - H * 0.32) / (H * 0.7));
    let op = 1;
    const D = 26;

    if (fly < 1 || arrive <= 0) {
      // пролёт: знак уходит к центру экрана и летит на камеру, разворачиваясь
      const f = ease(fly), c = ease(clamp01(fly * 1.7)), hr = g.hero;
      place(lerp(hr.cx, W / 2, c), lerp(hr.cy, H * 0.46, c), hr.h, lerp(D, 1.4, f), D, W, H);
      logo.rotation.set(
        -state.my * 0.25 * sway + f * 0.7 + Math.sin(t * 0.5) * 0.04,
        state.mx * 0.45 * sway + f * 1.9 + Math.sin(t * 0.33) * 0.12,
        f * -0.3
      );
      op = 1 - band(fly, 0.6, 0.9);
      rig.visible = fly < 0.95;
    } else {
      // финал: прилетает из глубины, крутясь
      const a = easeOut(arrive);
      place(er.cx, er.cy, er.h, lerp(70, D, a), D, W, H);
      logo.rotation.set(-state.my * 0.2 * sway + (1 - a) * -0.8, state.mx * 0.4 * sway + (1 - a) * -2.4 + Math.sin(t * 0.33) * 0.1, 0);
      op = a;
      rig.visible = arrive > 0.01;
    }
    if (rig.visible) {
      chrome.opacity = op;
      glowMat.uniforms.uK.value = (0.42 + 0.1 * Math.sin(t * 1.3)) * op * band(draw, 0, 0.3);
      eye.material.opacity = eyeOn * op;
      eyeHalo.material.opacity = eyeOn * 0.8 * op;
      orbits.children.forEach((m, i) => {
        m.rotation.z += dt * (i ? -0.06 : 0.09);
        m.material.opacity = 0.32 * band(draw, 0.5, 1) * op;
        const a = t * (i ? -0.45 : 0.6) + i * 2;
        m.userData.bead.position.set(Math.cos(a) * m.userData.r, Math.sin(a) * m.userData.r, 0);
        m.userData.bead.material.opacity = 0.9 * band(draw, 0.7, 1) * op;
      });
      logo.position.y = Math.sin(t * 0.8) * 0.18;
    }

    /* — клипы: пока их не видно, не считаем — */
    const show = band(p, 0.07, 0.17);
    clipGroup.visible = show > 0.001;
    if (clipGroup.visible) {
      const toRing = ease(band(p, 0.24, 0.42));
      const toFar = ease(band(p, 0.5, 0.78));
      const side = (1 - toRing) * (small() ? 0 : 1);
      for (let i = 0; i < N; i++) {
        const h = home[i], r = ring[i], f = far[i], s = seed[i];
        const wob = Math.sin(t * 0.7 + i * 0.37) * 0.12;
        v.set(
          lerp(lerp(h.x, r.x, toRing), f.x, toFar),
          lerp(lerp(h.y, r.y, toRing), f.y, toFar) + wob,
          lerp(lerp(h.z - s * 2 * (1 - show), r.z, toRing), f.z, toFar)
        );
        dummy.position.copy(v);
        // в решётке смотрят на зрителя, в хороводе — наружу, в разлёте кувыркаются
        dummy.rotation.set(toFar * (s - 0.5) * 3,
                           lerp(0, ringYaw[i], toRing) + toFar * s * 2, toFar * (s - 0.5));
        dummy.scale.setScalar((0.4 + 0.6 * easeOut(clamp01(show * 1.4 - s * 0.4))) * (1 - 0.4 * toFar));
        dummy.updateMatrix();
        clips.setMatrixAt(i, dummy.matrix);
      }
      clips.instanceMatrix.needsUpdate = true;
      clipMat.opacity = (0.32 + 0.43 * toRing) * show * (1 - 0.65 * toFar);   // у «Что это» — тихий фон за цифрами
      clipGroup.position.set(side * 11, -side * 1.6, lerp(-12, 4, toRing));
      clipGroup.rotation.y = lerp(-0.5, 0, toRing) + t * 0.05 * toRing + state.mx * 0.25 * sway;
      clipGroup.rotation.x = -state.my * 0.15 * sway;
    }

    /* — пыль и пол — */
    dust.rotation.y = t * 0.01 + state.mx * 0.08 * sway;
    dust.position.z = p * 30;
    dust.material.opacity = 0.75 * clamp01((now - startAt) / 1800);
    dust.material.size = 0.22 + Math.min(0.25, Math.abs(state.vel) * 0.004);
    const floorOp = 0.22 * band(draw, 0.2, 0.8) * (1 - band(p, 0.45, 0.65) * 0.7);
    floor.visible = floorOp > 0.002;
    floor.position.z = (p * 160) % 2.5;
    floor.material.opacity = floorOp;

    /* — камера: дышит за курсором, при скролле опускается в сцену — */
    camera.position.x = state.mx * 1.2 * sway;
    camera.position.y = lerp(0.5, 1.8, p) - state.my * 0.8 * sway;
    camera.position.z = 26 - ease(band(p, 0.14, 0.42)) * 12 - band(p, 0.5, 1) * 8;
    camera.lookAt(0, lerp(0, 0.6, p), lerp(0, -10, p));
    const fov = lerp(50, 64, band(p, 0.3, 0.7)) + Math.min(6, Math.abs(state.vel) * 0.05);
    if (Math.abs(fov - camera.fov) > 1e-4) { camera.fov = fov; camera.updateProjectionMatrix(); }

    renderer.render(scene, camera);
  };

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    dpr = maxDpr(); slow = fast = 0;
    renderer.setPixelRatio(dpr);
    renderer.setSize(innerWidth, innerHeight);
  }, { passive: true });
  document.addEventListener('visibilitychange', () => { visible = !document.hidden; last = 0; });
}

/* ───────── текстуры ───────── */
function softDot() {
  if (softDot.t) return softDot.t;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return softDot.t = new THREE.CanvasTexture(c);
}
function clipTexture() {
  // клип как в студии: заливка, светлая кромка сверху, полоска имени и треугольник «играть»
  const c = document.createElement('canvas'); c.width = 256; c.height = 134;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 134);
  gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,.16)');
  g.fillStyle = gr; g.fillRect(4, 4, 248, 126);
  g.fillStyle = 'rgba(255,255,255,.95)'; g.fillRect(4, 4, 248, 5);
  g.fillStyle = 'rgba(255,255,255,.7)'; g.fillRect(44, 34, 110, 14); g.fillRect(44, 62, 70, 10);
  g.beginPath(); g.moveTo(18, 32); g.lineTo(32, 41); g.lineTo(18, 50); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 2; g.strokeRect(5, 5, 246, 124);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
