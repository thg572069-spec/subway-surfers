
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// =====================================================================
// CONFIG – ajuste fino da escala e rotação do mapa e da personagem
// =====================================================================
const CONFIG = {
  // Personagem 3D
  playerModel: 'assets/player.glb',
  playerModelHeight: 1.75,
  playerModelRotationY: Math.PI,

  // Mapa 3D
  mapModel: 'assets/mapa/mapa.glb',
  mapTrackWidth: 95.0,
  mapRotationX: 0,
  mapRotationY: 0,
  mapGroundOffsetY: 0.0,
  mapSegmentOverlap: 0.88,

  // Física e Jogabilidade
  laneWidth: 2.4,
  startSpeed: 15,
  maxSpeed: 36,
  acceleration: 0.22,
  gravity: 42,
  jumpVelocity: 13.5,
  rollDuration: 0.7,
};

// =====================================================================
// Constantes & Helpers
// =====================================================================
const LANE_W = CONFIG.laneWidth;
const SPAWN_AHEAD = 170;
const DESPAWN_BEHIND = 20;
const STAND_H = 1.75;
const ROLL_H = 0.9;

const laneX = (l) => (l - 1) * LANE_W;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (k, dt) => 1 - Math.exp(-k * dt);

// =====================================================================
// Renderer, Cena, Câmera e Iluminação
// =====================================================================
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const SKY = 0x9fd8ff;
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 75, 210);

// Câmera mais próxima e com campo de visão menor
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 450);
camera.position.set(0, 4.0, 6.2);

scene.add(new THREE.HemisphereLight(0xffffff, 0xb8aca0, 1.2));
scene.add(new THREE.AmbientLight(0xffffff, 0.45));

const sun = new THREE.DirectionalLight(0xfff4e0, 1.5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 35, bottom: -35, near: 1, far: 110 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// =====================================================================
// Materiais
// =====================================================================
const std = (o) => new THREE.MeshStandardMaterial(o);
const MAT = {
  coin: std({
    color: 0xffc61a,
    emissive: 0xb07000,
    emissiveIntensity: 0.6,
    metalness: 0.35,
    roughness: 0.3,
  }),
  hoodie: std({ color: 0xff7a1a, roughness: 0.8 }),
  pants: std({ color: 0x2b4c8c, roughness: 0.85 }),
  skin: std({ color: 0xf1c27d, roughness: 0.7 }),
  cap: std({ color: 0xe8253b, roughness: 0.6 }),
  shoe: std({ color: 0xffffff, roughness: 0.6 }),
};

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const coinGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.09, 24).rotateX(Math.PI / 2);

function box(mat, sx, sy, sz, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(UNIT_BOX, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

// =====================================================================
// MAPA GLB ÚNICO – ALINHAMENTO AUTOMÁTICO E LOOP CONTÍNUO
// =====================================================================
const MAP_SEGMENTS_COUNT = 4;
const mapSegments = [];
let mapLength = 0;
let mapLoaded = false;

const fallbackGround = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 450).rotateX(-Math.PI / 2),
  std({ color: 0x7a828c, roughness: 0.9 })
);
fallbackGround.receiveShadow = true;
scene.add(fallbackGround);

function getEffectiveStep() {
  const overlap = clamp(CONFIG.mapSegmentOverlap ?? 1, 0.5, 1.05);
  return mapLength * overlap;
}

function updateMapLoop() {
  fallbackGround.position.z = G.pz - 100;
  if (!mapLoaded || mapLength <= 0) return;

  const step = getEffectiveStep();

  for (const segment of mapSegments) {
    if (segment.position.z - step / 2 > G.pz + 15) {
      const furthestBack = Math.min(...mapSegments.map((item) => item.position.z));
      segment.position.z = furthestBack - step;
    }
  }
}

function resetMapLoop() {
  if (!mapLoaded || mapLength <= 0) return;
  const step = getEffectiveStep();
  mapSegments.forEach((segment, index) => {
    segment.position.z = G.pz - index * step;
  });
}

