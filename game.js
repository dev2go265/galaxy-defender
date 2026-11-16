// Galaxy Defender — Space Invaders style. Plain canvas JS, no assets.
// Move: Arrows/WASD or drag. Shoot: Space/click/tap. P pause. M mute.
// Clear 3 waves to win. Lose at 0 lives or if aliens reach the ground.
'use strict';

var W = 480, H = 640;
var canvas = document.getElementById('game');
var ctx = canvas.getContext('2d');
var hudScore = document.getElementById('hud-score');
var hudWave = document.getElementById('hud-wave');
var hudLives = document.getElementById('hud-lives');
var startBtn = document.getElementById('start-btn');
var sensSlider = document.getElementById('sensitivity');
var sensValue = document.getElementById('sens-value');

// Crisp canvas on high-DPI screens.
var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
if (dpr > 2) dpr = 2;
canvas.width = W * dpr;
canvas.height = H * dpr;
ctx.scale(dpr, dpr);

var ROW_POINTS = [30, 20, 20, 10, 10];
var TOTAL_WAVES = 3;
var BASE_SHIP_SPEED = 320;

var state = 'title'; // title | playing | paused | gameover | win
var score = 0;
var highScore = 0;
var lives = 3;
var wave = 1;
var sensitivity = 1;
var muted = false;
var fireCooldown = 0;
var alienFireTimer = 1;
var alienDir = 1;
var alienSpeed = 22;
var waveClearTimer = 0;
var invulnTimer = 0;
var elapsed = 0;

try { highScore = parseInt(localStorage.getItem('galaxy-defender-high') || '0', 10) || 0; } catch (e) { highScore = 0; }

var player = { x: W / 2 - 22, y: H - 56, w: 44, h: 26, alive: true };
var bullets = [];      // player bullets {x,y}
var alienBullets = []; // {x,y}
var aliens = [];       // {x,y,w,h,row,alive}
var particles = [];    // {x,y,vx,vy,life,color}
var stars = [];
for (var i = 0; i < 90; i++) {
  stars.push({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.6 + 0.4, tw: Math.random() * 6.28 });
}

var keys = {};
var dragging = false;

// ---------- Audio (WebAudio only, no assets) ----------
var audioCtx = null;
function beep(freq, dur, type, vol) {
  if (muted) return;
  try {
    if (typeof AudioContext === 'undefined' && typeof webkitAudioContext === 'undefined') return;
    if (!audioCtx) audioCtx = new (AudioContext || webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    var o = audioCtx.createOscillator();
    var g = audioCtx.createGain();
    o.type = type || 'square';
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.08, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + dur);
  } catch (e) { /* audio unavailable — game still works */ }
}
function sfx(name) {
  if (name === 'shoot') beep(880, 0.08, 'square', 0.05);
  else if (name === 'hit') { beep(220, 0.15, 'sawtooth', 0.1); beep(110, 0.2, 'square', 0.08); }
  else if (name === 'playerHit') { beep(160, 0.4, 'sawtooth', 0.12); }
  else if (name === 'wave') { beep(523, 0.12, 'sine', 0.1); beep(784, 0.2, 'sine', 0.1); }
  else if (name === 'win') { beep(523, 0.15, 'sine', 0.1); beep(659, 0.15, 'sine', 0.1); beep(784, 0.3, 'sine', 0.1); }
  else if (name === 'lose') { beep(330, 0.3, 'sawtooth', 0.1); beep(165, 0.5, 'sawtooth', 0.1); }
}

// ---------- Setup ----------
function spawnWave(n) {
  aliens = [];
  var cols = 8, rows = 5;
  var aw = 34, ah = 26, gapX = 14, gapY = 16;
  var totalW = cols * aw + (cols - 1) * gapX;
  var startX = (W - totalW) / 2;
  for (var r = 0; r < rows; r++) {
    for (var c = 0; c < cols; c++) {
      aliens.push({ x: startX + c * (aw + gapX), y: 70 + r * (ah + gapY), w: aw, h: ah, row: r, alive: true });
    }
  }
  alienDir = 1;
  alienSpeed = 20 + n * 6;
  alienBullets = [];
  alienFireTimer = 1.2;
}

