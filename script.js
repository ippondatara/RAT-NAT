// ============================================================
//  RATA SURVIVOR – script.js
//  Juego educativo de biología: flujo de energía,
//  selección natural y cambio climático.
// ============================================================

"use strict";

// ── CONSTANTES ────────────────────────────────────────────────
const TILE    = 32;       // px por tile
const COLS    = 40;       // mapa 40 columnas
const ROWS    = 40;       // mapa 40 filas
const MAP_W   = COLS * TILE;
const MAP_H   = ROWS * TILE;

// Zonas (columna inicio, columna fin)
const ZONES = {
  safe:    { xStart: 0,  xEnd: 14, label: "🟢 Segura",   color: "#1a3a1a" },
  scarce:  { xStart: 14, xEnd: 27, label: "🟡 Escasez",   color: "#2a2008" },
  hostile: { xStart: 27, xEnd: 40, label: "🔴 Hostil",    color: "#2a0808" },
};

// Energía
const ENERGY_MAX      = 100;
const ENERGY_DECAY    = 0.012;   // por frame (base)
const ENERGY_FOOD     = 30;      // restaura al comer
const ENERGY_RUN_COST = 0.02;    // extra al correr

// Velocidades (tiles/s → px/frame a 60fps)
const SPEED_WALK = 2.2;
const SPEED_RUN  = 4.0;

// Ciclo día/noche (segundos)
const DAY_DURATION = 40;

// ── ESTADO GLOBAL ─────────────────────────────────────────────
let canvas, ctx;
let keys = {};
let gameActive = false;

let player, camera, foods, timeAlive;
let dayTimer, climate, climateTimer;
let trait;             // adaptación activa del jugador
let stats;             // acumuladores para evolución
let evoTimer;          // segundos hasta próxima oferta evolutiva
let tilemap;           // array[row][col] = tipo de tile
let overlay;           // oscuridad noche (0..1)

// ── TIPOS DE TILE ─────────────────────────────────────────────
const T_GRASS  = 0;
const T_ROCK   = 1;

// ── INICIALIZACIÓN ────────────────────────────────────────────
function init() {
  canvas = document.getElementById("gameCanvas");
  ctx    = canvas.getContext("2d");
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);

  document.getElementById("btn-start").addEventListener("click", startGame);
  document.getElementById("btn-restart").addEventListener("click", () => {
    showScreen("screen-start");
  });
  document.addEventListener("keydown", e => { keys[e.code] = true; });
  document.addEventListener("keyup",   e => { keys[e.code] = false; });
}

function resizeCanvas() {
  // La vista es el viewport menos el HUD (~44px)
  const hudH = 44;
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight - hudH;
}

// ── INICIO DE PARTIDA ─────────────────────────────────────────
function startGame() {
  showScreen("screen-game");

  // Mapa
  tilemap = generateMap();

  // Jugador (empieza en zona segura)
  player = {
    x: 5 * TILE + TILE / 2,
    y: 5 * TILE + TILE / 2,
    w: 18, h: 18,
    energy: ENERGY_MAX,
    speed: SPEED_WALK,
  };

  // Cámara
  camera = { x: 0, y: 0 };

  // Comida
  foods = [];
  spawnFoods(30);   // inicial: muchas semillas

  // Tiempo y clima
  timeAlive  = 0;
  dayTimer   = 0;
  overlay    = 0;
  climate    = "normal";
  climateTimer = 0;

  // Adaptación y estadísticas
  trait  = "normal";
  stats  = { steps: 0, runs: 0, eats: 0 };
  evoTimer = 45;   // primera oferta a los 45 s

  gameActive = true;
  document.getElementById("evo-panel").classList.add("hidden");

  requestAnimationFrame(gameLoop);
}