new GLTFLoader().load(
  CONFIG.mapModel,
  (gltf) => {
    const rawModel = gltf.scene;

    rawModel.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
        if (obj.material) {
          obj.material.side = THREE.DoubleSide;
          if (obj.material.metalness > 0.7) obj.material.metalness = 0.25;
          obj.material.needsUpdate = true;
        }
      }
    });

    const wrapper = new THREE.Group();
    wrapper.add(rawModel);
    rawModel.rotation.x = CONFIG.mapRotationX;
    rawModel.rotation.y = CONFIG.mapRotationY;

    // Alinha o lado mais comprido do mapa com o eixo Z
    const preBounds = new THREE.Box3().setFromObject(wrapper);
    const preSize = preBounds.getSize(new THREE.Vector3());
    if (CONFIG.mapRotationY === 0 && preSize.x > preSize.z) {
      rawModel.rotation.y = Math.PI / 2;
    }

    // Escala proporcional pela largura configurada
    const scaledBounds = new THREE.Box3().setFromObject(wrapper);
    const scaledSize = scaledBounds.getSize(new THREE.Vector3());
    const scaleFactor = CONFIG.mapTrackWidth / (scaledSize.x || 1);
    wrapper.scale.setScalar(scaleFactor);

    // Centraliza em X e Z
    const finalBounds = new THREE.Box3().setFromObject(wrapper);
    const finalSize = finalBounds.getSize(new THREE.Vector3());
    const finalCenter = finalBounds.getCenter(new THREE.Vector3());

    wrapper.position.set(-finalCenter.x, -finalBounds.min.y, -finalCenter.z);
    wrapper.updateMatrixWorld(true);

    // Detecta automaticamente a altura da superfície da rua no centro da pista
    const raycaster = new THREE.Raycaster();
    const samplePoints = [
      new THREE.Vector3(0, finalSize.y + 10, 0),
      new THREE.Vector3(0, finalSize.y + 10, finalSize.z * 0.25),
      new THREE.Vector3(0, finalSize.y + 10, -finalSize.z * 0.25),
    ];

    let roadSurfaceY = 0;
    for (const origin of samplePoints) {
      raycaster.set(origin, new THREE.Vector3(0, -1, 0));
      const hits = raycaster.intersectObject(wrapper, true);
      if (hits.length > 0) {
        roadSurfaceY = hits[0].point.y;
        break;
      }
    }

    // Alinha o asfalto com Y = 0
    wrapper.position.y -= roadSurfaceY - CONFIG.mapGroundOffsetY;

    mapLength = finalSize.z;

    if (!Number.isFinite(mapLength) || mapLength < 1) {
      console.error('[mapa] Comprimento inválido no GLB.');
      return;
    }

    const step = getEffectiveStep();

    for (let i = 0; i < MAP_SEGMENTS_COUNT; i++) {
      const segment = new THREE.Group();
      const clone = wrapper.clone(true);
      segment.add(clone);
      segment.position.set(0, 0, G.pz - i * step);
      scene.add(segment);
      mapSegments.push(segment);
    }

    fallbackGround.visible = false;
    mapLoaded = true;
    console.info(
      `[mapa] Pista nivelada! Largura: ${CONFIG.mapTrackWidth}, Comprimento: ${mapLength.toFixed(2)}, Passo: ${step.toFixed(2)}`
    );
  },
  undefined,
  (error) => {
    console.error(`[mapa] Erro ao carregar ${CONFIG.mapModel}:`, error);
  }
);

// =====================================================================
// Personagem 3D
// =====================================================================
function makeRunner() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  body.add(box(MAT.hoodie, 0.7, 0.72, 0.42, 0, 1.17, 0));
  body.add(box(MAT.skin, 0.44, 0.44, 0.42, 0, 1.78, 0));
  body.add(box(MAT.cap, 0.48, 0.14, 0.46, 0, 2.0, 0));
  body.add(box(MAT.cap, 0.4, 0.05, 0.25, 0, 1.95, 0.3));

  const limb = (mat, w, h, x, y) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    pivot.add(box(mat, w, h, w, 0, -h / 2, 0));
    body.add(pivot);
    return pivot;
  };

  const armL = limb(MAT.hoodie, 0.18, 0.66, -0.45, 1.5);
  const armR = limb(MAT.hoodie, 0.18, 0.66, 0.45, 1.5);
  const legL = limb(MAT.pants, 0.24, 0.8, -0.18, 0.82);
  const legR = limb(MAT.pants, 0.24, 0.8, 0.18, 0.82);

  legL.add(box(MAT.shoe, 0.28, 0.14, 0.38, 0, -0.78, -0.05));
  legR.add(box(MAT.shoe, 0.28, 0.14, 0.38, 0, -0.78, -0.05));

  scene.add(root);
  return { root, body, armL, armR, legL, legR };
}

const runner = makeRunner();
let glb = null;