function resetGame() {
  score = 0; lives = 3; wave = 1;
  player.x = W / 2 - 22; player.alive = true;
  bullets = []; alienBullets = []; particles = [];
  invulnTimer = 0; fireCooldown = 0; waveClearTimer = 0;
  spawnWave(1);
  updateHUD();
}

function startGame() {
  resetGame();
  state = 'playing';
  startBtn.textContent = 'RESTART';
  sfx('wave');
}

function updateHUD() {
  hudScore.textContent = 'SCORE ' + score;
  hudWave.textContent = 'WAVE ' + wave + '/' + TOTAL_WAVES;
  var hearts = '';
  for (var i = 0; i < lives; i++) hearts += '\u2665';
  hudLives.textContent = hearts || '---';
}

function saveHigh() {
  if (score > highScore) {
    highScore = score;
    try { localStorage.setItem('galaxy-defender-high', String(highScore)); } catch (e) {}
  }
}

function gameOver(reason) {
  state = 'gameover';
  saveHigh();
  sfx('lose');
  startBtn.textContent = 'PLAY AGAIN';
  updateHUD();
  if (reason === 'invaded') spawnBurst(player.x + 22, player.y + 13, '#ff5d73', 40);
}

function winGame() {
  state = 'win';
  saveHigh();
  sfx('win');
  startBtn.textContent = 'PLAY AGAIN';
  updateHUD();
}

// ---------- Combat ----------
function shoot() {
  if (state !== 'playing' || fireCooldown > 0 || bullets.length >= 4) return;
  bullets.push({ x: player.x + player.w / 2 - 2, y: player.y - 8, w: 4, h: 14 });
  fireCooldown = 0.22;
  sfx('shoot');
}

function spawnBurst(x, y, color, n) {
  for (var i = 0; i < n; i++) {
    var a = Math.random() * 6.283, sp = 40 + Math.random() * 160;
    particles.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5 + Math.random() * 0.4, color: color });
  }
}

function alienShoot() {
  var alive = aliens.filter(function (a) { return a.alive; });
  if (!alive.length) return;
  // Pick a random column, shoot from its lowest alien.
  var cols = {};
  alive.forEach(function (a) { cols[a.x] = a; });
  var keysArr = Object.keys(cols);
  var pick = cols[keysArr[Math.floor(Math.random() * keysArr.length)]];
  alienBullets.push({ x: pick.x + pick.w / 2 - 2, y: pick.y + pick.h, w: 4, h: 12 });
}

