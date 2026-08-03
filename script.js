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

  // session-only best height (resets on page reload; add localStorage yourself once this is hosted for real)
  let bestHeightM = 0;

  const PALETTE = ['#ff2fb0', '#29f1ff', '#7b2ff7', '#ffd23f', '#ff6b6b', '#5eead4'];

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
  let windCooldown = 0;
  let currentZoom = 1, zoomTarget = 1;
  let boost = 0; // 1 right after firing, eased to 0 over BOOST_DURATION

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
    launchTimer = 0;
    heightM = 0;
    scrollSpeed = 90;
    spawnTimer = 1.0;
    cloudWallTimer = 5 + Math.random()*3;
    windCooldown = 0;
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
    scatterSpeedLines();
    hudHeight.textContent = '0m'; // else the previous run's height lingers through the launch animation
    startScreen.classList.add('hidden');
    resultScreen.classList.add('hidden');
    spawnMuzzleFlash();
  }

  function spawnMuzzleFlash(){
    for(let i=0;i<26;i++){
      const angle = -Math.PI/2 + (Math.random()-0.5)*1.1;
      const speed = 80 + Math.random()*160;
      muzzleParticles.push({
        x: player.x, y: LAUNCH_Y+6,
        vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed,
        r: 2+Math.random()*3,
        life: 0.35+Math.random()*0.25, maxLife: 0.5,
        color: PALETTE[Math.floor(Math.random()*PALETTE.length)]
      });
    }
  }

  function weightedObstacleType(){
    const pool = [{t:'cloud', w:5}, {t:'movingcloud', w:4}];
    if(heightM > 150 && windCooldown <= 0) pool.push({t:'wind', w:3});
    if(heightM > 300) pool.push({t:'debris', w:3});
    if(heightM > 600) pool.push({t:'bird', w:3});
    const total = pool.reduce((s,p)=>s+p.w,0);
    let r = Math.random()*total;
    for(const p of pool){ if(r < p.w) return p.t; r -= p.w; }
    return 'cloud';
  }

  function spawnObstacle(){
    const type = weightedObstacleType();
    if(type === 'cloud'){
      const w = 70 + Math.random()*70;
      obstacles.push({ type, x: Math.random()*(GAME_W-w), y: -60, w, h: 42 + Math.random()*18 });
    } else if(type === 'wind'){
      const dir = Math.random() < 0.5 ? -1 : 1;
      const h = 160;
      obstacles.push({ type, x:0, y:-h, w: GAME_W, h, dir, force: 190 });
      // don't let another gust start until this one has fully drifted off screen
      windCooldown = (GAME_H + 120 + h) / Math.max(scrollSpeed, 60) + 0.4;
    } else if(type === 'debris'){
      obstacles.push({ type, x: Math.random()*(GAME_W-14), y:-20, w:14, h:14, vx:(Math.random()*2-1)*60, extraVy: 130 });
    } else if(type === 'movingcloud'){
      const w = 60 + Math.random()*50;
      const h = 34 + Math.random()*14;
      const dir = Math.random() < 0.5 ? -1 : 1;
      const speed = 16 + Math.random()*14; // slow, one-way drift
      obstacles.push({ type, x: Math.random()*(GAME_W-w), y:-60, w, h, vx: dir*speed });
    } else if(type === 'bird'){
      obstacles.push({ type, x: Math.random()*(GAME_W-34), y:-24, w:34, h:20, baseX: 0, t0: elapsed });
      obstacles[obstacles.length-1].baseX = obstacles[obstacles.length-1].x;
    }
  }

  function spawnCloudWall(){
    const gapWidth = Math.max(88, 150 - heightM/40);
    const gapX = PLAY_LEFT + Math.random()*((PLAY_RIGHT-PLAY_LEFT) - gapWidth);
    const h = 46;
    if(gapX - PLAY_LEFT > 4){
      obstacles.push({ type:'cloud', x: PLAY_LEFT, y:-70, w: gapX-PLAY_LEFT, h, wall:true });
    }
    const rightStart = gapX+gapWidth;
    if(PLAY_RIGHT - rightStart > 4){
      obstacles.push({ type:'cloud', x: rightStart, y:-70, w: PLAY_RIGHT-rightStart, h, wall:true });
    }
    spawnTimer = Math.max(spawnTimer, 1.1);
  }

  function circleRectHit(cx, cy, cr, rx, ry, rw, rh){
    const nx = Math.max(rx, Math.min(cx, rx+rw));
    const ny = Math.max(ry, Math.min(cy, ry+rh));
    const dx = cx-nx, dy = cy-ny;
    return (dx*dx+dy*dy) < cr*cr;
  }

  function triggerExplosion(){
    state = 'exploding';
    const scale = Math.min(2.6, 1 + heightM/1100);
    const count = Math.min(150, 28 + heightM/9);
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
        color: PALETTE[Math.floor(Math.random()*PALETTE.length)]
      });
    }
    if(heightM > bestHeightM) bestHeightM = heightM;
  }

  function endToResult(){
    state = 'result';
    resultHeight.textContent = Math.floor(heightM) + 'm';
    resultBest.textContent = '自己ベスト ' + Math.floor(bestHeightM) + 'm';
    hudBest.textContent = Math.floor(bestHeightM) + 'm';
    resultScreen.classList.remove('hidden');
  }

  let explodeTimer = 0;

  function update(dt){
    elapsed += dt;

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
      if(windCooldown > 0) windCooldown -= dt;
      if(cloudWallTimer <= 0){
        spawnCloudWall();
        cloudWallTimer = 8 + Math.random()*6;
      }

      let windForce = 0;

      for(let i=obstacles.length-1;i>=0;i--){
        const o = obstacles[i];
        if(o.type === 'debris'){
          o.y += scrollSpeed*1.6*dt;
          o.x += o.vx*dt;
        } else if(o.type === 'bird'){
          o.y += scrollSpeed*dt;
          o.x = o.baseX + Math.sin((elapsed - o.t0)*3.2)*60;
        } else if(o.type === 'movingcloud'){
          o.y += scrollSpeed*dt;
          o.x += o.vx*dt;
          if(o.x + o.w < 0) o.x = GAME_W;
          else if(o.x > GAME_W) o.x = -o.w;
        } else {
          o.y += scrollSpeed*dt;
        }

        if(o.type === 'wind'){
          if(player.y >= o.y && player.y <= o.y+o.h){
            windForce += o.dir * o.force;
          }
        } else {
          if(circleRectHit(player.x, player.y, player.r, o.x, o.y, o.w, o.h)){
            triggerExplosion();
          }
        }

        if(o.y > GAME_H + 100) obstacles.splice(i,1);
      }

      player.x += windForce*dt;
      // push the drag target by the same amount, or the shot would auto-correct
      // against the gust and touch players would shrug off wind that keys can't
      if(dragTargetX !== null) dragTargetX = clamp(dragTargetX + windForce*dt, 0, GAME_W);

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
        ctx.fillStyle = 'rgba(220,225,240,0.85)';
        roundRect(o.x, o.y, o.w, o.h, 16);
        ctx.fill();
      } else if(o.type === 'wind'){
        ctx.save();
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = o.dir > 0 ? '#29f1ff' : '#ff2fb0';
        ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.globalAlpha = 0.4;
        ctx.strokeStyle = ctx.fillStyle;
        for(let i=0;i<8;i++){
          ctx.beginPath();
          ctx.moveTo(i*(GAME_W/8), o.y);
          ctx.lineTo(i*(GAME_W/8) + o.dir*24, o.y+o.h);
          ctx.stroke();
        }
        ctx.restore();
      } else if(o.type === 'movingcloud'){
        ctx.save();
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = 'rgba(180,210,255,0.9)';
        roundRect(o.x - o.vx*0.06, o.y, o.w, o.h, 16);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = 'rgba(206,224,255,0.92)';
        roundRect(o.x, o.y, o.w, o.h, 16);
        ctx.fill();
      } else if(o.type === 'debris'){
        ctx.fillStyle = '#ffb14a';
        ctx.beginPath();
        ctx.arc(o.x+o.w/2, o.y+o.h/2, o.w/2, 0, Math.PI*2);
        ctx.fill();
      } else if(o.type === 'bird'){
        ctx.fillStyle = 'rgba(20,22,35,0.9)';
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
    ctx.save();
    ctx.shadowBlur = 18;
    ctx.shadowColor = '#ffd23f';
    ctx.fillStyle = '#fff6d8';
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.r, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();

    // exhaust trail, stretched while the muzzle kick is still pushing
    const tailLen = 14 + boost*54;
    const tailTop = player.y + player.r;
    ctx.save();
    const tailGrad = ctx.createLinearGradient(player.x, tailTop, player.x, tailTop + tailLen);
    tailGrad.addColorStop(0, 'rgba(255,210,63,0.55)');
    tailGrad.addColorStop(1, 'rgba(255,120,40,0)');
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

  window.addEventListener('keydown', (e) => {
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
})();