if (CONFIG.playerModel) {
  new GLTFLoader().load(
    CONFIG.playerModel,
    (gltf) => {
      const model = gltf.scene;

      model.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });

      const rawBox = new THREE.Box3().setFromObject(model);
      const rawSize = rawBox.getSize(new THREE.Vector3());
      const scale = CONFIG.playerModelHeight / (rawSize.y || 1);
      model.scale.setScalar(scale);

      const scaledBox = new THREE.Box3().setFromObject(model);
      const center = scaledBox.getCenter(new THREE.Vector3());
      model.position.set(-center.x, -scaledBox.min.y, -center.z);

      const pivot = new THREE.Group();
      pivot.add(model);
      pivot.rotation.y = CONFIG.playerModelRotationY;

      runner.root.add(pivot);
      runner.body.visible = false;

      const mixer = new THREE.AnimationMixer(model);
      const clips = gltf.animations || [];
      const find = (...names) =>
        clips.find((cl) => names.some((n) => cl.name.toLowerCase().includes(n)));

      const actions = {};
      const runClip = find('run', 'sprint', 'jog', 'walk') || clips[0];
      const jumpClip = find('jump');
      const rollClip = find('roll', 'slide', 'crouch');

      if (runClip) actions.run = mixer.clipAction(runClip);
      if (jumpClip) actions.jump = mixer.clipAction(jumpClip);
      if (rollClip) actions.roll = mixer.clipAction(rollClip);

      if (actions.run) actions.run.play();

      glb = { pivot, mixer, actions, current: actions.run || null };
      console.info(`[runner] Modelo 3D alinhado (${CONFIG.playerModelHeight}m).`);
    },
    undefined,
    () => console.info(`[runner] Modelo não encontrado – usando personagem padrão.`)
  );
}

function playGlbAction(name) {
  if (!glb) return;
  const next = glb.actions[name] || glb.actions.run;
  if (!next || next === glb.current) return;
  next.reset().fadeIn(0.12).play();
  if (glb.current) glb.current.fadeOut(0.12);
  glb.current = next;
}

// =====================================================================
// Áudio
// =====================================================================
let actx = null;

function ensureAudio() {
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch {
    actx = null;
  }
}