function hitTest(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// ---------- Update ----------
function update(dt) {
  elapsed += dt;
  if (fireCooldown > 0) fireCooldown -= dt;
  if (invulnTimer > 0) invulnTimer -= dt;

  // Ship movement.
  var speed = BASE_SHIP_SPEED * sensitivity;
  if (keys['ArrowLeft'] || keys['a'] || keys['A']) player.x -= speed * dt;
  if (keys['ArrowRight'] || keys['d'] || keys['D']) player.x += speed * dt;
  if (player.x < 4) player.x = 4;
  if (player.x > W - player.w - 4) player.x = W - player.w - 4;

  // Wave cleared?
  var remaining = aliens.filter(function (a) { return a.alive; }).length;
  if (remaining === 0) {
    if (waveClearTimer <= 0) {
      score += 100 * wave;
      sfx('wave');
      waveClearTimer = 1.6;
      updateHUD();
    } else {
      waveClearTimer -= dt;
      if (waveClearTimer <= 0) {
        if (wave >= TOTAL_WAVES) { winGame(); return; }
        wave++;
        spawnWave(wave);
        updateHUD();
      }
    }
    // Still update bullets/particles during the breather.
  } else {
    // Alien formation movement: speed grows as aliens die.
    var step = alienSpeed * (1 + (40 - remaining) / 40);
    var hitEdge = false;
    aliens.forEach(function (a) {
      if (!a.alive) return;
      a.x += alienDir * step * dt;
      if (a.x <= 6 || a.x + a.w >= W - 6) hitEdge = true;
    });
    if (hitEdge) {
      alienDir *= -1;
      aliens.forEach(function (a) { if (a.alive) a.y += 18; });
    }
    // Aliens reached the ground?
    for (var i = 0; i < aliens.length; i++) {
      if (aliens[i].alive && aliens[i].y + aliens[i].h >= player.y + 8) {
        gameOver('invaded');
        return;
      }
    }
    // Alien fire.
    alienFireTimer -= dt;
    if (alienFireTimer <= 0) {
      alienShoot();
      alienFireTimer = Math.max(0.45, 0.95 - wave * 0.08) * (0.7 + Math.random() * 0.6);
    }
  }

  // Player bullets.
  for (var b = bullets.length - 1; b >= 0; b--) {
    bullets[b].y -= 520 * dt;
    if (bullets[b].y < -20) { bullets.splice(b, 1); continue; }
    for (var j = 0; j < aliens.length; j++) {
      var al = aliens[j];
      if (al.alive && hitTest(bullets[b], al)) {
        al.alive = false;
        bullets.splice(b, 1);
        score += ROW_POINTS[al.row];
        spawnBurst(al.x + al.w / 2, al.y + al.h / 2, al.row === 0 ? '#ff5d73' : (al.row < 3 ? '#4de3ff' : '#7dff6a'), 18);
        sfx('hit');
        updateHUD();
        break;
      }
    }
  }

  // Alien bullets.
  for (var k = alienBullets.length - 1; k >= 0; k--) {
    alienBullets[k].y += (250 + wave * 20) * dt;
    if (alienBullets[k].y > H + 20) { alienBullets.splice(k, 1); continue; }
    if (invulnTimer <= 0 && hitTest(alienBullets[k], player)) {
      alienBullets.splice(k, 1);
      lives--;
      updateHUD();
      spawnBurst(player.x + 22, player.y + 13, '#ff5d73', 24);
      sfx('playerHit');
      if (lives <= 0) { gameOver('shot'); return; }
      invulnTimer = 2;
      alienBullets = [];
      break;
    }
  }

  // Particles.
  for (var p = particles.length - 1; p >= 0; p--) {
    particles[p].x += particles[p].vx * dt;
    particles[p].y += particles[p].vy * dt;
    particles[p].life -= dt;
    if (particles[p].life <= 0) particles.splice(p, 1);
  }
}

// ---------- Draw ----------
function drawAlien(a) {
  var cx = a.x + a.w / 2, cy = a.y + a.h / 2;
  ctx.save();
  ctx.shadowBlur = 10;
  if (a.row === 0) { // top: red squid
    ctx.fillStyle = '#ff5d73'; ctx.shadowColor = '#ff5d73';
    ctx.fillRect(a.x + 6, a.y + 2, a.w - 12, 12);
    ctx.fillRect(a.x + 2, a.y + 12, a.w - 4, 6);
    ctx.fillRect(a.x + 6, a.y + 18, 5, 6);
    ctx.fillRect(a.x + a.w - 11, a.y + 18, 5, 6);
  } else if (a.row < 3) { // middle: cyan crab
    ctx.fillStyle = '#4de3ff'; ctx.shadowColor = '#4de3ff';
    ctx.fillRect(a.x + 4, a.y + 4, a.w - 8, 12);
    ctx.fillRect(a.x, a.y + 10, 6, 6);
    ctx.fillRect(a.x + a.w - 6, a.y + 10, 6, 6);
    ctx.fillRect(a.x + 8, a.y + 18, 5, 6);
    ctx.fillRect(a.x + a.w - 13, a.y + 18, 5, 6);
  } else { // bottom: green octopus
    ctx.fillStyle = '#7dff6a'; ctx.shadowColor = '#7dff6a';
    ctx.fillRect(a.x + 8, a.y, a.w - 16, 14);
    ctx.fillRect(a.x + 4, a.y + 12, 6, 10);
    ctx.fillRect(a.x + 14, a.y + 12, 6, 10);
    ctx.fillRect(a.x + a.w - 10, a.y + 12, 6, 10);
  }
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#050510';
  ctx.fillRect(cx - 9, cy - 4, 5, 5);
  ctx.fillRect(cx + 4, cy - 4, 5, 5);
  ctx.restore();
}

function drawShip() {
  if (invulnTimer > 0 && Math.floor(elapsed * 10) % 2 === 0) return; // blink
  var cx = player.x + player.w / 2;
  ctx.save();
  ctx.shadowColor = '#4de3ff'; ctx.shadowBlur = 14;
  ctx.fillStyle = '#4de3ff';
  ctx.beginPath();
  ctx.moveTo(cx, player.y);
  ctx.lineTo(player.x + player.w, player.y + player.h);
  ctx.lineTo(player.x + player.w - 8, player.y + player.h - 6);
  ctx.lineTo(player.x + 8, player.y + player.h - 6);
  ctx.lineTo(player.x, player.y + player.h);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffe14d';
  ctx.beginPath(); ctx.arc(cx, player.y + 12, 4, 0, 6.283); ctx.fill();
  ctx.restore();
}

function drawTextCenter(text, y, size, color, glow) {
  ctx.save();
  ctx.font = 'bold ' + size + 'px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = color;
  if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 16; }
  ctx.fillText(text, W / 2, y);
  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  var g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0a0a24');
  g.addColorStop(1, '#070718');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // Stars.
  ctx.save();
  for (var s = 0; s < stars.length; s++) {
    var st = stars[s];
    ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(elapsed + st.tw));
    ctx.fillStyle = '#cfe8ff';
    ctx.fillRect(st.x, st.y, st.r, st.r);
  }
  ctx.restore();

  if (state === 'title') {
    drawTextCenter('GALAXY DEFENDER', 150, 34, '#4de3ff', true);
    drawTextCenter('Shoot the aliens. Clear 3 waves.', 200, 16, '#e8f4ff', false);
    drawTextCenter('Move: Arrows / WASD or drag', 250, 15, '#9fd8ff', false);
    drawTextCenter('Shoot: Space / click / tap', 278, 15, '#9fd8ff', false);
    drawTextCenter('P pause   M mute', 306, 15, '#9fd8ff', false);
    drawTextCenter('Sensitivity slider below adjusts', 334, 15, '#9fd8ff', false);
    drawTextCenter('ship speed live.', 356, 15, '#9fd8ff', false);
    drawTextCenter('Press ENTER or tap START', 420, 18, '#ffe14d', true);
    if (highScore > 0) drawTextCenter('HIGH SCORE ' + highScore, 470, 15, '#ffe14d', false);
    return;
  }

  // Ground line.
  ctx.save();
  ctx.strokeStyle = '#1a3a6b'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, player.y + player.h + 14); ctx.lineTo(W, player.y + player.h + 14); ctx.stroke();
  ctx.restore();

  aliens.forEach(function (a) { if (a.alive) drawAlien(a); });
  drawShip();

  ctx.save();
  ctx.shadowBlur = 8;
  bullets.forEach(function (b) {
    ctx.fillStyle = '#ffe14d'; ctx.shadowColor = '#ffe14d';
    ctx.fillRect(b.x, b.y, b.w, b.h);
  });
  alienBullets.forEach(function (b) {
    ctx.fillStyle = '#ff5d73'; ctx.shadowColor = '#ff5d73';
    ctx.fillRect(b.x, b.y, b.w, b.h);
  });
  particles.forEach(function (p) {
    ctx.globalAlpha = Math.max(0, p.life * 2);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
  });
  ctx.restore();

  if (state === 'paused') {
    ctx.fillStyle = 'rgba(5,5,16,0.7)';
    ctx.fillRect(0, 0, W, H);
    drawTextCenter('PAUSED', 300, 36, '#ffe14d', true);
    drawTextCenter('P to resume', 340, 16, '#e8f4ff', false);
  } else if (state === 'gameover') {
    ctx.fillStyle = 'rgba(5,5,16,0.7)';
    ctx.fillRect(0, 0, W, H);
    drawTextCenter('GAME OVER', 280, 36, '#ff5d73', true);
    drawTextCenter('SCORE ' + score + '   HIGH ' + highScore, 330, 18, '#e8f4ff', false);
    drawTextCenter('Press ENTER to play again', 380, 16, '#ffe14d', false);
  } else if (state === 'win') {
    ctx.fillStyle = 'rgba(5,5,16,0.7)';
    ctx.fillRect(0, 0, W, H);
    drawTextCenter('YOU WIN!', 280, 36, '#7dff6a', true);
    drawTextCenter('All 3 waves cleared!', 320, 18, '#e8f4ff', false);
    drawTextCenter('SCORE ' + score + '   HIGH ' + highScore, 355, 18, '#e8f4ff', false);
    drawTextCenter('Press ENTER to play again', 400, 16, '#ffe14d', false);
  }
}