// ── GENERACIÓN DEL MAPA ───────────────────────────────────────
function generateMap() {
  const map = [];
  for (let r = 0; r < ROWS; r++) {
    map[r] = [];
    for (let c = 0; c < COLS; c++) {
      // Bordes son rocas
      if (r === 0 || r === ROWS-1 || c === 0 || c === COLS-1) {
        map[r][c] = T_ROCK;
      } else {
        map[r][c] = T_GRASS;
      }
    }
  }

  // Obstáculos: rocas dispersas (más en zona hostil)
  const rockChance = (c) => {
    if (c < 14) return 0.03;  // segura: pocas
    if (c < 27) return 0.07;  // escasez: medias
    return 0.12;              // hostil: muchas
  };

  for (let r = 1; r < ROWS-1; r++) {
    for (let c = 1; c < COLS-1; c++) {
      if (Math.random() < rockChance(c)) map[r][c] = T_ROCK;
    }
  }

  // Pequeños grupos de rocas para hacer el mapa más interesante
  for (let i = 0; i < 18; i++) {
    const cr = 1 + Math.floor(Math.random() * (ROWS - 2));
    const cc = 1 + Math.floor(Math.random() * (COLS - 2));
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nr = cr + dr, nc = cc + dc;
        if (nr > 0 && nr < ROWS-1 && nc > 0 && nc < COLS-1) {
          map[nr][nc] = T_ROCK;
        }
      }
    }
    // aseguramos que el spawn esté limpio
    if (cr < 8 && cc < 8) {
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++)
          if (cr+dr>0&&cc+dc>0) map[cr+dr][cc+dc] = T_GRASS;
    }
  }

  return map;
}

// ── COMIDA ────────────────────────────────────────────────────
function spawnFoods(n) {
  for (let i = 0; i < n; i++) {
    trySpawnFood();
  }
}

function trySpawnFood() {
  // Más comida en zona segura, menos en escasez, casi nada en hostil
  const zoneRoll = Math.random();
  let col;
  if (zoneRoll < 0.65)      col = 1 + Math.floor(Math.random() * 13); // segura
  else if (zoneRoll < 0.90) col = 14 + Math.floor(Math.random() * 13);// escasez
  else                      col = 27 + Math.floor(Math.random() * 12);// hostil

  const row = 1 + Math.floor(Math.random() * (ROWS - 2));
  if (tilemap[row][col] === T_ROCK) return;

  // Evitar duplicados
  const fx = col * TILE + TILE / 2;
  const fy = row * TILE + TILE / 2;
  if (foods.some(f => Math.abs(f.x - fx) < 8 && Math.abs(f.y - fy) < 8)) return;

  foods.push({ x: fx, y: fy, r: 6, respawnTimer: 0, eaten: false });
}

// ── CÁMARA ────────────────────────────────────────────────────
function updateCamera() {
  const hw = canvas.width  / 2;
  const hh = canvas.height / 2;
  camera.x = Math.max(0, Math.min(player.x - hw, MAP_W - canvas.width));
  camera.y = Math.max(0, Math.min(player.y - hh, MAP_H - canvas.height));
}

// ── ZONA ACTUAL ───────────────────────────────────────────────
function getZone(px) {
  const col = Math.floor(px / TILE);
  if (col < ZONES.safe.xEnd)    return "safe";
  if (col < ZONES.scarce.xEnd)  return "scarce";
  return "hostile";
}

// ── LOOP PRINCIPAL ────────────────────────────────────────────
let lastTime = 0;
function gameLoop(ts) {
  if (!gameActive) return;
  const dt = Math.min((ts - lastTime) / 1000, 0.05); // delta en segundos
  lastTime = ts;

  update(dt);
  draw();
  requestAnimationFrame(gameLoop);
}