function beep(freq, dur = 0.08, type = 'square', vol = 0.04, slide = 1) {
  if (!actx) return;
  const t = actx.currentTime;
  const o = actx.createOscillator();
  const g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide !== 1) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(actx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

// =====================================================================
// Estado do Jogo & UI
// =====================================================================
const ui = {
  score: document.getElementById('score-hud'),
  coins: document.getElementById('coins-hud'),
  best: document.getElementById('best-hud'),
  menu: document.getElementById('menu'),
  over: document.getElementById('over'),
  finalScore: document.getElementById('final-score'),
  finalCoins: document.getElementById('final-coins'),
  finalBest: document.getElementById('final-best'),
  newBest: document.getElementById('new-best'),
  flash: document.getElementById('flash'),
  loading: document.getElementById('loading'),
};

function loadBest() {
  try {
    return Number(localStorage.getItem('subwayRushBest')) || 0;
  } catch {
    return 0;
  }
}

function saveBest(v) {
  try {
    localStorage.setItem('subwayRushBest', String(v));
  } catch {}
}

const G = {
  state: 'menu',
  px: 0, py: 0, pz: 0, vy: 0,
  lane: 1, prevLane: 1,
  speed: CONFIG.startSpeed,
  grounded: true,
  rollTimer: 0,
  phase: 0,
  coins: 0,
  score: 0,
  best: loadBest(),
  nextCoinZ: -30,
  overAt: 0,
};

const coins = [];

if (ui.best) ui.best.textContent = `BEST ${G.best}`;

function resetGame() {
  for (const c of coins) scene.remove(c.mesh);
  coins.length = 0;

  Object.assign(G, {
    px: 0, py: 0, pz: 0, vy: 0, lane: 1, prevLane: 1,
    speed: CONFIG.startSpeed, grounded: true, rollTimer: 0,
    phase: 0, coins: 0, score: 0, nextCoinZ: -30,
  });

  resetMapLoop();

  runner.root.rotation.set(0, 0, 0);
  runner.root.position.set(0, 0, 0);
  runner.body.scale.set(1, 1, 1);

  if (glb) glb.pivot.scale.set(1, 1, 1);

  playGlbAction('run');
  spawnCoinsAhead();
}

function startGame() {
  ensureAudio();
  resetGame();
  G.state = 'playing';
  if (ui.menu) ui.menu.classList.add('hidden');
  if (ui.over) ui.over.classList.add('hidden');
  beep(520, 0.1, 'square', 0.04, 1.5);
}

// =====================================================================
// Moedas na Pista
// =====================================================================
function addCoin(x, y, z) {
  const mesh = new THREE.Mesh(coinGeo, MAT.coin);
  mesh.position.set(x, y, z);
  scene.add(mesh);
  coins.push({ mesh, taken: false });
}

function spawnCoinsAhead() {
  while (G.nextCoinZ > G.pz - SPAWN_AHEAD) {
    const l = Math.floor(Math.random() * 3);
    const x = laneX(l);
    const count = 6;

    for (let i = 0; i < count; i++) {
      addCoin(x, 1.0, G.nextCoinZ - i * 2.2);
    }

    G.nextCoinZ -= count * 2.2 + rand(12, 22);
  }
}

// =====================================================================
// Controles (Teclado & Touch)
// =====================================================================
function move(dir) {
  if (G.state !== 'playing') return;
  const nl = clamp(G.lane + dir, 0, 2);
  if (nl === G.lane) return;
  G.prevLane = G.lane;
  G.lane = nl;
  beep(380, 0.05, 'triangle', 0.03);
}

function jump() {
  if (G.state !== 'playing' || !G.grounded) return;
  G.vy = CONFIG.jumpVelocity;
  G.grounded = false;
  G.rollTimer = 0;
  beep(440, 0.12, 'square', 0.035, 1.8);
}

function roll() {
  if (G.state !== 'playing') return;
  if (!G.grounded) G.vy = -28;
  G.rollTimer = CONFIG.rollDuration;
  beep(300, 0.12, 'triangle', 0.04, 0.5);
}

window.addEventListener('keydown', (e) => {
  const k = e.code;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(k)) {
    e.preventDefault();
  }
  if (G.state === 'menu' || (G.state === 'over' && performance.now() - G.overAt > 400)) {
    if (k === 'Enter' || k === 'Space') startGame();
    return;
  }
  if (k === 'ArrowLeft' || k === 'KeyA') move(-1);
  else if (k === 'ArrowRight' || k === 'KeyD') move(1);
  else if (k === 'ArrowUp' || k === 'KeyW' || k === 'Space') jump();
  else if (k === 'ArrowDown' || k === 'KeyS') roll();
});

let gesture = null;
window.addEventListener('pointerdown', (e) => {
  ensureAudio();
  gesture = { x: e.clientX, y: e.clientY };
});
window.addEventListener('pointermove', (e) => {
  if (!gesture || G.state !== 'playing') return;
  const dx = e.clientX - gesture.x;
  const dy = e.clientY - gesture.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 30) return;
  gesture = null;
  if (Math.abs(dx) > Math.abs(dy)) move(Math.sign(dx));
  else if (dy < 0) jump();
  else roll();
});
window.addEventListener('pointerup', () => (gesture = null));
window.addEventListener('pointercancel', () => (gesture = null));

if (ui.menu) ui.menu.addEventListener('click', startGame);
if (ui.over) ui.over.addEventListener('click', () => {
  if (performance.now() - G.overAt > 400) startGame();
});

// =====================================================================
// Loop de Atualização
// =====================================================================
const tmpLook = new THREE.Vector3();

function updatePlaying(dt) {
  G.speed = Math.min(CONFIG.maxSpeed, G.speed + CONFIG.acceleration * dt);

  G.pz -= G.speed * dt;
  G.px += (laneX(G.lane) - G.px) * damp(16, dt);
  G.rollTimer = Math.max(0, G.rollTimer - dt);

  if (G.vy > 0 || G.py > 0.02) {
    G.vy -= CONFIG.gravity * dt;
    G.py += G.vy * dt;
    if (G.py <= 0) {
      G.py = 0;
      G.vy = 0;
      G.grounded = true;
    } else {
      G.grounded = false;
    }
  } else {
    G.py = 0;
    G.vy = 0;
    G.grounded = true;
  }

  const h = G.rollTimer > 0 ? ROLL_H : STAND_H;
  for (const c of coins) {
    if (c.taken) continue;
    const p = c.mesh.position;
    if (
      Math.abs(p.x - G.px) < 0.85 &&
      Math.abs(p.z - G.pz) < 0.9 &&
      Math.abs(p.y - (G.py + h / 2)) < 1.15
    ) {
      c.taken = true;
      c.mesh.visible = false;
      G.coins++;
      beep(1320, 0.07, 'square', 0.025, 1.3);
    }
  }

  G.score = Math.floor(-G.pz);
  if (G.score > G.best) {
    G.best = G.score;
    saveBest(G.best);
    if (ui.best) ui.best.textContent = `BEST ${G.best}`;
  }

  spawnCoinsAhead();
  recycle();
}