// ---------- Main loop ----------
var lastTs = 0;
function loop(ts) {
  requestAnimationFrame(loop);
  var dt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016);
  lastTs = ts;
  if (state === 'playing') update(dt);
  else elapsed += dt;
  draw();
}
requestAnimationFrame(loop);
updateHUD();

// ---------- Input ----------
function canvasX(clientX) {
  var rect = canvas.getBoundingClientRect();
  return (clientX - rect.left) * (W / rect.width);
}
function moveShipTo(clientX) {
  player.x = canvasX(clientX) - player.w / 2;
  if (player.x < 4) player.x = 4;
  if (player.x > W - player.w - 4) player.x = W - player.w - 4;
}

window.addEventListener('keydown', function (e) {
  keys[e.key] = true;
  if (e.key === ' ') e.preventDefault();
  if (e.key === 'Enter') {
    if (state === 'title' || state === 'gameover' || state === 'win') startGame();
  } else if (e.key === ' ' || e.key === 'Spacebar') {
    if (state === 'title' || state === 'gameover' || state === 'win') startGame();
    else shoot();
  } else if (e.key === 'p' || e.key === 'P') {
    if (state === 'playing') { state = 'paused'; }
    else if (state === 'paused') { state = 'playing'; }
  } else if (e.key === 'm' || e.key === 'M') {
    muted = !muted;
  }
});
window.addEventListener('keyup', function (e) { keys[e.key] = false; });