// ── UPDATE ────────────────────────────────────────────────────
function update(dt) {
  timeAlive += dt;

  // --- Movimiento ---
  const running = keys["Space"] || keys["ShiftLeft"];
  const spd = (running ? SPEED_RUN : SPEED_WALK)
              * (trait === "fast"    ? 1.35 : 1)
              * (climate === "cold"  ? 0.65 : 1)
              * (TILE / 16);          // escala a px/frame aprox

  let dx = 0, dy = 0;
  if (keys["ArrowUp"]    || keys["KeyW"]) dy = -1;
  if (keys["ArrowDown"]  || keys["KeyS"]) dy =  1;
  if (keys["ArrowLeft"]  || keys["KeyA"]) dx = -1;
  if (keys["ArrowRight"] || keys["KeyD"]) dx =  1;

  // Sin diagonal: prioriza un eje
  if (dx !== 0 && dy !== 0) dy = 0;

  const newX = player.x + dx * spd;
  const newY = player.y + dy * spd;

  if (!collides(newX, player.y)) player.x = newX;
  if (!collides(player.x, newY)) player.y = newY;

  if (dx !== 0 || dy !== 0) {
    stats.steps++;
    if (running) stats.runs++;
  }

  // --- Energía ---
  const zone = getZone(player.x);
  let decay = ENERGY_DECAY;
  if (zone === "hostile") decay *= (climate === "heat" ? 2.8 : 1.8);
  if (zone === "scarce")  decay *= 1.25;
  if (climate === "heat") decay *= 1.4;
  if (running)            decay += ENERGY_RUN_COST;
  if (trait === "efficient") decay *= 0.65;

  player.energy -= decay;
  player.energy  = Math.max(0, Math.min(ENERGY_MAX, player.energy));

  // --- Muerte ---
  if (player.energy <= 0) {
    endGame(); return;
  }

  // --- Comer ---
  for (const f of foods) {
    if (f.eaten) continue;
    if (dist(player.x, player.y, f.x, f.y) < f.r + 9) {
      f.eaten = true;
      f.respawnTimer = zone === "safe" ? 8 : zone === "scarce" ? 20 : 40;
      player.energy = Math.min(ENERGY_MAX, player.energy + ENERGY_FOOD);
      stats.eats++;
    }
  }

  // Re-aparición de comida
  for (const f of foods) {
    if (f.eaten) {
      f.respawnTimer -= dt;
      if (f.respawnTimer <= 0) f.eaten = false;
    }
  }

  // Rellenar comida si hay muy poca
  if (foods.filter(f => !f.eaten).length < 12) trySpawnFood();

  // --- Ciclo día/noche ---
  dayTimer += dt;
  const phase = (dayTimer % DAY_DURATION) / DAY_DURATION; // 0..1
  if (phase < 0.45)       overlay = 0;                           // día
  else if (phase < 0.55)  overlay = (phase - 0.45) / 0.1;       // atardecer
  else if (phase < 0.9)   overlay = 1;                           // noche
  else                    overlay = 1 - (phase - 0.9) / 0.1;    // amanecer

  // --- Clima ---
  climateTimer -= dt;
  if (climateTimer <= 0) {
    const roll = Math.random();
    if (roll < 0.33)      { climate = "heat"; climateTimer = 15; showClimateMsg("🌡 ¡Calor extremo! La energía se drena más rápido."); }
    else if (roll < 0.55) { climate = "cold"; climateTimer = 12; showClimateMsg("❄️ ¡Frío polar! Tu velocidad se reduce."); }
    else                  { climate = "normal"; climateTimer = 20; }
  }

  // --- Evolución ---
  evoTimer -= dt;
  if (evoTimer <= 0 && document.getElementById("evo-panel").classList.contains("hidden")) {
    gameActive = false;
    showEvolution();
  }

  // --- Cámara ---
  updateCamera();

  // --- HUD ---
  updateHUD(zone);
}

function collides(px, py) {
  const hw = player.w / 2, hh = player.h / 2;
  const corners = [
    [px - hw, py - hh], [px + hw, py - hh],
    [px - hw, py + hh], [px + hw, py + hh],
  ];
  for (const [cx, cy] of corners) {
    const col = Math.floor(cx / TILE);
    const row = Math.floor(cy / TILE);
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return true;
    if (tilemap[row][col] === T_ROCK) return true;
  }
  return false;
}

// ── DRAW ──────────────────────────────────────────────────────
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(-camera.x, -camera.y);

  drawTiles();
  drawFoods();
  drawPlayer();

  // Overlay noche
  if (overlay > 0) {
    ctx.fillStyle = `rgba(0,0,20,${overlay * 0.65})`;
    ctx.fillRect(camera.x, camera.y, canvas.width, canvas.height);
  }

  ctx.restore();
}

