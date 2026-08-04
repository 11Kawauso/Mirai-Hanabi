(() => {
  const GAME_W = 480, GAME_H = 800;
  const PLAYER_Y = GAME_H * 0.62;
  const PIXELS_PER_METER = 6;
  const PLAY_LEFT = 26, PLAY_RIGHT = GAME_W - 26; // side walls: hit them and it's over
  const LAUNCH_Y = GAME_H - 54; // cannon mouth height
  const LAUNCH_DURATION = 0.85;
  const VERTICAL_RANGE = 46; // small up/down wiggle room around the usual flight line
  const MOVE_SPEED_X = 260;
  const MOVE_SPEED_Y = 130;
  const CANNON_TOP_OFFSET = 74; // muzzle rim sits this far above the cannon's base line
  const BOOST_DURATION = 1.2;   // how long the muzzle kick keeps pushing after firing
  const BOOST_EXTRA = 340;      // px/s piled on top of cruise speed at t=0, eased to 0

  // Wind. A signed speed in m/s (negative = blowing left) that never sits still:
  // it eases toward a fresh target every dozen-odd seconds, and that target is
  // sometimes dead calm.
  const WIND_START = 3.0;        // seconds after firing before wind starts and the gauge appears
  const WIND_MAX = 5;            // m/s
  const WIND_PX_PER_MS = 22;     // px/s of sideways drift per m/s -> 5m/s is 110px/s vs the shot's 260
  const WIND_EASE = 0.55;        // m/s the wind is allowed to change per second
  const WIND_CALM_CHANCE = 0.25; // how often a new target is "no wind at all"
  // Each cloud catches the wind a bit differently. Always positive, so a cloud
  // never sails against the wind — only slower or faster than its neighbours.
  const WIND_FACTOR_MIN = 0.65, WIND_FACTOR_MAX = 1.35;
  function randomWindFactor(){ return WIND_FACTOR_MIN + Math.random()*(WIND_FACTOR_MAX-WIND_FACTOR_MIN); }
  // A cloud wall can only shift its gap so far before the gap would leave the
  // lane entirely, so it leans into the wind less and coasts to a stop near the
  // edges rather than hitting the limit and freezing on the spot.
  const WALL_WIND_SCALE = 0.35;
  const WALL_EDGE_EASE = 70; // px of runway over which the gap eases to a halt
  // Clear sky kept above and below a cloud wall. Floor in px so it always looks
  // like a corridor; scaled by speed so it's always ~1.1s of reaction time.
  const WALL_CLEAR_MIN = 160, WALL_CLEAR_SEC = 1.1;

  const wrap = document.getElementById('wrap');
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // Draw at the device's real pixel density so the shot stays crisp on phones.
  // The backing store grows, but every draw call below still works in 480x800 units.
  function resizeCanvas(){
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(GAME_W * dpr);
    canvas.height = Math.round(GAME_H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('orientationchange', resizeCanvas);

  const hudHeight = document.getElementById('hud-height');
  const hudBest = document.getElementById('hud-best');
  const startScreen = document.getElementById('start-screen');
  const resultScreen = document.getElementById('result-screen');
  const resultHeight = document.getElementById('result-height');
  const resultBest = document.getElementById('result-best');
  const startBtn = document.getElementById('start-btn');
  const retryBtn = document.getElementById('retry-btn');
  const skinRows = [...document.querySelectorAll('[data-skin-picker]')];
  const skinNames = [...document.querySelectorAll('[data-skin-name]')];
  const skinUnlockMsg = document.getElementById('skin-unlock');

  // ---- saved data ----------------------------------------------------------
  // Wrapped: localStorage throws in private mode and on some file:// origins,
  // and a skin picker is not worth taking the whole game down for.
  const STORE_BEST = 'mirai-hanabi.best';
  const STORE_SKIN = 'mirai-hanabi.skin';
  function load(key, fallback){
    try{
      const v = localStorage.getItem(key);
      return v === null ? fallback : v;
    }catch(e){ return fallback; }
  }
  function save(key, value){
    try{ localStorage.setItem(key, value); }catch(e){ /* nothing we can do */ }
  }

  let bestHeightM = Math.max(0, parseFloat(load(STORE_BEST, '0')) || 0);
  let bestBeforeRun = bestHeightM; // to spot skins unlocked by the run just finished

  // ---- skins ---------------------------------------------------------------
  // Purely cosmetic: shot colour, exhaust trail, and the burst it opens into.
  // Unlocked by best height so there's a reason to keep climbing.
  const SKINS = [
    { id:'mirai', name:'ミライ', unlock:0,
      core:'#fff6d8', glow:'#ffd23f',
      trailFrom:'rgba(255,210,63,0.55)', trailTo:'rgba(255,120,40,0)',
      palette:['#ff2fb0','#29f1ff','#7b2ff7','#ffd23f','#ff6b6b','#5eead4'], burst:1 },

    { id:'sousei', name:'蒼星', unlock:300,
      core:'#e8fbff', glow:'#29f1ff',
      trailFrom:'rgba(41,241,255,0.55)', trailTo:'rgba(60,120,255,0)',
      palette:['#29f1ff','#5eead4','#7bdcff','#a5b4fc','#e8fbff','#3b82f6'], burst:1 },

    { id:'shakudama', name:'正三尺玉', unlock:600,
      core:'#fff3cf', glow:'#ffb14a',
      trailFrom:'rgba(255,177,74,0.6)', trailTo:'rgba(255,90,20,0)',
      palette:['#ffd23f','#ffb14a','#ff8a3d','#fff3cf','#ffe08a','#ff6b2c'], burst:1.35 },

    { id:'phoenix', name:'フェニックス', unlock:1000,
      core:'#fff0f0', glow:'#ff4d4d',
      trailFrom:'rgba(255,77,77,0.6)', trailTo:'rgba(255,180,40,0)',
      palette:['#ff2f2f','#ff6b6b','#ff9f1c','#ffd23f','#ff2fb0','#fff0f0'], burst:1.2 },

    { id:'gokusai', name:'極彩', unlock:1500,
      core:'#ffffff', glow:'#ff2fb0',
      trailFrom:'rgba(255,47,176,0.6)', trailTo:'rgba(123,47,247,0)',
      palette:['#ff2fb0','#7b2ff7','#29f1ff','#c084fc','#f0abfc','#22d3ee'], burst:1.5 }
  ];

  let skinIndex = Math.min(SKINS.length-1, Math.max(0, parseInt(load(STORE_SKIN, '0'), 10) || 0));
  // a cleared best must not leave a locked skin equipped
  if(bestHeightM < SKINS[skinIndex].unlock) skinIndex = 0;
  function skin(){ return SKINS[skinIndex]; }
  function isUnlocked(s){ return bestHeightM >= s.unlock; }

  function selectSkin(i){
    if(!isUnlocked(SKINS[i])) return;
    skinIndex = i;
    save(STORE_SKIN, String(i));
    renderSkins();
  }

  function renderSkins(){
    for(const row of skinRows){
      row.textContent = '';
      SKINS.forEach((s, i) => {
        const open = isUnlocked(s);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'skin-dot' + (i === skinIndex ? ' on' : '') + (open ? '' : ' locked');
        b.style.setProperty('--core', s.core);
        b.style.setProperty('--glow', s.glow);
        b.disabled = !open;
        b.setAttribute('aria-label', open ? s.name : `${s.name}（${s.unlock}m で解放）`);
        if(!open) b.textContent = s.unlock + 'm';
        b.addEventListener('click', () => selectSkin(i));
        row.appendChild(b);
      });
    }
    for(const el of skinNames) el.textContent = SKINS[skinIndex].name;
  }

  const STAGES = [
    { minH: 0,    top:'#050914', bottom:'#131a2c', grid:0.0, stars:0.15, cityAlpha:1.0 },
    { minH: 120,  top:'#0d1730', bottom:'#22314f', grid:0.0, stars:0.3,  cityAlpha:0.0 },
    { minH: 550,  top:'#171040', bottom:'#3a1f63', grid:0.35,stars:0.55, cityAlpha:0.0 },
    { minH: 1000, top:'#120a30', bottom:'#4a1f74', grid:0.7, stars:0.75, cityAlpha:0.0 },
    { minH: 1600, top:'#08051c', bottom:'#1c0a3a', grid:1.0, stars:1.0,  cityAlpha:0.0 }
  ];

  function lerp(a,b,t){ return a + (b-a)*t; }
  function clamp(v,lo,hi){ return Math.max(lo, Math.min(hi, v)); }
  function stepToward(delta, maxStep){ return clamp(delta, -maxStep, maxStep); }
  function hexToRgb(hex){
    const v = parseInt(hex.slice(1),16);
    return [(v>>16)&255, (v>>8)&255, v&255];
  }
  function lerpColor(hexA, hexB, t){
    const a = hexToRgb(hexA), b = hexToRgb(hexB);
    const r = Math.round(lerp(a[0],b[0],t));
    const g = Math.round(lerp(a[1],b[1],t));
    const bl = Math.round(lerp(a[2],b[2],t));
    return `rgb(${r},${g},${bl})`;
  }
  function getStage(heightM){
    let cur = STAGES[0], next = STAGES[STAGES.length-1], t = 1;
    for(let i=0;i<STAGES.length;i++){
      if(heightM >= STAGES[i].minH){
        cur = STAGES[i];
        next = STAGES[i+1] || STAGES[i];
        const range = (next.minH - cur.minH) || 1;
        t = Math.min(1, (heightM - cur.minH) / range);
      }
    }
    return { cur, next, t };
  }

  let state = 'start'; // start | playing | exploding | result
  let heightM = 0;
  let scrollSpeed = 0;
  let spawnTimer = 0;
  let obstacles = [];
  let particles = [];
  let stars = [];
  let elapsed = 0;

  const player = { x: GAME_W/2, y: LAUNCH_Y, vx: 0, r: 9 };
  let keyLeft = false, keyRight = false;
  let moveUp = false, moveDown = false;
  // drag steering: where the finger is asking the shot to go (null = not dragging)
  let dragTargetX = null, dragTargetY = null;
  let dragPointerId = null;
  let lastPointer = null;
  let launchTimer = 0;
  let muzzleParticles = [];
  let cloudWallTimer = 6;
  let wallPending = false; // a wall is due and is waiting for a clear corridor
  let currentZoom = 1, zoomTarget = 1;
  let boost = 0; // 1 right after firing, eased to 0 over BOOST_DURATION
  let windSpeed = 0;   // signed m/s, negative = left
  let windTarget = 0;
  let windTimer = 0;   // until the next target is rolled
  let windVisible = 0; // 0..1 fade of the bottom gauge

  for(let i=0;i<70;i++){
    stars.push({ x: Math.random()*GAME_W, y: Math.random()*GAME_H, r: Math.random()*1.6+0.4, tw: Math.random()*6.28 });
  }

  // streaks that rush past during the boost — the only thing that actually sells
  // speed, since the shot itself is pinned to a fixed height on screen
  const speedLines = [];
  for(let i=0;i<22;i++) speedLines.push({ x:0, y:0, len:0, spd:0, alpha:0 });
  function scatterSpeedLines(){
    for(const l of speedLines){
      l.x = Math.random()*GAME_W;
      l.y = Math.random()*GAME_H;
      l.len = 50 + Math.random()*110;
      l.spd = 1.5 + Math.random()*1.6; // parallax: nearer streaks fly by faster
      l.alpha = 0.25 + Math.random()*0.4;
    }
  }
  scatterSpeedLines();

  function reset(){
    state = 'launching';
    bestBeforeRun = bestHeightM;
    skinUnlockMsg.classList.add('hidden');
    launchTimer = 0;
    heightM = 0;
    scrollSpeed = 90;
    spawnTimer = 1.0;
    cloudWallTimer = 5 + Math.random()*3;
    wallPending = false;
    currentZoom = 1;
    zoomTarget = 1;
    obstacles = [];
    particles = [];
    muzzleParticles = [];
    elapsed = 0;
    player.x = GAME_W/2;
    player.y = LAUNCH_Y;
    player.vx = 0;
    clearDrag();
    boost = 1;
    windSpeed = 0; // every run starts calm, then builds once the gauge appears
    windTarget = 0;
    windTimer = 0;
    windVisible = 0;
    scatterSpeedLines();
    hudHeight.textContent = '0m'; // else the previous run's height lingers through the launch animation
    startScreen.classList.add('hidden');
    resultScreen.classList.add('hidden');
    spawnMuzzleFlash();
  }

  function spawnMuzzleFlash(){
    const pal = skin().palette;
    for(let i=0;i<26;i++){
      const angle = -Math.PI/2 + (Math.random()-0.5)*1.1;
      const speed = 80 + Math.random()*160;
      muzzleParticles.push({
        x: player.x, y: LAUNCH_Y+6,
        vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed,
        r: 2+Math.random()*3,
        life: 0.35+Math.random()*0.25, maxLife: 0.5,
        color: pal[Math.floor(Math.random()*pal.length)]
      });
    }
  }

  function weightedObstacleType(){
    const pool = [{t:'cloud', w:5}];
    if(heightM > 300) pool.push({t:'debris', w:3});
    if(heightM > 600) pool.push({t:'bird', w:3});
    const total = pool.reduce((s,p)=>s+p.w,0);
    let r = Math.random()*total;
    for(const p of pool){ if(r < p.w) return p.t; r -= p.w; }
    return 'cloud';
  }

  // Free clouds and wall slabs both fall at exactly scrollSpeed, so the vertical
  // gap they have at spawn is the gap they keep forever. Enforcing it once here
  // is enough to guarantee the wall's opening never gets corked.
  function wallClearance(){ return Math.max(WALL_CLEAR_MIN, scrollSpeed*WALL_CLEAR_SEC); }
  function cloudNear(y, dist, wantWall){
    for(const o of obstacles){
      if(o.type !== 'cloud' || !!o.wall !== wantWall) continue;
      if(Math.abs(o.y - y) < dist) return true;
    }
    return false;
  }

  function spawnObstacle(){
    const type = weightedObstacleType();
    if(type === 'cloud'){
      // hold off while a wall is due, otherwise newly spawned clouds keep
      // refilling the corridor and the wall can never find room to appear
      if(wallPending) return;
      if(cloudNear(-60, wallClearance(), true)) return;
      const w = 70 + Math.random()*70;
      obstacles.push({ type, x: Math.random()*(GAME_W-w), y: -60, w, h: 42 + Math.random()*18, windFactor: randomWindFactor() });
    } else if(type === 'debris'){
      obstacles.push({ type, x: Math.random()*(GAME_W-14), y:-20, w:14, h:14, vx:(Math.random()*2-1)*60, extraVy: 130 });
    } else if(type === 'bird'){
      obstacles.push({ type, x: Math.random()*(GAME_W-34), y:-24, w:34, h:20, baseX: 0, t0: elapsed });
      obstacles[obstacles.length-1].baseX = obstacles[obstacles.length-1].x;
    }
  }

  function spawnCloudWall(){
    const gapW = Math.max(88, 150 - heightM/40);
    const gapX = PLAY_LEFT + Math.random()*((PLAY_RIGHT-PLAY_LEFT) - gapW);
    const h = 46;
    // Both slabs always exist, even at zero width, so that a gap which starts
    // flush against one edge still has a slab there to grow once wind moves it.
    // They share one wind factor — differing ones would stretch the gap apart.
    const windFactor = randomWindFactor();
    obstacles.push({ type:'cloud', x: PLAY_LEFT, y:-70, w: gapX-PLAY_LEFT, h, wall:true, side:'left', gapX, gapW, windFactor });
    const rightStart = gapX+gapW;
    obstacles.push({ type:'cloud', x: rightStart, y:-70, w: PLAY_RIGHT-rightStart, h, wall:true, side:'right', gapX, gapW, windFactor });
  }

  function circleRectHit(cx, cy, cr, rx, ry, rw, rh){
    const nx = Math.max(rx, Math.min(cx, rx+rw));
    const ny = Math.max(ry, Math.min(cy, ry+rh));
    const dx = cx-nx, dy = cy-ny;
    return (dx*dx+dy*dy) < cr*cr;
  }

  function triggerExplosion(){
    state = 'exploding';
    const sk = skin();
    const scale = Math.min(2.6, 1 + heightM/1100) * sk.burst;
    const count = Math.min(150, 28 + heightM/9) * sk.burst;
    zoomTarget = Math.max(0.25, 1 - scale*0.32); // bigger blast, more the world shrinks away
    for(let i=0;i<count;i++){
      const angle = Math.random()*Math.PI*2;
      const speed = (90 + Math.random()*220) * (0.6 + scale*0.5);
      particles.push({
        x: player.x, y: player.y,
        vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed,
        r: (2 + Math.random()*4) * scale,
        life: 0.9 + Math.random()*0.7,
        maxLife: 0.9 + Math.random()*0.7,
        color: sk.palette[Math.floor(Math.random()*sk.palette.length)]
      });
    }
    if(heightM > bestHeightM){
      bestHeightM = heightM;
      save(STORE_BEST, String(Math.floor(bestHeightM)));
    }
  }

  function endToResult(){
    state = 'result';
    resultHeight.textContent = Math.floor(heightM) + 'm';
    resultBest.textContent = '自己ベスト ' + Math.floor(bestHeightM) + 'm';
    hudBest.textContent = Math.floor(bestHeightM) + 'm';

    // anything this run just put within reach?
    const opened = SKINS.filter(s => s.unlock > 0 && bestBeforeRun < s.unlock && bestHeightM >= s.unlock);
    if(opened.length){
      skinUnlockMsg.textContent = '新しいスキン「' + opened.map(s=>s.name).join('」「') + '」を解放！';
      skinUnlockMsg.classList.remove('hidden');
    } else {
      skinUnlockMsg.classList.add('hidden');
    }
    renderSkins(); // unlock states may have changed
    resultScreen.classList.remove('hidden');
  }

  let explodeTimer = 0;

  function update(dt){
    elapsed += dt;

    // the gauge only belongs on screen while you're actually flying
    const wantGauge = (state === 'playing' && elapsed >= WIND_START);
    windVisible = clamp(windVisible + (wantGauge ? dt*1.6 : -dt*3), 0, 1);

    // muzzle-flash sparks animate no matter what state we're in
    for(let i=muzzleParticles.length-1;i>=0;i--){
      const p = muzzleParticles[i];
      p.x += p.vx*dt; p.y += p.vy*dt;
      p.vy += 260*dt;
      p.life -= dt;
      if(p.life <= 0) muzzleParticles.splice(i,1);
    }

    if(state === 'launching'){
      launchTimer += dt;
      const t = Math.min(1, launchTimer / LAUNCH_DURATION);
      const eased = 1 - Math.pow(1-t, 3);
      player.y = LAUNCH_Y + (PLAYER_Y - LAUNCH_Y) * eased;
      player.x = GAME_W/2 + Math.sin(t*10) * (1-t) * 4;
      if(t >= 1){
        player.y = PLAYER_Y;
        state = 'playing';
        // a finger held through the launch animation shouldn't yank the shot on the first frame
        if(dragPointerId !== null){ dragTargetX = player.x; dragTargetY = player.y; }
      }
    }

    // The world scrolls from the moment of firing, launch animation included.
    // Without this the first 0.85s is a dead-still screen and the shot reads as
    // floating rather than being flung out of a cannon.
    if(state === 'launching' || state === 'playing'){
      boost = Math.pow(1 - Math.min(1, elapsed/BOOST_DURATION), 2); // ease-out
      // speed increases very gradually with time survived, not with height directly
      scrollSpeed = Math.min(230, 90 + elapsed*1.0) + boost*BOOST_EXTRA;
      heightM += (scrollSpeed*dt) / PIXELS_PER_METER;
      hudHeight.textContent = Math.floor(heightM) + 'm';

      for(const l of speedLines){
        l.y += scrollSpeed * l.spd * dt;
        if(l.y - l.len > GAME_H){ // recycle off the top once it has fully passed
          l.y = -Math.random()*120;
          l.x = Math.random()*GAME_W;
        }
      }
    } else {
      boost = 0;
    }

    if(state === 'playing'){
      // keyboard wins while a key is held; otherwise the shot chases the drag target,
      // capped at the same speed so touch is never easier than keys
      let vx = 0;
      if(keyLeft) vx -= MOVE_SPEED_X;
      if(keyRight) vx += MOVE_SPEED_X;
      if(vx !== 0) player.x += vx*dt;
      else if(dragTargetX !== null) player.x += stepToward(dragTargetX - player.x, MOVE_SPEED_X*dt);

      let vy = 0;
      if(moveUp) vy -= MOVE_SPEED_Y;
      if(moveDown) vy += MOVE_SPEED_Y;
      if(vy !== 0) player.y += vy*dt;
      else if(dragTargetY !== null) player.y += stepToward(dragTargetY - player.y, MOVE_SPEED_Y*dt);
      player.y = clamp(player.y, PLAYER_Y-VERTICAL_RANGE, PLAYER_Y+VERTICAL_RANGE);

      spawnTimer -= dt;
      if(spawnTimer <= 0){
        spawnObstacle();
        spawnTimer = Math.max(0.45, 1.15 - elapsed*0.01);
      }

      cloudWallTimer -= dt;
      if(cloudWallTimer <= 0) wallPending = true;
      // wait for a clear corridor before dropping the wall in. Cloud spawning is
      // paused while pending, so the strays always fall clear within ~2s.
      if(wallPending && !cloudNear(-70, wallClearance(), false)){
        spawnCloudWall();
        wallPending = false;
        cloudWallTimer = 8 + Math.random()*6;
      }

      if(elapsed >= WIND_START){
        windTimer -= dt;
        if(windTimer <= 0){
          windTarget = Math.random() < WIND_CALM_CHANCE
            ? 0
            : (Math.random() < 0.5 ? -1 : 1) * (1 + Math.random()*(WIND_MAX-1));
          windTimer = 12 + Math.random()*13;
        }
        // eased, never snapped: the gauge needle is always creeping somewhere
        windSpeed += stepToward(windTarget - windSpeed, WIND_EASE*dt);
      }
      const windPx = windSpeed * WIND_PX_PER_MS;

      player.x += windPx*dt;
      // the drag target has to ride the wind too, otherwise a held finger keeps
      // steering back to its old spot and silently cancels the drift out
      if(dragTargetX !== null) dragTargetX = clamp(dragTargetX + windPx*dt, 0, GAME_W);

      for(let i=obstacles.length-1;i>=0;i--){
        const o = obstacles[i];
        if(o.type === 'debris'){
          o.y += scrollSpeed*1.6*dt;
          o.x += o.vx*dt;
        } else if(o.type === 'bird'){
          o.y += scrollSpeed*dt;
          o.x = o.baseX + Math.sin((elapsed - o.t0)*3.2)*60;
        } else {
          o.y += scrollSpeed*dt;
          const drift = windPx * o.windFactor * dt;
          if(o.wall){
            // Slide the gap, not the slabs. Drifting the whole wall would tear a
            // free hole open at whichever side edge it pulled away from.
            let d = drift * WALL_WIND_SCALE;
            // Bleed the drift off over the last stretch of runway. The gap then
            // settles against the edge asymptotically instead of running full
            // speed into the clamp and stopping dead the frame it arrives.
            const room = d > 0 ? (PLAY_RIGHT - o.gapW - o.gapX) : (o.gapX - PLAY_LEFT);
            d *= clamp(room / WALL_EDGE_EASE, 0, 1);
            o.gapX = clamp(o.gapX + d, PLAY_LEFT, PLAY_RIGHT - o.gapW);
            if(o.side === 'left'){ o.x = PLAY_LEFT; o.w = o.gapX - PLAY_LEFT; }
            else { o.x = o.gapX + o.gapW; o.w = PLAY_RIGHT - o.x; }
          } else {
            o.x += drift;
          }
        }

        if(o.w > 1 && circleRectHit(player.x, player.y, player.r, o.x, o.y, o.w, o.h)){
          triggerExplosion();
        }

        if(o.y > GAME_H + 100) obstacles.splice(i,1);
      }

      if(state === 'playing'){
        if(player.x - player.r <= PLAY_LEFT){
          player.x = PLAY_LEFT + player.r;
          triggerExplosion();
        } else if(player.x + player.r >= PLAY_RIGHT){
          player.x = PLAY_RIGHT - player.r;
          triggerExplosion();
        }
      }
    }

    if(state === 'exploding'){
      currentZoom += (zoomTarget - currentZoom) * Math.min(1, dt*5);
      explodeTimer += dt;
      for(let i=particles.length-1;i>=0;i--){
        const p = particles[i];
        p.vy += 220*dt;
        p.x += p.vx*dt;
        p.y += p.vy*dt;
        p.life -= dt;
        if(p.life <= 0) particles.splice(i,1);
      }
      if(explodeTimer > 1.7 || particles.length === 0){
        explodeTimer = 0;
        endToResult();
      }
    }
  }

  function drawSky(){
    const { cur, next, t } = getStage(heightM);
    const top = lerpColor(cur.top, next.top, t);
    const bottom = lerpColor(cur.bottom, next.bottom, t);
    const grad = ctx.createLinearGradient(0,0,0,GAME_H);
    grad.addColorStop(0, top);
    grad.addColorStop(1, bottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0,0,GAME_W,GAME_H);
  }

  function drawBackgroundDetails(){
    const { cur, next, t } = getStage(heightM);

    const starDensity = lerp(cur.stars, next.stars, t);
    ctx.save();
    for(const s of stars){
      const tw = 0.55 + 0.45*Math.sin(elapsed*2 + s.tw);
      ctx.globalAlpha = starDensity * tw;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.restore();

    const gridAmt = lerp(cur.grid, next.grid, t);
    if(gridAmt > 0.01){
      ctx.save();
      ctx.globalAlpha = gridAmt * 0.5;
      ctx.strokeStyle = '#29f1ff';
      ctx.lineWidth = 1;
      const spacing = 34;
      const offset = (elapsed*40) % spacing;
      for(let y = GAME_H - offset; y > GAME_H*0.35; y -= spacing){
        ctx.beginPath();
        ctx.moveTo(0,y);
        ctx.lineTo(GAME_W,y);
        ctx.stroke();
      }
      ctx.globalAlpha = gridAmt * 0.35;
      for(let x=-GAME_W; x<GAME_W*2; x+=48){
        ctx.beginPath();
        ctx.moveTo(GAME_W/2 + (x-GAME_W/2)*0.2, GAME_H*0.35);
        ctx.lineTo(x, GAME_H);
        ctx.stroke();
      }
      ctx.restore();
    }

    const buildings = [75,150,105,215,120,175,90,235,110,160];
    const cityDrop = heightM * PIXELS_PER_METER; // sinks away at the same rate the world scrolls past
    const maxBuildingH = Math.max(...buildings);
    if(cityDrop < GAME_H + maxBuildingH + 40){
      ctx.save();
      ctx.fillStyle = '#020208';
      let x = 0;
      const bw = GAME_W / buildings.length;
      for(const h of buildings){
        ctx.fillRect(x, GAME_H - h + cityDrop, bw-3, h);
        x += bw;
      }
      ctx.fillStyle = 'rgba(255,190,90,0.65)';
      for(let i=0;i<14;i++){
        ctx.fillRect((i*bw*0.7)%GAME_W + 6, GAME_H-20-Math.random()*60 + cityDrop, 3, 3);
      }
      ctx.restore();
    }
  }

  function drawSpeedLines(){
    if(boost <= 0.02) return;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for(const l of speedLines){
      // tapered so each streak reads as a trail rather than a floating stick
      const grad = ctx.createLinearGradient(l.x, l.y - l.len, l.x, l.y);
      grad.addColorStop(0, 'rgba(210,240,255,0)');
      grad.addColorStop(1, `rgba(210,240,255,${(boost*l.alpha).toFixed(3)})`);
      ctx.strokeStyle = grad;
      ctx.beginPath();
      ctx.moveTo(l.x, l.y - l.len);
      ctx.lineTo(l.x, l.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawWalls(){
    const wallW = PLAY_LEFT;
    ctx.save();
    const glowL = ctx.createLinearGradient(0,0,wallW,0);
    glowL.addColorStop(0, 'rgba(255,47,176,0.55)');
    glowL.addColorStop(1, 'rgba(255,47,176,0)');
    ctx.fillStyle = glowL;
    ctx.fillRect(0,0,wallW,GAME_H);
    const glowR = ctx.createLinearGradient(GAME_W,0,GAME_W-wallW,0);
    glowR.addColorStop(0, 'rgba(255,47,176,0.55)');
    glowR.addColorStop(1, 'rgba(255,47,176,0)');
    ctx.fillStyle = glowR;
    ctx.fillRect(GAME_W-wallW,0,wallW,GAME_H);
    ctx.strokeStyle = 'rgba(255,47,176,0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(PLAY_LEFT,0); ctx.lineTo(PLAY_LEFT,GAME_H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(PLAY_RIGHT,0); ctx.lineTo(PLAY_RIGHT,GAME_H); ctx.stroke();
    ctx.restore();
  }

  function drawCannon(){
    // rides the world scroll exactly like the city below, so it slides out of
    // frame with everything else instead of vanishing the instant flight starts
    const drop = heightM * PIXELS_PER_METER;
    const cx = GAME_W/2, baseY = GAME_H-4 + drop;
    if(baseY - CANNON_TOP_OFFSET > GAME_H) return; // fully below the frame
    ctx.save();
    ctx.fillStyle = '#1b1830';
    ctx.beginPath();
    ctx.ellipse(cx, baseY, 50, 14, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = '#242042';
    roundRect(cx-30, baseY-64, 60, 64, 14);
    ctx.fill();
    ctx.fillStyle = '#05040f';
    ctx.beginPath();
    ctx.ellipse(cx, baseY-64, 26, 10, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(41,241,255,0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(cx, baseY-64, 26, 10, 0, 0, Math.PI*2);
    ctx.stroke();
    ctx.restore();
  }

  function drawObstacles(){
    for(const o of obstacles){
      if(o.type === 'cloud'){
        if(o.w <= 1) continue; // a wall slab squeezed to nothing by the drifting gap
        ctx.fillStyle = 'rgba(220,225,240,0.85)';
        roundRect(o.x, o.y, o.w, o.h, Math.min(16, o.w/2, o.h/2));
        ctx.fill();
      } else if(o.type === 'debris'){
        ctx.fillStyle = '#ffb14a';
        ctx.beginPath();
        ctx.arc(o.x+o.w/2, o.y+o.h/2, o.w/2, 0, Math.PI*2);
        ctx.fill();
      } else if(o.type === 'bird'){
        ctx.fillStyle = 'rgba(248,250,255,0.95)';
        ctx.beginPath();
        ctx.moveTo(o.x, o.y+o.h/2);
        ctx.lineTo(o.x+o.w/2, o.y);
        ctx.lineTo(o.x+o.w, o.y+o.h/2);
        ctx.lineTo(o.x+o.w/2, o.y+o.h);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  function roundRect(x,y,w,h,r){
    ctx.beginPath();
    ctx.moveTo(x+r,y);
    ctx.arcTo(x+w,y,x+w,y+h,r);
    ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r);
    ctx.arcTo(x,y,x+w,y,r);
    ctx.closePath();
  }

  function drawPlayer(){
    if(state === 'exploding') return;
    const sk = skin();
    ctx.save();
    ctx.shadowBlur = 18;
    ctx.shadowColor = sk.glow;
    ctx.fillStyle = sk.core;
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.r, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();

    // exhaust trail, stretched while the muzzle kick is still pushing
    const tailLen = 14 + boost*54;
    const tailTop = player.y + player.r;
    ctx.save();
    const tailGrad = ctx.createLinearGradient(player.x, tailTop, player.x, tailTop + tailLen);
    tailGrad.addColorStop(0, sk.trailFrom);
    tailGrad.addColorStop(1, sk.trailTo);
    ctx.strokeStyle = tailGrad;
    ctx.lineWidth = 3 + boost*2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(player.x, tailTop);
    ctx.lineTo(player.x, tailTop + tailLen);
    ctx.stroke();
    ctx.restore();
  }

  function drawMuzzleParticles(){
    for(const p of muzzleParticles){
      const alpha = Math.max(0, p.life/p.maxLife);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.shadowBlur = 8;
      ctx.shadowColor = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawParticles(){
    for(const p of particles){
      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.shadowBlur = 10;
      ctx.shadowColor = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawWindGauge(){
    if(windVisible <= 0.01) return;
    const speed = Math.abs(windSpeed);
    const calm = speed < 0.15;
    const strength = Math.min(1, speed / WIND_MAX);
    const cx = GAME_W/2, cy = GAME_H - 52;
    const w = 168, h = 44;

    ctx.save();
    ctx.globalAlpha = windVisible;

    ctx.fillStyle = 'rgba(5,4,15,0.6)';
    roundRect(cx-w/2, cy-h/2, w, h, 22);
    ctx.fill();
    ctx.strokeStyle = calm ? 'rgba(238,242,255,0.18)' : 'rgba(41,241,255,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(238,242,255,0.45)';
    ctx.font = '9px "Hiragino Sans","Yu Gothic",system-ui,sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('風向き', cx-w/2+16, cy-11);

    if(calm){
      ctx.fillStyle = 'rgba(238,242,255,0.7)';
      ctx.font = 'bold 15px "Hiragino Sans","Yu Gothic",system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('無風', cx+12, cy+5);
    } else {
      // weak breeze reads cyan, a real gale reads hot pink
      const col = lerpColor('#29f1ff', '#ff2fb0', strength);
      const dir = windSpeed < 0 ? -1 : 1;
      const len = 26 + strength*18;
      const ax = cx - 40, ay = cy + 4;

      ctx.strokeStyle = col;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowBlur = 8;
      ctx.shadowColor = col;
      const tip = ax + dir*len/2;
      ctx.beginPath();
      ctx.moveTo(ax - dir*len/2, ay);
      ctx.lineTo(tip, ay);
      ctx.moveTo(tip - dir*9, ay-7);
      ctx.lineTo(tip, ay);
      ctx.lineTo(tip - dir*9, ay+7);
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.fillStyle = col;
      ctx.font = 'bold 17px system-ui,sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(speed.toFixed(1), cx+w/2-32, cy+4);
      ctx.fillStyle = 'rgba(238,242,255,0.5)';
      ctx.font = '10px system-ui,sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('m/s', cx+w/2-29, cy+5);
    }
    ctx.restore();
  }

  function draw(){
    ctx.clearRect(0,0,GAME_W,GAME_H);
    drawSky();
    drawBackgroundDetails();
    drawSpeedLines();
    drawWalls();
    drawCannon(); // self-hides once it has scrolled past the bottom edge
    ctx.save();
    if(state === 'exploding'){
      const cx = GAME_W/2, cy = GAME_H/2;
      ctx.translate(cx, cy);
      ctx.scale(currentZoom, currentZoom);
      ctx.translate(-cx, -cy);
    }
    drawObstacles();
    ctx.restore();
    drawPlayer();
    drawParticles();
    drawMuzzleParticles();
    drawWindGauge();
  }

  let lastTime = 0;
  function loop(ts){
    if(!lastTime) lastTime = ts;
    const dt = Math.min(0.05, (ts-lastTime)/1000);
    lastTime = ts;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // Keys the game claims. The browser's default action for these is scrolling,
  // which would drag the side panel up and down while you're steering, so the
  // default is suppressed whether or not the game is currently using the key.
  const GAME_KEYS = new Set([
    'ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyA','KeyD','KeyW','KeyS','Space'
  ]);

  window.addEventListener('keydown', (e) => {
    if(GAME_KEYS.has(e.code)) e.preventDefault();
    if(e.code === 'ArrowLeft' || e.code === 'KeyA') keyLeft = true;
    if(e.code === 'ArrowRight' || e.code === 'KeyD') keyRight = true;
    if(e.code === 'ArrowUp' || e.code === 'KeyW') moveUp = true;
    if(e.code === 'ArrowDown' || e.code === 'KeyS') moveDown = true;
    if(e.code === 'Space' || e.code === 'Enter'){
      if(state === 'start' || state === 'result') reset();
    }
  });
  window.addEventListener('keyup', (e) => {
    if(e.code === 'ArrowLeft' || e.code === 'KeyA') keyLeft = false;
    if(e.code === 'ArrowRight' || e.code === 'KeyD') keyRight = false;
    if(e.code === 'ArrowUp' || e.code === 'KeyW') moveUp = false;
    if(e.code === 'ArrowDown' || e.code === 'KeyS') moveDown = false;
  });

  // ---- drag steering (touch + mouse, via Pointer Events) --------------------
  // Relative drag, not absolute: the shot moves by however far the finger has
  // travelled, so it never teleports underneath your thumb where you can't see it.

  function toGameCoords(clientX, clientY){
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (GAME_W / rect.width),
      y: (clientY - rect.top) * (GAME_H / rect.height)
    };
  }

  function clearDrag(){
    dragPointerId = null;
    lastPointer = null;
    dragTargetX = null;
    dragTargetY = null;
  }

  wrap.addEventListener('pointerdown', (e) => {
    // ignore while the start/result overlay is up so the buttons still work
    if(state !== 'playing' && state !== 'launching') return;
    if(dragPointerId !== null) return; // first finger down owns the shot
    dragPointerId = e.pointerId;
    lastPointer = toGameCoords(e.clientX, e.clientY);
    dragTargetX = player.x;
    dragTargetY = player.y;
  });

  window.addEventListener('pointermove', (e) => {
    if(e.pointerId !== dragPointerId || lastPointer === null) return;
    const g = toGameCoords(e.clientX, e.clientY);
    // target stays clamped in bounds, otherwise dragging past the edge builds up
    // slack you'd have to drag all the way back before the shot responds again
    dragTargetX = clamp(dragTargetX + (g.x - lastPointer.x), 0, GAME_W);
    dragTargetY = clamp(dragTargetY + (g.y - lastPointer.y), PLAYER_Y-VERTICAL_RANGE, PLAYER_Y+VERTICAL_RANGE);
    lastPointer = g;
  });

  function endDrag(e){
    if(e.pointerId === dragPointerId) clearDrag();
  }
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  // an incoming call or a swiped-away tab must not leave inputs stuck on
  window.addEventListener('blur', () => {
    clearDrag();
    keyLeft = keyRight = moveUp = moveDown = false;
  });

  startBtn.addEventListener('click', reset);
  retryBtn.addEventListener('click', reset);

  hudBest.textContent = Math.floor(bestHeightM) + 'm';
  renderSkins();
})();
