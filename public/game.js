/* Kernschmelze – Wellen-Shooter mit Three.js. Grafik und Ton werden komplett per Code erzeugt. */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  function fatal(msg) {
    $('errorText').textContent = msg;
    $('error').classList.remove('hidden');
    $('menu').classList.add('hidden');
  }
  if (typeof THREE === 'undefined') {
    fatal('Three.js konnte nicht geladen werden. Bitte prüfe deine Internetverbindung und lade die Seite neu.');
    return;
  }

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* privat */ } },
  };
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ========== Plattform und Grafikqualität ========== */
  const UA = navigator.userAgent;
  const IOS = /iPad|iPhone|iPod/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
  const ANDROID = /Android/i.test(UA);
  const MOBILE = IOS || ANDROID ||
    (navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches);
  const STANDALONE = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches ||
    navigator.standalone === true;
  document.body.classList.toggle('mobile', MOBILE);
  document.body.classList.toggle('standalone', STANDALONE);

  const PRESETS = {
    low: { label: 'Niedrig', res: .7, dprCap: 1, shadows: 0, fx: .45, aa: false },
    medium: { label: 'Mittel', res: .85, dprCap: 1.5, shadows: 1, fx: .7, aa: true },
    high: { label: 'Hoch', res: 1, dprCap: 1.5, shadows: 2, fx: 1, aa: true },
    ultra: { label: 'Ultra', res: 1, dprCap: 2, shadows: 3, fx: 1, aa: true },
  };
  // grobe Leistungseinschätzung aus Grafikchip, Kernen und Speicher
  function detectTier() {
    let gpu = '';
    try {
      const c = document.createElement('canvas'), gl = c.getContext('webgl');
      if (gl) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
        const lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
      }
    } catch (e) { gpu = ''; }
    const mem = navigator.deviceMemory || 8, cores = navigator.hardwareConcurrency || 4;
    if (/SwiftShader|llvmpipe|Software|Basic Render/i.test(gpu)) return 'low';
    if (MOBILE) return IOS ? (cores >= 6 ? 'medium' : 'low') : (mem >= 6 && cores >= 8 ? 'medium' : 'low');
    let score = 0;
    if (/RTX|RX ?[5-9]\d{3}|Radeon Pro|Apple M[1-9]|GTX 1[0-9]{3}|Arc A/i.test(gpu)) score += 2;
    else if (/GeForce|Radeon|Apple/i.test(gpu)) score += 1;
    else if (/Iris Xe/i.test(gpu)) score += .5;
    if (cores >= 8) score += .5;
    if (mem >= 8) score += .5; else if (mem <= 4) score -= 1;
    return score >= 2.5 ? 'ultra' : score >= 1.5 ? 'high' : score >= .5 ? 'medium' : 'low';
  }
  const detected = detectTier();
  let gfx;
  try { gfx = JSON.parse(store.get('ks_gfx', 'null')); } catch (e) { gfx = null; }
  if (!gfx || typeof gfx !== 'object') gfx = { preset: 'auto' };
  // „auto“ und feste Stufen übernehmen die Werte der Stufe, „custom“ behält eigene Werte
  function resolvedGfx() {
    const base = PRESETS[gfx.preset === 'auto' || gfx.preset === 'custom' ? detected : gfx.preset] || PRESETS.medium;
    if (gfx.preset !== 'custom') return Object.assign({}, base);
    return Object.assign({}, base, { res: gfx.res ?? base.res, shadows: gfx.shadows ?? base.shadows, fx: gfx.fx ?? base.fx });
  }
  let FX = resolvedGfx().fx;
  const fxN = n => { const v = n * FX; return Math.floor(v) + (Math.random() < v % 1 ? 1 : 0); };
  const v1 = new THREE.Vector3(), F = new THREE.Vector3(), R = new THREE.Vector3(), U = new THREE.Vector3();

  /* ========== Renderer und Szene ========== */
  const canvas = $('game');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: resolvedGfx().aa, powerPreference: 'high-performance' });
  } catch (e) {
    fatal('Dein Browser unterstützt WebGL hier nicht. Aktiviere die Hardwarebeschleunigung und versuche es erneut.');
    return;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, resolvedGfx().dprCap) * resolvedGfx().res);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.autoClear = false;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0c1826, 0.015);
  const camera = new THREE.PerspectiveCamera(78, 1, 0.05, 900);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();

  function makeCanvas(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 4;
    return t;
  }

  const glowTex = makeCanvas(128, 128, (g, w) => {
    const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(.25, 'rgba(255,255,255,.55)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, w);
  });
  const glowSprite = (color, size) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false,
    }));
    s.scale.setScalar(size);
    return s;
  };

  // Weiche Rauchwolke mit unregelmäßigem Rand
  const smokeTex = makeCanvas(128, 128, (g, w) => {
    for (let i = 0; i < 14; i++) {
      const x = w / 2 + rand(-22, 22), y = w / 2 + rand(-22, 22), r = rand(20, 44);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,.32)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, w);
    }
  });
  // Mündungsfeuer: Stern von vorn und Flammenzunge von der Seite
  const flashStarTex = makeCanvas(128, 128, (g, w) => {
    g.translate(w / 2, w / 2);
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      g.rotate(Math.PI * 2 / 7 + rand(-.2, .2));
      const l = rand(38, 62);
      const gr = g.createLinearGradient(0, 0, 0, -l);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(-7, 0); g.lineTo(0, -l); g.lineTo(7, 0); g.fill();
    }
    const r = g.createRadialGradient(0, 0, 0, 0, 0, 34);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(-64, -64, 128, 128);
  });
  const flashSideTex = makeCanvas(128, 64, (g, w, h) => {
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
      const gr = g.createRadialGradient(10, h / 2, 0, 10, h / 2, w * rand(.6, 1));
      gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(.3, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.save(); g.translate(0, h / 2); g.scale(1, rand(.22, .4)); g.translate(0, -h / 2);
      g.fillRect(0, 0, w, h); g.restore();
    }
  });

  // Studio-Umgebung, damit Metall glänzt statt grau zu wirken
  let envMap = null;
  try {
    const envTex = makeCanvas(512, 256, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#9fb8cc'); gr.addColorStop(.45, '#3a5468'); gr.addColorStop(.52, '#1a2430'); gr.addColorStop(1, '#07090c');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffffff'; g.fillRect(60, 30, 90, 26);
      g.fillStyle = '#ffe2bd'; g.fillRect(300, 40, 120, 18);
      g.fillStyle = 'rgba(95,240,224,.8)'; g.fillRect(0, 112, w, 5);
    });
    envTex.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    envMap = pmrem.fromEquirectangular(envTex).texture;
    pmrem.dispose();
  } catch (e) { envMap = null; }

  // Himmel mit Sternen und Ringplanet
  scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(800, 32, 16),
    new THREE.MeshBasicMaterial({
      side: THREE.BackSide, fog: false, depthWrite: false,
      map: makeCanvas(2048, 1024, (g, w, h) => {
        const sky = g.createLinearGradient(0, 0, 0, h);
        sky.addColorStop(0, '#03060f'); sky.addColorStop(.42, '#10263a');
        sky.addColorStop(.5, '#2c4a5c'); sky.addColorStop(.56, '#0a1118'); sky.addColorStop(1, '#05080d');
        g.fillStyle = sky; g.fillRect(0, 0, w, h);
        for (let i = 0; i < 1500; i++) {
          g.fillStyle = `rgba(255,255,255,${rand(.15, .95)})`;
          const s = Math.random() < .08 ? 2 : 1;
          g.fillRect(rand(0, w), rand(0, h * .5), s, s);
        }
        const px = 1420, py = 300, pr = 125;
        const planet = g.createRadialGradient(px - 45, py - 45, 10, px, py, pr);
        planet.addColorStop(0, '#f2b880'); planet.addColorStop(.65, '#94502f'); planet.addColorStop(1, '#2a1411');
        g.fillStyle = planet; g.beginPath(); g.arc(px, py, pr, 0, 7); g.fill();
        g.strokeStyle = 'rgba(245,205,160,.55)'; g.lineWidth = 7;
        g.beginPath(); g.ellipse(px, py, pr * 1.7, pr * .32, -.3, 0, 7); g.stroke();
      }),
    })
  ));

  scene.add(new THREE.HemisphereLight(0x7f9fc4, 0x1a2028, .85));
  const sun = new THREE.DirectionalLight(0xffd9b0, 1.05);
  sun.position.set(38, 70, 24);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -52, right: 52, top: 52, bottom: -52, near: 1, far: 170 });
  sun.shadow.bias = -0.0006;
  scene.add(sun);

  /* ========== Arena ========== */
  const ARENA = 36;
  const colliders = [];
  const addCollider = (minX, maxX, minY, maxY, minZ, maxZ) => colliders.push({ minX, maxX, minY, maxY, minZ, maxZ });

  const floorTex = makeCanvas(512, 512, (g, w) => {
    g.fillStyle = '#1a2530'; g.fillRect(0, 0, w, w);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = `rgba(${Math.random() < .5 ? '255,255,255' : '0,0,0'},.03)`;
      g.fillRect(rand(0, w), rand(0, w), rand(2, 24), rand(1, 4));
    }
    g.strokeStyle = '#0b1219'; g.lineWidth = 6; g.strokeRect(0, 0, w, w);
    g.strokeStyle = '#34495a'; g.lineWidth = 2; g.strokeRect(14, 14, w - 28, w - 28);
    g.fillStyle = '#44606f';
    [[34, 34], [478, 34], [34, 478], [478, 478]].forEach(([x, y]) => { g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill(); });
  });
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(ARENA / 2, ARENA / 2);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ARENA * 2, ARENA * 2),
    new THREE.MeshStandardMaterial({ map: floorTex, roughness: .62, metalness: .35 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const panelTex = makeCanvas(256, 256, (g, w) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, w);
    for (let i = 0; i < 500; i++) {
      g.fillStyle = `rgba(0,0,0,${rand(.02, .08)})`;
      g.fillRect(rand(0, w), rand(0, w), rand(2, 30), rand(1, 3));
    }
    g.strokeStyle = 'rgba(0,0,0,.65)'; g.lineWidth = 7; g.strokeRect(4, 4, w - 8, w - 8);
    g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = 3; g.strokeRect(26, 26, w - 52, w - 52);
  });
  const mat = (color) => new THREE.MeshStandardMaterial({ map: panelTex, color, roughness: .6, metalness: .45 });
  const matWall = mat(0x47596a), matCrate = mat(0x8a6a44), matBlock = mat(0x566a78), matPillar = mat(0x3c4c5c);
  const stripTeal = new THREE.MeshBasicMaterial({ color: 0x46e6d4 });
  const stripAmber = new THREE.MeshBasicMaterial({ color: 0xffa83a });
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);

  function solid(x, z, w, d, h, material, strip, collide = true) {
    const m = new THREE.Mesh(boxGeo, material);
    m.scale.set(w, h, d);
    m.position.set(x, h / 2, z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    if (strip) {
      const s = new THREE.Mesh(boxGeo, strip);
      s.scale.set(w + .05, .09, d + .05);
      s.position.set(x, h - .2, z);
      scene.add(s);
    }
    if (collide) addCollider(x - w / 2, x + w / 2, 0, h, z - d / 2, z + d / 2);
  }
  const mirror4 = (x, z, w, d, h, m, s) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) solid(sx * x, sz * z, w, d, h, m, s);
  };

  // Außenmauern: sichtbare Segmente, je ein Kollider
  for (let i = -ARENA + 4; i < ARENA; i += 8) {
    const h = 7 + (Math.abs(i) % 16 === 4 ? 1.5 : 0);
    solid(i, -ARENA - 1, 8, 2, h, matWall, stripTeal, false);
    solid(i, ARENA + 1, 8, 2, h, matWall, stripTeal, false);
    solid(-ARENA - 1, i, 2, 8, h, matWall, stripTeal, false);
    solid(ARENA + 1, i, 2, 8, h, matWall, stripTeal, false);
  }
  addCollider(-ARENA - 2, ARENA + 2, 0, 40, -ARENA - 2, -ARENA);
  addCollider(-ARENA - 2, ARENA + 2, 0, 40, ARENA, ARENA + 2);
  addCollider(-ARENA - 2, -ARENA, 0, 40, -ARENA - 2, ARENA + 2);
  addCollider(ARENA, ARENA + 2, 0, 40, -ARENA - 2, ARENA + 2);

  mirror4(12, 12, 4, 4, 1.3, matCrate, stripAmber);
  mirror4(16, 12, 4, 4, 2.5, matCrate, stripAmber);
  mirror4(22, 8, 3, 8, 3.6, matBlock, stripTeal);
  mirror4(8, 22, 8, 3, 3.6, matBlock, stripTeal);
  mirror4(26, 26, 5, 5, 7, matPillar, stripTeal);
  mirror4(20, 28, 3, 3, 1.3, matCrate, stripAmber);
  mirror4(28, 18, 3, 3, 1.3, matCrate, stripAmber);

  // Spawn-Tore
  const gates = [[33, 0], [-33, 0], [0, 33], [0, -33], [32, 32], [-32, 32], [32, -32], [-32, -32]];
  const gateGeo = new THREE.RingGeometry(1.5, 1.9, 32);
  const gateMat = new THREE.MeshBasicMaterial({ color: 0xff4d3d, side: THREE.DoubleSide });
  gates.forEach(([x, z]) => {
    const r = new THREE.Mesh(gateGeo, gateMat);
    r.rotation.x = -Math.PI / 2;
    r.position.set(x, .03, z);
    scene.add(r);
  });

  /* ========== Reaktor ========== */
  const CORE_HALF = 4, CORE_MAX = 400;
  const reactor = new THREE.Group();
  scene.add(reactor);
  addCollider(-CORE_HALF, CORE_HALF, 0, 11, -CORE_HALF, CORE_HALF);
  const steel = new THREE.MeshStandardMaterial({ color: 0x46566a, roughness: .45, metalness: .75 });
  const coreMat = new THREE.MeshStandardMaterial({ color: 0x06100f, emissive: 0x38f0e0, emissiveIntensity: 2.4, roughness: .3 });
  const addR = (geo, m, y, shadow = true) => {
    const o = new THREE.Mesh(geo, m);
    o.position.y = y; o.castShadow = shadow; o.receiveShadow = shadow;
    reactor.add(o); return o;
  };
  addR(new THREE.CylinderGeometry(4.3, 4.8, 1.2, 8), steel, .6);
  addR(new THREE.CylinderGeometry(3, 2.3, 1.2, 8), steel, 9.6);
  const coreColumn = addR(new THREE.CylinderGeometry(1.5, 1.5, 8, 18), coreMat, 5, false);
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    const s = addR(boxGeo, steel, 5);
    s.scale.set(.32, 8.2, .32);
    s.position.x = Math.cos(a) * 2.6;
    s.position.z = Math.sin(a) * 2.6;
  }
  const ringGeo = new THREE.TorusGeometry(3.15, .14, 8, 44);
  const reactorRings = [3, 5.2, 7.4].map(y => {
    const r = addR(ringGeo, coreMat, y, false);
    r.rotation.x = Math.PI / 2;
    return r;
  });
  const coreGlow = glowSprite(0x38f0e0, 20);
  coreGlow.position.y = 5;
  coreGlow.material.opacity = .55;
  reactor.add(coreGlow);
  const coreLight = new THREE.PointLight(0x38f0e0, 2.2, 42, 1.6);
  coreLight.position.y = 6;
  reactor.add(coreLight);
  const floorRing = new THREE.Mesh(new THREE.RingGeometry(6, 6.25, 64),
    new THREE.MeshBasicMaterial({ color: 0x38f0e0, side: THREE.DoubleSide }));
  floorRing.rotation.x = -Math.PI / 2;
  floorRing.position.y = .03;
  scene.add(floorRing);

  /* ========== Wegfindung ========== */
  const G = ARENA * 2;
  const blocked = new Uint8Array(G * G);
  const fieldPlayer = new Uint16Array(G * G), fieldCore = new Uint16Array(G * G);
  const bfsQueue = new Int32Array(G * G);
  const INF = 65535;
  const cell = v => clamp(Math.floor(v + ARENA), 0, G - 1);
  const idx = (i, j) => j * G + i;

  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const x = i - ARENA + .5, z = j - ARENA + .5;
    for (const b of colliders) {
      if (x > b.minX - 1.25 && x < b.maxX + 1.25 && z > b.minZ - 1.25 && z < b.maxZ + 1.25) { blocked[idx(i, j)] = 1; break; }
    }
  }

  function bfs(field, sources) {
    field.fill(INF);
    let head = 0, tail = 0;
    for (const s of sources) { field[s] = 0; bfsQueue[tail++] = s; }
    while (head < tail) {
      const c = bfsQueue[head++], i = c % G, j = (c - i) / G, d = field[c] + 1;
      const visit = n => { if (!blocked[n] && field[n] === INF) { field[n] = d; bfsQueue[tail++] = n; } };
      if (i > 0) visit(c - 1);
      if (i < G - 1) visit(c + 1);
      if (j > 0) visit(c - G);
      if (j < G - 1) visit(c + G);
    }
  }
  function nearestFree(x, z) {
    const ci = cell(x), cj = cell(z);
    for (let r = 0; r < G; r++) {
      for (let j = Math.max(0, cj - r); j <= Math.min(G - 1, cj + r); j++) {
        for (let i = Math.max(0, ci - r); i <= Math.min(G - 1, ci + r); i++) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) === r && !blocked[idx(i, j)]) return idx(i, j);
        }
      }
    }
    return idx(ci, cj);
  }
  (() => { // Reaktorfeld: alle freien Zellen direkt am Sperrbereich sind Ziele
    const src = [];
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const x = i - ARENA + .5, z = j - ARENA + .5;
      if (!blocked[idx(i, j)] && Math.max(Math.abs(x), Math.abs(z)) < CORE_HALF + 2.3) src.push(idx(i, j));
    }
    bfs(fieldCore, src);
  })();

  const flowOut = { x: 0, z: 0 };
  function flowDir(field, x, z) {
    const ci = cell(x), cj = cell(z);
    let best = field[idx(ci, cj)], bi = -1, bj = -1;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= G || j >= G) continue;
      if (di && dj && (blocked[idx(ci + di, cj)] || blocked[idx(ci, cj + dj)])) continue;
      const v = field[idx(i, j)];
      if (v < best) { best = v; bi = i; bj = j; }
    }
    if (bi < 0) return null;
    const dx = bi - ARENA + .5 - x, dz = bj - ARENA + .5 - z, l = Math.hypot(dx, dz) || 1;
    flowOut.x = dx / l; flowOut.z = dz / l;
    return flowOut;
  }

  let rbAxis = -1;
  const hitN = new THREE.Vector3();
  function rayBox(ox, oy, oz, dx, dy, dz, b) {
    let tmin = 0, tmax = Infinity, ax = -1;
    const axis = (o, d, lo, hi, id) => {
      if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
      let t1 = (lo - o) / d, t2 = (hi - o) / d;
      if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
      if (t1 > tmin) { tmin = t1; ax = id; }
      tmax = Math.min(tmax, t2);
      return tmin <= tmax;
    };
    if (!axis(ox, dx, b.minX, b.maxX, 0) || !axis(oy, dy, b.minY, b.maxY, 1) || !axis(oz, dz, b.minZ, b.maxZ, 2)) return -1;
    rbAxis = ax;
    return tmin;
  }
  // liefert die Trefferdistanz und setzt hitN auf die Flächennormale
  function rayWorld(ox, oy, oz, dx, dy, dz, maxT) {
    let t = maxT;
    hitN.set(-dx, -dy, -dz);
    if (dy < 0 && -oy / dy < t) { t = -oy / dy; hitN.set(0, 1, 0); }
    for (const b of colliders) {
      const h = rayBox(ox, oy, oz, dx, dy, dz, b);
      if (h >= 0 && h < t) {
        t = h;
        if (rbAxis === 0) hitN.set(-Math.sign(dx), 0, 0);
        else if (rbAxis === 1) hitN.set(0, -Math.sign(dy), 0);
        else if (rbAxis === 2) hitN.set(0, 0, -Math.sign(dz));
        else hitN.set(-dx, -dy, -dz);
      }
    }
    return t;
  }
  function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
    const lx = ox - cx, ly = oy - cy, lz = oz - cz;
    const b = lx * dx + ly * dy + lz * dz, c = lx * lx + ly * ly + lz * lz - r * r;
    const disc = b * b - c;
    if (disc < 0) return -1;
    const t = -b - Math.sqrt(disc);
    return t >= 0 ? t : -1;
  }
  function losClear(ax, az, bx, bz, inflate) {
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1;
    const ux = dx / len, uz = dz / len;
    const fat = { minY: -1, maxY: 1 };
    for (const b of colliders) {
      fat.minX = b.minX - inflate; fat.maxX = b.maxX + inflate;
      fat.minZ = b.minZ - inflate; fat.maxZ = b.maxZ + inflate;
      const t = rayBox(ax, 0, az, ux, 0, uz, fat);
      if (t >= 0 && t < len) return false;
    }
    return true;
  }
  function pushOut(p, r) {
    for (const b of colliders) {
      const cx = clamp(p.x, b.minX, b.maxX), cz = clamp(p.z, b.minZ, b.maxZ);
      const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        p.x = cx + dx / d * r; p.z = cz + dz / d * r;
      } else {
        const opts = [[p.x - b.minX, -1, 0], [b.maxX - p.x, 1, 0], [p.z - b.minZ, 0, -1], [b.maxZ - p.z, 0, 1]];
        opts.sort((a, c) => a[0] - c[0]);
        p.x += opts[0][1] * (opts[0][0] + r); p.z += opts[0][2] * (opts[0][0] + r);
      }
    }
  }

  /* ========== Ton ========== */
  const Snd = {
    ctx: null, master: null, noise: null, muted: store.get('ks_mute', '0') === '1',
    init() {
      if (this.ctx) { this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const c = this.ctx = new AC();
      this.master = c.createGain();
      this.master.gain.value = this.muted ? 0 : .55;
      this.master.connect(c.destination);
      const len = c.sampleRate;
      this.noise = c.createBuffer(1, len, len);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // leises Reaktorbrummen
      const hum = c.createGain(); hum.gain.value = .05; hum.connect(this.master);
      [46, 46.7, 92.3].forEach(f => {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 170;
        o.connect(lp); lp.connect(hum); o.start();
      });
      if (window.KSMusic) {
        this.music = window.KSMusic(c, this.master, this.noise);
        this.applyMusicVolume();
        this.music.setSong(this.song);
        this.music.setIntensity(this.intensity);
      }
    },
    music: null, song: 'menu', intensity: 0,
    musicVol: parseFloat(store.get('ks_music', '0.6')),
    musicOff: store.get('ks_musicoff', '0') === '1',
    applyMusicVolume() { if (this.music) this.music.setVolume(this.musicOff ? 0 : this.musicVol * 1.2); },
    setSong(s) { this.song = s; if (this.music) this.music.setSong(s); },
    setIntensity(v) { this.intensity = v; if (this.music) this.music.setIntensity(v); },
    setPaused(p) { if (this.music) this.music.setPaused(p); },
    toggleMusic() {
      this.musicOff = !this.musicOff;
      store.set('ks_musicoff', this.musicOff ? '1' : '0');
      this.applyMusicVolume();
    },
    limit(name, gap) {
      const now = performance.now();
      this.times = this.times || {};
      if (now - (this.times[name] || 0) < gap) return false;
      this.times[name] = now;
      return true;
    },
    step() { this.burst(.055, rand(.08, .13), rand(380, 620)); this.tone(95, 50, .06, 'sine', .12); },
    jump() { this.tone(180, 360, .11, 'triangle', .1); this.burst(.08, .07, 1400, 'bandpass'); },
    land(k) { this.burst(.12, .3 * k, 520); this.tone(105, 38, .14, 'sine', .42 * k); },
    empty() { this.tone(1700, 1350, .03, 'square', .07); },
    casing(p = 1) {
      if (!this.limit('casing', 28)) return;
      setTimeout(() => {
        this.tone(rand(3000, 4300) * p, 2400 * p, .04 + (1 - p) * .05, 'triangle', .03 + (1 - p) * .03);
        if (p < .7) this.burst(.05, .05, 900);
      }, rand(0, 30));
    },
    magOut() { this.tone(240, 160, .06, 'square', .07); this.burst(.06, .12, 1800, 'bandpass'); },
    magIn() { this.tone(180, 420, .05, 'square', .1); this.burst(.04, .18, 2600, 'bandpass'); },
    rack() { this.burst(.05, .16, 3200, 'bandpass'); setTimeout(() => { this.tone(900, 600, .04, 'square', .07); this.burst(.04, .14, 2400, 'bandpass'); }, 90); },
    pump() { this.burst(.07, .2, 1300, 'bandpass'); this.tone(150, 110, .06, 'square', .06); setTimeout(() => { this.burst(.06, .22, 1700, 'bandpass'); this.tone(210, 160, .05, 'square', .07); }, 120); },
    shellIn() { this.tone(330, 260, .05, 'square', .06); this.burst(.04, .1, 2000, 'bandpass'); },
    drum() { this.tone(1200, 900, .03, 'square', .05); },
    swap() { this.burst(.08, .1, 2200, 'bandpass'); this.tone(420, 300, .05, 'triangle', .06); },
    whoosh() { this.burst(.18, .08, 900, 'bandpass'); },
    ricochet() { if (this.limit('ric', 90)) this.tone(rand(1800, 2700), rand(500, 800), .13, 'sine', .035); },
    spawn() { if (this.limit('spawn', 160)) { this.tone(190, 880, .22, 'sine', .05); this.burst(.18, .06, 2500, 'bandpass'); } },
    roar() { this.tone(72, 34, 1.5, 'sawtooth', .5); this.tone(142, 55, 1.5, 'square', .16); this.burst(1.1, .35, 420); },
    killCombo(m) { this.tone(400 + m * 90, 840 + m * 190, .13, 'triangle', .22); if (m >= 3) this.tone(1200 + m * 120, 1900 + m * 150, .09, 'sine', .08); },
    debris() { this.burst(.36, .1, 3200, 'highpass'); },
    hover() { this.tone(1100, 1100, .025, 'sine', .035); },
    click() { this.tone(520, 880, .07, 'triangle', .15); },
    beep(last) { this.tone(last ? 1320 : 880, last ? 1320 : 880, last ? .22 : .08, 'square', .09); },
    heart() { this.tone(64, 38, .15, 'sine', .55); setTimeout(() => this.tone(56, 34, .18, 'sine', .4), 190); },
    toggle() {
      this.muted = !this.muted;
      store.set('ks_mute', this.muted ? '1' : '0');
      if (this.master) this.master.gain.value = this.muted ? 0 : .55;
    },
    tone(f, f2, t, type, g) {
      if (!this.ctx) return;
      const c = this.ctx, now = c.currentTime, o = c.createOscillator(), a = c.createGain();
      o.type = type; o.frequency.setValueAtTime(f, now);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), now + t);
      a.gain.setValueAtTime(g, now); a.gain.exponentialRampToValueAtTime(.001, now + t);
      o.connect(a); a.connect(this.master); o.start(now); o.stop(now + t + .02);
    },
    burst(t, g, fc, type = 'lowpass') {
      if (!this.ctx) return;
      const c = this.ctx, now = c.currentTime, s = c.createBufferSource(), a = c.createGain(), f = c.createBiquadFilter();
      s.buffer = this.noise; s.loop = true;
      f.type = type; f.frequency.value = fc;
      a.gain.setValueAtTime(g, now); a.gain.exponentialRampToValueAtTime(.001, now + t);
      s.connect(f); f.connect(a); a.connect(this.master);
      s.start(now, Math.random() * .8); s.stop(now + t + .02);
    },
    shoot(i) {
      if (i === 0) { this.tone(620, 130, .1, 'square', .16); this.burst(.05, .2, 3000); }
      if (i === 1) { this.burst(.24, .6, 1500); this.tone(130, 40, .2, 'sine', .55); }
      if (i === 2) { this.tone(980, 300, .07, 'sawtooth', .09); this.burst(.03, .12, 2500, 'highpass'); }
      if (i === 3) { this.tone(190, 60, .28, 'sine', .55); this.burst(.1, .3, 700); }
    },
    hit() { this.tone(1500, 1100, .04, 'square', .05); },
    crit() { this.tone(2100, 1500, .07, 'square', .08); },
    kill() { this.tone(420, 880, .12, 'triangle', .22); },
    // knackiger Abschuss-Impact: Crunch + tiefer Schlag, skaliert mit Wucht
    smash(k) {
      this.burst(.06 + k * .03, .7 + k * .2, 5200, 'highpass');
      this.burst(.16, .8, 700, 'bandpass');
      this.burst(.3 + k * .1, .6, 220);
      this.tone(220, 30, .25 + k * .1, 'sine', .9 + k * .2);
      this.tone(80, 22, .45, 'sine', .7);
      this.tone(3200, 400, .06, 'sawtooth', .12);
      this.tone(140, 45, .12, 'square', .25);
    },
    boom(g = .7) { this.burst(.55, g, 620); this.tone(95, 28, .5, 'sine', g); },
    hurt() { this.tone(180, 70, .18, 'sawtooth', .28); this.burst(.1, .2, 900); },
    pickup() { this.tone(640, 1280, .13, 'triangle', .22); },
    reload() { this.tone(300, 520, .06, 'square', .08); },
    dash() { this.burst(.2, .3, 1800, 'bandpass'); },
    enemyShot() { this.tone(420, 150, .14, 'sawtooth', .06); },
    horn() { this.tone(110, 220, .6, 'sawtooth', .22); this.tone(165, 330, .6, 'sawtooth', .14); },
    upgrade() { [523, 659, 784].forEach((f, i) => setTimeout(() => this.tone(f, f, .16, 'triangle', .22), i * 70)); },
    alarm() { this.tone(760, 520, .22, 'square', .1); },
  };

  /* ========== Partikel und Effekte ========== */
  const tmpColor = new THREE.Color();
  // Punktpartikel mit eigener Größe und Deckkraft pro Teilchen
  const pointScale = { value: 600 };
  const PT_VERT = `
    attribute float psize; attribute float palpha; attribute vec3 pcolor;
    uniform float uScale; varying vec3 vColor; varying float vAlpha;
    void main() {
      vColor = pcolor; vAlpha = palpha;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = psize * uScale / max(0.1, -mv.z);
      gl_Position = projectionMatrix * mv;
    }`;
  const PT_FRAG = `
    uniform sampler2D map; varying vec3 vColor; varying float vAlpha;
    void main() {
      vec4 t = texture2D(map, gl_PointCoord);
      gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);
      #include <tonemapping_fragment>
      #include <encodings_fragment>
    }`;
  function makeSystem(n, map, additive, smokey) {
    const s = {
      n, head: 0, smokey,
      pos: new Float32Array(n * 3).fill(-999), vel: new Float32Array(n * 3), col: new Float32Array(n * 3), base: new Float32Array(n * 3),
      size: new Float32Array(n), alpha: new Float32Array(n), life: new Float32Array(n), max: new Float32Array(n),
      grav: new Float32Array(n), drag: new Float32Array(n), s0: new Float32Array(n), s1: new Float32Array(n), a0: new Float32Array(n),
    };
    s.geo = new THREE.BufferGeometry();
    s.geo.setAttribute('position', new THREE.BufferAttribute(s.pos, 3));
    s.geo.setAttribute('pcolor', new THREE.BufferAttribute(s.col, 3));
    s.geo.setAttribute('psize', new THREE.BufferAttribute(s.size, 1));
    s.geo.setAttribute('palpha', new THREE.BufferAttribute(s.alpha, 1));
    const pts = new THREE.Points(s.geo, new THREE.ShaderMaterial({
      uniforms: { map: { value: map }, uScale: pointScale },
      vertexShader: PT_VERT, fragmentShader: PT_FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
    pts.frustumCulled = false;
    pts.renderOrder = additive ? 2 : 1;
    scene.add(pts);
    return s;
  }
  function emit(s, x, y, z, vx, vy, vz, color, life, s0, s1, a0, grav, drag) {
    const i = s.head; s.head = (s.head + 1) % s.n;
    const i3 = i * 3;
    s.pos[i3] = x; s.pos[i3 + 1] = y; s.pos[i3 + 2] = z;
    s.vel[i3] = vx; s.vel[i3 + 1] = vy; s.vel[i3 + 2] = vz;
    tmpColor.set(color);
    s.base[i3] = tmpColor.r; s.base[i3 + 1] = tmpColor.g; s.base[i3 + 2] = tmpColor.b;
    s.life[i] = s.max[i] = life;
    s.s0[i] = s0; s.s1[i] = s1; s.a0[i] = a0; s.grav[i] = grav; s.drag[i] = drag;
  }
  function updateSystem(s, dt) {
    for (let i = 0; i < s.n; i++) {
      if (s.life[i] <= 0) continue;
      const i3 = i * 3;
      s.life[i] -= dt;
      if (s.life[i] <= 0) { s.pos[i3 + 1] = -999; s.alpha[i] = 0; continue; }
      const dr = Math.exp(-s.drag[i] * dt);
      s.vel[i3] *= dr; s.vel[i3 + 2] *= dr;
      s.vel[i3 + 1] = s.vel[i3 + 1] * dr - s.grav[i] * dt;
      s.pos[i3] += s.vel[i3] * dt; s.pos[i3 + 1] += s.vel[i3 + 1] * dt; s.pos[i3 + 2] += s.vel[i3 + 2] * dt;
      if (s.pos[i3 + 1] < .03) { s.pos[i3 + 1] = .03; s.vel[i3 + 1] *= -.4; }
      const f = s.life[i] / s.max[i], k = 1 - f;
      s.size[i] = s.s0[i] + (s.s1[i] - s.s0[i]) * (s.smokey ? 1 - f * f : k);
      s.alpha[i] = s.a0[i] * (s.smokey ? Math.min(1, k * 8) * f : f);
      // Funken kühlen von Weißglut zur Grundfarbe ab
      const hot = s.smokey ? 0 : Math.max(0, f - .6) * 2.2;
      s.col[i3] = s.base[i3] + hot; s.col[i3 + 1] = s.base[i3 + 1] + hot; s.col[i3 + 2] = s.base[i3 + 2] + hot;
    }
    s.geo.attributes.position.needsUpdate = true;
    s.geo.attributes.pcolor.needsUpdate = true;
    s.geo.attributes.psize.needsUpdate = true;
    s.geo.attributes.palpha.needsUpdate = true;
  }
  const glowPS = makeSystem(1600, glowTex, true, false);
  const smokePS = makeSystem(360, smokeTex, false, true);

  function burst(x, y, z, n, color, speed, life, grav = 14) {
    n = fxN(n);
    for (let k = 0; k < n; k++) {
      const th = rand(0, 6.283), c = rand(-1, 1), s = Math.sqrt(1 - c * c), sp = rand(.25, 1) * speed;
      emit(glowPS, x, y, z, Math.cos(th) * s * sp, c * sp, Math.sin(th) * s * sp, color, rand(.5, 1) * life, rand(.18, .38), 0, 1, grav, .6);
    }
  }
  function smoke(x, y, z, n, spread, color, life, size, rise = 1.2, alpha = .55) {
    n = fxN(n);
    for (let k = 0; k < n; k++) {
      emit(smokePS, x + rand(-spread, spread), y + rand(-spread, spread) * .6, z + rand(-spread, spread),
        rand(-1, 1) * spread * 1.5, rand(.2, 1) * rise, rand(-1, 1) * spread * 1.5,
        color, life * rand(.7, 1.2), size * .4, size * rand(.9, 1.5), alpha * rand(.6, 1), -rise * .3, 1.8);
    }
  }

  // Funken als Linien, die entlang ihrer Flugbahn gestreckt sind
  const SN = 420;
  const sPos = new Float32Array(SN * 6).fill(-999), sCol = new Float32Array(SN * 6), sVel = new Float32Array(SN * 3);
  const sBase = new Float32Array(SN * 3), sLife = new Float32Array(SN), sMax = new Float32Array(SN);
  let sHead = 0;
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  sGeo.setAttribute('color', new THREE.BufferAttribute(sCol, 3));
  const sparkLines = new THREE.LineSegments(sGeo, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  sparkLines.frustumCulled = false;
  scene.add(sparkLines);
  // n Funken in einem Kegel um die Richtung (nx, ny, nz)
  function sparks(x, y, z, n, color, speed, life, nx = 0, ny = 1, nz = 0, cone = 1) {
    tmpColor.set(color);
    n = fxN(n);
    for (let k = 0; k < n; k++) {
      const i = sHead; sHead = (sHead + 1) % SN;
      let dx = nx + rand(-cone, cone), dy = ny + rand(-cone, cone), dz = nz + rand(-cone, cone);
      const l = Math.hypot(dx, dy, dz) || 1, sp = speed * rand(.35, 1);
      dx /= l; dy /= l; dz /= l;
      sVel[i * 3] = dx * sp; sVel[i * 3 + 1] = dy * sp; sVel[i * 3 + 2] = dz * sp;
      for (let v = 0; v < 2; v++) { sPos[i * 6 + v * 3] = x; sPos[i * 6 + v * 3 + 1] = y; sPos[i * 6 + v * 3 + 2] = z; }
      sBase[i * 3] = tmpColor.r; sBase[i * 3 + 1] = tmpColor.g; sBase[i * 3 + 2] = tmpColor.b;
      sLife[i] = sMax[i] = life * rand(.5, 1);
    }
  }
  function updateSparks(dt) {
    for (let i = 0; i < SN; i++) {
      if (sLife[i] <= 0) continue;
      const i3 = i * 3, i6 = i * 6;
      sLife[i] -= dt;
      if (sLife[i] <= 0) { sPos[i6 + 1] = sPos[i6 + 4] = -999; for (let c = 0; c < 6; c++) sCol[i6 + c] = 0; continue; }
      sVel[i3 + 1] -= 16 * dt;
      const x = sPos[i6] + sVel[i3] * dt, y = sPos[i6 + 1] + sVel[i3 + 1] * dt, z = sPos[i6 + 2] + sVel[i3 + 2] * dt;
      sPos[i6] = x; sPos[i6 + 1] = Math.max(.03, y); sPos[i6 + 2] = z;
      if (y < .03) { sVel[i3 + 1] *= -.35; sVel[i3] *= .6; sVel[i3 + 2] *= .6; }
      sPos[i6 + 3] = x - sVel[i3] * .028; sPos[i6 + 4] = Math.max(.03, y - sVel[i3 + 1] * .028); sPos[i6 + 5] = z - sVel[i3 + 2] * .028;
      const f = sLife[i] / sMax[i], hot = f * f * .8;
      sCol[i6] = (sBase[i3] + hot) * f; sCol[i6 + 1] = (sBase[i3 + 1] + hot) * f; sCol[i6 + 2] = (sBase[i3 + 2] + hot) * f;
      sCol[i6 + 3] = sCol[i6] * .15; sCol[i6 + 4] = sCol[i6 + 1] * .15; sCol[i6 + 5] = sCol[i6 + 2] * .15;
    }
    sGeo.attributes.position.needsUpdate = true;
    sGeo.attributes.color.needsUpdate = true;
  }
  function updateParticles(dt) {
    updateSystem(glowPS, dt);
    updateSystem(smokePS, dt);
    updateSparks(dt);
  }

  // Leuchtspuren: ein kurzer, heller Streifen fliegt vom Lauf zum Ziel
  const tracerGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, .5);
  const tracers = [];
  for (let i = 0; i < 72; i++) {
    const m = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    m.visible = false; m.frustumCulled = false;
    scene.add(m);
    tracers.push({ m, a: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, head: 0, speed: 0, len: 0, w: 0, hit: null });
  }
  let tracerHead = 0;
  function placeTracer(t) {
    const s = Math.max(0, t.head - t.len), e = Math.min(t.head, t.dist);
    t.m.position.copy(t.a).addScaledVector(t.dir, s);
    v1.copy(t.m.position).add(t.dir);
    t.m.lookAt(v1);
    const taper = clamp((t.dist - s) / t.len, .25, 1);
    t.m.scale.set(t.w * taper, t.w * taper, Math.max(.001, e - s));
  }
  function tracer(a, b, color, w, speed = 300, len = 5, hit = null) {
    const t = tracers[tracerHead]; tracerHead = (tracerHead + 1) % tracers.length;
    if (t.hit) impactFX(t.hit);
    t.m.material.color.set(color).multiplyScalar(2.4);
    t.a.copy(a); t.dir.subVectors(b, a); t.dist = t.dir.length(); t.dir.divideScalar(t.dist || 1);
    t.head = Math.min(t.dist, len * .5); t.speed = speed; t.len = len; t.w = w; t.hit = hit;
    t.m.visible = true;
    placeTracer(t);
  }
  function updateTracers(dt) {
    for (const t of tracers) {
      if (!t.m.visible) continue;
      t.head += t.speed * dt;
      if (t.hit && t.head >= t.dist) { impactFX(t.hit); t.hit = null; }
      if (t.head - t.len >= t.dist) { t.m.visible = false; continue; }
      placeTracer(t);
    }
  }

  // Explosionsblitze
  const flashes = [];
  for (let i = 0; i < 48; i++) {
    const s = glowSprite(0xffffff, 1); s.visible = false; scene.add(s);
    flashes.push({ s, life: 0, max: 1, size: 1 });
  }
  const boomLights = [0, 1, 2].map(() => { const l = new THREE.PointLight(0xffa050, 0, 26, 1.8); scene.add(l); return l; });
  let flashHead = 0, lightHead = 0;
  let shake = 0;
  function flashAt(x, y, z, size, color, life = .3) {
    const f = flashes[flashHead]; flashHead = (flashHead + 1) % flashes.length;
    f.s.position.set(x, y, z); f.s.material.color.set(color);
    f.s.material.rotation = rand(0, 6.28);
    f.s.visible = true; f.life = f.max = life; f.size = size;
  }
  function explode(x, y, z, size, color) {
    flashAt(x, y, z, size * 3.4, color);
    flashAt(x, y, z, size * 1.5, 0xfff2d8, .14);
    // Feuerball aus aufquellenden Glutballen
    const balls = Math.round(4 + size * 2.2);
    for (let i = 0; i < balls; i++) {
      emit(glowPS, x + rand(-.3, .3) * size, y + rand(-.2, .3) * size, z + rand(-.3, .3) * size,
        rand(-1.6, 1.6) * size, rand(.4, 2.4) * size, rand(-1.6, 1.6) * size,
        i % 3 ? color : 0xffc070, rand(.32, .55), size * .8, size * 2.1, .85, -1.5, 3.2);
    }
    burst(x, y, z, Math.round(14 + size * 10), color, 7 + size * 3.5, .7);
    sparks(x, y, z, Math.round(10 + size * 7), 0xffc070, 11 + size * 4, .65, 0, .7, 0, 1.3);
    smoke(x, y + size * .3, z, Math.round(3 + size * 2.4), size * .45, 0x2a2f36, 1.5 + size * .3, size * 2.2, 1.7, .72);
    const l = boomLights[lightHead]; lightHead = (lightHead + 1) % boomLights.length;
    l.position.set(x, y + .5, z); l.color.set(color); l.intensity = 2.5 + size;
    ringAt(x, y < 4 ? .07 : y, z, size * 3.2, color, .42);
    if (size >= 1.4) ringAt(x, y < 4 ? .09 : y, z, size * 1.8, 0xffffff, .25);
    spawnDebris(x, y, z, Math.min(10, Math.round(3 + size * 2)), 6 + size * 2, debrisMat, .1 + size * .05);
    if (y < 7) scorch(x, z, 1 + size * .75);
    const d = Math.hypot(x - camera.position.x, z - camera.position.z);
    screenFlash = Math.max(screenFlash, clamp(size * .11 * (1 - d / 40), 0, .4));
    if (size >= 2) Snd.debris();
  }

  // Druckwellen
  const rings = [];
  const ringGeom = new THREE.RingGeometry(.84, 1, 56);
  for (let i = 0; i < 18; i++) {
    const m = new THREE.Mesh(ringGeom, new THREE.MeshBasicMaterial({
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    }));
    m.rotation.x = -Math.PI / 2;
    m.visible = false;
    scene.add(m);
    rings.push({ m, life: 0, max: 1, size: 1 });
  }
  let ringHead = 0, screenFlash = 0, speedFade = 0, hitStop = 0, killFlash = 0;
  function ringAt(x, y, z, size, color, life) {
    const r = rings[ringHead]; ringHead = (ringHead + 1) % rings.length;
    r.m.position.set(x, y, z); r.m.material.color.set(color);
    r.m.visible = true; r.life = r.max = life; r.size = size;
  }

  // Brandspuren am Boden
  const scorchTex = makeCanvas(128, 128, (g, w) => {
    const r = g.createRadialGradient(w / 2, w / 2, 4, w / 2, w / 2, w / 2);
    r.addColorStop(0, 'rgba(0,0,0,.92)'); r.addColorStop(.6, 'rgba(0,0,0,.6)'); r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, w);
    g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineCap = 'round';
    for (let i = 0; i < 18; i++) {
      const a = rand(0, 6.28), l = rand(30, 62);
      g.lineWidth = rand(1.5, 5);
      g.beginPath(); g.moveTo(w / 2, w / 2); g.lineTo(w / 2 + Math.cos(a) * l, w / 2 + Math.sin(a) * l); g.stroke();
    }
  });
  const scorches = [];
  const scorchGeo = new THREE.PlaneGeometry(2, 2);
  for (let i = 0; i < 32; i++) {
    const m = new THREE.Mesh(scorchGeo, new THREE.MeshBasicMaterial({ map: scorchTex, transparent: true, depthWrite: false, opacity: .8 }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = .032 + i * .0004;
    m.visible = false;
    scene.add(m);
    scorches.push(m);
  }
  let scorchHead = 0;
  function scorch(x, z, size) {
    if (Math.abs(x) > ARENA - 1 || Math.abs(z) > ARENA - 1) return;
    const m = scorches[scorchHead]; scorchHead = (scorchHead + 1) % scorches.length;
    m.position.x = x; m.position.z = z;
    m.rotation.z = rand(0, 6.28);
    m.scale.set(size, size, 1);
    m.visible = true;
  }

  // Einschusslöcher, die kurz nachglühen
  const holeTex = makeCanvas(64, 64, (g, w) => {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 30);
    r.addColorStop(0, 'rgba(0,0,0,1)'); r.addColorStop(.2, 'rgba(8,9,11,.95)');
    r.addColorStop(.42, 'rgba(18,20,24,.55)'); r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, w);
    g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 1.5;
    for (let i = 0; i < 7; i++) {
      const a = rand(0, 6.28), l = rand(12, 26);
      g.beginPath(); g.moveTo(32, 32); g.lineTo(32 + Math.cos(a) * l, 32 + Math.sin(a) * l); g.stroke();
    }
  });
  const decalGeo = new THREE.PlaneGeometry(1, 1);
  const decals = [];
  for (let i = 0; i < 70; i++) {
    const m = new THREE.Mesh(decalGeo, new THREE.MeshBasicMaterial({
      map: holeTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
    }));
    const glow = new THREE.Mesh(decalGeo, new THREE.MeshBasicMaterial({
      map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: -5, fog: false,
    }));
    glow.scale.setScalar(.8);
    m.add(glow);
    m.visible = false;
    scene.add(m);
    decals.push({ m, glow, life: 0 });
  }
  let decalHead = 0;
  function decal(x, y, z, nx, ny, nz, size, color) {
    if (FX < .5) return;
    const d = decals[decalHead]; decalHead = (decalHead + 1) % decals.length;
    d.m.position.set(x + nx * .012, y + ny * .012, z + nz * .012);
    v1.set(x + nx, y + ny, z + nz);
    d.m.lookAt(v1);
    d.m.rotateZ(rand(0, 6.28));
    d.m.scale.setScalar(size * rand(.8, 1.2));
    d.glow.material.color.set(color).multiplyScalar(1.6);
    d.m.visible = true;
    d.life = 14;
  }
  function updateDecals(dt) {
    for (const d of decals) {
      if (!d.m.visible) continue;
      d.life -= dt;
      if (d.life <= 0) { d.m.visible = false; continue; }
      d.m.material.opacity = Math.min(1, d.life / 2) * .9;
      d.glow.material.opacity = Math.max(0, (d.life - 12.6) / 1.4);
    }
  }
  function impactFX(h) {
    sparks(h.x, h.y, h.z, h.big ? 9 : 5, h.color, h.big ? 10 : 8, .32, h.nx, h.ny, h.nz, .75);
    burst(h.x, h.y, h.z, 3, h.color, 2.5, .2, 6);
    flashAt(h.x + h.nx * .06, h.y + h.ny * .06, h.z + h.nz * .06, h.big ? .9 : .6, h.color, .08);
    smoke(h.x + h.nx * .12, h.y + h.ny * .12, h.z + h.nz * .12, 1, .05, 0x8c98a4, .8, .55, .5, .32);
    decal(h.x, h.y, h.z, h.nx, h.ny, h.nz, h.big ? .26 : .18, h.color);
    if (Math.hypot(h.x - camera.position.x, h.z - camera.position.z) < 45) Snd.ricochet();
  }

  // Trümmer
  const debrisMat = new THREE.MeshStandardMaterial({ color: 0x3a424c, roughness: .5, metalness: .7, flatShading: true });
  const debris = [];
  for (let i = 0; i < 90; i++) {
    const m = new THREE.Mesh(boxGeo, debrisMat);
    m.visible = false;
    scene.add(m);
    debris.push({ m, vx: 0, vy: 0, vz: 0, life: 0, spin: 0, size: 1, glow: false });
  }
  let debrisHead = 0;
  function spawnDebris(x, y, z, n, speed, material, size) {
    for (let k = 0; k < n; k++) {
      const d = debris[debrisHead]; debrisHead = (debrisHead + 1) % debris.length;
      d.m.material = material;
      d.m.position.set(x, y, z);
      d.size = size * rand(.6, 1.5);
      d.m.scale.set(d.size * rand(.6, 1.4), d.size * rand(.6, 1.4), d.size * rand(.6, 1.4));
      d.m.visible = true;
      const a = rand(0, 6.28);
      d.vx = Math.cos(a) * speed * rand(.3, 1); d.vz = Math.sin(a) * speed * rand(.3, 1); d.vy = speed * rand(.3, 1.1);
      d.life = rand(1.4, 2.6); d.spin = rand(-14, 14); d.glow = material.emissive && material.emissiveIntensity > 1;
    }
  }
  function updateDebris(dt) {
    for (const d of debris) {
      if (!d.m.visible) continue;
      d.life -= dt;
      if (d.life <= 0) { d.m.visible = false; continue; }
      d.vy -= 22 * dt;
      d.m.position.x += d.vx * dt; d.m.position.y += d.vy * dt; d.m.position.z += d.vz * dt;
      d.m.rotation.x += d.spin * dt; d.m.rotation.y += d.spin * .7 * dt;
      // glühende Bruchstücke ziehen Rauch hinter sich her
      if (d.glow && d.life > .8 && Math.random() < dt * 14) smoke(d.m.position.x, d.m.position.y, d.m.position.z, 1, .02, 0x30353c, .6, .35, .4, .45);
      if (d.life < .4) d.m.scale.multiplyScalar(Math.max(0, 1 - dt * 6));
      if (d.m.position.y < .05) {
        d.m.position.y = .05;
        d.vy *= -.42; d.vx *= .6; d.vz *= .6; d.spin *= .5;
      }
    }
  }

  // Hülsen, Schrotpatronen, Energiezellen und leere Magazine
  const brass = new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: .28, metalness: .95 });
  const shellTex = makeCanvas(64, 128, (g, w, h) => {
    g.fillStyle = '#b3241c'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 4) { g.fillStyle = x % 8 ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.08)'; g.fillRect(x, 0, 2, h); }
    const b = g.createLinearGradient(0, h * .7, 0, h);
    b.addColorStop(0, '#f2cf7a'); b.addColorStop(.5, '#c99a3a'); b.addColorStop(1, '#8a6420');
    g.fillStyle = b; g.fillRect(0, h * .72, w, h * .28);
    g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(0, h * .72, w, 3);
  });
  const shellMat = new THREE.MeshStandardMaterial({ map: shellTex, roughness: .5, metalness: .25 });
  const cellMat = new THREE.MeshStandardMaterial({ color: 0x1b2a1c, emissive: 0x8dff8a, emissiveIntensity: 1.6, roughness: .3, metalness: .6 });
  const magMat = new THREE.MeshStandardMaterial({ color: 0x252c34, roughness: .45, metalness: .8 });
  const SHELL_KINDS = {
    brass: { geo: new THREE.CylinderGeometry(.011, .012, .045, 8), mat: brass, pitch: 1 },
    shell: { geo: new THREE.CylinderGeometry(.02, .02, .075, 10), mat: shellMat, pitch: .55 },
    cell: { geo: new THREE.CylinderGeometry(.014, .014, .05, 6), mat: cellMat, pitch: 1.3 },
    big: { geo: new THREE.CylinderGeometry(.032, .032, .07, 12), mat: brass, pitch: .5 },
    mag: { geo: new THREE.BoxGeometry(.035, .12, .06), mat: magMat, pitch: .3 },
  };
  const shells = [];
  for (let i = 0; i < 90; i++) {
    const m = new THREE.Mesh(SHELL_KINDS.brass.geo, brass);
    m.visible = false; m.castShadow = false;
    scene.add(m);
    shells.push({ m, kind: null, vx: 0, vy: 0, vz: 0, sx: 0, sy: 0, life: 0, rest: false, ground: 0 });
  }
  let shellHead = 0;
  function groundAt(x, z, y) {
    let g = 0;
    for (const b of colliders) {
      if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && b.maxY <= y + .1 && b.maxY > g) g = b.maxY;
    }
    return g;
  }
  function ejectShell(kind, pos, vx, vy, vz) {
    const s = shells[shellHead]; shellHead = (shellHead + 1) % shells.length;
    const k = SHELL_KINDS[kind];
    s.kind = k;
    s.m.geometry = k.geo; s.m.material = k.mat;
    s.m.position.copy(pos);
    s.m.rotation.set(rand(0, 6.28), rand(0, 6.28), Math.PI / 2);
    s.m.scale.setScalar(1);
    s.m.visible = true;
    s.vx = vx; s.vy = vy; s.vz = vz;
    s.sx = rand(12, 26) * (Math.random() < .5 ? -1 : 1); s.sy = rand(-10, 10);
    s.life = kind === 'mag' ? 7 : 9; s.rest = false;
    s.ground = groundAt(pos.x, pos.z, pos.y);
  }
  function updateShells(dt) {
    for (const s of shells) {
      if (!s.m.visible) continue;
      s.life -= dt;
      if (s.life <= 0) { s.m.visible = false; continue; }
      const p = s.m.position;
      if (s.life < 1) s.m.scale.setScalar(s.life);
      if (s.rest) continue;
      s.vy -= 20 * dt;
      p.x += s.vx * dt; p.y += s.vy * dt; p.z += s.vz * dt;
      s.m.rotation.x += s.sx * dt; s.m.rotation.y += s.sy * dt;
      const half = s.kind === SHELL_KINDS.mag ? .03 : .014;
      if (p.y < s.ground + half) {
        p.y = s.ground + half;
        if (s.vy < -1.6) Snd.casing(s.kind.pitch);
        s.vy *= -.38; s.vx *= .55; s.vz *= .55; s.sx *= .45; s.sy *= .6;
        if (Math.abs(s.vy) < .6) {
          // flach hinlegen und liegen lassen
          s.rest = true;
          s.m.rotation.set(0, rand(0, 6.28), Math.PI / 2);
        }
      }
    }
  }

  // Schwebende Glut um die Kamera
  const EMBERS = 170;
  const emberPos = new Float32Array(EMBERS * 3), emberSeed = new Float32Array(EMBERS);
  for (let i = 0; i < EMBERS; i++) {
    emberPos[i * 3] = rand(-30, 30); emberPos[i * 3 + 1] = rand(0, 12); emberPos[i * 3 + 2] = rand(-30, 30);
    emberSeed[i] = rand(0, 6.28);
  }
  const emberGeo = new THREE.BufferGeometry();
  emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPos, 3));
  const embers = new THREE.Points(emberGeo, new THREE.PointsMaterial({
    size: .09, color: 0xffa860, map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  embers.frustumCulled = false;
  scene.add(embers);
  function updateEmbers(dt) {
    const cx = camera.position.x, cz = camera.position.z;
    for (let i = 0; i < EMBERS; i++) {
      const j = i * 3;
      emberSeed[i] += dt;
      emberPos[j] += Math.sin(emberSeed[i] * .8) * dt * .7;
      emberPos[j + 1] += dt * .7;
      emberPos[j + 2] += Math.cos(emberSeed[i] * .6) * dt * .7;
      if (emberPos[j + 1] > 12 || Math.abs(emberPos[j] - cx) > 32 || Math.abs(emberPos[j + 2] - cz) > 32) {
        emberPos[j] = cx + rand(-30, 30); emberPos[j + 1] = rand(0, 2); emberPos[j + 2] = cz + rand(-30, 30);
      }
    }
    emberGeo.attributes.position.needsUpdate = true;
  }

  // Lichtbögen am Reaktor
  const arcs = [0, 1, 2, 3].map(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 3), 3));
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xbffcf4, fog: false }));
    l.frustumCulled = false;
    scene.add(l);
    return l;
  });
  let arcT = 0;
  function updateArcs(dt) {
    arcT -= dt;
    if (arcT > 0) return;
    arcT = .055;
    for (const l of arcs) {
      l.visible = Math.random() < .55;
      if (!l.visible) continue;
      const a = rand(0, 6.28), y = rand(2, 8), p = l.geometry.attributes.position;
      for (let i = 0; i < 8; i++) {
        const k = i / 7, r = 1.5 + k * 1.65;
        const j = i > 0 && i < 7 ? .22 : 0;
        p.setXYZ(i, Math.cos(a) * r + rand(-j, j), y + rand(-j, j) * 2, Math.sin(a) * r + rand(-j, j));
      }
      p.needsUpdate = true;
    }
  }

  function updateEffects(dt) {
    for (const r of rings) {
      if (!r.m.visible) continue;
      r.life -= dt;
      if (r.life <= 0) { r.m.visible = false; continue; }
      const k = r.life / r.max, e = 1 - k * k * k;
      r.m.material.opacity = k * k * .9;
      r.m.scale.set(r.size * e, r.size * e, 1);
    }
    updateDebris(dt);
    updateShells(dt);
    updateDecals(dt);
    updateEmbers(dt);
    updateArcs(dt);
    updateTracers(dt);
    for (const f of flashes) {
      if (!f.s.visible) continue;
      f.life -= dt;
      if (f.life <= 0) { f.s.visible = false; continue; }
      const k = f.life / f.max;
      f.s.material.opacity = k * k;
      f.s.scale.setScalar(f.size * (1.2 - k * .55));
    }
    for (const l of boomLights) l.intensity = Math.max(0, l.intensity - dt * 18);
    muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 40);
    updateParticles(dt);
  }

  /* ========== Waffen ========== */
  const WEAPONS = [
    { name: 'Impuls', dmg: 27, rate: 4.4, mag: 14, reserve: Infinity, cap: Infinity, reload: 1.0, spread: .005, pellets: 1, color: 0x66e0ff, kick: .05, shell: 'brass' },
    { name: 'Schrot', dmg: 13, rate: 1.3, mag: 6, reserve: 30, cap: 60, reload: 1.6, spread: .07, pellets: 10, color: 0xffc36a, kick: .13, shell: 'shell' },
    { name: 'Plasma', dmg: 15, rate: 11, mag: 40, reserve: 120, cap: 280, reload: 1.8, spread: .017, pellets: 1, color: 0x8dff8a, kick: .028, shell: 'cell' },
    { name: 'Werfer', dmg: 140, rate: 1.05, mag: 4, reserve: 8, cap: 20, reload: 2.1, spread: 0, pellets: 1, color: 0xff7a3d, kick: .17, explosive: true, radius: 6.5, shell: 'big' },
  ];

  // Die Waffe wird in einer eigenen Szene mit engerem Blickwinkel gezeichnet: kein Clipping in Wände, weniger Verzerrung
  const vmScene = new THREE.Scene();
  const vmCam = new THREE.PerspectiveCamera(56, 1, .01, 10);
  vmScene.add(new THREE.HemisphereLight(0x9fb8d4, 0x161b22, .75));
  const vmSun = new THREE.DirectionalLight(0xffe2c4, 1.25);
  vmScene.add(vmSun); vmScene.add(vmSun.target);
  const vmRim = new THREE.DirectionalLight(0x5ff0e0, .55);
  vmRim.position.set(-1.5, .6, -1.2);
  vmScene.add(vmRim);
  const vmMuzzleLight = new THREE.PointLight(0xffe0b0, 0, 1.6, 2);
  vmScene.add(vmMuzzleLight);
  const vmRoot = new THREE.Group();
  vmRoot.visible = false;
  vmScene.add(vmRoot);

  const shiny = (m, k = 1) => { if (envMap) { m.envMap = envMap; m.envMapIntensity = k; } return m; };
  const gunDark = shiny(new THREE.MeshStandardMaterial({ color: 0x1d2329, roughness: .36, metalness: .82 }), .9);
  const gunMid = shiny(new THREE.MeshStandardMaterial({ color: 0x56636f, roughness: .4, metalness: .78 }));
  const gunLight = shiny(new THREE.MeshStandardMaterial({ color: 0xa8b2ba, roughness: .22, metalness: .95 }), 1.3);
  const gunGrip = new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: .9, metalness: .1 });
  const gloveMat = new THREE.MeshStandardMaterial({ color: 0x2a2d29, roughness: .92, metalness: 0 });
  const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x38414b, roughness: .8, metalness: .1 });
  const sleeveStripe = new THREE.MeshBasicMaterial({ color: 0xffa83a });
  const glassMat = new THREE.MeshBasicMaterial({ color: 0x5ff0e0, transparent: true, opacity: .18, depthWrite: false, blending: THREE.AdditiveBlending });
  [brass, magMat].forEach(m => shiny(m, 1.2));
  const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 14), cylGeo6 = new THREE.CylinderGeometry(1, 1, 1, 6);
  const flameGeo = new THREE.PlaneGeometry(1, 1).rotateY(Math.PI / 2).translate(0, 0, -.5);

  function part(parent, geo, m, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.rotation.set(rx, ry, rz);
    parent.add(o);
    return o;
  }
  const gbox = (p, w, h, d, x, y, z, m, rx = 0, ry = 0, rz = 0) => part(p, boxGeo, m, x, y, z, w, h, d, rx, ry, rz);
  const gcyl = (p, r, len, x, y, z, m, geo = cylGeo) => part(p, geo, m, x, y, z, r, len, r, Math.PI / 2);
  const node = (p, x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); p.add(o); return o; };

  // Handschuh mit Unterarm; die Hand greift an ihrem Ursprung
  function makeArm(parent, x, y, z, side, reach) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    gbox(g, .052, .062, .072, 0, 0, 0, gloveMat);
    gbox(g, .05, .022, .05, -side * .012, .036, -.012, gloveMat, .25);
    gbox(g, .018, .018, .05, side * .03, .012, -.026, gloveMat, 0, side * .3);
    const arm = new THREE.Group();
    arm.position.set(side * .015, -.03, .04);
    arm.rotation.set(.55, side * Math.abs(reach), 0);
    g.add(arm);
    gbox(arm, .058, .058, .08, 0, 0, .04, gloveMat);
    gbox(arm, .078, .078, .34, 0, 0, .23, sleeveMat);
    gbox(arm, .08, .012, .03, 0, .034, .1, sleeveStripe);
    return g;
  }
  function makeScreen(parent, x, y, z, w, h, rx) {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 64;
    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    const m = part(parent, new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }), x, y, z, 1, 1, 1, rx);
    return { c, g: c.getContext('2d'), tex, m, key: '' };
  }
  function makeFlash(parent, x, y, z, size, len, color) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    const tint = new THREE.Color(color).lerp(new THREE.Color(0xffffff), .35);
    const mk = map => new THREE.MeshBasicMaterial({
      map, color: tint, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    const star = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashStarTex, color: tint, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    star.scale.setScalar(size);
    g.add(star);
    const sideMat = mk(flashSideTex);
    const a = part(g, flameGeo, sideMat, 0, 0, 0, 1, size * .6, len);
    const b = part(g, flameGeo, sideMat, 0, 0, 0, 1, size * .6, len, 0, 0, Math.PI / 2);
    g.visible = false;
    return { g, star, a, b, size, len };
  }

  const vmModels = WEAPONS.map((w, i) => {
    const g = new THREE.Group();
    const glow = new THREE.MeshBasicMaterial({ color: w.color, toneMapped: false });
    const M = { g, glow, glowBase: new THREE.Color(w.color) };
    if (i === 0) { // Impuls: Energiepistole mit Schlitten
      gbox(g, .044, .046, .2, 0, 0, -.06, gunMid);
      gbox(g, .046, .012, .05, 0, -.026, -.09, gunDark);
      M.slide = new THREE.Group(); M.slide.position.set(0, .04, -.06); g.add(M.slide);
      gbox(M.slide, .05, .04, .23, 0, 0, 0, gunDark);
      gbox(M.slide, .052, .012, .045, 0, .006, .03, gunGrip);
      gbox(M.slide, .014, .008, .19, 0, .023, -.01, gunLight);
      for (let k = 0; k < 5; k++) gbox(M.slide, .052, .03, .004, 0, 0, .07 + k * .009, gunMid);
      gbox(M.slide, .008, .012, .008, 0, .027, -.105, glow);
      gbox(M.slide, .03, .012, .008, 0, .027, .1, gunDark);
      gcyl(g, .011, .05, 0, .035, -.195, gunLight);
      gcyl(g, .016, .012, 0, .035, -.175, glow);
      [-.13, -.1, -.07].forEach(z => gbox(g, .05, .008, .018, 0, .014, z, glow));
      gbox(g, .042, .11, .052, 0, -.068, .028, gunGrip, -.25);
      gbox(g, .006, .03, .044, 0, -.032, -.035, gunDark);
      gbox(g, .007, .022, .007, 0, -.03, -.01, gunLight, .3);
      M.mag = new THREE.Group(); M.mag.position.set(0, -.07, .032); M.mag.rotation.x = -.25; g.add(M.mag);
      gbox(M.mag, .034, .1, .044, 0, -.012, 0, gunDark);
      gbox(M.mag, .038, .01, .048, 0, -.066, 0, glow);
      M.port = node(g, .03, .05, -.04);
      M.muzzle = node(g, 0, .035, -.23);
      M.screen = makeScreen(g, 0, .068, .052, .044, .022, -.5);
      M.armR = makeArm(g, .004, -.072, .04, 1, .15);
      M.armL = makeArm(g, -.036, -.09, .015, -1, -.5);
      M.armL.rotation.set(0, -.25, -.3);
      M.flash = makeFlash(g, 0, .035, -.235, .16, .2, w.color);
      M.pose = { x: .2, y: -.19, z: -.42 };
    } else if (i === 1) { // Schrot: Pumpflinte mit Patronenhalter
      gbox(g, .058, .07, .21, 0, 0, -.02, gunDark);
      gbox(g, .06, .012, .2, 0, .038, -.02, gunMid);
      gbox(g, .006, .008, .19, 0, .047, -.02, glow);
      gcyl(g, .017, .5, 0, .022, -.37, gunMid);
      gcyl(g, .021, .03, 0, .022, -.6, gunLight);
      gcyl(g, .013, .38, 0, -.016, -.3, gunDark);
      gbox(g, .006, .01, .006, 0, .044, -.6, glow);
      M.pump = new THREE.Group(); M.pump.position.set(0, -.016, -.3); g.add(M.pump);
      gbox(M.pump, .05, .046, .16, 0, 0, 0, gunGrip);
      for (let k = 0; k < 6; k++) gbox(M.pump, .053, .036, .008, 0, 0, -.06 + k * .024, gunMid);
      gbox(g, .042, .1, .05, 0, -.075, .07, gunGrip, -.35);
      gbox(g, .044, .065, .16, 0, -.04, .2, gunGrip, .12);
      gbox(g, .046, .075, .02, 0, -.045, .28, gunMid, .12);
      M.shells = [];
      for (let k = 0; k < 6; k++) {
        const s = part(g, SHELL_KINDS.shell.geo, shellMat, .036, .005, -.085 + k * .026, .9, .9, .9, 0, 0, Math.PI / 2);
        M.shells.push(s);
      }
      gbox(g, .006, .03, .17, .031, .005, -.02, gunMid);
      M.port = node(g, .034, .02, -.03);
      M.muzzle = node(g, 0, .022, -.62);
      M.armR = makeArm(g, .004, -.08, .08, 1, .12);
      M.armL = makeArm(M.pump, -.008, -.035, .01, -1, -.6);
      M.flash = makeFlash(g, 0, .022, -.62, .3, .5, w.color);
      M.pose = { x: .19, y: -.2, z: -.36 };
    } else if (i === 2) { // Plasma: Energiegewehr mit Wärmeschlitzen und Holovisier
      gbox(g, .058, .078, .3, 0, 0, -.08, gunDark);
      gbox(g, .02, .012, .26, 0, .045, -.08, gunMid);
      for (let k = 0; k < 9; k++) gbox(g, .026, .006, .008, 0, .053, -.2 + k * .028, gunMid);
      gbox(g, .052, .052, .17, 0, .005, -.31, gunMid);
      M.vent = new THREE.MeshBasicMaterial({ color: w.color, toneMapped: false });
      for (let k = 0; k < 4; k++) for (const sx of [-1, 1]) gbox(g, .004, .03, .016, sx * .027, .005, -.37 + k * .035, M.vent);
      gcyl(g, .012, .08, 0, .005, -.43, gunLight);
      M.spin = new THREE.Group(); M.spin.position.set(0, .005, -.44); g.add(M.spin);
      for (let k = 0; k < 3; k++) {
        const a = k / 3 * Math.PI * 2;
        gbox(M.spin, .008, .008, .06, Math.cos(a) * .022, Math.sin(a) * .022, 0, glow);
      }
      gcyl(g, .024, .012, 0, .005, -.475, gunDark);
      gbox(g, .004, .028, .006, -.018, .074, -.04, gunDark);
      gbox(g, .004, .028, .006, .018, .074, -.04, gunDark);
      gbox(g, .04, .004, .006, 0, .088, -.04, gunDark);
      part(g, new THREE.PlaneGeometry(.034, .024), glassMat, 0, .074, -.04);
      gbox(g, .003, .003, .002, 0, .074, -.041, glow);
      gbox(g, .04, .1, .05, 0, -.085, .04, gunGrip, -.3);
      gbox(g, .036, .05, .14, 0, -.01, .14, gunGrip);
      M.mag = new THREE.Group(); M.mag.position.set(0, -.07, -.14); g.add(M.mag);
      gbox(M.mag, .042, .016, .042, 0, .012, 0, gunDark);
      part(M.mag, cylGeo6, cellMat, 0, -.035, 0, .018, .08, .018);
      gbox(M.mag, .042, .016, .042, 0, -.08, 0, gunDark);
      M.port = node(g, .032, .02, -.06);
      M.muzzle = node(g, 0, .005, -.48);
      M.screen = makeScreen(g, 0, .03, .072, .05, .025, -.2);
      M.armR = makeArm(g, .004, -.085, .05, 1, .12);
      M.armL = makeArm(g, -.012, -.09, -.2, -1, -.6);
      M.flash = makeFlash(g, 0, .005, -.48, .13, .16, w.color);
      M.pose = { x: .19, y: -.19, z: -.38 };
    } else { // Werfer: Granatwerfer mit Revolvertrommel
      gbox(g, .066, .06, .22, 0, .045, -.02, gunDark);
      gbox(g, .07, .014, .2, 0, .08, -.02, gunMid);
      M.drum = new THREE.Group(); M.drum.position.set(0, -.012, -.14); g.add(M.drum);
      part(M.drum, new THREE.CylinderGeometry(1, 1, 1, 8), gunMid, 0, 0, 0, .068, .15, .068, Math.PI / 2);
      M.chambers = [];
      for (let k = 0; k < 4; k++) {
        const a = k / 4 * Math.PI * 2 + Math.PI / 4;
        const ch = gcyl(M.drum, .018, .01, Math.cos(a) * .04, Math.sin(a) * .04, -.076, glow);
        gbox(M.drum, .012, .012, .15, Math.cos(a + Math.PI / 4) * .066, Math.sin(a + Math.PI / 4) * .066, 0, gunDark, 0, 0, a + Math.PI / 4);
        M.chambers.push(ch);
      }
      gcyl(g, .036, .3, 0, .04, -.33, gunDark);
      gcyl(g, .042, .05, 0, .04, -.45, gunMid);
      gcyl(g, .043, .012, 0, .04, -.42, glow);
      gbox(g, .024, .05, .14, 0, .115, -.06, gunMid);
      gbox(g, .028, .03, .01, 0, .13, -.13, gunDark);
      part(g, new THREE.CircleGeometry(.011, 12), glow, 0, .13, -.124);
      gbox(g, .04, .1, .05, 0, -.06, .07, gunGrip, -.3);
      gbox(g, .036, .1, .04, 0, -.07, -.31, gunGrip, .1);
      M.port = node(g, .03, -.01, -.1);
      M.muzzle = node(g, 0, .04, -.48);
      M.armR = makeArm(g, .004, -.07, .08, 1, .12);
      M.armL = makeArm(g, -.004, -.1, -.31, -1, -.5);
      M.flash = makeFlash(g, 0, .04, -.48, .32, .4, w.color);
      M.pose = { x: .2, y: -.21, z: -.4 };
    }
    g.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
    g.visible = false;
    vmRoot.add(g);
    return M;
  });
  const muzzleLight = new THREE.PointLight(0xffe0b0, 0, 16, 2);
  muzzleLight.position.set(.2, -.1, -1);
  camera.add(muzzleLight);
  const vm = {
    kick: 0, kickV: 0, rot: 0, rotV: 0, roll: 0, rollV: 0, swayX: 0, swayY: 0, swap: 0, flash: 0,
    slide: 0, pumpAge: -1, pumpEject: false, heat: 0, drumA: 0, drumTarget: 0, drumClick: 0,
    lagX: 0, lagY: 0, tilt: 0, air: 0, dash: 0, t: 0, rk: 0, punch: 0, punchV: 0,
  };

  // Bildschirmposition eines Punkts der Waffe in Weltkoordinaten übersetzen
  const vmTmp = new THREE.Vector3();
  function vmToWorld(obj, out, dist = .9) {
    vmRoot.updateMatrixWorld(true);
    obj.getWorldPosition(vmTmp);
    vmTmp.project(vmCam);
    out.set(vmTmp.x, vmTmp.y, .5).unproject(camera).sub(camera.position).normalize();
    return out.multiplyScalar(dist).add(camera.position);
  }
  function drawScreen(M, a) {
    const s = M.screen;
    if (!s) return;
    const max = magSize(a), key = `${a.mag}/${max}/${P.reloading > 0}`;
    if (s.key === key) return;
    s.key = key;
    const g = s.g, col = '#' + M.glowBase.getHexString();
    g.fillStyle = '#04090c'; g.fillRect(0, 0, 128, 64);
    g.fillStyle = col; g.textAlign = 'center';
    g.font = '700 38px "Chakra Petch",monospace';
    g.fillText(P.reloading > 0 ? '··' : String(a.mag).padStart(2, '0'), 64, 42);
    g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(10, 52, 108, 5);
    g.fillStyle = a.mag <= max * .25 ? '#ff4d3d' : col; g.fillRect(10, 52, 108 * (a.mag / max), 5);
    s.tex.needsUpdate = true;
  }

  /* ========== Spielerzustand ========== */
  const P = {};
  const HALF = .4, HEIGHT = 1.75, EYE = 1.62;
  const keys = {};
  let state = 'menu';
  let pendingStart = false, firing = false;
  let timeScale = 1, dying = 0, deathCause = '';
  let sensitivity = parseFloat(store.get('ks_sens', '1')) || 1;
  $('sens').value = sensitivity;
  const DIFFS = {
    easy: { label: 'Leicht', hp: 250, core: 600, dmg: .6, enemyHp: .8, score: .75 },
    normal: { label: 'Mittel', hp: 175, core: 480, dmg: .85, enemyHp: 1, score: 1 },
    hard: { label: 'Schwer', hp: 100, core: 400, dmg: 1.15, enemyHp: 1.2, score: 1.5 },
    // Spaßmodus: Gegnerflut, unendlich Munition, kein Nachladen, Schub fast ohne Abklingzeit
    ultra: { label: 'Ultrakill', hp: 300, core: 1200, dmg: .5, enemyHp: .6, score: .5, ultra: true },
  };
  const ULTRA_UNLOCK = 2000;
  const ultraUnlocked = () => ['easy', 'normal', 'hard'].some(k => (parseInt(store.get('ks_best_' + k, '0'), 10) || 0) >= ULTRA_UNLOCK);
  let diffKey = store.get('ks_diff', 'normal');
  if (!DIFFS[diffKey] || (diffKey === 'ultra' && !ultraUnlocked())) diffKey = 'normal';
  let diff = DIFFS[diffKey];
  let bestScore = 0;
  const showBest = () => { $('best').textContent = bestScore ? `Rekord auf „${diff.label}“: ${bestScore.toLocaleString('de-DE')} Punkte` : ''; };
  const diffButtons = Array.from(document.querySelectorAll('#diff button'));
  function setDiff(k) {
    diffKey = k;
    diff = DIFFS[k];
    store.set('ks_diff', k);
    bestScore = parseInt(store.get('ks_best_' + k, '0'), 10) || 0;
    diffButtons.forEach(b => {
      const on = b.dataset.d === k;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    showBest();
  }
  function refreshUltraLock() {
    const b = diffButtons.find(x => x.dataset.d === 'ultra');
    if (!b) return;
    const open = ultraUnlocked();
    b.classList.toggle('locked', !open);
    b.setAttribute('aria-disabled', open ? 'false' : 'true');
    b.querySelector('small').textContent = open ? 'Unendlich Munition · Gegnerflut' : `🔒 ${ULTRA_UNLOCK.toLocaleString('de-DE')} Punkte nötig`;
  }
  diffButtons.forEach(b => {
    b.onclick = () => {
      if (b.dataset.d === 'ultra' && !ultraUnlocked()) { Snd.empty(); return; }
      setDiff(b.dataset.d);
    };
  });
  refreshUltraLock();
  setDiff(diffKey);

  function resetPlayer() {
    Object.assign(P, {
      x: 0, y: 0, z: 16, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, grounded: true,
      hp: diff.hp, maxHp: diff.hp, core: diff.core, coreMax: diff.core,
      dashT: 0, dashCd: 0, dashCdMax: diff.ultra ? .3 : 2.4, dashX: 0, dashZ: 0,
      dmgMul: 1, reloadMul: 1, magMul: 1, speedMul: 1, fireMul: 1,
      weapon: 0, cool: 0, reloading: 0, bloom: 0,
      arsenal: WEAPONS.map(w => ({ def: w, mag: w.mag, reserve: w.reserve })),
      score: 0, kills: 0, fired: 0, hits: 0, combo: 0, comboT: 0, bestCombo: 1,
      bob: 0, land: 0, coreAlarm: 0,
    });
    selectWeapon(0, true);
  }
  const magSize = a => Math.round(a.def.mag * P.magMul);
  const comboMul = () => 1 + Math.min(4, Math.floor(P.combo / 4));

  function selectWeapon(i, silent) {
    if (i < 0 || i >= WEAPONS.length || (i === P.weapon && !silent)) return;
    P.weapon = i; P.reloading = 0; P.cool = Math.max(P.cool, .2);
    vm.swap = 1; vm.pumpAge = -1; vm.rk = 0;
    vmModels.forEach((m, k) => { m.g.visible = k === i; });
    if (!silent) { Snd.swap(); hudWeaponSwap(); }
    buildSlots();
  }
  function startReload() {
    const a = P.arsenal[P.weapon];
    if (diff.ultra || P.reloading > 0 || a.mag >= magSize(a) || a.reserve <= 0) return;
    P.reloading = a.def.reload * P.reloadMul;
    P.reloadNeed = magSize(a) - a.mag;
    vm.rk = 0; vm.pumpAge = -1;
    Snd.reload();
  }

  const muzzleW = new THREE.Vector3(), portW = new THREE.Vector3();
  function fire() {
    const a = P.arsenal[P.weapon], w = a.def, M = vmModels[P.weapon];
    if (P.cool > 0 || P.reloading > 0 || vm.swap > .45 || (P.weapon === 1 && vm.pumpAge >= 0 && vm.pumpAge < .38)) return;
    if (a.mag <= 0) {
      Snd.empty();
      P.cool = .25;
      vm.rotV -= .6;
      hudAmmoShake();
      startReload();
      if (a.reserve <= 0) {
        const next = P.arsenal.findIndex(s => s.mag > 0 || s.reserve > 0);
        if (next >= 0) selectWeapon(next);
      }
      return;
    }
    if (!diff.ultra) a.mag--;
    P.cool = 1 / (w.rate * P.fireMul);
    P.fired++;
    // federnder Rückstoß von Waffe und Kamera
    vm.kickV += w.kick * 14;
    vm.rotV += w.kick * 42;
    vm.rollV += rand(-1, 1) * w.kick * 18;
    vm.punchV += w.kick * 5.5;
    vm.flash = 1;
    P.bloom = Math.min(.05, P.bloom + w.spread * .45);
    P.pitch = clamp(P.pitch + w.kick * .025, -1.5, 1.5);
    if (P.weapon === 0) vm.slide = 1;
    if (P.weapon === 1) { vm.pumpAge = 0; vm.pumpEject = false; }
    if (P.weapon === 2) vm.heat = Math.min(1, vm.heat + .06);
    if (P.weapon === 3) { vm.drumTarget += Math.PI / 2; vm.drumClick = .16; }
    const f = M.flash;
    f.star.material.rotation = rand(0, 6.28);
    const fs = rand(.8, 1.25);
    f.star.scale.setScalar(f.size * fs);
    f.a.scale.z = f.b.scale.z = f.len * rand(.7, 1.3);
    f.g.rotation.z = rand(0, 6.28);
    muzzleLight.color.set(w.color);
    muzzleLight.intensity = 2.6;
    vmMuzzleLight.color.set(w.color);
    vmMuzzleLight.intensity = 3;
    Snd.shoot(P.weapon);
    hudFire();

    camera.updateMatrixWorld();
    camera.getWorldDirection(F);
    R.setFromMatrixColumn(camera.matrixWorld, 0);
    U.setFromMatrixColumn(camera.matrixWorld, 1);
    const O = camera.position;
    const from = vmToWorld(M.muzzle, muzzleW, .9);
    if (P.weapon === 0 || P.weapon === 2) {
      vmToWorld(M.port, portW, .45);
      ejectShell(w.shell, portW, R.x * rand(1.8, 2.8) + U.x * rand(1.4, 2.2) - F.x * .4 + P.vx, rand(1.6, 2.6) + P.vy * .5, R.z * rand(1.8, 2.8) + U.z * rand(1.4, 2.2) - F.z * .4 + P.vz);
    }
    const puffs = P.weapon === 1 ? 3 : P.weapon === 3 ? 4 : Math.random() < .35 ? 1 : 0;
    if (puffs) smoke(from.x + F.x * .3, from.y + F.y * .3, from.z + F.z * .3, puffs, .06, 0xb8c2cc, .9, P.weapon === 1 ? .55 : .4, .7, .22);

    if (w.explosive) {
      spawnProjectile(from.x, from.y, from.z, F.x * 44, F.y * 44 + 2, F.z * 44, 'player');
      return;
    }
    const spread = w.spread + P.bloom + Math.hypot(P.vx, P.vz) * .0008;
    let anyHit = false;
    // Zielhilfe: Schussrichtung leicht zum nächsten Ziel biegen, Streuung bleibt erhalten
    let bx = 0, by = 0, bz = 0;
    if (AA.s > .02) {
      const t = aaTarget(O, F, .03 + AA.s * .08);
      if (t) { const k = AA.s * (w.pellets > 1 ? .6 : .9); bx = (t.x - F.x) * k; by = (t.y - F.y) * k; bz = (t.z - F.z) * k; }
    }
    for (let n = 0; n < w.pellets; n++) {
      const a1 = rand(0, 6.283), r1 = Math.sqrt(Math.random()) * spread;
      const sx = Math.cos(a1) * r1, sy = Math.sin(a1) * r1;
      const dx = F.x + R.x * sx + U.x * sy + bx, dy = F.y + R.y * sx + U.y * sy + by, dz = F.z + R.z * sx + U.z * sy + bz;
      const l = Math.hypot(dx, dy, dz), ux = dx / l, uy = dy / l, uz = dz / l;
      let t = rayWorld(O.x, O.y, O.z, ux, uy, uz, 200);
      const nx = hitN.x, ny = hitN.y, nz = hitN.z;
      let target = null, crit = false;
      for (const e of enemies) {
        if (e.dead) continue;
        const wp = weakPos(e);
        if (wp) {
          const h = raySphere(O.x, O.y, O.z, ux, uy, uz, wp.x, wp.y, wp.z, e.def.weakR);
          if (h >= 0 && h < t) { t = h; target = e; crit = true; }
        }
        const c = bodyPos(e);
        const h = raySphere(O.x, O.y, O.z, ux, uy, uz, c.x, c.y, c.z, e.def.hitR);
        if (h >= 0 && h < t) { t = h; target = e; crit = false; }
      }
      v1.set(O.x + ux * t, O.y + uy * t, O.z + uz * t);
      const plasma = P.weapon === 2, pellet = w.pellets > 1;
      const hit = !target && t < 199 && (!pellet || n % 2 === 0)
        ? { x: v1.x, y: v1.y, z: v1.z, nx, ny, nz, color: w.color, big: plasma } : null;
      tracer(from, v1, w.color, pellet ? .012 : plasma ? .032 : .02, plasma ? 140 : pellet ? 260 : 330, plasma ? 1.8 : pellet ? 3 : 5, hit);
      if (target) {
        anyHit = true;
        const dmg = w.dmg * P.dmgMul * (crit ? 2 : 1);
        const c = crit ? 0xffd84d : target.def.color;
        burst(v1.x, v1.y, v1.z, crit ? 12 : 5, c, 5, .25, 8);
        sparks(v1.x, v1.y, v1.z, crit ? 10 : 4, c, crit ? 11 : 7, .3, -ux, -uy, -uz, .9);
        flashAt(v1.x, v1.y, v1.z, crit ? 1.8 : 1, crit ? 0xffd84d : w.color, .09);
        target.hitKick = Math.min(1, (target.hitKick || 0) + (pellet ? .25 : .6));
        target.hitDirX = ux; target.hitDirZ = uz;
        const killed = damageEnemy(target, dmg, crit, v1.x, v1.y, v1.z);
        hitMark(killed, crit);
        crit ? Snd.crit() : Snd.hit();
      }
    }
    if (anyHit) P.hits++;
    aaTrack(anyHit);
  }

  /* ========== Geschosse ========== */
  const projectiles = [];
  const projGeo = new THREE.SphereGeometry(.11, 8, 6);
  const projEnemyMat = new THREE.MeshBasicMaterial({ color: 0xfff0c0, fog: false });
  const grenadeGeo = new THREE.CylinderGeometry(.07, .07, .2, 10).rotateX(Math.PI / 2);
  const grenadeBandGeo = new THREE.CylinderGeometry(.075, .075, .05, 10).rotateX(Math.PI / 2);
  const grenadeMat = shiny(new THREE.MeshStandardMaterial({ color: 0x3c4650, roughness: .4, metalness: .8 }));
  const grenadeGlow = new THREE.MeshBasicMaterial({ color: 0xff7a3d });

  function spawnProjectile(x, y, z, vx, vy, vz, owner, dmg = 0) {
    const m = new THREE.Group();
    if (owner === 'player') {
      m.add(new THREE.Mesh(grenadeGeo, grenadeMat));
      m.add(new THREE.Mesh(grenadeBandGeo, grenadeGlow));
      m.add(glowSprite(0xff7a3d, 1.1));
    } else {
      m.add(new THREE.Mesh(projGeo, projEnemyMat));
      m.add(glowSprite(0xffa040, 1.5));
    }
    m.position.set(x, y, z);
    scene.add(m);
    projectiles.push({ m, vx, vy, vz, owner, dmg, life: 6 });
  }
  function grenadeBlast(x, y, z) {
    const w = WEAPONS[3];
    explode(x, y, z, 2.4, 0xff7a3d);
    Snd.boom(.8);
    shake = Math.max(shake, .5);
    let hit = false;
    for (const e of enemies.slice()) {
      if (e.dead) continue;
      const c = bodyPos(e);
      const d = Math.max(0, Math.hypot(c.x - x, c.y - y, c.z - z) - e.def.hitR);
      if (d > w.radius) continue;
      const killed = damageEnemy(e, w.dmg * P.dmgMul * (1 - d / w.radius * .7), false, c.x, c.y + e.def.hitR, c.z);
      hit = true;
      if (killed) hitMark(true);
    }
    if (hit) { P.hits++; hitMark(false); }
    // Rückstoß ohne Schaden ermöglicht Raketensprünge
    const dx = P.x - x, dy = P.y + 1 - y, dz = P.z - z, d = Math.hypot(dx, dy, dz);
    if (d < 5.5) {
      const f = (1 - d / 5.5) * 16, l = d || 1;
      P.vx += dx / l * f; P.vz += dz / l * f; P.vy += Math.max(3, dy / l * f + 5); P.grounded = false;
    }
  }
  function updateProjectiles(dt) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i], m = p.m;
      p.life -= dt;
      if (p.owner === 'player') p.vy -= 12 * dt;
      const ox = m.position.x, oy = m.position.y, oz = m.position.z;
      const sp = Math.hypot(p.vx, p.vy, p.vz), step = sp * dt;
      const ux = p.vx / sp, uy = p.vy / sp, uz = p.vz / sp;
      const t = rayWorld(ox, oy, oz, ux, uy, uz, step);
      m.position.set(ox + ux * t, oy + uy * t, oz + uz * t);
      v1.set(m.position.x + ux, m.position.y + uy, m.position.z + uz);
      m.lookAt(v1);
      if (p.owner === 'player') {
        m.children[0].rotation.z += dt * 30;
        smoke(m.position.x, m.position.y, m.position.z, 1, .03, 0x9aa4ae, .9, .45, .3, .4);
        emit(glowPS, m.position.x, m.position.y, m.position.z, 0, 0, 0, 0xff7a3d, .14, .5, .1, .9, 0, 0);
      } else {
        emit(glowPS, m.position.x, m.position.y, m.position.z, rand(-.3, .3), rand(-.3, .3), rand(-.3, .3), 0xff9030, .22, .55, .05, .8, 0, 0);
      }
      let gone = p.life <= 0;
      const hitWorld = t < step - 1e-6;

      if (p.owner === 'player') {
        let struck = hitWorld;
        for (const e of enemies) {
          if (e.dead) continue;
          const c = bodyPos(e);
          if (Math.hypot(c.x - m.position.x, c.y - m.position.y, c.z - m.position.z) < e.def.hitR + .25) { struck = true; break; }
        }
        if (struck) { grenadeBlast(m.position.x, m.position.y, m.position.z); gone = true; }
      } else {
        const qy = clamp(m.position.y, P.y + .2, P.y + HEIGHT - .1);
        if (dying <= 0 && Math.hypot(m.position.x - P.x, m.position.y - qy, m.position.z - P.z) < .68) {
          hurtPlayer(p.dmg, m.position.x, m.position.z);
          gone = true;
        } else if (hitWorld) {
          burst(m.position.x, m.position.y, m.position.z, 6, 0xff9030, 4, .25, 8);
          sparks(m.position.x, m.position.y, m.position.z, 6, 0xff9030, 7, .3, hitN.x, hitN.y, hitN.z, .8);
          flashAt(m.position.x, m.position.y, m.position.z, 1.4, 0xff9030, .12);
          if (Math.max(Math.abs(m.position.x), Math.abs(m.position.z)) < CORE_HALF + .3 && m.position.y > .1) hurtCore(p.dmg * .4);
          gone = true;
        }
      }
      if (gone) { scene.remove(m); projectiles.splice(i, 1); }
    }
  }

  /* ========== Gegner ========== */
  const TYPES = {
    swarm: { hp: 30, speed: 11, r: .55, hitR: .78, hitY: 0, turn: 5, score: 50, color: 0xff4d3d, hoverY: 1.2 },
    gunner: { hp: 62, speed: 6.5, r: .85, hitR: 1, hitY: 0, turn: 4, score: 120, color: 0xff9a30, hoverY: 2.6, weakF: .78, weakU: 0, weakR: .36 },
    brute: { hp: 340, speed: 3.7, r: 1.2, hitR: 1.8, hitY: 2.1, turn: 6, score: 300, color: 0xffd84d, hoverY: 0, weakF: .35, weakU: 3.75, weakR: .55 },
    boss: { hp: 2800, speed: 4.2, r: 3, hitR: 3.3, hitY: 0, turn: 2, score: 2500, color: 0xff3a6a, hoverY: 6, weakF: 2.7, weakU: 0, weakR: .95, fly: true },
  };
  const enemies = [];
  const armor = new THREE.MeshStandardMaterial({ color: 0x20262e, roughness: .4, metalness: .85, flatShading: true });
  const armor2 = new THREE.MeshStandardMaterial({ color: 0x5a3a34, roughness: .5, metalness: .6, flatShading: true });
  const glowRed = new THREE.MeshStandardMaterial({ color: 0x220303, emissive: 0xff3a2a, emissiveIntensity: 2.6 });
  const glowOrange = new THREE.MeshStandardMaterial({ color: 0x221103, emissive: 0xff8a20, emissiveIntensity: 2.4 });
  const glowYellow = new THREE.MeshStandardMaterial({ color: 0x222003, emissive: 0xffe050, emissiveIntensity: 3.2 });
  const glowPink = new THREE.MeshStandardMaterial({ color: 0x220310, emissive: 0xff3a6a, emissiveIntensity: 2.6 });
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const blobGeo = new THREE.CircleGeometry(1, 20);
  const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .42, depthWrite: false });
  const G_ = {
    ico: new THREE.IcosahedronGeometry(.55, 0), cone: new THREE.ConeGeometry(.16, .55, 5),
    sph: new THREE.SphereGeometry(.82, 12, 10), ring: new THREE.TorusGeometry(1.18, .08, 6, 26),
    eye: new THREE.SphereGeometry(.3, 12, 10), barrel: new THREE.CylinderGeometry(.11, .15, .7, 8),
    weak: new THREE.SphereGeometry(.5, 12, 10), bossB: new THREE.OctahedronGeometry(3, 1),
    bossR: new THREE.TorusGeometry(4.4, .18, 8, 46), bossE: new THREE.SphereGeometry(.95, 16, 12),
  };

  function buildEnemy(kind) {
    const root = new THREE.Group(), body = new THREE.Group();
    root.add(body);
    const parts = [];
    const add = (geo, m, x = 0, y = 0, z = 0, parent = body) => {
      const o = new THREE.Mesh(geo, m);
      o.position.set(x, y, z);
      parent.add(o);
      parts.push({ o, m });
      return o;
    };
    const out = { root, body, parts };
    if (kind === 'swarm') {
      add(G_.ico, glowRed).scale.setScalar(.72);
      [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].forEach(d => {
        const c = add(G_.cone, armor, d[0] * .5, d[1] * .5, d[2] * .5);
        c.quaternion.setFromUnitVectors(v1.set(0, 1, 0), new THREE.Vector3(d[0], d[1], d[2]));
      });
      body.add(glowSprite(0xff4d3d, 2.2));
    } else if (kind === 'gunner') {
      add(G_.sph, armor);
      out.spin = add(G_.ring, glowOrange);
      out.spin.rotation.x = Math.PI / 2.3;
      add(G_.eye, glowYellow, 0, 0, .74);
      const b = add(G_.barrel, armor2, 0, -.48, .55);
      b.rotation.x = Math.PI / 2;
      out.charge = glowSprite(0xffc040, .1);
      out.charge.position.z = 1;
      body.add(out.charge);
    } else if (kind === 'brute') {
      const box = (w, h, d, x, y, z, m) => { const o = add(boxGeo, m, x, y, z); o.scale.set(w, h, d); return o; };
      box(2.5, 2, 1.7, 0, 2.3, 0, armor);
      box(2.7, .28, 1.85, 0, 2.5, .03, armor2);
      out.armL = box(.8, 2.3, .9, -1.72, 2.0, .15, armor2);
      out.armR = box(.8, 2.3, .9, 1.72, 2.0, .15, armor2);
      out.legL = box(.85, 1.4, .95, -.7, .7, 0, armor);
      out.legR = box(.85, 1.4, .95, .7, .7, 0, armor);
      add(G_.weak, glowYellow, 0, 3.75, .35);
      const s = glowSprite(0xffd84d, 2.6); s.position.set(0, 3.75, .35); body.add(s);
    } else {
      add(G_.bossB, armor);
      out.spin = add(G_.bossR, glowPink);
      out.spin2 = add(G_.bossR, glowPink);
      out.spin2.rotation.x = Math.PI / 2;
      add(G_.bossE, glowYellow, 0, 0, 2.7);
      const s = glowSprite(0xff3a6a, 15); body.add(s);
    }
    const blob = new THREE.Mesh(blobGeo, blobMat);
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = .04;
    blob.scale.setScalar(TYPES[kind].r * 1.25);
    root.add(blob);
    body.position.y = TYPES[kind].hoverY;
    return out;
  }

  const bodyOut = { x: 0, y: 0, z: 0 }, weakOut = { x: 0, y: 0, z: 0 };
  function bodyPos(e) {
    bodyOut.x = e.root.position.x;
    bodyOut.y = e.body.position.y + e.def.hitY;
    bodyOut.z = e.root.position.z;
    return bodyOut;
  }
  function weakPos(e) {
    if (e.def.weakR === undefined) return null;
    const a = e.root.rotation.y;
    weakOut.x = e.root.position.x + Math.sin(a) * e.def.weakF;
    weakOut.y = e.body.position.y + e.def.weakU;
    weakOut.z = e.root.position.z + Math.cos(a) * e.def.weakF;
    return weakOut;
  }

  function spawnEnemy(kind, x, z) {
    const def = TYPES[kind];
    const m = buildEnemy(kind);
    const scaleHp = (1 + .13 * (D.wave - 1)) * diff.enemyHp;
    if (kind === 'boss') { Snd.roar(); shake = Math.max(shake, .7); } else Snd.spawn();
    ringAt(x, .07, z, kind === 'boss' ? 16 : 5, def.color, .5);
    const e = Object.assign(m, {
      kind, def, hp: def.hp * scaleHp, maxHp: def.hp * scaleHp, dead: false,
      vel: new THREE.Vector3(), t: rand(0, 6), flash: 0, losT: 0, los: false, age: 0,
      toCore: kind === 'brute' || (kind === 'swarm' && Math.random() < .3),
      shootT: rand(1, 2.4), charging: 0, strafe: Math.random() < .5 ? -1 : 1, strafeT: rand(1, 3),
      spawnT: 7, attackT: 1, stuckX: x, stuckZ: z, stuckT: 4, attacking: false,
    });
    e.root.position.set(x, 0, z);
    e.root.scale.setScalar(.01);
    scene.add(e.root);
    enemies.push(e);
    burst(x, 1.5, z, 18, def.color, 7, .55, 2);
    sparks(x, .2, z, kind === 'boss' ? 40 : 14, def.color, kind === 'boss' ? 16 : 10, .55, 0, 1, 0, .35);
    for (let k = 0; k < 6; k++) emit(glowPS, x, .3 + k * .5, z, 0, 2 + k, 0, def.color, .35, 1.4 - k * .15, .1, .7, 0, 2);
    flashAt(x, 1.5, z, 5, def.color);
    return e;
  }
  function setFlash(e, on) {
    for (const p of e.parts) p.o.material = on ? flashMat : p.m;
  }
  function damageEnemy(e, amount, crit, x, y, z) {
    if (e.dead) return false;
    e.hp -= amount;
    if (e.flash <= 0) setFlash(e, true);
    e.flash = .06;
    dmgNumber(x, y, z, Math.round(amount), crit, e.hp <= 0);
    if (e.hp <= 0) { killEnemy(e, true); return true; }
    return false;
  }
  function removeEnemy(e) {
    e.dead = true;
    scene.remove(e.root);
  }
  function killEnemy(e, scored) {
    const c = bodyPos(e), cx = c.x, cy = c.y, cz = c.z;
    removeEnemy(e);
    const big = e.kind === 'boss' ? 6 : e.kind === 'brute' ? 2.6 : e.kind === 'gunner' ? 1.4 : .9;
    explode(cx, cy, cz, big, e.def.color);
    const gm = e.parts.find(p => p.m.emissive && p.m.emissiveIntensity > 1);
    spawnDebris(cx, cy, cz, Math.round(3 + big * 1.5), 6 + big * 2, e.parts[0].m, .12 + big * .05);
    if (gm) spawnDebris(cx, cy, cz, Math.round(2 + big), 8 + big * 2, gm.m, .08 + big * .03);
    Snd.boom(Math.min(.9, .2 + big * .14));
    if (!scored) return;
    if (e.kind === 'boss') { shake = 1; for (let i = 0; i < 4; i++) dropPickup(cx + rand(-4, 4), cz + rand(-4, 4), i % 2 ? 'ammo' : 'health'); }
    P.combo++;
    P.comboT = 3.2;
    P.bestCombo = Math.max(P.bestCombo, comboMul());
    const pts = Math.round(e.def.score * comboMul() * diff.score);
    P.score += pts;
    hudKill(pts, comboMul());
    P.kills++;
    Snd.killCombo(comboMul());
    killImpact(e, big, cx, cy, cz);
    const r = Math.random(), chance = e.kind === 'brute' ? 1 : .2;
    if (r < chance) dropPickup(cx, cz, Math.random() < .45 ? 'health' : 'ammo');
  }

  // Abschuss-Wucht: Freeze-Frame, Kamera-Punch, FOV-Snap, Kill-Flash, Waffenruck.
  // Schnelle Folge-Kills (Multikill) steigern die Intensität.
  let multiKill = 0, multiKillT = 0, lastFrameFx = 0;
  const gameCanvas = $('game');
  const CALLS = ['KILL', 'DOUBLE KILL', 'TRIPLE KILL', 'MULTIKILL', 'MASSAKER', 'ULTRAKILL'];
  function killCall(text, k) {
    const n = el.killcall;
    n.textContent = text;
    n.style.setProperty('--kc', k > 1.2 ? '#ff2a1a' : k > .8 ? '#ff8a3d' : '#ffffff');
    anim(n, [
      { opacity: 1, transform: `translate(-50%, -50%) scale(${2.4 + k * .4}) rotate(${rand(-9, 9)}deg)` },
      { opacity: 1, transform: 'translate(-50%, -50%) scale(1) rotate(0)', offset: .18 },
      { opacity: 1, transform: 'translate(-50%, -50%) scale(1.04)', offset: .7 },
      { opacity: 0, transform: 'translate(-50%, -62%) scale(.96)' },
    ], { duration: 700 + k * 200, easing: 'cubic-bezier(.15, .9, .3, 1)' });
  }
  function killImpact(e, big, cx, cy, cz) {
    multiKill = multiKillT > 0 ? multiKill + 1 : 0;
    multiKillT = .55;
    const boss = e.kind === 'boss';
    const k = clamp(big / 2.6 + multiKill * .3, .35, boss ? 3 : 1.6);
    hitStop = Math.max(hitStop, boss ? .4 : .06 + k * .06);
    shake = Math.max(shake, .45 + k * .35);
    camera.fov -= boss ? 14 : 5 + k * 4; camera.updateProjectionMatrix();
    vm.punchV += 1.6 + k * .9;
    vm.kickV += .9 + k * .6;
    vm.rollV += rand(-1, 1) * 7 * k;
    screenFlash = Math.max(screenFlash, .12 + k * .08);
    killFlash = Math.min(1, Math.max(killFlash, .6 + k * .3));
    sparks(cx, cy, cz, Math.round(24 + k * 24), e.def.color, 12 + k * 6, .55, 0, 1, 0, 1);
    sparks(cx, cy, cz, Math.round(10 + k * 10), 0xfff2d8, 18 + k * 5, .25, 0, 1, 0, 1);
    burst(cx, cy, cz, Math.round(10 + k * 10), e.def.color, 7 + k * 4, .7);
    ringAt(cx, cy, cz, 1.6 + k * 2, e.def.color, .25);
    ringAt(cx, .08, cz, 2.5 + k * 3, 0xfff2d8, .35);
    // Spritzer auf dem Boden
    for (let i = 0; i < 2 + Math.round(k * 2); i++) decal(cx + rand(-1.4, 1.4) * k, .02, cz + rand(-1.4, 1.4) * k, 0, 1, 0, .6 + k * .7, e.def.color);
    Snd.smash(Math.min(k, 2));
    // Impact-Frame: kurz invertiert/übersättigt + Zoom-Ruck (gedrosselt für Ultrakill-Fluten)
    const now = performance.now();
    if (now - lastFrameFx > 110) {
      lastFrameFx = now;
      const hard = boss || k >= 1 || multiKill >= 1;
      anim(gameCanvas, [
        { filter: hard ? 'invert(1) contrast(1.8)' : 'brightness(2.2) contrast(1.6) saturate(2)', transform: `scale(${1.05 + k * .03}) rotate(${rand(-1, 1) * k}deg)` },
        { filter: 'contrast(1.5) saturate(2.2)', transform: `scale(${1.02 + k * .015})`, offset: .3 },
        { filter: 'none', transform: 'none' },
      ], { duration: 160 + k * 90, easing: 'cubic-bezier(.1, .8, .3, 1)' });
    }
    killCall(boss ? 'ZERSCHMETTERT' : e.kind === 'brute' && multiKill === 0 ? 'BRUTAL' : CALLS[Math.min(multiKill, CALLS.length - 1)], k);
  }

  function steer(e, tx, tz, field, dt) {
    const p = e.root.position;
    e.losT -= dt;
    if (e.losT <= 0) { e.losT = rand(.15, .35); e.los = losClear(p.x, p.z, tx, tz, e.def.r * .9); }
    if (!e.los && field) {
      const f = flowDir(field, p.x, p.z);
      if (f) return f;
    }
    const dx = tx - p.x, dz = tz - p.z, l = Math.hypot(dx, dz) || 1;
    flowOut.x = dx / l; flowOut.z = dz / l;
    return flowOut;
  }
  const accel = (e, dx, dz, speed, dt) => {
    const k = Math.min(1, dt * e.def.turn);
    e.vel.x += (dx * speed - e.vel.x) * k;
    e.vel.z += (dz * speed - e.vel.z) * k;
  };
  const face = (e, tx, tz, dt, rate = 10) => {
    const target = Math.atan2(tx - e.root.position.x, tz - e.root.position.z);
    let d = target - e.root.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    e.root.rotation.y += d * Math.min(1, dt * rate);
  };
  const coreEdgeDist = (x, z) => Math.hypot(Math.max(Math.abs(x) - CORE_HALF, 0), Math.max(Math.abs(z) - CORE_HALF, 0));

  function shootAt(e, ox, oy, oz, tx, ty, tz, speed, dmg) {
    const dx = tx - ox, dy = ty - oy, dz = tz - oz, l = Math.hypot(dx, dy, dz) || 1;
    spawnProjectile(ox, oy, oz, dx / l * speed, dy / l * speed, dz / l * speed, 'enemy', dmg);
  }

  function updateEnemies(dt) {
    const px = P.x, pz = P.z, py = P.y + 1;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e.dead) continue;
      const pos = e.root.position;
      e.t += dt; e.age += dt;
      if (e.age < .45) e.root.scale.setScalar(Math.max(.01, e.age / .45));
      else e.root.scale.setScalar(1);
      if (e.flash > 0) { e.flash -= dt; if (e.flash <= 0) setFlash(e, false); }
      // Trefferreaktion: kurz stauchen und kleine Gegner zurückstoßen
      if (e.hitKick > 0) {
        e.hitKick = Math.max(0, e.hitKick - dt * 6);
        const k = e.hitKick;
        e.body.scale.set(1 + k * .14, 1 - k * .12, 1 + k * .14);
        if (e.kind === 'swarm' || e.kind === 'gunner') { pos.x += e.hitDirX * k * dt * 7; pos.z += e.hitDirZ * k * dt * 7; }
      }
      const dp = Math.hypot(px - pos.x, pz - pos.z);
      e.attacking = false;

      if (e.kind === 'swarm') {
        const tx = e.toCore ? 0 : px, tz = e.toCore ? 0 : pz;
        const d = steer(e, tx, tz, e.toCore ? fieldCore : fieldPlayer, dt);
        accel(e, d.x, d.z, e.def.speed * (e.toCore ? .8 : 1), dt);
        e.body.position.y += ((e.toCore ? 1.8 : clamp(py, 1, 6)) + Math.sin(e.t * 7) * .25 - e.body.position.y) * Math.min(1, dt * 5);
        e.body.rotation.x += dt * 4; e.body.rotation.y += dt * 6;
        if (Math.random() < dt * 28) burst(pos.x, e.body.position.y, pos.z, 1, 0xff4d3d, .5, .32, 0);
        if (dying <= 0 && dp < 1.5 && Math.abs(e.body.position.y - py) < 2) {
          killEnemy(e, false);
          hurtPlayer(12, pos.x, pos.z);
          continue;
        }
        if (coreEdgeDist(pos.x, pos.z) < 1.5) {
          killEnemy(e, false);
          hurtCore(6);
          continue;
        }
      } else if (e.kind === 'gunner') {
        e.body.position.y = e.def.hoverY + Math.sin(e.t * 2.2) * .22;
        e.spin.rotation.z += dt * 3;
        face(e, px, pz, dt);
        const ey = e.body.position.y;
        const dist = Math.hypot(px - pos.x, py + .6 - ey, pz - pos.z) || 1;
        const see = rayWorld(pos.x, ey, pos.z, (px - pos.x) / dist, (py + .6 - ey) / dist, (pz - pos.z) / dist, dist) >= dist - .01;
        e.strafeT -= dt;
        if (e.strafeT <= 0) { e.strafeT = rand(1, 3); e.strafe *= -1; }
        if (!see || dp > 25) {
          const d = steer(e, px, pz, fieldPlayer, dt);
          accel(e, d.x, d.z, e.def.speed, dt);
        } else {
          const ux = (px - pos.x) / (dp || 1), uz = (pz - pos.z) / (dp || 1);
          const back = dp < 12 ? -1 : dp > 20 ? .6 : 0;
          accel(e, ux * back + -uz * e.strafe * .8, uz * back + ux * e.strafe * .8, e.def.speed, dt);
        }
        e.shootT -= dt;
        if (e.shootT <= .45 && see && !e.charging) { e.charging = .45; }
        if (e.charging > 0) {
          e.charging -= dt;
          e.charge.scale.setScalar(.1 + (1 - Math.max(0, e.charging) / .45) * 1.9);
          if (e.charging <= 0) {
            e.charging = 0; e.charge.scale.setScalar(.1);
            e.shootT = rand(1.7, 2.8);
            const w = weakPos(e);
            shootAt(e, w.x, w.y, w.z, px, P.y + 1.1, pz, 25, 9);
            if (dp < 40) Snd.enemyShot();
          }
        }
      } else if (e.kind === 'brute') {
        const cd = coreEdgeDist(pos.x, pos.z);
        e.attackT -= dt;
        const swing = Math.sin(e.t * 5.5);
        if (dying <= 0 && dp < 3.6 && Math.abs(P.y) < 3) {
          e.attacking = true; face(e, px, pz, dt);
          accel(e, 0, 0, 0, dt);
          if (e.attackT <= 0) {
            e.attackT = 1.5;
            hurtPlayer(18, pos.x, pos.z);
            P.vx += (px - pos.x) / (dp || 1) * 14; P.vz += (pz - pos.z) / (dp || 1) * 14; P.vy = 6; P.grounded = false;
            Snd.boom(.3);
          }
        } else if (cd < 1.9) {
          e.attacking = true; face(e, 0, 0, dt);
          accel(e, 0, 0, 0, dt);
          if (e.attackT <= 0) {
            e.attackT = 1.2;
            hurtCore(5);
            burst(pos.x * .8, 2.2, pos.z * .8, 18, 0x38f0e0, 8, .4);
            Snd.boom(.25);
          }
        } else {
          const d = steer(e, 0, 0, fieldCore, dt);
          accel(e, d.x, d.z, e.def.speed, dt);
          face(e, pos.x + e.vel.x, pos.z + e.vel.z, dt, 5);
        }
        const walk = e.attacking ? 0 : swing * .4;
        e.legL.rotation.x = walk; e.legR.rotation.x = -walk;
        const armA = e.attacking ? -Math.max(0, e.attackT / 1.2) * 1.6 : -walk;
        e.armL.rotation.x = armA; e.armR.rotation.x = e.attacking ? armA : walk;
      } else {
        e.body.position.y = e.def.hoverY + Math.sin(e.t * 1.3) * .5;
        e.spin.rotation.x += dt * 1.1; e.spin.rotation.y += dt * .7;
        e.spin2.rotation.y += dt * 1.4; e.spin2.rotation.z += dt * .4;
        face(e, px, pz, dt, 4);
        const ux = (px - pos.x) / (dp || 1), uz = (pz - pos.z) / (dp || 1);
        const back = dp < 15 ? -1 : dp > 24 ? 1 : 0;
        accel(e, ux * back - uz * .5, uz * back + ux * .5, e.def.speed, dt);
        const enraged = e.hp < e.maxHp * .4;
        e.shootT -= dt;
        if (e.shootT <= 0) {
          e.shootT = enraged ? 1.5 : 2.3;
          const w = weakPos(e), base = Math.atan2(px - w.x, pz - w.z);
          const n = enraged ? 15 : 11, wide = 1.1;
          for (let k = 0; k < n; k++) {
            const a = base + (k / (n - 1) - .5) * wide;
            shootAt(e, w.x, w.y, w.z, w.x + Math.sin(a) * dp, P.y + 1.1, w.z + Math.cos(a) * dp, 22, 8);
          }
          Snd.enemyShot();
        }
        e.spawnT -= dt;
        if (e.spawnT <= 0) {
          e.spawnT = enraged ? 5.5 : 8;
          for (let k = 0; k < 3; k++) spawnEnemy('swarm', pos.x + rand(-3, 3), pos.z + rand(-3, 3));
        }
      }

      pos.x += e.vel.x * dt;
      pos.z += e.vel.z * dt;

      // Festhänger umsetzen, damit eine Welle immer enden kann
      if (e.kind === 'swarm' || e.kind === 'brute') {
        e.stuckT -= dt;
        if (e.stuckT <= 0) {
          e.stuckT = 4;
          if (!e.attacking && Math.hypot(pos.x - e.stuckX, pos.z - e.stuckZ) < 1) {
            const n = nearestFree(pos.x, pos.z), ni = n % G, nj = (n - ni) / G;
            pos.x = ni - ARENA + .5; pos.z = nj - ARENA + .5;
          }
          e.stuckX = pos.x; e.stuckZ = pos.z;
        }
      }
    }

    // gegenseitiges Ausweichen und Kollision
    for (let i = 0; i < enemies.length; i++) {
      const a = enemies[i];
      if (a.dead) continue;
      for (let j = i + 1; j < enemies.length; j++) {
        const b = enemies[j];
        if (b.dead || a.def.fly || b.def.fly) continue;
        const dx = b.root.position.x - a.root.position.x, dz = b.root.position.z - a.root.position.z;
        const min = a.def.r + b.def.r, d2 = dx * dx + dz * dz;
        if (d2 >= min * min || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), push = (min - d) * .25;
        a.root.position.x -= dx / d * push; a.root.position.z -= dz / d * push;
        b.root.position.x += dx / d * push; b.root.position.z += dz / d * push;
      }
      const p = a.root.position;
      if (a.def.fly) {
        p.x = clamp(p.x, -ARENA + 5, ARENA - 5);
        p.z = clamp(p.z, -ARENA + 5, ARENA - 5);
      } else {
        pushOut(p, a.def.r);
      }
    }
    for (let i = enemies.length - 1; i >= 0; i--) if (enemies[i].dead) enemies.splice(i, 1);
  }

  /* ========== Pickups und Upgrades ========== */
  const pickups = [];
  const pickGreen = new THREE.MeshBasicMaterial({ color: 0x7dff9b });
  const pickAmber = new THREE.MeshBasicMaterial({ color: 0xffb347 });
  function dropPickup(x, z, kind) {
    const g = new THREE.Group();
    const gx = clamp(x, -ARENA + 1, ARENA - 1), gz = clamp(z, -ARENA + 1, ARENA - 1);
    const safe = { x: gx, z: gz };
    pushOut(safe, .8);
    g.position.set(safe.x, 1, safe.z);
    const m = kind === 'health' ? pickGreen : pickAmber;
    const part = (w, h, d) => { const b = new THREE.Mesh(boxGeo, m); b.scale.set(w, h, d); g.add(b); };
    if (kind === 'health') { part(.7, .22, .22); part(.22, .7, .22); }
    else { part(.5, .34, .34); }
    g.add(glowSprite(kind === 'health' ? 0x7dff9b : 0xffb347, 2.2));
    scene.add(g);
    g.scale.setScalar(.01);
    pickups.push({ g, kind, life: 22, t: rand(0, 6), age: 0 });
    ringAt(safe.x, .06, safe.z, 2.2, kind === 'health' ? 0x7dff9b : 0xffb347, .4);
  }
  function updatePickups(dt) {
    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i];
      p.life -= dt; p.t += dt; p.age += dt;
      const pa = Math.min(1, p.age / .45);
      // federnd erscheinen
      p.g.scale.setScalar(Math.max(.01, 1 + Math.sin(pa * Math.PI) * .35 * (1 - pa) + (pa - 1) * (1 - pa) * 2));
      p.g.rotation.y += dt * 2.4;
      p.g.position.y = 1 + Math.sin(p.t * 3) * .14;
      p.g.visible = p.life > 4 || Math.sin(p.t * 16) > 0;
      const dx = P.x - p.g.position.x, dz = P.z - p.g.position.z, d = Math.hypot(dx, dz);
      if (d < 5 && dying <= 0) {
        const pull = (5 - d) * 3.2 * dt / (d || 1);
        p.g.position.x += dx * pull; p.g.position.z += dz * pull;
      }
      let take = false;
      if (d < 1.5 && P.y < 3 && dying <= 0) {
        if (p.kind === 'health') {
          if (P.hp < P.maxHp) { P.hp = Math.min(P.maxHp, P.hp + P.maxHp * .25); take = true; }
        } else {
          for (const a of P.arsenal) if (a.def.cap !== Infinity) a.reserve = Math.min(a.def.cap, a.reserve + Math.ceil(a.def.cap * .3));
          take = true;
        }
      }
      if (take) {
        const pc = p.kind === 'health' ? 0x7dff9b : 0xffb347;
        Snd.pickup();
        burst(p.g.position.x, 1, p.g.position.z, 14, pc, 4, .4, 2);
        ringAt(p.g.position.x, .06, p.g.position.z, 3, pc, .35);
        toast(p.kind === 'health' ? '+25 % Hülle' : 'Munition aufgefüllt', p.kind === 'health' ? 'hp' : 'ammo');
        hudPickupFlash(p.kind);
        buildSlots();
      }
      if (take || p.life <= 0) { scene.remove(p.g); pickups.splice(i, 1); }
    }
  }

  const UPGRADES = [
    { n: 'Überladung', d: '+20 % Schaden', f() { P.dmgMul *= 1.2; } },
    { n: 'Panzerung', d: '+30 maximale Hülle', f() { P.maxHp += 30; P.hp += 30; } },
    { n: 'Schnelllader', d: 'Nachladen 25 % schneller', f() { P.reloadMul *= .75; } },
    { n: 'Großmagazin', d: '+35 % Magazingröße', f() { P.magMul *= 1.35; } },
    { n: 'Servomotoren', d: '+10 % Laufgeschwindigkeit', f() { P.speedMul *= 1.1; } },
    { n: 'Kühlsystem', d: '+15 % Feuerrate', f() { P.fireMul *= 1.15; } },
    { n: 'Notreparatur', d: 'Reaktor +120', f() { P.core = Math.min(P.coreMax, P.core + 120); } },
    { n: 'Phasenspule', d: 'Schub 30 % früher bereit', f() { P.dashCdMax *= .7; } },
    { n: 'Nachschub', d: 'Alle Munitionsvorräte voll', f() { for (const a of P.arsenal) a.reserve = a.def.cap === Infinity ? Infinity : a.def.cap; buildSlots(); } },
  ];
  let pylons = [];
  const PYLON_COLORS = ['#5ff0e0', '#ffb347', '#7dff9b'];
  const beamGeo = new THREE.CylinderGeometry(.55, .55, 6, 14, 1, true);
  const pylonBaseGeo = new THREE.CylinderGeometry(1.1, 1.3, .3, 14);

  function spawnPylons() {
    clearPylons();
    const pool = UPGRADES.slice().sort(() => Math.random() - .5).slice(0, 3);
    pool.forEach((u, i) => {
      const a = i / 3 * Math.PI * 2 + Math.PI / 2, x = Math.cos(a) * 7.8, z = Math.sin(a) * 7.8;
      const color = PYLON_COLORS[i];
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: .4, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      beam.position.y = 3;
      g.add(beam);
      const base = new THREE.Mesh(pylonBaseGeo, steel);
      base.position.y = .15;
      g.add(base);
      const label = new THREE.Sprite(new THREE.SpriteMaterial({
        depthTest: false, transparent: true, fog: false,
        map: makeCanvas(512, 200, (c, w, h) => {
          c.fillStyle = 'rgba(6,14,22,.82)'; c.fillRect(0, 0, w, h);
          c.fillStyle = color; c.fillRect(0, 0, w, 7);
          c.textAlign = 'center';
          c.font = '700 54px "Chakra Petch","Segoe UI",sans-serif'; c.fillText(u.n, w / 2, 88);
          c.fillStyle = '#e8f3f5';
          c.font = '600 34px "Chakra Petch","Segoe UI",sans-serif'; c.fillText(u.d, w / 2, 148);
        }),
      }));
      label.scale.set(4.6, 1.8, 1);
      label.position.y = 4;
      g.add(label);
      scene.add(g);
      pylons.push({ g, u, label, color });
    });
  }
  function clearPylons() {
    for (const p of pylons) {
      scene.remove(p.g);
      p.label.material.map.dispose();
      p.label.material.dispose();
      p.g.children[0].material.dispose();
    }
    pylons = [];
  }

  /* ========== Wellen ========== */
  const D = { wave: 0, phase: 'idle', queue: [], spawnT: 0, t: 0 };
  const MAX_ALIVE = 42, ULTRA_MAX_ALIVE = 140;

  function beginCountdown(t) { D.phase = 'countdown'; D.t = t; }
  function startWave() {
    D.wave++;
    const w = D.wave, q = [];
    const boss = w % 5 === 0;
    const swarms = Math.round((5 + w * 2.1) * (boss ? .5 : 1));
    for (let i = 0; i < swarms; i++) q.push('swarm');
    if (w >= 2) for (let i = 0; i < Math.round((1 + w * .85) * (boss ? .5 : 1)); i++) q.push('gunner');
    if (w >= 3) for (let i = 0; i < Math.floor((w - 1) / 2); i++) q.push('brute');
    if (diff.ultra) {
      // Ultrakill: die Welle vervielfachen
      const base = q.slice();
      for (let r = 0; r < 5; r++) q.push(...base);
      for (let i = 0; i < 10 + w * 6; i++) q.push('swarm');
    }
    q.sort(() => Math.random() - .5);
    if (boss) q.unshift('boss');
    D.queue = q;
    D.total = q.length;
    D.phase = 'fight';
    D.spawnT = .5;
    banner(`Welle ${w}`, boss ? 'Ein Wächter nähert sich!' : w === 3 ? 'Achtung: Brecher halten direkt auf den Reaktor zu' : w === 2 ? 'Schützen eröffnen das Feuer aus der Distanz' : '');
    Snd.horn();
    Snd.setIntensity(boss ? 2 : 1);
    ringAt(0, .07, 0, 46, boss ? 0xff3a6a : 0x38f0e0, 1);
  }
  function endWave() {
    D.phase = 'break';
    D.t = 18;
    Snd.setIntensity(0);
    P.hp = Math.min(P.maxHp, P.hp + P.maxHp * .15);
    P.core = Math.min(P.coreMax, P.core + 25);
    const bonus = 200 * D.wave;
    P.score += bonus;
    banner('Welle überstanden', `+${fmt(bonus)} Punkte · Hülle und Reaktor teilweise repariert`);
    spawnPylons();
    Snd.upgrade();
  }
  function spawnNext() {
    const options = gates.filter(([x, z]) => Math.hypot(x - P.x, z - P.z) > 18);
    const [gx, gz] = pick(options.length ? options : gates);
    const kind = D.queue.shift();
    const safe = { x: gx + rand(-1.5, 1.5), z: gz + rand(-1.5, 1.5) };
    spawnEnemy(kind, safe.x, safe.z);
  }
  function updateDirector(dt) {
    if (D.phase === 'countdown') {
      D.t -= dt;
      setNotice(`Nächste Welle in ${Math.ceil(D.t)} …`);
      if (Math.ceil(D.t) !== D.beep) { D.beep = Math.ceil(D.t); Snd.beep(false); }
      if (D.t <= 0) { setNotice(''); Snd.beep(true); startWave(); }
    } else if (D.phase === 'fight') {
      D.spawnT -= dt;
      const cap = diff.ultra ? ULTRA_MAX_ALIVE : MAX_ALIVE;
      if (D.queue.length && D.spawnT <= 0 && enemies.length < cap) {
        const n = diff.ultra ? Math.min(4, D.queue.length, cap - enemies.length) : 1;
        for (let i = 0; i < n; i++) spawnNext();
        D.spawnT = diff.ultra ? .1 : Math.max(.22, .62 - D.wave * .03);
      }
      if (!D.queue.length && !enemies.length) endWave();
    } else if (D.phase === 'break') {
      D.t -= dt;
      setNotice(`Lauf durch eine Säule, um ein Upgrade zu wählen · noch ${Math.ceil(D.t)} s`);
      for (const p of pylons) {
        p.g.children[0].material.opacity = .32 + Math.sin(performance.now() * .005) * .12;
        if (Math.hypot(P.x - p.g.position.x, P.z - p.g.position.z) < 1.7 && P.y < 4 && dying <= 0) {
          p.u.f();
          burst(p.g.position.x, 2, p.g.position.z, 60, p.color, 9, .8, 6);
          banner(p.u.n, p.u.d, 1.6);
          toast(`${p.u.n}: ${p.u.d}`, 'up');
          Snd.upgrade();
          clearPylons();
          beginCountdown(3);
          break;
        }
      }
      if (D.phase === 'break' && D.t <= 0) { clearPylons(); beginCountdown(3); }
    }
  }

  /* ========== Schaden am Spieler und Reaktor ========== */
  let hurtFade = 0, dirFade = 0;
  function hurtPlayer(amount, fromX, fromZ) {
    if (dying > 0 || state !== 'playing') return;
    amount *= diff.dmg;
    P.hp -= amount;
    hurtFade = Math.min(1, hurtFade + amount / 26 + .2);
    shake = Math.max(shake, .22 + amount / 60);
    const dx = fromX - P.x, dz = fromZ - P.z;
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
    $('dmgdir').style.transform = `rotate(${Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz)}rad)`;
    dirFade = 1;
    Snd.hurt();
    if (P.hp <= 0) { P.hp = 0; die('Hülle durchbrochen'); }
  }
  function hurtCore(amount) {
    if (dying > 0 || state !== 'playing') return;
    P.core -= amount;
    if (P.coreAlarm <= 0) {
      P.coreAlarm = 3.5;
      Snd.alarm();
      setNotice('Der Reaktor wird angegriffen!', 1.6);
      anim(el.corebar.parentElement.parentElement, [
        { transform: 'translateX(-6px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(-3px)' }, { transform: 'none' },
      ], { duration: 260 });
    }
    if (P.core <= 0) {
      P.core = 0;
      explode(0, 6, 0, 8, 0x38f0e0);
      explode(0, 3, 0, 6, 0xff5030);
      Snd.boom(1);
      shake = 1;
      die('Reaktor zerstört');
    }
  }
  function die(cause) {
    dying = 1.5;
    deathCause = cause;
    timeScale = .25;
    firing = false;
  }

  /* ========== HUD ========== */
  const textCache = new Map();
  const setText = (node, v) => {
    if (textCache.get(node) === v) return false;
    textCache.set(node, v); node.textContent = v;
    return true;
  };
  const el = {
    score: $('score'), combo: $('combo'), combotext: $('combotext'), combobar: $('combobar'), gains: $('gains'),
    wave: $('wave'), wavebar: $('wavebar'), remaining: $('remaining'), hpbar: $('hpbar'), hpnum: $('hpnum'),
    corebar: $('corebar'), corenum: $('corenum'), dashbar: $('dashbar'), mag: $('mag'), reserve: $('reserve'), ammo: $('ammo'),
    ammohint: $('ammohint'), wname: $('wname'), slots: $('slots'), bossbox: $('bossbox'), bossbar: $('bossbar'),
    vignette: $('vignette'), lowhp: $('lowhp'), dmgdir: $('dmgdir'), crosshair: $('crosshair'), hitmark: $('hitmark'),
    killtag: $('killtag'), reloadring: $('reloadring'), reloadarc: $('reloadarc'), banner: $('banner'), bannerT: $('bannerT'),
    bannerS: $('bannerS'), bannerLine: document.querySelector('#banner .line'), notice: $('notice'), radar: $('radar'),
    numbers: $('numbers'), toasts: $('toasts'), flash: $('flash'), killflash: $('killflash'), killcall: $('killcall'), speedlines: $('speedlines'), hud: $('hud'),
  };
  // kurze Animationen über die Web Animations API, damit sie sich beliebig neu starten lassen
  const anim = (node, kf, opt) => { if (!reducedMotion && node && node.animate) return node.animate(kf, opt); return null; };
  const fmt = n => n.toLocaleString('de-DE');
  let bannerT = 0, hitT = 0, noticeHold = 0, crossPulse = 0;

  function banner(t, s, dur = 2.4) {
    el.bannerT.textContent = t; el.bannerS.textContent = s;
    bannerT = dur;
    const ease = 'cubic-bezier(.16, 1, .3, 1)';
    anim(el.bannerT, [
      { opacity: 0, transform: 'scale(1.4)', letterSpacing: '.45em', filter: 'blur(10px)' },
      { opacity: 1, transform: 'scale(1)', letterSpacing: '.05em', filter: 'blur(0)' },
    ], { duration: 520, easing: ease });
    anim(el.bannerS, [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }],
      { duration: 420, delay: 160, easing: ease, fill: 'backwards' });
    anim(el.bannerLine, [{ transform: 'scaleX(0)', opacity: 0 }, { transform: 'scaleX(1)', opacity: 1 }],
      { duration: 600, easing: ease });
  }
  function setNotice(t, hold) {
    if (hold) noticeHold = hold;
    else if (noticeHold > 0) return;
    if (setText(el.notice, t) && t) {
      anim(el.notice, [{ opacity: 0, transform: 'translateY(10px) scale(.96)' }, { opacity: 1, transform: 'none' }],
        { duration: 240, easing: 'ease-out' });
    }
  }
  function hitMark(kill, crit) {
    hitT = kill ? .32 : .16;
    const c = kill ? '#ff4d3d' : crit ? '#ffd84d' : '#ffffff';
    el.hitmark.style.setProperty('--hm', c);
    el.crosshair.style.setProperty('--hm', c);
    anim(el.hitmark, kill
      ? [{ transform: 'scale(1.9) rotate(-20deg)' }, { transform: 'scale(1.15) rotate(0)' }]
      : [{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }],
    { duration: kill ? 260 : 120, easing: 'cubic-bezier(.2, .9, .3, 1)' });
  }
  function hudFire() {
    crossPulse = 1;
    anim(el.mag, [{ transform: 'translateY(-5px) scale(1.1)' }, { transform: 'none' }], { duration: 110, easing: 'ease-out' });
  }
  function hudAmmoShake() {
    anim(el.ammo, [
      { transform: 'translateX(-9px)' }, { transform: 'translateX(7px)' }, { transform: 'translateX(-4px)' }, { transform: 'none' },
    ], { duration: 240 });
  }
  function hudWeaponSwap() {
    const ease = 'cubic-bezier(.2, .8, .2, 1)';
    anim(el.wname, [{ opacity: 0, transform: 'translateX(26px)', letterSpacing: '.4em' }, { opacity: 1, transform: 'none', letterSpacing: '.14em' }],
      { duration: 300, easing: ease });
    anim(el.ammo, [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: ease });
  }
  function hudPickupFlash(kind) {
    anim(kind === 'health' ? el.hpbar.parentElement : el.ammo,
      [{ filter: 'brightness(2.4)' }, { filter: 'none' }], { duration: 550, easing: 'ease-out' });
  }
  function hudWave() {
    anim(el.wave, [
      { transform: 'scale(1.6)', color: '#5ff0e0', textShadow: '0 0 20px #5ff0e0' },
      { transform: 'scale(1)', color: '#e8f3f5', textShadow: '0 0 0 transparent' },
    ], { duration: 600, easing: 'cubic-bezier(.2, 1.3, .4, 1)' });
  }
  function hudBoot() {
    el.hud.classList.remove('boot');
    void el.hud.offsetWidth;
    el.hud.classList.add('boot');
    setTimeout(() => el.hud.classList.remove('boot'), 1300);
  }
  function hudKill(points, mult) {
    el.killtag.textContent = mult > 1 ? `+${fmt(points)}  ×${mult}` : `+${fmt(points)}`;
    anim(el.killtag, [
      { opacity: 0, transform: 'translate(-6px, 6px) scale(1.5)' },
      { opacity: 1, transform: 'translate(0, 0) scale(1)', offset: .15 },
      { opacity: 1, transform: 'translate(0, -4px) scale(1)', offset: .7 },
      { opacity: 0, transform: 'translate(0, -12px) scale(.95)' },
    ], { duration: 900, easing: 'ease-out' });
  }
  function toast(text, kind = '') {
    const d = document.createElement('div');
    d.textContent = text;
    if (kind) d.className = kind;
    el.toasts.appendChild(d);
    while (el.toasts.children.length > 4) el.toasts.firstChild.remove();
    setTimeout(() => d.remove(), 2400);
  }

  function buildSlots() {
    el.slots.innerHTML = '';
    P.arsenal.forEach((a, i) => {
      const d = document.createElement('div');
      if (i === P.weapon) d.classList.add('on');
      if (a.mag <= 0 && a.reserve <= 0) d.classList.add('empty');
      d.textContent = `${i + 1} ${a.def.name}`;
      const s = document.createElement('small');
      d.appendChild(s);
      el.slots.appendChild(d);
    });
  }

  // Leisten mit nachlaufender Schadensmarke
  const bars = ['hp', 'core', 'boss'].map(k => ({ b: $(k + 'bar'), chip: $(k + 'chip'), v: 1, c: 1, hold: 0, fx: 0 }));
  function setBar(o, v, dt) {
    v = clamp(v, 0, 1);
    o.fx -= dt;
    if (v < o.v - .0005) {
      o.hold = .45;
      if (o.fx <= 0) { o.fx = .12; anim(o.b.parentElement, [{ filter: 'brightness(2.4)' }, { filter: 'none' }], { duration: 160 }); }
    } else if (v > o.v + .02) {
      anim(o.b.parentElement, [{ filter: 'brightness(2.2) saturate(1.5)', boxShadow: '0 0 14px #7dff9b' }, { filter: 'none', boxShadow: 'none' }], { duration: 650, easing: 'ease-out' });
    }
    o.v = v;
    o.b.style.transform = `scaleX(${v})`;
    if (o.c < v) o.c = v;
    else if (o.hold > 0) o.hold -= dt;
    else o.c = Math.max(v, o.c - dt * .55);
    o.chip.style.transform = `scaleX(${o.c})`;
  }
  function resetBars() { for (const o of bars) { o.v = o.c = 1; o.hold = 0; } }

  const numPool = [];
  for (let i = 0; i < 28; i++) {
    const s = document.createElement('span');
    el.numbers.appendChild(s);
    numPool.push({ s, life: 0, age: 0, x: 0, y: 0, z: 0, vx: 0, crit: false });
  }
  let numHead = 0;
  function dmgNumber(x, y, z, val, crit, kill) {
    const n = numPool[numHead]; numHead = (numHead + 1) % numPool.length;
    n.x = x + rand(-.2, .2); n.y = y; n.z = z + rand(-.2, .2); n.life = crit || kill ? .8 : .65; n.age = 0;
    n.vx = rand(-50, 50); n.crit = crit;
    n.s.textContent = val;
    n.s.className = crit ? 'crit' : kill ? 'kill' : '';
  }
  function updateNumbers(dt) {
    for (const n of numPool) {
      if (n.life <= 0) continue;
      n.life -= dt; n.age += dt;
      if (n.life <= 0) { n.s.style.opacity = 0; continue; }
      n.y += dt * 1.4;
      v1.set(n.x, n.y, n.z).project(camera);
      if (v1.z > 1) { n.s.style.opacity = 0; continue; }
      const pop = n.age < .14 ? 1 + (1 - n.age / .14) * (n.crit ? 1.1 : .6) : 1;
      const jx = n.crit && n.age < .2 ? rand(-2, 2) : 0;
      n.s.style.opacity = Math.min(1, n.life * 3);
      n.s.style.transform = `translate(${((v1.x * .5 + .5) * innerWidth + n.vx * n.age + jx).toFixed(1)}px,${((-v1.y * .5 + .5) * innerHeight).toFixed(1)}px) translate(-50%,-50%) scale(${pop.toFixed(2)})`;
    }
  }
  const gainPool = Array.from({ length: 6 }, () => { const s = document.createElement('span'); el.gains.appendChild(s); return s; });
  let gainHead = 0;
  function scoreGain(d) {
    const s = gainPool[gainHead]; gainHead = (gainHead + 1) % gainPool.length;
    s.textContent = `+${fmt(d)}`;
    anim(s, [
      { opacity: 0, transform: 'translate(-8px, 6px) scale(1.3)' },
      { opacity: 1, transform: 'translate(0, 0) scale(1)', offset: .15 },
      { opacity: 0, transform: 'translate(0, -28px) scale(.9)' },
    ], { duration: 1100, easing: 'ease-out' });
  }

  const radarCtx = el.radar.getContext('2d');
  function drawRadar(now) {
    const c = radarCtx, S = 168, mid = S / 2, R0 = mid - 3, scale = mid / 42;
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
    const plot = (x, z, r, color, square, edge) => {
      const dx = x - P.x, dz = z - P.z;
      let sx = (dx * rx + dz * rz) * scale, sy = -(dx * fx + dz * fz) * scale;
      const d = Math.hypot(sx, sy);
      if (d > R0 - r) {
        if (!edge) return;
        // Gegner außerhalb der Reichweite am Rand andeuten
        sx *= (R0 - 3) / d; sy *= (R0 - 3) / d;
        c.globalAlpha = .55; r *= .7;
      }
      c.fillStyle = color;
      if (square) c.fillRect(mid + sx - r, mid + sy - r, r * 2, r * 2);
      else { c.beginPath(); c.arc(mid + sx, mid + sy, r, 0, 7); c.fill(); }
      c.globalAlpha = 1;
    };
    c.clearRect(0, 0, S, S);
    // Entfernungsringe, Sichtkegel und Abtaststrahl
    c.strokeStyle = 'rgba(95,240,224,.14)'; c.lineWidth = 1;
    for (const rr of [R0 * .33, R0 * .66]) { c.beginPath(); c.arc(mid, mid, rr, 0, 7); c.stroke(); }
    c.beginPath(); c.moveTo(mid - R0, mid); c.lineTo(mid + R0, mid); c.moveTo(mid, mid - R0); c.lineTo(mid, mid + R0); c.stroke();
    const fovG = c.createRadialGradient(mid, mid, 0, mid, mid, R0);
    fovG.addColorStop(0, 'rgba(255,255,255,.12)'); fovG.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = fovG;
    c.beginPath(); c.moveTo(mid, mid); c.arc(mid, mid, R0, -Math.PI / 2 - .62, -Math.PI / 2 + .62); c.fill();
    const sweep = (now * .0025) % (Math.PI * 2);
    for (let k = 0; k < 10; k++) {
      c.fillStyle = `rgba(95,240,224,${(.16 * (1 - k / 10)).toFixed(3)})`;
      c.beginPath(); c.moveTo(mid, mid); c.arc(mid, mid, R0, sweep - (k + 1) * .07, sweep - k * .07); c.fill();
    }
    const pulse = 1 + Math.sin(now * .012) * .25;
    plot(0, 0, 7, P.core < P.coreMax * .3 ? '#ff4d3d' : '#5ff0e0', false, true);
    for (const p of pickups) plot(p.g.position.x, p.g.position.z, 2.5, p.kind === 'health' ? '#7dff9b' : '#ffb347', true);
    for (const p of pylons) plot(p.g.position.x, p.g.position.z, 4 * pulse, p.color, true, true);
    for (const e of enemies) {
      const big = e.kind === 'boss' ? 7 * pulse : e.kind === 'brute' ? 4.5 : 2.6;
      plot(e.root.position.x, e.root.position.z, big, e.kind === 'brute' ? '#ffd84d' : e.kind === 'boss' ? '#ff3a6a' : '#ff4d3d', false, e.kind !== 'swarm');
    }
    c.fillStyle = '#fff';
    c.beginPath(); c.moveTo(mid, mid - 7); c.lineTo(mid + 5, mid + 5); c.lineTo(mid, mid + 2); c.lineTo(mid - 5, mid + 5); c.fill();
  }
  // HUD reagiert federnd auf Kameradrehung, Laufen, Springen und Rückstoß
  const hudLayers = [
    ['scorebox', .85, '', 3], ['wavebox', .45, 'translateX(-50%)', 0], ['bossbox', .45, 'translateX(-50%)', 0],
    ['radar', 1, '', -4], ['vitals', 1.2, '', 5], ['weaponbox', 1.2, '', -5], ['toasts', 1.1, '', 5],
    ['banner', .3, '', 0], ['notice', .3, '', 0], ['crosshair', .1, '', 0],
  ].map(([id, depth, base, tilt]) => ({ node: $(id), depth, base, tilt }));
  const hudM = { x: 0, y: 0, r: 0, vx: 0, vy: 0, vr: 0, yaw: 0, pitch: 0 };
  function updateHudMotion(dt) {
    if (reducedMotion || dt <= 0) return;
    const yawRate = clamp((P.yaw - hudM.yaw) / dt, -9, 9), pitchRate = clamp((P.pitch - hudM.pitch) / dt, -9, 9);
    hudM.yaw = P.yaw; hudM.pitch = P.pitch;
    const side = P.vx * Math.cos(P.yaw) - P.vz * Math.sin(P.yaw);
    const tx = clamp(yawRate * 5 - side * .85, -30, 30);
    const ty = clamp(pitchRate * 5 + P.vy * .75 + P.land * 34 + vm.kick * 60, -26, 26);
    const tr = clamp(yawRate * .22 - side * .05, -1.6, 1.6);
    const spring = (pos, vel, target) => {
      hudM[vel] += (target - hudM[pos]) * 130 * dt;
      hudM[vel] *= Math.exp(-13 * dt);
      hudM[pos] += hudM[vel] * dt;
    };
    spring('x', 'vx', tx); spring('y', 'vy', ty); spring('r', 'vr', tr);
    const sh = shake * 5;
    for (const l of hudLayers) {
      const x = (hudM.x + rand(-sh, sh)) * l.depth, y = (hudM.y + rand(-sh, sh)) * l.depth;
      const tilt = l.tilt ? `perspective(800px) rotateY(${(l.tilt + hudM.x * .22 * l.depth).toFixed(2)}deg) rotateX(${(-hudM.y * .16 * l.depth).toFixed(2)}deg) ` : '';
      l.node.style.transform = `${l.base} translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0) ${tilt}rotate(${(hudM.r * l.depth).toFixed(3)}deg)`;
    }
  }

  const hs = { score: 0, shown: 0, tier: 1, left: -1, boss: false, wave: 0 };
  function resetHudState() { Object.assign(hs, { score: 0, shown: 0, tier: 1, left: -1, boss: false, wave: 0 }); resetBars(); }
  function updateHUD(dt) {
    const a = P.arsenal[P.weapon], now = performance.now();
    // Punkte zählen hoch statt zu springen
    if (P.score !== hs.score) {
      const d = P.score - hs.score;
      hs.score = P.score;
      if (d > 0) {
        scoreGain(d);
        anim(el.score, [{ transform: 'scale(1.16)', color: '#ffd84d' }, { transform: 'scale(1)', color: '#e8f3f5' }], { duration: 280, easing: 'ease-out' });
      }
    }
    hs.shown += (P.score - hs.shown) * Math.min(1, dt * 8);
    if (Math.abs(P.score - hs.shown) < 1) hs.shown = P.score;
    setText(el.score, fmt(Math.round(hs.shown)));

    const tier = comboMul();
    if (tier !== hs.tier) {
      if (tier > hs.tier) {
        anim(el.combo, [
          { transform: 'scale(1.8) rotate(-7deg)', filter: 'brightness(2.2)' },
          { transform: 'scale(1) rotate(0)', filter: 'none' },
        ], { duration: 420, easing: 'cubic-bezier(.2, 1.5, .4, 1)' });
      }
      hs.tier = tier;
      el.combo.className = 't' + tier;
    }
    setText(el.combotext, tier > 1 ? `×${tier} Combo` : '');
    el.combobar.style.transform = `scaleX(${tier > 1 ? clamp(P.comboT / 3.2, 0, 1) : 0})`;

    if (D.wave !== hs.wave) { hs.wave = D.wave; if (D.wave) hudWave(); }
    setText(el.wave, D.wave ? `Welle ${D.wave}` : 'Bereitmachen');
    const left = D.queue.length + enemies.length;
    const fight = D.phase === 'fight';
    if (fight && left < hs.left) anim(el.remaining, [{ transform: 'scale(1.25)', color: '#ffffff' }, { transform: 'scale(1)', color: '#8fa6b0' }], { duration: 220 });
    hs.left = fight ? left : -1;
    setText(el.remaining, fight ? (left === 1 ? 'Noch 1 Gegner' : `Noch ${left} Gegner`) : '');
    el.wavebar.style.transform = `scaleX(${fight && D.total ? clamp(1 - left / D.total, 0, 1) : D.phase === 'break' ? 1 : 0})`;

    setBar(bars[0], P.hp / P.maxHp, dt);
    setText(el.hpnum, String(Math.ceil(P.hp)));
    el.hpbar.parentElement.classList.toggle('danger', P.hp < P.maxHp * .3);
    setBar(bars[1], P.core / P.coreMax, dt);
    setText(el.corenum, Math.ceil(P.core / P.coreMax * 100) + ' %');
    el.corebar.parentElement.classList.toggle('danger', P.core < P.coreMax * .3);
    el.dashbar.style.transform = `scaleX(${1 - clamp(P.dashCd / P.dashCdMax, 0, 1)})`;

    setText(el.mag, P.reloading > 0 ? '··' : String(a.mag));
    setText(el.reserve, a.reserve === Infinity ? '∞' : String(a.reserve));
    setText(el.wname, P.reloading > 0 ? 'Lädt nach …' : a.def.name);
    const max = magSize(a);
    el.ammo.classList.toggle('low', a.mag <= Math.ceil(max * .25));
    const out = a.mag <= 0 && a.reserve <= 0;
    const hint = P.reloading > 0 ? '' : out ? 'Keine Munition' : a.mag <= Math.ceil(max * .25) && a.reserve > 0 ? 'R · Nachladen' : '';
    setText(el.ammohint, hint);
    el.ammohint.classList.toggle('out', out);
    P.arsenal.forEach((s, i) => {
      const sm = el.slots.children[i] && el.slots.children[i].lastChild;
      if (sm) setText(sm, s.reserve === Infinity ? `${s.mag} / ∞` : `${s.mag} / ${s.reserve}`);
    });
    if (P.reloading > 0) {
      const k = clamp(1 - P.reloading / (a.def.reload * P.reloadMul), 0, 1);
      el.reloadarc.style.strokeDashoffset = (163.4 * (1 - k)).toFixed(1);
    }
    el.reloadring.classList.toggle('on', P.reloading > 0);

    const boss = enemies.find(e => e.kind === 'boss');
    el.bossbox.classList.toggle('hidden', !boss);
    if (!!boss !== hs.boss) {
      hs.boss = !!boss;
      if (boss) {
        bars[2].v = bars[2].c = 1;
        anim(el.bossbox, [{ opacity: 0, clipPath: 'inset(0 50% 0 50%)' }, { opacity: 1, clipPath: 'inset(0 0 0 0)' }], { duration: 700, easing: 'cubic-bezier(.2, .8, .2, 1)' });
      }
    }
    if (boss) setBar(bars[2], boss.hp / boss.maxHp, dt);

    hurtFade = Math.max(0, hurtFade - dt * 1.8);
    dirFade = Math.max(0, dirFade - dt * 1.4);
    hitT = Math.max(0, hitT - dt);
    bannerT = Math.max(0, bannerT - dt);
    noticeHold = Math.max(0, noticeHold - dt);
    screenFlash = Math.max(0, screenFlash - dt * 2.6);
    speedFade = Math.max(0, speedFade - dt * 3.4);
    crossPulse = Math.max(0, crossPulse - dt * 9);
    el.flash.style.opacity = screenFlash;
    killFlash = Math.max(0, killFlash - dt * 4.5);
    el.killflash.style.opacity = reducedMotion ? killFlash * .4 : killFlash;
    el.speedlines.style.opacity = speedFade * .75;
    updateHudMotion(dt);
    el.vignette.style.opacity = hurtFade;
    el.dmgdir.style.opacity = dirFade;
    el.hitmark.style.opacity = Math.min(1, hitT * 9);
    el.crosshair.classList.toggle('hit', hitT > .05);
    el.banner.style.opacity = Math.min(1, bannerT * 2.5);
    el.lowhp.style.opacity = P.hp < P.maxHp * .3 ? .55 + Math.sin(now * .006) * .35 : 0;
    const w = a.def;
    const gap = 5 + (w.spread + P.bloom + Math.hypot(P.vx, P.vz) * .0008) * innerHeight * .75 + crossPulse * (4 + w.kick * 40);
    el.crosshair.style.setProperty('--gap', Math.min(90, gap).toFixed(1) + 'px');
    updateNumbers(dt);
    drawRadar(now);
  }

  /* ========== Spielerupdate ========== */
  function collidesBody() {
    for (const b of colliders) {
      if (P.x + HALF > b.minX && P.x - HALF < b.maxX && P.z + HALF > b.minZ && P.z - HALF < b.maxZ &&
          P.y + HEIGHT > b.minY && P.y < b.maxY) return b;
    }
    return null;
  }
  function moveAxis(axis, d) {
    P[axis] += d;
    const b = collidesBody();
    if (!b) return;
    if (axis === 'x') P.x = d > 0 ? b.minX - HALF - .001 : b.maxX + HALF + .001;
    else P.z = d > 0 ? b.minZ - HALF - .001 : b.maxZ + HALF + .001;
  }
  function updatePlayer(dt) {
    let mx = 0, mz = 0;
    if (dying <= 0) {
      const f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) + TS.moveY, r = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + TS.moveX;
      const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
      mx = fx * f + rx * r; mz = fz * f + rz * r;
      const l = Math.hypot(mx, mz);
      // Stick erlaubt langsames Gehen, Tasten laufen immer voll
      if (l > 1) { mx /= l; mz /= l; }
      P.dashCd = Math.max(0, P.dashCd - dt);
      if ((keys.ShiftLeft || keys.ShiftRight) && P.dashCd <= 0) {
        P.dashT = .17; P.dashCd = P.dashCdMax;
        P.dashX = l > 0 ? mx : fx; P.dashZ = l > 0 ? mz : fz;
        Snd.dash();
        speedFade = 1;
        burst(P.x, P.y + .3, P.z, 22, 0xbfeaff, 6, .35, 2);
      }
      if (keys.Space && P.grounded) { P.vy = 9.2; P.grounded = false; Snd.jump(); }
    }
    if (P.dashT > 0) {
      P.dashT -= dt;
      P.vx = P.dashX * 34; P.vz = P.dashZ * 34;
    } else {
      const sp = 9.2 * P.speedMul, k = Math.min(1, dt * (P.grounded ? 13 : 3.2));
      P.vx += (mx * sp - P.vx) * k;
      P.vz += (mz * sp - P.vz) * k;
    }
    moveAxis('x', P.vx * dt);
    moveAxis('z', P.vz * dt);

    P.vy -= 26 * dt;
    const before = P.vy;
    P.y += P.vy * dt;
    P.grounded = false;
    if (P.y <= 0) { P.y = 0; P.vy = 0; P.grounded = true; }
    const b = collidesBody();
    if (b) {
      if (P.vy <= 0) { P.y = b.maxY; P.vy = 0; P.grounded = true; }
      else { P.y = b.minY - HEIGHT - .001; P.vy = 0; }
    }
    if (P.grounded && before < -8) {
      P.land = Math.min(.3, -before * .015);
      Snd.land(clamp(-before / 18, .4, 1));
      burst(P.x, P.y + .08, P.z, 12, 0x9fb4c0, 3.5, .3, 1);
    }
    P.land = Math.max(0, P.land - dt * 1.3);

    const hs = Math.hypot(P.vx, P.vz);
    if (P.grounded) P.bob += hs * dt * 1.25;
    const stepN = Math.floor(P.bob / Math.PI);
    if (stepN !== P.stepN) { P.stepN = stepN; if (P.grounded && hs > 3) Snd.step(); }
    if (P.hp < P.maxHp * .3 && dying <= 0) {
      P.heart = (P.heart || 0) - dt;
      if (P.heart <= 0) { P.heart = .95; Snd.heart(); }
    }
    camera.position.set(P.x, P.y + EYE + Math.sin(P.bob * 2) * .035 * clamp(hs / 9, 0, 1) - P.land, P.z);
    const sh = reducedMotion ? 0 : shake;
    camera.rotation.set(P.pitch + vm.punch + rand(-1, 1) * sh * .012, P.yaw + rand(-1, 1) * sh * .012, rand(-1, 1) * sh * .01 + vm.roll * .04 + vm.tilt * .2);
    shake = Math.max(0, shake - dt * 2.4);
    const targetFov = P.dashT > 0 ? 90 : 78;
    if (Math.abs(camera.fov - targetFov) > .05) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 14);
      camera.updateProjectionMatrix();
    }

    P.cool -= dt;
    P.bloom = Math.max(0, P.bloom - dt * .09);
    P.coreAlarm = Math.max(0, P.coreAlarm - dt);
    if (P.comboT > 0) { P.comboT -= dt; if (P.comboT <= 0) P.combo = 0; }
    if (P.reloading > 0) {
      P.reloading -= dt;
      if (P.reloading <= 0) {
        P.reloading = 0;
        const a = P.arsenal[P.weapon], need = magSize(a) - a.mag, got = Math.min(need, a.reserve);
        a.mag += got;
        if (a.reserve !== Infinity) a.reserve -= got;
        Snd.reload();
      }
    }
    aaUpdate(dt);
    aaSteer(dt);
    if (firing && dying <= 0) fire();

    updateViewmodel(dt, hs);
  }

  const smooth = t => t * t * (3 - 2 * t);
  const seg = (k, a, b) => clamp((k - a) / (b - a), 0, 1);
  const qInv = new THREE.Quaternion(), vmW = new THREE.Vector3();
  function updateViewmodel(dt, hs) {
    const M = vmModels[P.weapon], a = P.arsenal[P.weapon], def = a.def, max = magSize(a);
    vm.t += dt;
    // Federn für Rückstoß, Kippen, Rollen und Kamerastoß, in kleinen Schritten für Stabilität
    const steps = Math.max(1, Math.ceil(dt * 120)), h = dt / steps;
    for (let i = 0; i < steps; i++) {
      vm.kickV += (-300 * vm.kick - 24 * vm.kickV) * h; vm.kick += vm.kickV * h;
      vm.rotV += (-220 * vm.rot - 19 * vm.rotV) * h; vm.rot += vm.rotV * h;
      vm.rollV += (-200 * vm.roll - 18 * vm.rollV) * h; vm.roll += vm.rollV * h;
      vm.punchV += (-170 * vm.punch - 22 * vm.punchV) * h; vm.punch += vm.punchV * h;
    }
    vm.kick = clamp(vm.kick, -.08, .12); vm.rot = clamp(vm.rot, -.5, .5);
    vm.swap = Math.max(0, vm.swap - dt * 3.2);
    vm.swayX *= Math.exp(-dt * 9); vm.swayY *= Math.exp(-dt * 9);
    const side = P.vx * Math.cos(P.yaw) - P.vz * Math.sin(P.yaw);
    vm.tilt += (-side * .011 - vm.tilt) * Math.min(1, dt * 8);
    vm.air += (clamp(-P.vy * .003, -.035, .035) - vm.air) * Math.min(1, dt * 10);
    vm.dash += ((P.dashT > 0 ? 1 : 0) - vm.dash) * Math.min(1, dt * 12);

    const mv = P.grounded ? clamp(hs / 9, 0, 1) : 0;
    const bobX = Math.cos(P.bob) * .011 * mv, bobY = Math.abs(Math.sin(P.bob)) * .014 * mv, bobR = Math.cos(P.bob) * .025 * mv;
    const breathe = Math.sin(vm.t * 1.6) * .0035, breatheX = Math.cos(vm.t * .8) * .002;

    // Nachladen als Ablauf mit Ereignissen an festen Punkten
    let rk = 0, env = 0, rx = 0, rz = 0, ox = 0, oy = 0;
    if (P.reloading > 0) {
      rk = clamp(1 - P.reloading / (def.reload * P.reloadMul), 0, 1);
      env = smooth(seg(rk, 0, .16)) * (1 - smooth(seg(rk, .84, 1)));
    }
    const cross = x => vm.rk < x && rk >= x;
    if (M.mag) {
      if (M.magY === undefined) { M.magY = M.mag.position.y; M.armLY = M.armL.position.y; }
      const drop = rk < .4 ? smooth(seg(rk, .12, .3)) : 1 - smooth(seg(rk, .4, .66));
      M.mag.position.y = M.magY - drop * .22;
      M.mag.visible = !(rk > .3 && rk < .4);
      M.armL.position.y = M.armLY - (rk > .3 && rk < .7 ? drop * .2 : 0);
      if (cross(.18)) {
        Snd.magOut();
        vmToWorld(M.mag, vmW, .45);
        ejectShell('mag', vmW, P.vx + rand(-.3, .3), -1.5, P.vz + rand(-.3, .3));
      }
      if (cross(.64)) { Snd.magIn(); vm.kickV -= .5; vm.rotV += 1.6; }
      if (cross(.78)) { vm.slide = 1; Snd.rack(); vm.rollV += 3; vm.kickV += .4; }
      rz = .5 * env; rx = .28 * env; ox = -.04 * env; oy = .02 * env;
    } else if (P.weapon === 1) {
      const n = clamp(P.reloadNeed || 1, 1, 8);
      let inserted = 0;
      for (let i = 0; i < n; i++) {
        const at = .15 + (i + .6) / n * .62;
        if (rk >= at) inserted++;
        if (cross(at)) { Snd.shellIn(); vm.kickV += .3; vm.rotV -= .9; }
      }
      if (cross(.84)) { vm.pumpAge = 0; vm.pumpEject = true; }
      rz = -.42 * env; rx = .2 * env; ox = -.03 * env; oy = .03 * env;
      const shown = Math.min(6, a.mag + (P.reloading > 0 ? inserted : 0));
      M.shells.forEach((s, i) => { s.visible = i < shown; });
    } else if (P.weapon === 3) {
      if (cross(.15)) {
        Snd.magOut();
        const n = Math.min(4, P.reloadNeed || 1);
        for (let i = 0; i < n; i++) {
          vmToWorld(M.port, vmW, .5);
          ejectShell('big', vmW, P.vx + rand(-.8, .8), rand(-.5, 1), P.vz + rand(-.8, .8));
        }
      }
      if (rk > .2 && rk < .8) vm.drumA += dt * 16;
      if (cross(.82)) { vm.drumTarget = Math.round(vm.drumA / (Math.PI / 2)) * Math.PI / 2; Snd.magIn(); vm.rotV += 2; }
      rz = .7 * env; rx = .15 * env; ox = -.05 * env; oy = .03 * env;
      const loaded = P.reloading > 0 ? (rk > .8 ? 4 : rk > .2 ? Math.floor(seg(rk, .2, .8) * 4) : a.mag) : a.mag;
      M.chambers.forEach((c, i) => { c.visible = i < loaded; });
    }
    vm.rk = rk;

    // Mechanik: Schlitten, Pumpe, Kühlschlitze, Trommel
    let pumpRx = 0, pumpRz = 0;
    if (M.slide) {
      vm.slide *= Math.exp(-dt * 22);
      const lock = a.mag === 0 && P.reloading <= 0 ? .85 : 0;
      M.slide.position.z = -.06 + Math.max(vm.slide, lock) * .04;
    }
    if (M.pump) {
      let off = 0;
      if (vm.pumpAge >= 0) {
        const prev = vm.pumpAge;
        vm.pumpAge += dt;
        const u = seg(vm.pumpAge, .1, .4);
        off = Math.sin(Math.PI * u) * .085;
        pumpRz = Math.sin(Math.PI * u) * .12; pumpRx = -Math.sin(Math.PI * u) * .05;
        if (prev < .1 && vm.pumpAge >= .1) Snd.pump();
        if (!vm.pumpEject && u >= .5) {
          vm.pumpEject = true;
          vmToWorld(M.port, vmW, .45);
          F.set(0, 0, -1).applyQuaternion(camera.quaternion); R.set(1, 0, 0).applyQuaternion(camera.quaternion);
          ejectShell('shell', vmW, R.x * rand(2, 3) - F.x * .5 + P.vx, rand(1.8, 2.6), R.z * rand(2, 3) - F.z * .5 + P.vz);
        }
        if (vm.pumpAge >= .5) vm.pumpAge = -1;
      }
      M.pump.position.z = -.3 + off;
    }
    if (M.vent) {
      vm.heat = Math.max(0, vm.heat - dt * (firing ? .22 : .7));
      M.vent.color.copy(M.glowBase).multiplyScalar(.2 + vm.heat * 2.4);
      M.spin.rotation.z += dt * (1.5 + vm.heat * 45);
      if (vm.heat > .45 && Math.random() < dt * 10 * vm.heat) {
        vmToWorld(M.muzzle, vmW, .8);
        smoke(vmW.x, vmW.y, vmW.z, 1, .02, 0xc8d4cc, .8, .22, .5, .18);
      }
    }
    if (M.drum) {
      if (!(P.reloading > 0 && rk > .2 && rk < .8)) vm.drumA += (vm.drumTarget - vm.drumA) * Math.min(1, dt * 22);
      M.drum.rotation.z = vm.drumA;
      if (vm.drumClick > 0) { vm.drumClick -= dt; if (vm.drumClick <= 0) Snd.drum(); }
    }

    // Leuchtteile zeigen den Füllstand, leeres Magazin blinkt
    const frac = max ? a.mag / max : 0;
    M.glow.color.copy(M.glowBase).multiplyScalar(.25 + .95 * frac + (a.mag === 0 && Math.sin(vm.t * 18) > 0 ? .5 : 0));
    drawScreen(M, a);

    vm.flash = Math.max(0, vm.flash - dt * 26);
    M.flash.g.visible = vm.flash > .02;
    M.flash.star.material.opacity = vm.flash;
    M.flash.a.material.opacity = vm.flash * vm.flash;
    vmMuzzleLight.intensity = Math.max(0, vmMuzzleLight.intensity - dt * 70);

    const P0 = M.pose, sw = smooth(vm.swap);
    vmRoot.position.set(
      P0.x + vm.swayX + bobX + breatheX + ox - vm.tilt * .3,
      P0.y + vm.swayY - bobY + breathe + oy - sw * .32 - P.land * .25 + vm.air - vm.dash * .03,
      P0.z + vm.kick + vm.dash * .06);
    vmRoot.rotation.set(
      vm.rot + rx - sw * .9 + vm.air * 1.5 - vm.dash * .15 + pumpRx,
      vm.swayX * -2.2 + sw * .25,
      vm.roll + rz + vm.tilt + bobR + sw * .5 + pumpRz);
    vmRoot.updateMatrixWorld(true);
    M.muzzle.getWorldPosition(vmMuzzleLight.position);
    // Licht der Welt in den Raum der Waffe übertragen
    qInv.copy(camera.quaternion).invert();
    vmSun.position.copy(sun.position).normalize().applyQuaternion(qInv);
  }

  /* ========== Spielablauf ========== */
  function clearWorld() {
    enemies.forEach(e => scene.remove(e.root)); enemies.length = 0;
    projectiles.forEach(p => scene.remove(p.m)); projectiles.length = 0;
    pickups.forEach(p => scene.remove(p.g)); pickups.length = 0;
    clearPylons();
    scorches.forEach(m => { m.visible = false; });
  }
  function beginGame() {
    clearWorld();
    resetPlayer();
    Object.assign(hudM, { x: 0, y: 0, r: 0, vx: 0, vy: 0, vr: 0, yaw: P.yaw, pitch: P.pitch });
    hitStop = 0; screenFlash = 0; speedFade = 0; killFlash = 0; multiKill = 0; multiKillT = 0;
    Object.assign(vm, { kick: 0, kickV: 0, rot: 0, rotV: 0, roll: 0, rollV: 0, punch: 0, punchV: 0, heat: 0, pumpAge: -1, flash: 0 });
    shells.forEach(x => { x.m.visible = false; });
    decals.forEach(x => { x.m.visible = false; });
    resetHudState();
    hudBoot();
    Snd.setSong('game');
    Snd.setIntensity(0);
    Snd.setPaused(false);
    Object.assign(D, { wave: 0, phase: 'idle', queue: [], spawnT: 0, t: 0 });
    timeScale = 1; dying = 0; shake = 0; firing = false; hurtFade = 0; dirFade = 0; bannerT = 0;
    reactor.visible = true;
    Object.keys(keys).forEach(k => { keys[k] = false; });
    beginCountdown(3);
    state = 'playing';
    vmRoot.visible = true;
    $('hud').classList.remove('hidden');
    ['menu', 'pause', 'over', 'settings'].forEach(i => $(i).classList.add('hidden'));
    aaReset();
    resetTouch();
    touchEl.classList.toggle('hidden', !MOBILE);
  }
  function requestLock() {
    Snd.init();
    $('lockhint').classList.add('hidden');
    let r;
    try { r = canvas.requestPointerLock(); } catch (e) { lockFailed(); return; }
    if (r && r.catch) r.catch(lockFailed);
  }
  function lockFailed() {
    pendingStart = false;
    if (state === 'paused') $('lockhint').classList.remove('hidden');
  }
  function gameOver() {
    state = 'over';
    timeScale = 1; dying = 0;
    vmRoot.visible = false;
    $('hud').classList.add('hidden');
    touchEl.classList.add('hidden');
    resetTouch();
    if (document.exitPointerLock) document.exitPointerLock();
    const isNew = P.score > bestScore;
    const wasLocked = !ultraUnlocked();
    if (isNew) { bestScore = P.score; store.set('ks_best_' + diffKey, String(bestScore)); }
    refreshUltraLock();
    const justUnlocked = wasLocked && ultraUnlocked();
    showBest();
    Snd.setSong('menu');
    $('oDiff').textContent = diff.label;
    $('overT').textContent = deathCause;
    $('overScore').textContent = P.score.toLocaleString('de-DE');
    $('overNew').classList.toggle('hidden', !isNew);
    $('overUltra').classList.toggle('hidden', !justUnlocked);
    $('oWave').textContent = D.wave;
    $('oKills').textContent = P.kills;
    $('oAcc').textContent = (P.fired ? Math.round(P.hits / P.fired * 100) : 0) + ' %';
    $('oCombo').textContent = '×' + P.bestCombo;
    // Endstand zählt hoch
    const target = P.score, t0 = performance.now();
    const count = t => {
      const k = Math.min(1, (t - t0) / 1100), e = 1 - Math.pow(1 - k, 3);
      $('overScore').textContent = Math.round(target * e).toLocaleString('de-DE');
      if (k < 1 && state === 'over') requestAnimationFrame(count);
    };
    if (!reducedMotion) requestAnimationFrame(count);
    document.querySelectorAll('#over dl > *').forEach((n, i) => { n.style.animationDelay = (.25 + Math.floor(i / 2) * .07) + 's'; });
    $('over').classList.remove('hidden');
  }
  function toMenu() {
    clearWorld();
    state = 'menu';
    vmRoot.visible = false;
    Snd.setPaused(false);
    Snd.setSong('menu');
    touchEl.classList.add('hidden');
    ['pause', 'over'].forEach(i => $(i).classList.add('hidden'));
    $('hud').classList.add('hidden');
    $('menu').classList.remove('hidden');
  }

  $('startBtn').onclick = $('retryBtn').onclick = () => {
    if (MOBILE) {
      Snd.init();
      lockLandscape();
      if (document.documentElement.requestFullscreen && !document.fullscreenElement && !STANDALONE) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
      beginGame();
      return;
    }
    pendingStart = true; requestLock();
  };
  $('resumeBtn').onclick = () => { if (MOBILE) { Snd.init(); resumeGame(); } else requestLock(); };
  $('quitBtn').onclick = toMenu;
  $('menuBtn').onclick = toMenu;
  $('sens').oninput = e => {
    const v = parseFloat(e.target.value);
    if (MOBILE) { TS.sens = v; store.set('ks_tsens', String(v)); return; }
    sensitivity = v; store.set('ks_sens', String(sensitivity));
  };
  $('musicVol').value = Snd.musicVol;
  $('musicVol').oninput = e => {
    Snd.musicVol = parseFloat(e.target.value);
    store.set('ks_music', String(Snd.musicVol));
    Snd.applyMusicVolume();
  };
  document.querySelectorAll('button').forEach(b => b.addEventListener('mouseenter', () => Snd.hover()));

  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    if (locked) {
      if (pendingStart) { pendingStart = false; beginGame(); }
      else if (state === 'paused') { state = 'playing'; $('pause').classList.add('hidden'); Snd.setPaused(false); }
    } else if (state === 'playing') {
      state = 'paused';
      firing = false;
      Object.keys(keys).forEach(k => { keys[k] = false; });
      $('pause').classList.remove('hidden');
      Snd.setPaused(true);
    }
  });
  document.addEventListener('pointerlockerror', lockFailed);

  document.addEventListener('mousemove', e => {
    if (MOBILE || state !== 'playing' || dying > 0) return;
    const mx = clamp(e.movementX, -250, 250), my = clamp(e.movementY, -250, 250);
    const k = .0021 * sensitivity * (AA.near ? 1 - AA.s * .35 : 1);
    P.yaw -= mx * k;
    P.pitch = clamp(P.pitch - my * k, -1.5, 1.5);
    vm.swayX = clamp(vm.swayX - mx * .00012, -.03, .03);
    vm.swayY = clamp(vm.swayY + my * .00012, -.03, .03);
  });
  document.addEventListener('mousedown', e => { if (!MOBILE && state === 'playing' && e.button === 0) firing = true; });
  document.addEventListener('mouseup', e => { if (e.button === 0) firing = false; });
  document.addEventListener('wheel', e => {
    if (state !== 'playing' || !e.deltaY) return;
    selectWeapon((P.weapon + (e.deltaY > 0 ? 1 : -1) + WEAPONS.length) % WEAPONS.length);
  }, { passive: true });
  addEventListener('keydown', e => {
    if (e.code === 'KeyM') Snd.toggle();
    if (e.code === 'KeyN') Snd.toggleMusic();
    if (state !== 'playing') return;
    if (['Space', 'ShiftLeft', 'ShiftRight', 'Tab'].includes(e.code)) e.preventDefault();
    keys[e.code] = true;
    if (e.code === 'KeyR') startReload();
    if (/^Digit[1-4]$/.test(e.code)) selectWeapon(+e.code.slice(5) - 1);
  });
  addEventListener('keyup', e => { keys[e.code] = false; });

  /* ========== Grafikeinstellungen anwenden ========== */
  const SHADOW_SIZES = [0, 1024, 2048, 4096];
  function applyGfx() {
    const g = resolvedGfx();
    FX = g.fx;
    renderer.setPixelRatio(Math.min(devicePixelRatio, g.dprCap) * g.res);
    resize();
    const size = SHADOW_SIZES[g.shadows] || 0, on = size > 0;
    if (renderer.shadowMap.enabled !== on || (on && sun.shadow.mapSize.x !== size)) {
      renderer.shadowMap.enabled = on;
      sun.castShadow = on;
      if (on && sun.shadow.mapSize.x !== size) {
        sun.shadow.mapSize.set(size, size);
        if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      }
      // Materialien neu übersetzen, damit Schatten an- oder abgeschaltet werden
      scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { m.needsUpdate = true; }); });
      renderer.shadowMap.needsUpdate = true;
    }
    embers.visible = g.fx >= .6;
    syncSettingsUI();
  }
  function saveGfx() { store.set('ks_gfx', JSON.stringify(gfx)); applyGfx(); }

  /* ========== Einstellungsmenü ========== */
  let settingsFrom = 'menu';
  const segs = {
    gfxPreset: v => { gfx = { preset: v }; saveGfx(); },
    gfxShadows: v => { gfx = Object.assign(resolvedGfx(), { preset: 'custom', shadows: +v }); saveGfx(); },
    gfxFx: v => { gfx = Object.assign(resolvedGfx(), { preset: 'custom', fx: +v }); saveGfx(); },
    aimAssist: v => { AA.on = v === '1'; store.set('ks_aim', v); syncSettingsUI(); },
  };
  Object.keys(segs).forEach(id => {
    $(id).querySelectorAll('button').forEach(b => { b.onclick = () => { Snd.click(); segs[id](b.dataset.v); }; });
  });
  function syncSettingsUI() {
    const g = resolvedGfx();
    const mark = (id, v) => $(id).querySelectorAll('button').forEach(b => {
      const on = b.dataset.v === String(v);
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    mark('gfxPreset', gfx.preset);
    mark('gfxShadows', g.shadows);
    mark('gfxFx', g.fx);
    mark('aimAssist', AA.on ? '1' : '0');
    $('gfxRes').value = g.res;
    $('gfxResOut').textContent = Math.round(g.res * 100) + ' %';
    $('gfxDetected').textContent = `erkannt: ${PRESETS[detected].label}`;
  }
  $('gfxRes').oninput = e => {
    gfx = Object.assign(resolvedGfx(), { preset: 'custom', res: parseFloat(e.target.value) });
    saveGfx();
  };
  function openSettings(from) {
    settingsFrom = from;
    $(from).classList.add('hidden');
    $('settings').classList.remove('hidden');
    syncSettingsUI();
  }
  $('settingsBtn').onclick = () => openSettings('menu');
  $('pauseSettingsBtn').onclick = () => openSettings('pause');
  $('settingsBack').onclick = () => {
    $('settings').classList.add('hidden');
    $(settingsFrom).classList.remove('hidden');
  };

  /* ========== Zielhilfe ==========
     Standardmäßig aus. Wenn eingeschaltet, greift sie nur ein, solange die Trefferquote
     schlecht ist, und blendet nichts ein. */
  const AA = { on: store.get('ks_aim', '0') === '1', acc: .5, shots: 0, s: 0, near: false };
  const aaDir = new THREE.Vector3();
  function aaReset() { Object.assign(AA, { acc: .5, shots: 0, s: 0, near: false }); }
  function aaTrack(hit) {
    AA.shots++;
    AA.acc += ((hit ? 1 : 0) - AA.acc) * .06;
  }
  function aaUpdate(dt) {
    let want = 0;
    if (AA.on && AA.shots >= 12) {
      want = clamp((.38 - AA.acc) / .26, 0, 1);
      if (P.hp < P.maxHp * .35 || P.core < P.coreMax * .3) want = Math.min(1, want + .2);
    }
    AA.s += (want - AA.s) * Math.min(1, dt * .6);
  }
  // nächstgelegenes sichtbares Ziel im Kegel um die Blickrichtung, bevorzugt Schwachstellen
  function aaTarget(O, dir, maxAng) {
    let best = null, bestAng = maxAng;
    for (const e of enemies) {
      if (e.dead) continue;
      const p = weakPos(e) || bodyPos(e);
      const dx = p.x - O.x, dy = p.y - O.y, dz = p.z - O.z, d = Math.hypot(dx, dy, dz);
      if (d > 70 || d < 1) continue;
      const ang = Math.acos(clamp((dx * dir.x + dy * dir.y + dz * dir.z) / d, -1, 1));
      if (ang >= bestAng) continue;
      if (rayWorld(O.x, O.y, O.z, dx / d, dy / d, dz / d, d) < d - 1) continue;
      bestAng = ang;
      best = aaDir.set(dx / d, dy / d, dz / d);
    }
    return best;
  }
  // sanftes Mitziehen der Kamera beim Feuern
  function aaSteer(dt) {
    AA.near = false;
    if (AA.s < .03 || dying > 0) return;
    camera.getWorldDirection(F);
    const t = aaTarget(camera.position, F, .05 + AA.s * .1);
    if (!t) return;
    AA.near = true;
    if (!firing) return;
    const k = Math.min(1, dt * AA.s * 3.2);
    const yaw = Math.atan2(-t.x, -t.z), pitch = Math.asin(clamp(t.y, -1, 1));
    P.yaw += Math.atan2(Math.sin(yaw - P.yaw), Math.cos(yaw - P.yaw)) * k;
    P.pitch += (pitch - P.pitch) * k;
  }

  /* ========== Touch-Steuerung ========== */
  const TS = { moveX: 0, moveY: 0, stick: null, look: new Map(), sens: parseFloat(store.get('ks_tsens', '1')) || 1 };
  const touchEl = $('touch'), stickEl = $('tstick'), knobEl = $('tknob');
  function resetTouch() {
    TS.moveX = TS.moveY = 0; TS.stick = null; TS.look.clear();
    stickEl.classList.remove('on');
    touchEl.querySelectorAll('.tbtn').forEach(b => b.classList.remove('down'));
  }
  const holdKey = { tjump: 'Space', tdash: 'ShiftLeft' };
  touchEl.addEventListener('pointerdown', e => {
    if (state !== 'playing') return;
    e.preventDefault();
    const btn = e.target.closest('.tbtn');
    touchEl.setPointerCapture(e.pointerId);
    if (btn) {
      btn.classList.add('down');
      const id = btn.id;
      if (id === 'tfire') { firing = true; TS.look.set(e.pointerId, { x: e.clientX, y: e.clientY, btn }); }
      else if (holdKey[id]) { keys[holdKey[id]] = true; TS.look.set(e.pointerId, { x: e.clientX, y: e.clientY, btn, key: holdKey[id] }); }
      else if (id === 'treload') { startReload(); TS.look.set(e.pointerId, { x: e.clientX, y: e.clientY, btn }); }
      else if (id === 'tswap') { selectWeapon((P.weapon + 1) % WEAPONS.length); TS.look.set(e.pointerId, { x: e.clientX, y: e.clientY, btn }); }
      else if (id === 'tpause') { pauseGame(); }
      return;
    }
    if (e.clientX < innerWidth * .42 && !TS.stick) {
      // Stick erscheint dort, wo der Daumen aufsetzt
      TS.stick = { id: e.pointerId, x: e.clientX, y: e.clientY };
      stickEl.style.left = e.clientX + 'px'; stickEl.style.top = e.clientY + 'px';
      knobEl.style.transform = 'translate(-50%,-50%)';
      stickEl.classList.add('on');
    } else {
      TS.look.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
  }, { passive: false });
  touchEl.addEventListener('pointermove', e => {
    if (state !== 'playing') return;
    if (TS.stick && TS.stick.id === e.pointerId) {
      const R0 = 56;
      let dx = e.clientX - TS.stick.x, dy = e.clientY - TS.stick.y;
      const l = Math.hypot(dx, dy);
      if (l > R0) { dx *= R0 / l; dy *= R0 / l; }
      TS.moveX = dx / R0; TS.moveY = -dy / R0;
      knobEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      return;
    }
    const L = TS.look.get(e.pointerId);
    if (!L || dying > 0) return;
    const dx = e.clientX - L.x, dy = e.clientY - L.y;
    L.x = e.clientX; L.y = e.clientY;
    const friction = AA.near ? 1 - AA.s * .35 : 1;
    const k = .0058 * TS.sens * friction;
    P.yaw -= dx * k;
    P.pitch = clamp(P.pitch - dy * k, -1.5, 1.5);
    vm.swayX = clamp(vm.swayX - dx * .0003, -.03, .03);
    vm.swayY = clamp(vm.swayY + dy * .0003, -.03, .03);
  }, { passive: false });
  const touchEnd = e => {
    if (TS.stick && TS.stick.id === e.pointerId) {
      TS.stick = null; TS.moveX = TS.moveY = 0;
      stickEl.classList.remove('on');
    }
    const L = TS.look.get(e.pointerId);
    if (L) {
      if (L.btn) L.btn.classList.remove('down');
      if (L.btn && L.btn.id === 'tfire') firing = false;
      if (L.key) keys[L.key] = false;
      TS.look.delete(e.pointerId);
    }
  };
  touchEl.addEventListener('pointerup', touchEnd);
  touchEl.addEventListener('pointercancel', touchEnd);
  touchEl.addEventListener('contextmenu', e => e.preventDefault());

  function pauseGame() {
    if (state !== 'playing') return;
    state = 'paused';
    firing = false;
    Object.keys(keys).forEach(k => { keys[k] = false; });
    resetTouch();
    $('pause').classList.remove('hidden');
    Snd.setPaused(true);
  }
  function resumeGame() {
    if (portrait()) return;
    state = 'playing';
    $('pause').classList.add('hidden');
    Snd.setPaused(false);
  }
  const portrait = () => MOBILE && innerHeight > innerWidth;
  function lockLandscape() {
    try {
      const o = screen.orientation;
      if (o && o.lock) o.lock('landscape').catch(() => {});
    } catch (e) { /* nicht unterstützt */ }
  }
  addEventListener('resize', () => { if (portrait()) pauseGame(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && MOBILE) pauseGame(); });

  /* ========== Installation als App ========== */
  let installEvent = null;
  addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    installEvent = e;
    $('installBtn').classList.remove('hidden');
  });
  addEventListener('appinstalled', () => {
    $('installBtn').classList.add('hidden');
    $('installSteps').innerHTML = '';
    $('installNote').textContent = 'Installiert! Schließ diesen Tab und starte Kernschmelze über das neue Symbol auf deinem Startbildschirm.';
  });
  $('installBtn').onclick = async () => {
    if (!installEvent) return;
    installEvent.prompt();
    try { await installEvent.userChoice; } catch (e) { /* abgebrochen */ }
    installEvent = null;
    $('installBtn').classList.add('hidden');
  };
  const ICON_SHARE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 11v9h14v-9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ICON_ADD = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const ICON_DOTS = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="19" r="2" fill="currentColor"/></svg>';
  function showInstall() {
    const steps = [];
    let note = '';
    if (IOS) {
      const safari = !/CriOS|FxiOS|EdgiOS|OPiOS/.test(UA);
      steps.push(`Tippe in der Leiste auf <b>Teilen</b> <i class="ico">${ICON_SHARE}</i>.`);
      steps.push(`Scrolle nach unten und wähle <b>Zum Home-Bildschirm</b> <i class="ico">${ICON_ADD}</i>.`);
      steps.push('Bestätige oben rechts mit <b>Hinzufügen</b>.');
      steps.push('Starte <b>Kernschmelze</b> über das neue Symbol auf deinem Home-Bildschirm und dreh das Handy ins Querformat.');
      if (!safari) note = 'Findest du die Option nicht? Öffne diese Seite in Safari, dort klappt es immer.';
    } else {
      const samsung = /SamsungBrowser/.test(UA);
      if (samsung) {
        steps.push(`Tippe unten rechts auf das <b>Menü</b> (☰).`);
        steps.push('Wähle <b>Seite hinzufügen zu</b> und dann <b>Startbildschirm</b>.');
      } else {
        steps.push(`Tippe oben rechts auf das <b>Menü</b> <i class="ico">${ICON_DOTS}</i>.`);
        steps.push('Wähle <b>App installieren</b> oder <b>Zum Startbildschirm hinzufügen</b>.');
      }
      steps.push('Bestätige mit <b>Installieren</b>.');
      steps.push('Starte <b>Kernschmelze</b> über das neue Symbol – das Spiel läuft dann im Vollbild und im Querformat.');
      note = 'Wenn oben ein Knopf „Jetzt installieren“ erscheint, geht es mit einem Tipp.';
    }
    $('installSteps').innerHTML = steps.map(s => `<li>${s}</li>`).join('');
    $('installNote').textContent = note;
    $('menu').classList.add('hidden');
    $('install').classList.remove('hidden');
  }

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }
  if (MOBILE) {
    $('sensLabel').firstChild.textContent = 'Touch-Empfindlichkeit ';
    $('sens').value = TS.sens;
    if (!STANDALONE) showInstall();
  }
  applyGfx();

  /* ========== Hauptschleife ========== */
  function animateReactor(now, dt) {
    const health = P.coreMax ? P.core / P.coreMax : 1;
    const safe = state === 'menu' ? 1 : health;
    tmpColor.setRGB(.22 + (1 - safe) * .78, .94 * safe + .2 * (1 - safe), .88 * safe + .12 * (1 - safe));
    coreMat.emissive.copy(tmpColor);
    coreGlow.material.color.copy(tmpColor);
    coreLight.color.copy(tmpColor);
    floorRing.material.color.copy(tmpColor);
    const pulseSpeed = safe < .3 ? .012 : .0028;
    const pulse = 1 + Math.sin(now * pulseSpeed) * .22;
    coreMat.emissiveIntensity = 2.2 * pulse;
    coreLight.intensity = 2.1 * pulse;
    coreGlow.material.opacity = .5 * pulse;
    reactorRings.forEach((r, i) => {
      r.rotation.y = Math.sin(now * .0009 + i * 2) * .22;
      r.rotation.x = Math.PI / 2 + Math.cos(now * .0011 + i) * .16;
      r.position.y = [3, 5.2, 7.4][i] + Math.sin(now * .0013 + i) * .25;
    });
    coreColumn.rotation.y += dt;
  }

  let last = performance.now();
  renderer.shadowMap.needsUpdate = true;
  const dbSize = new THREE.Vector2();
  function frame(now) {
    requestAnimationFrame(frame);
    const real = Math.min((now - last) / 1000, .05);
    last = now;
    if (state === 'playing') {
      // kurzer Trefferstopp bei großen Abschüssen
      let slow = 1;
      if (hitStop > 0) { hitStop -= real; slow = dying > 0 ? .08 : 0; }
      multiKillT -= real;
      const dt = real * timeScale * slow;
      updatePlayer(dt);
      updateDirector(dt);
      updateEnemies(dt);
      updateProjectiles(dt);
      updatePickups(dt);
      updateHUD(real);
      updateEffects(dt);
      if (dying > 0) {
        dying -= real;
        if (dying <= 0) gameOver();
      }
    } else if (state === 'menu' || state === 'over') {
      const a = now * .00011;
      camera.position.set(Math.sin(a) * 27, 7.5 + Math.sin(a * 2.7) * 1.5, Math.cos(a) * 27);
      camera.lookAt(state === 'menu' ? Math.cos(a) * 7 : 0, 5, state === 'menu' ? -Math.sin(a) * 7 : 0);
      if (camera.fov !== 78) { camera.fov = 78; camera.updateProjectionMatrix(); }
      updateEffects(real);
    }
    if (state !== 'paused') animateReactor(now, real);
    renderer.getDrawingBufferSize(dbSize);
    pointScale.value = dbSize.y / (2 * Math.tan(camera.fov * Math.PI / 360));
    renderer.clear();
    renderer.render(scene, camera);
    if (vmRoot.visible) {
      if (vmCam.aspect !== camera.aspect) { vmCam.aspect = camera.aspect; vmCam.updateProjectionMatrix(); }
      // transparente Partikel lassen die Tiefenmaske aus; ohne sie wäre clearDepth wirkungslos
      renderer.state.buffers.depth.setMask(true);
      renderer.clearDepth();
      renderer.render(vmScene, vmCam);
    }
  }
  requestAnimationFrame(frame);
})();