function drawTiles() {
  const startCol = Math.floor(camera.x / TILE);
  const endCol   = Math.min(COLS, startCol + Math.ceil(canvas.width  / TILE) + 1);
  const startRow = Math.floor(camera.y / TILE);
  const endRow   = Math.min(ROWS, startRow + Math.ceil(canvas.height / TILE) + 1);

  for (let r = startRow; r < endRow; r++) {
    for (let c = startCol; c < endCol; c++) {
      const x = c * TILE;
      const y = r * TILE;
      const type = tilemap[r][c];

      // Color de fondo según zona
      if (type === T_GRASS) {
        if (c < ZONES.safe.xEnd)   ctx.fillStyle = "#162816";
        else if (c < ZONES.scarce.xEnd) ctx.fillStyle = "#241e08";
        else                       ctx.fillStyle = "#1e0e0e";
      } else {
        ctx.fillStyle = "#404040";
      }
      ctx.fillRect(x, y, TILE, TILE);

      // Grilla sutil
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.strokeRect(x, y, TILE, TILE);

      // Detalles de roca
      if (type === T_ROCK) {
        ctx.fillStyle = "#555";
        ctx.fillRect(x + 6, y + 6, TILE - 12, TILE - 12);
        ctx.fillStyle = "#333";
        ctx.fillRect(x + 10, y + 10, TILE - 20, TILE - 20);
      } else {
        // Pequeñas hierbas (decoración)
        if ((r * 7 + c * 13) % 5 === 0) {
          ctx.fillStyle = c < 14 ? "#2a5a2a" : c < 27 ? "#4a4010" : "#3a1a1a";
          ctx.fillRect(x + 10, y + 16, 3, 8);
          ctx.fillRect(x + 18, y + 14, 3, 10);
        }
      }
    }
  }

  // Líneas de zona (indicadores visuales)
  ctx.strokeStyle = "#ffffff22";
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  for (const boundary of [ZONES.scarce.xStart, ZONES.hostile.xStart]) {
    ctx.beginPath();
    ctx.moveTo(boundary * TILE, 0);
    ctx.lineTo(boundary * TILE, MAP_H);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.lineWidth = 1;
}

function drawFoods() {
  for (const f of foods) {
    if (f.eaten) continue;
    // Brillo pulsante
    const pulse = 0.7 + 0.3 * Math.sin(Date.now() / 400 + f.x);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = "#5dfc8c";
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
    ctx.fill();
    // Tallo
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#3aaa5a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(f.x, f.y + f.r);
    ctx.lineTo(f.x, f.y + f.r + 5);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawPlayer() {
  const px = player.x - player.w / 2;
  const py = player.y - player.h / 2;
  const w  = player.w, h = player.h;

  // Sombra
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.fillRect(px + 3, py + 3, w, h);

  // Cuerpo
  const bodyColor =
    trait === "fast"      ? "#fccc5d" :
    trait === "efficient" ? "#5dccfc" :
    trait === "tough"     ? "#fc8c5d" : "#e0c890";

  ctx.fillStyle = bodyColor;
  ctx.fillRect(px, py, w, h);

  // Orejas
  ctx.fillStyle = "#c0a070";
  ctx.beginPath(); ctx.arc(px + 3, py + 2, 4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(px + w - 3, py + 2, 4, 0, Math.PI * 2); ctx.fill();

  // Ojos
  ctx.fillStyle = "#ff2222";
  ctx.fillRect(px + 4,  py + 5, 3, 3);
  ctx.fillRect(px + w - 7, py + 5, 3, 3);

  // Cola (línea)
  ctx.strokeStyle = "#c0a070";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(player.x, py + h);
  ctx.quadraticCurveTo(player.x + 10, py + h + 8, player.x + 6, py + h + 16);
  ctx.stroke();

  // Indicador energía (pequeño)
  const ePct = player.energy / ENERGY_MAX;
  const bw = w + 4;
  ctx.fillStyle = "#111";
  ctx.fillRect(px - 2, py - 7, bw, 4);
  ctx.fillStyle = ePct > 0.5 ? "#5dfc8c" : ePct > 0.25 ? "#fccc5d" : "#fc5d5d";
  ctx.fillRect(px - 2, py - 7, bw * ePct, 4);
}

// ── HUD ───────────────────────────────────────────────────────
function updateHUD(zone) {
  const ePct = player.energy / ENERGY_MAX;
  const bar  = document.getElementById("energy-bar");
  bar.style.width     = (ePct * 100) + "%";
  bar.style.background = ePct > 0.5 ? "#5dfc8c" : ePct > 0.25 ? "#fccc5d" : "#fc5d5d";

  document.getElementById("hud-zone").textContent =
    zone === "safe" ? "🟢 Segura" : zone === "scarce" ? "🟡 Escasez" : "🔴 Hostil";

  const climateLabels = { normal: "Normal 🌤", heat: "Calor 🔥", cold: "Frío ❄️" };
  document.getElementById("hud-climate").textContent = climateLabels[climate];

  document.getElementById("hud-time").textContent = Math.floor(timeAlive) + "s";

  const traitLabels = { normal: "Normal", fast: "⚡ Rápida", efficient: "💧 Eficiente", tough: "🛡 Resistente" };
  document.getElementById("hud-trait").textContent = traitLabels[trait] || trait;
}

// ── SISTEMA DE EVOLUCIÓN ──────────────────────────────────────
function showEvolution() {
  const panel    = document.getElementById("evo-panel");
  const choices  = document.getElementById("evo-choices");
  const desc     = document.getElementById("evo-desc");
  choices.innerHTML = "";

  // Determina candidatos según comportamiento
  const options = buildEvolutionOptions();
  desc.textContent = options.context;

  options.choices.forEach(opt => {
    const btn = document.createElement("button");
    btn.className = "evo-btn";
    btn.innerHTML = `<strong>${opt.icon} ${opt.name}</strong>${opt.desc}`;
    btn.addEventListener("click", () => {
      applyTrait(opt.id);
      panel.classList.add("hidden");
      evoTimer = 45 + Math.random() * 20;
      gameActive = true;
      requestAnimationFrame(gameLoop);
    });
    choices.appendChild(btn);
  });

  panel.classList.remove("hidden");
}

function buildEvolutionOptions() {
  const runRatio = stats.steps > 0 ? stats.runs / stats.steps : 0;
  const eatRatio = stats.eats;

  let context = "El entorno ha generado presión selectiva sobre tu linaje.";
  const all = [
    {
      id: "fast",
      icon: "⚡",
      name: "Patas Rápidas",
      desc: "Mutación que aumenta tu velocidad un 35%.\nIdeal para escapar y explorar.",
      priority: runRatio > 0.3 ? 3 : 1,
    },
    {
      id: "efficient",
      icon: "💧",
      name: "Metabolismo Eficiente",
      desc: "Reduces consumo de energía un 35%.\nSurvives más con menos comida.",
      priority: eatRatio > 8 ? 3 : 2,
    },
    {
      id: "tough",
      icon: "🛡",
      name: "Piel Gruesa",
      desc: "La zona hostil te daña menos.\nResistencia al calor y el frío.",
      priority: getZone(player.x) === "hostile" ? 3 : 1,
    },
  ];

  // Ordena por prioridad y toma los 2 mejores
  all.sort((a, b) => b.priority - a.priority);
  const chosen = all.slice(0, 2);

  if (runRatio > 0.35)
    context = "Corres mucho. La presión natural favorece las patas rápidas.";
  else if (eatRatio > 10)
    context = "Comes mucho. Tu metabolismo puede hacerse más eficiente.";
  else if (getZone(player.x) === "hostile")
    context = "Vives en zona hostil. La selección favorece la resistencia.";

  return { context, choices: chosen };
}

function applyTrait(id) {
  trait = id;
  // Reset stats para siguiente ciclo
  stats = { steps: 0, runs: 0, eats: 0 };
}

// ── CLIMA MENSAJE ─────────────────────────────────────────────
let climateTimeout;
function showClimateMsg(msg) {
  const el = document.getElementById("climate-msg");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(climateTimeout);
  climateTimeout = setTimeout(() => el.classList.add("hidden"), 3000);
}

// ── FIN DE PARTIDA ────────────────────────────────────────────
function endGame() {
  gameActive = false;
  const traitLabels = { normal: "Sin adaptación", fast: "Patas Rápidas ⚡", efficient: "Metabolismo Eficiente 💧", tough: "Piel Gruesa 🛡" };
  document.getElementById("end-stats").innerHTML =
    `Tiempo sobrevivido: <b>${Math.floor(timeAlive)}s</b><br>
     Alimentos comidos: <b>${stats.eats + (stats.eats > 0 ? 0 : 0)}</b><br>
     Adaptación final: <b>${traitLabels[trait] || "Normal"}</b><br>
     Zona al morir: <b>${getZone(player.x) === "safe" ? "Segura" : getZone(player.x) === "scarce" ? "Escasez" : "Hostil"}</b>`;
  showScreen("screen-end");
}

// ── UTILIDADES ────────────────────────────────────────────────
function dist(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

// ── ARRANQUE ──────────────────────────────────────────────────
window.addEventListener("load", init);