canvas.addEventListener('pointerdown', function (e) {
  e.preventDefault();
  if (state === 'title' || state === 'gameover' || state === 'win') { startGame(); return; }
  if (state !== 'playing') return;
  dragging = true;
  moveShipTo(e.clientX);
  shoot();
});
canvas.addEventListener('pointermove', function (e) {
  if (dragging && state === 'playing') moveShipTo(e.clientX);
});
canvas.addEventListener('pointerup', function () { dragging = false; });
canvas.addEventListener('pointercancel', function () { dragging = false; });

startBtn.addEventListener('click', function () {
  if (state === 'playing' || state === 'paused') { startGame(); }
  else startGame();
});

sensSlider.addEventListener('input', function () {
  sensitivity = parseFloat(sensSlider.value);
  sensValue.textContent = sensitivity.toFixed(1) + 'x';
});

// Test/debug handle (used by the headless smoke test; harmless in the browser).
window.__galaxy = {
  get state() { return state; },
  get score() { return score; },
  get lives() { return lives; },
  get wave() { return wave; },
  get sensitivity() { return sensitivity; },
  player: player,
  get aliens() { return aliens; },
  get bullets() { return bullets; },
  get alienBullets() { return alienBullets; },
  start: startGame,
  shoot: shoot,
  setLives: function (n) { lives = n; updateHUD(); },
  clearAliens: function () { aliens.forEach(function (a) { a.alive = false; }); },
  dropAlien: function () { var a = aliens.find(function (x) { return x.alive; }); if (a) a.y = player.y; }
};