function recycle() {
  updateMapLoop();

  for (let i = coins.length - 1; i >= 0; i--) {
    if (coins[i].mesh.position.z > G.pz + DESPAWN_BEHIND) {
      scene.remove(coins[i].mesh);
      coins.splice(i, 1);
    }
  }
}

function animateRunner(dt) {
  const r = runner;
  r.root.position.set(G.px, G.py, G.pz);

  const rolling = G.rollTimer > 0;
  const k = damp(18, dt);

  r.root.rotation.z = clamp((G.px - laneX(G.lane)) * 0.12, -0.35, 0.35);
  G.phase += dt * (G.state === 'menu' ? 3 : 6 + G.speed * 0.6);
  const s = Math.sin(G.phase);

  if (rolling) {
    r.body.scale.y += (0.5 - r.body.scale.y) * k;
    r.legL.rotation.x = r.legR.rotation.x = -1.4;
    r.armL.rotation.x = r.armR.rotation.x = -2.2;
  } else if (!G.grounded) {
    r.body.scale.y += (1 - r.body.scale.y) * k;
    r.legL.rotation.x = -1.0;
    r.legR.rotation.x = 0.5;
    r.armL.rotation.x = r.armR.rotation.x = -2.6;
  } else {
    r.body.scale.y += (1 - r.body.scale.y) * k;
    const amp = G.state === 'menu' ? 0.15 : 0.95;
    r.legL.rotation.x = s * amp;
    r.legR.rotation.x = -s * amp;
    r.armL.rotation.x = -s * amp * 0.9;
    r.armR.rotation.x = s * amp * 0.9;
  }

  r.body.position.y = G.grounded && !rolling ? Math.abs(s) * 0.07 : 0;

  if (glb) {
    const want = rolling ? 'roll' : !G.grounded ? 'jump' : 'run';
    playGlbAction(want);

    if (glb.actions.run) {
      glb.actions.run.timeScale = G.state === 'menu' ? 0.4 : G.speed / CONFIG.startSpeed;
    }

    const sy = rolling && !glb.actions.roll ? 0.55 : 1;
    glb.pivot.scale.y += (sy - glb.pivot.scale.y) * k;
    glb.mixer.update(dt);
  }
}

function updateCamera(dt) {
  const tx = G.px * 0.8;
  const ty = 4.0 + G.py * 0.6;

  camera.position.x += (tx - camera.position.x) * damp(8, dt);
  camera.position.y += (ty - camera.position.y) * damp(6, dt);
  camera.position.z = G.pz + 6.2;

  tmpLook.set(G.px * 0.85, 1.4 + G.py * 0.5, G.pz - 8);
  camera.lookAt(tmpLook);

  // Reduz o zoom aberto excessivo nas telas verticais
  const portraitBoost = camera.aspect < 1 ? (1 - camera.aspect) * 12 : 0;
  const fov = 55 + portraitBoost + (G.speed - CONFIG.startSpeed) * 0.2;

  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }

  sun.position.set(G.px + 8, 22, G.pz + 6);
  sun.target.position.set(G.px, 0, G.pz - 12);
}

let lastScore = -1;
let lastCoins = -1;

function updateHud() {
  if (ui.score && G.score !== lastScore) ui.score.textContent = (lastScore = G.score);
  if (ui.coins && G.coins !== lastCoins) ui.coins.textContent = (lastCoins = G.coins);
}

const timer = new THREE.Timer();

function frame(timestamp) {
  timer.update(timestamp);
  const dt = Math.min(timer.getDelta(), 0.05);

  if (G.state === 'playing') {
    updatePlaying(dt);
  }

  for (const c of coins) {
    if (!c.taken) c.mesh.rotation.y += dt * 3;
  }

  animateRunner(dt);
  updateCamera(dt);
  updateHud();

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

resetGame();
if (ui.loading) ui.loading.remove();
requestAnimationFrame(frame);

window.__game = { G, coins, start: startGame, move, jump, roll, CONFIG };
