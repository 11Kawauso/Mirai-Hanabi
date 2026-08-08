(() => {
  const GAME_W = 480, GAME_H = 800;
  const PLAYER_Y = GAME_H * 0.62;
  // 画面が 1px 流れて何メートル稼ぐか。小さいほど高度の伸びが速い。
  // 見た目の流れる速さ（= 避けにくさ）は変えずに数字の伸びだけを上げられる
  const PIXELS_PER_METER = 5;
  const PLAY_LEFT = 26, PLAY_RIGHT = GAME_W - 26; // side walls: hit them and it's over
  const LAUNCH_Y = GAME_H - 54; // cannon mouth height
  const LAUNCH_DURATION = 0.85;
  const VERTICAL_RANGE = 64; // small up/down wiggle room around the usual flight line
  const MOVE_SPEED_X = 260;
  const MOVE_SPEED_Y = 130;
  const CANNON_TOP_OFFSET = 74; // muzzle rim sits this far above the cannon's base line
  const BOOST_DURATION = 1.2;   // how long the muzzle kick keeps pushing after firing
  const BOOST_EXTRA = 340;      // px/s piled on top of cruise speed at t=0, eased to 0

  // Climb rate. Tuned so the speed is still creeping up all the way to the top
  // of the scale instead of pinning a tenth of the way in.
  const SCROLL_BASE = 90;
  const SCROLL_RATE = 0.38;     // px/s gained per second survived
  const SCROLL_CAP  = 370;      // only reached around 34,000m

  // Wind. A signed speed in m/s (negative = blowing left) that never sits still:
  // it eases toward a fresh target every dozen-odd seconds, and that target is
  // sometimes dead calm.
  const WIND_START = 3.0;        // seconds after firing before wind starts and the gauge appears
  const WIND_MAX = 5;            // m/s, the ordinary ceiling near the ground
  const WIND_PX_PER_MS = 22;     // px/s of sideways drift per m/s -> 5m/s is 110px/s vs the shot's 260
  const WIND_EASE = 0.55;        // m/s the wind is allowed to change per second
  const WIND_CALM_CHANCE = 0.25; // how often a new target is "no wind at all"
  // The higher you get, the harder it can blow.
  const WIND_TIERS = [
    { minH: 0,     cap: WIND_MAX },
    { minH: 5000,  cap: 7  },   // 強風
    { minH: 15000, cap: 10 }    // 暴風
  ];
  const WIND_VIS_MAX = 10;       // gauge/streaks are graded against the storm ceiling,
                                 // so 7 and 10 actually look worse than 5
  const WIND_DEBRIS_MIN = 5;     // m/s at which junk starts getting torn loose
  function windCap(){
    let cap = WIND_TIERS[0].cap;
    for(const t of WIND_TIERS) if(heightM >= t.minH) cap = t.cap;
    return cap;
  }
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
  // Burst physics. Drag is what makes a real shell bloom fast then hang, rather
  // than every spark sprinting off at a constant speed.
  const BURST_DRAG = 1.35;     // velocity decay per second
  const BURST_GRAVITY = 110;   // gentle, so the flower hangs before it droops
  const BURST_FIT = 200;       // on-screen radius the camera pulls back to frame
  const BURST_ZOOM_MIN = 0.15; // how far the camera may pull back; low enough that a
                               // 30,000m shell shrinks the scenery to specks
  // Thunderheads. Not lethal - they just wash the screen out. A single one spans
  // roughly 500m of climb, so it's a long stretch of flying half-blind rather
  // than a brief flash. Obstacles keep coming inside, which is why the whiteout
  // stops short of opaque: everything stays readable, just barely.
  const CUMULO_MIN_H = 10000;    // altitude they start forming at
  const CUMULO_GAP = 70, CUMULO_GAP_RAND = 60; // seconds between them
  const CUMULO_SPAN_M = 500, CUMULO_SPAN_RAND_M = 90; // metres of altitude one covers
  const CUMULO_FADE = 110;       // px of soft edge entering and leaving
  const CUMULO_MAX_ALPHA = 0.52; // screen wash; the cloud body adds ~0.28 on top

  // 尾に座標を刻む間隔(秒)。粗いほど区間は減るが、trail×これが尾の「長さ(秒)」
  const TAIL_STEP = 0.05;

  // 爆発後のキラキラ。開いた瞬間は素直に光らせ、そこから瞬きを強めていく。
  // 菊物(正三尺玉)は尾で見せる玉なので、こちらは適用しない。
  // 底と山は、山の形 (0.5+0.5sin)^2 の平均 0.375 を掛けたときに
  // 元の明るさとほぼ同じになるよう決めてある。0.35 + 1.55*0.375 ≒ 0.93。
  // 下げるだけだと爆発が早く消えたように見えるので、山側で取り返す
  const TWINKLE_START = 0.22; // 寿命のこの割合を過ぎてから瞬き始める
  const TWINKLE_FADE  = 0.3;  // ここまでかけて瞬きが最大になる
  const TWINKLE_MIN   = 0.35; // 瞬きの底
  const TWINKLE_PEAK  = 1.9;  // 瞬きの山。1 を超えるぶんは頭打ちになって強く光る
  const TWINKLE_RATE  = 14, TWINKLE_RATE_RAND = 22; // rad/s。粒ごとにばらす
  const BURST_SCALE_CAP = 7.5, BURST_SCALE_DIV = 4400; // spread grows to ~28,600m
  const BURST_COUNT_CAP = 300, BURST_COUNT_DIV = 105;  // density grows to ~30,000m

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

  // ---- ranking --------------------------------------------------------------
  // Firebase Realtime Database over its REST interface: no SDK, no API key, just
  // the database URL. What guards the data is the security rules you paste in
  // during setup - see RANKING-SETUP.md.
  // Leave this blank and everything below falls back to a device-local board, so
  // the game still works offline and at a venue with flaky wifi.
  const RANKING_DB = 'https://mirai-hanabi-acb4f-default-rtdb.asia-southeast1.firebasedatabase.app';
  const RANKING_PATH = 'scores';
  const RANKING_SHOW = 30;  // rows listed; the panel scrolls past ~10
  const RANKING_FETCH = 200;// pulled before de-duplicating by name
  const STORE_NAME = 'mirai-hanabi.name';
  const STORE_LOCAL_RANK = 'mirai-hanabi.rank';
  const STORE_SENT = 'mirai-hanabi.sent'; // highest score the board has actually accepted
  const STORE_CLIENT = 'mirai-hanabi.id'; // this browser's permanent slot on the board
  const rankingOnline = () => RANKING_DB !== '';

  const nameInput = document.getElementById('name-input');
  const nameSave = document.getElementById('name-save');
  const rankStatus = document.getElementById('rank-status');
  const rankList = document.getElementById('rank-list');
  const rankMe = document.getElementById('rank-me');

  let playerName = String(load(STORE_NAME, '')).slice(0, 12);
  // Tracked separately from bestHeightM: a best set while offline, or one whose
  // upload failed, must still get sent on a later run.
  let sentBest = Number(load(STORE_SENT, '0')) || 0;

  // The board is keyed by this, never by the name. A name is neither unique nor
  // stable: keying on it meant renaming created a second entry, and two people
  // who picked the same name collapsed into one. One browser, one slot.
  function makeClientId(){
    try{ if(typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); }
    catch(e){ /* fall through */ }
    return 'c' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  let clientId = String(load(STORE_CLIENT, ''));
  if(!clientId){ clientId = makeClientId(); save(STORE_CLIENT, clientId); }
  if(nameInput) nameInput.value = playerName;
  const displayName = () => playerName.trim() || 'ななし';

  function localRanking(){
    try{
      const rows = JSON.parse(load(STORE_LOCAL_RANK, '[]'));
      if(!Array.isArray(rows)) return [];
      // tag our own row so the highlight works offline too
      const mine = displayName();
      return rows.map(r => ({ ...r, id: r.name === mine ? clientId : 'local:' + r.name }));
    }catch(e){ return []; }
  }
  function localSubmit(name, score){
    const rows = localRanking();
    const hit = rows.find(r => r.name === name);
    if(hit){ if(score > hit.score) hit.score = score; }
    else rows.push({ name, score });
    rows.sort((a,b) => b.score - a.score);
    save(STORE_LOCAL_RANK, JSON.stringify(rows.slice(0, RANKING_SHOW)));
  }

  async function fetchRanking(){
    // limitToLast with orderBy="score" gives the highest N; needs .indexOn in the rules
    const url = `${RANKING_DB}/${RANKING_PATH}.json` +
                `?orderBy=${encodeURIComponent('"score"')}&limitToLast=${RANKING_FETCH}`;
    const res = await fetch(url);
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    // RTDB hands back an object keyed by client id, or null when empty. Each key
    // is already one browser's single entry, so there is nothing to merge.
    return Object.entries(data || {})
      .filter(([, r]) => r)
      .map(([id, r]) => ({
        id,
        name: String(r.name || '').slice(0,12) || 'ななし',
        score: Number(r.score) || 0
      }))
      .sort((a,b) => b.score - a.score);
  }

  // PUT to this browser's own slot, so a rename edits the existing row instead of
  // adding another one. The rules only accept a score >= what is already there.
  async function putEntry(score){
    if(!rankingOnline()) return;
    const res = await fetch(`${RANKING_DB}/${RANKING_PATH}/${clientId}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: displayName(), score: Math.floor(score) })
    });
    // a rules rejection comes back as a normal response, so it has to be checked
    if(!res.ok) throw new Error('HTTP ' + res.status);
  }

  // Submit first, THEN reload. Firing the upload and immediately re-reading
  // raced the write, so a fresh score was never in the list that came back.
  async function reportScore(){
    if(bestHeightM > sentBest){
      localSubmit(displayName(), Math.floor(bestHeightM));
      try{
        await putEntry(bestHeightM);
        sentBest = Math.floor(bestHeightM);
        save(STORE_SENT, String(sentBest));
      }catch(e){
        await refreshRanking();
        if(rankStatus){
          rankStatus.textContent = '記録を送信できませんでした（次回もう一度試します）';
          rankStatus.classList.add('err');
        }
        return;
      }
    }
    await refreshRanking();
  }

  function rankRow(rank, name, score, mine){
    const li = document.createElement('li');
    if(mine) li.className = 'me';
    const r = document.createElement('span');
    r.className = 'r-rank'; r.textContent = rank;
    const n = document.createElement('span');
    n.className = 'r-nm'; n.textContent = name;
    const s = document.createElement('span');
    s.className = 'r-sc'; s.textContent = score.toLocaleString('en-US') + 'm';
    li.append(r, n, s);
    return li;
  }

  function renderRanking(rows, note, isError){
    if(!rankList) return;
    rankStatus.textContent = note;
    rankStatus.classList.toggle('err', !!isError);

    rankList.textContent = '';
    // matched on the browser id, so someone else picking your name isn't you
    let myRank = -1;
    rows.slice(0, RANKING_SHOW).forEach((r, i) => {
      const mine = r.id === clientId;
      if(mine && myRank < 0) myRank = i + 1;
      rankList.appendChild(rankRow(i+1, r.name, r.score, mine));
    });
    if(!rows.length){
      const p = document.createElement('p');
      p.className = 'r-empty';
      p.textContent = 'まだ記録がありません。最初の一発を。';
      rankList.appendChild(p);
    }

    // own score always visible, even when it's nowhere near the top
    rankMe.textContent = '';
    if(myRank < 0 && bestHeightM > 0){
      const full = rows.findIndex(r => r.id === clientId);
      const ol = document.createElement('ol');
      ol.className = 'r-list';
      ol.appendChild(rankRow(full >= 0 ? full+1 : '—', displayName(), Math.floor(bestHeightM), true));
      rankMe.appendChild(ol);
    }
  }

  async function refreshRanking(){
    if(!rankList) return;
    if(!rankingOnline()){
      renderRanking(localRanking(), 'この端末の記録（オンライン未設定）', false);
      return;
    }
    rankStatus.textContent = '読み込み中…';
    try{
      renderRanking(await fetchRanking(), '全プレイヤー共通', false);
    }catch(e){
      // never let a dead network take the panel away
      renderRanking(localRanking(), '接続できないため端末の記録を表示中', true);
    }
  }

  function setName(v){
    playerName = String(v || '').slice(0, 12).trim();
    save(STORE_NAME, playerName);
    if(nameInput) nameInput.value = playerName;
    // Relabel the row we already own rather than starting a new one. Re-sending
    // the same score is allowed by the rules, so the rename lands right away.
    (async () => {
      if(sentBest > 0){ try{ await putEntry(sentBest); }catch(e){ /* shown on next run */ } }
      await refreshRanking();
    })();
  }
  if(nameSave) nameSave.addEventListener('click', () => setName(nameInput.value));
  if(nameInput) nameInput.addEventListener('keydown', (e) => {
    if(e.code === 'Enter' || e.key === 'Enter'){ setName(nameInput.value); nameInput.blur(); }
  });

  // ---- burst shapes --------------------------------------------------------
  // Japanese "katamono" shells open into a figure rather than a ball. Each
  // function walks the outline for t in [0,1) and returns a direction vector
  // (roughly unit length) that a spark is fired along. Canvas y points down, so
  // anything that should read upright is negated here.
  const SHAPES = {
    star(t){                       // five points, outer radius 1, inner 0.42
      const v = i => {
        const r = (i % 2 === 0) ? 1 : 0.42;
        const a = -Math.PI/2 + i*Math.PI/5;
        return [Math.cos(a)*r, Math.sin(a)*r];
      };
      const s = t*10, e = Math.floor(s), f = s - e;
      const a = v(e % 10), b = v((e+1) % 10);
      return [a[0] + (b[0]-a[0])*f, a[1] + (b[1]-a[1])*f];
    },
    square(t){
      const pts = [[-1,-1],[1,-1],[1,1],[-1,1]];
      const s = t*4, e = Math.floor(s), f = s - e;
      const a = pts[e % 4], b = pts[(e+1) % 4];
      return [a[0] + (b[0]-a[0])*f, a[1] + (b[1]-a[1])*f];
    },
    heart(t){                      // classic 16sin³ / 13cos… curve, scaled to ~1
      const a = t*Math.PI*2;
      const x = 16*Math.pow(Math.sin(a), 3);
      const y = 13*Math.cos(a) - 5*Math.cos(2*a) - 2*Math.cos(3*a) - Math.cos(4*a);
      return [x/17, -y/17];
    }
  };

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

    // The real thing bursts at roughly 600m over Nagaoka, so it unlocks there.
    // It is the festival's headline shell, so it should be easy to reach.
    // kiku: the only shell that opens into a chrysanthemum - it hangs far wider
    // than the rest, every spark drags a streamer, and the whole flower sinks
    // instead of scattering. See triggerExplosion for what each field drives.
    { id:'shakudama', name:'正三尺玉', unlock:600,
      core:'#fff3cf', glow:'#ffb14a',
      trailFrom:'rgba(255,177,74,0.6)', trailTo:'rgba(255,90,20,0)',
      // 写真の正三尺玉に寄せた、白寄りの淡い金。彩度を上げすぎると尾が濁る
      palette:['#ffd9a0','#ffc978','#ffb14a','#fff3cf','#ffe08a','#ffcf9a'],
      kiku:{
        fit:265,        // 画面に収める半径。他は 200 なので一回り大きく映る
        gravity:38,     // 既定 110。垂れ落ちる速さ
        drag:0.7,       // 既定 1.35。小さいほど遠くまで伸びてから沈む
        hold:4.2,       // 爆発を見せている秒数。既定 2.5
        life:3.4, lifeSpan:1.3,
        // 32 × TAIL_STEP = 1.6秒ぶんの軌跡。中心から外周まで一本に繋がって見える
        trail:32,
        pistilRatio:0.1, // 芯で光る色玉の割合
        pistil:['#ff69c0','#7dff9e','#b98bff','#ffffff']
      },
      burst:1.8 },

    { id:'guren', name:'紅蓮', unlock:1500,
      core:'#fff0ec', glow:'#ff3b30',
      trailFrom:'rgba(255,59,48,0.6)', trailTo:'rgba(150,20,20,0)',
      palette:['#ff3b30','#ff6b6b','#e11d48','#ff8a3d','#ffb4a2','#b91c1c'], burst:1.2 },

    { id:'hoshi', name:'星', unlock:3000, shape:'star',
      core:'#fffdf0', glow:'#ffe066',
      trailFrom:'rgba(255,224,102,0.6)', trailTo:'rgba(255,170,0,0)',
      palette:['#ffe066','#fff3b0','#ffd23f','#ffffff','#ffc14d','#fff8dc'], burst:1.3 },

    { id:'ginryu', name:'銀柳', unlock:5000,
      core:'#f4fff8', glow:'#b8f2d8',
      trailFrom:'rgba(184,242,216,0.6)', trailTo:'rgba(90,180,140,0)',
      palette:['#d1fae5','#6ee7b7','#a7f3d0','#e2e8f0','#f4fff8','#34d399'], burst:1.35 },

    { id:'heart', name:'ハート', unlock:7500, shape:'heart',
      core:'#fff0f6', glow:'#ff5fa8',
      trailFrom:'rgba(255,95,168,0.6)', trailTo:'rgba(255,20,120,0)',
      palette:['#ff5fa8','#ff8ad4','#ffc2e8','#ff2f6d','#fff0f6','#ffd23f'], burst:1.4 },

    { id:'kaku', name:'四角', unlock:10000, shape:'square',
      core:'#f7ffe8', glow:'#a3e635',
      trailFrom:'rgba(163,230,53,0.6)', trailTo:'rgba(80,160,20,0)',
      palette:['#a3e635','#d9f99d','#84cc16','#ecfccb','#bef264','#65a30d'], burst:1.45 },

    { id:'nishiki', name:'錦冠', unlock:14000,
      core:'#fffbe8', glow:'#f5c518',
      trailFrom:'rgba(245,197,24,0.65)', trailTo:'rgba(180,90,0,0)',
      palette:['#f5c518','#ffd23f','#fff0a8','#e8a33d','#fffbe8','#c98a17'], burst:1.6 },

    { id:'phoenix', name:'フェニックス', unlock:18000,
      core:'#fff0f0', glow:'#ff4d4d',
      trailFrom:'rgba(255,77,77,0.6)', trailTo:'rgba(255,180,40,0)',
      palette:['#ff2f2f','#ff6b6b','#ff9f1c','#ffd23f','#ff2fb0','#fff0f0'], burst:1.75 },

    { id:'gokusai', name:'極彩', unlock:23000,
      core:'#ffffff', glow:'#ff2fb0',
      trailFrom:'rgba(255,47,176,0.6)', trailTo:'rgba(123,47,247,0)',
      palette:['#ff2fb0','#7b2ff7','#29f1ff','#c084fc','#f0abfc','#22d3ee'], burst:1.9 },

    // The finale. fx:'grand' adds a hue-cycling core, a pulsing halo and a
    // continuous spark trail on top of the biggest burst in the game.
    { id:'banka', name:'万華', unlock:30000,
      core:'#ffffff', glow:'#ffd23f', fx:'grand',
      trailFrom:'rgba(255,255,255,0.75)', trailTo:'rgba(255,47,176,0)',
      palette:['#ff2f6d','#ff8a3d','#ffd23f','#5eead4','#29f1ff','#7b2ff7','#ff2fb0','#ffffff'],
      burst:2.2 }
  ];

  // "1.5k" style so the number still fits inside a locked swatch
  function shortM(m){
    if(m < 1000) return String(m);
    const k = m/1000;
    return (Number.isInteger(k) ? k : k.toFixed(1)) + 'k';
  }

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
        b.className = 'skin-dot' + (i === skinIndex ? ' on' : '') + (open ? '' : ' locked')
                    + (s.fx === 'grand' ? ' grand' : '');
        b.style.setProperty('--core', s.core);
        b.style.setProperty('--glow', s.glow);
        b.disabled = !open;
        b.setAttribute('aria-label', open ? s.name : `${s.name}（${s.unlock}m で解放）`);
        if(!open) b.textContent = shortM(s.unlock);
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
  // 玉によって落ち方と見せる長さが変わるので、爆発ごとに差し替える
  let burstGravity = BURST_GRAVITY;
  let burstDrag = BURST_DRAG;
  let explodeHold = 2.5;

  const player = { x: GAME_W/2, y: LAUNCH_Y, vx: 0, r: 9 };
  let keyLeft = false, keyRight = false;
  let moveUp = false, moveDown = false;
  // スティックの倒し具合。-1〜1 で、ボタン/キーと同じ最高速度に正規化して使う
  let stickX = 0, stickY = 0;
  let launchTimer = 0;
  let muzzleParticles = [];
  let cloudWallTimer = 6;
  let wallPending = false; // a wall is due and is waiting for a clear corridor
  let sparkleTimer = 0;    // emitter for the finale skin's spark trail
  let cumuloTimer = 0;     // until the next thunderhead
  let cumuloFog = 0;       // 0..1 eased whiteout while inside one
  let currentZoom = 1, zoomTarget = 1;
  let boost = 0; // 1 right after firing, eased to 0 over BOOST_DURATION
  let windSpeed = 0;   // signed m/s, negative = left
  let windTarget = 0;
  let windTimer = 0;   // until the next target is rolled
  let windVisible = 0; // 0..1 fade of the bottom gauge
  let windDebrisTimer = 0.4;

  for(let i=0;i<70;i++){
    stars.push({ x: Math.random()*GAME_W, y: Math.random()*GAME_H, r: Math.random()*1.6+0.4, tw: Math.random()*6.28 });
  }

  // streaks that rush past during the boost — the only thing that actually sells
  // speed, since the shot itself is pinned to a fixed height on screen
  const speedLines = [];
  for(let i=0;i<22;i++) speedLines.push({ x:0, y:0, len:0, spd:0, alpha:0 });
  // Faint horizontal streaks of moving air. Kept deliberately dim - they should
  // register at the edge of your attention, not compete with the obstacles.
  // Ceiling at a full 10m/s storm. 5m/s lands near half of this, which is where
  // the effect sat before the storm tiers existed.
  const WIND_STREAK_ALPHA = 0.30;

  // One pre-rendered tapered streak, reused for every gust line. Building a
  // fresh gradient for all 14 of them on every frame was steady garbage, and it
  // started the instant the wind picked up.
  const streakSprite = document.createElement('canvas');
  (function buildStreakSprite(){
    streakSprite.width = 128; streakSprite.height = 3;
    const g = streakSprite.getContext('2d');
    if(!g) return;
    const grad = g.createLinearGradient(0,0,128,0);
    grad.addColorStop(0, 'rgba(214,236,255,0)');
    grad.addColorStop(1, 'rgba(214,236,255,1)');
    g.fillStyle = grad;
    g.fillRect(0,0,128,3);
  })();

  // Same trick for the vertical launch streaks, which were rebuilding 22
  // gradients a frame for the whole boost - on every single launch.
  const speedSprite = document.createElement('canvas');
  (function buildSpeedSprite(){
    speedSprite.width = 2; speedSprite.height = 128;
    const g = speedSprite.getContext('2d');
    if(!g) return;
    const grad = g.createLinearGradient(0,0,0,128);
    grad.addColorStop(0, 'rgba(210,240,255,0)');
    grad.addColorStop(1, 'rgba(210,240,255,1)');
    g.fillStyle = grad;
    g.fillRect(0,0,2,128);
  })();

  // Rasterising a glyph at a size/weight the canvas has not drawn before costs a
  // visible frame, and CJK glyphs are the worst of it. The gauge only switches to
  // bold 強風/暴風 once you are already flying, which is exactly when the stutter
  // showed up - so every string it can ever show gets warmed here, up front.
  (function warmGaugeFonts(){
    const warm = document.createElement('canvas');
    warm.width = 96; warm.height = 32;
    const g = warm.getContext('2d');
    if(!g) return;
    const fonts = [
      '9px "Hiragino Sans","Yu Gothic",system-ui,sans-serif',
      'bold 9px "Hiragino Sans","Yu Gothic",system-ui,sans-serif',
      'bold 15px "Hiragino Sans","Yu Gothic",system-ui,sans-serif',
      'bold 17px system-ui,sans-serif',
      '10px system-ui,sans-serif'
    ];
    const words = ['風向き','強風','暴風','無風','m/s','0123456789.'];
    g.fillStyle = '#fff';
    for(const f of fonts){
      g.font = f;
      for(const w of words) g.fillText(w, 0, 16);
    }
  })();
  const windStreaks = [];
  for(let i=0;i<14;i++) windStreaks.push({ x:0, y:0, len:0, spd:0, alpha:0 });
  function scatterWindStreaks(){
    for(const s of windStreaks){
      s.x = Math.random()*GAME_W;
      s.y = Math.random()*GAME_H;
      s.len = 34 + Math.random()*66;
      s.spd = 0.7 + Math.random()*0.9; // parallax, so they don't move as one sheet
      s.alpha = 0.35 + Math.random()*0.65;
    }
  }
  scatterWindStreaks();

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
    // 引き出しを開いたまま打ち上がると盤が見えないので必ず畳む
    setPanel(null);
    document.body.classList.add('playing');
    bestBeforeRun = bestHeightM;
    skinUnlockMsg.classList.add('hidden');
    launchTimer = 0;
    heightM = 0;
    scrollSpeed = SCROLL_BASE;
    spawnTimer = 1.0;
    cloudWallTimer = 5 + Math.random()*3;
    wallPending = false;
    cumuloTimer = 12 + Math.random()*18; // first one lands a while after 10,000m
    cumuloFog = 0;
    currentZoom = 1;
    zoomTarget = 1;
    obstacles = [];
    particles = [];
    muzzleParticles = [];
    elapsed = 0;
    player.x = GAME_W/2;
    player.y = LAUNCH_Y;
    player.vx = 0;
    boost = 1;
    windSpeed = 0; // every run starts calm, then builds once the gauge appears
    windTarget = 0;
    windTimer = 0;
    windVisible = 0;
    windDebrisTimer = 0.4;
    scatterSpeedLines();
    scatterWindStreaks();
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

  // Junk torn loose by a gale. It enters from the side the wind is coming FROM
  // and crosses well ahead of the clouds, so it reads as being thrown by the air
  // rather than drifting in it.
  function spawnWindDebris(){
    const dir = windSpeed < 0 ? -1 : 1;
    const size = 14 + Math.random()*11; // big enough to read while it streaks past
    obstacles.push({
      type:'windborne',
      x: dir > 0 ? -size - Math.random()*50 : GAME_W + Math.random()*50,
      y: -20 + Math.random()*(GAME_H*0.6),
      w:size, h:size,
      speedMul: 1.9 + Math.random()*0.9, // clouds ride at 0.65-1.35x, this outruns them
      rot: Math.random()*Math.PI*2,
      spin: (Math.random()*2-1)*7
    });
  }

  function spawnCumulo(){
    const h = (CUMULO_SPAN_M + Math.random()*CUMULO_SPAN_RAND_M) * PIXELS_PER_METER;
    // puffs on both faces - the lower one is the leading edge you actually fly into
    const lumps = [], base = [];
    for(let i=0;i<8;i++) lumps.push({ x: Math.random()*GAME_W, r: 42 + Math.random()*58 });
    for(let i=0;i<8;i++) base.push({ x: Math.random()*GAME_W, r: 46 + Math.random()*62 });
    obstacles.push({ type:'cumulo', x:0, y:-h, w:GAME_W, h, lumps, base });
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
    // burst counts fully toward how many sparks fly, but only partly toward how
    // big each one is - otherwise the late skins throw dinner plates
    const scale = Math.min(BURST_SCALE_CAP, 1 + heightM/BURST_SCALE_DIV) * (1 + (sk.burst-1)*0.35);
    const shapeFn = SHAPES[sk.shape];
    const kiku = sk.kiku; // 菊物（正三尺玉）だけ、落ち方も見せ方も別仕立てにする
    burstGravity = kiku ? kiku.gravity : BURST_GRAVITY;
    burstDrag = kiku ? kiku.drag : BURST_DRAG;
    explodeHold = kiku ? kiku.hold : 2.5;
    const lifeMin = kiku ? kiku.life : 1.5;
    const lifeSpan = kiku ? kiku.lifeSpan : 0.9;
    const maxLife = lifeMin + lifeSpan;

    let count = Math.min(BURST_COUNT_CAP, 28 + heightM/BURST_COUNT_DIV) * sk.burst;
    // a ball still reads with a handful of sparks; a heart does not, so shaped
    // shells get a floor to stay legible even on a low, early death
    if(shapeFn) count = Math.max(110, count);
    // 菊は花びらの本数で見える。低い高度で散っても形が出るよう下限を置き、
    // 一本ずつ尾を引く分だけ描画が重いので上限も締める
    if(kiku) count = clamp(count, 200, 360);
    const push = 0.6 + scale*0.5;
    // With drag, a spark coasts to v0/burstDrag - so the fastest spark tells us
    // how wide the flower opens, and gravity sags it further than that. The
    // camera pulls back just enough to frame the result; small bursts need none.
    const reach = ((shapeFn ? 215 : 250) * push + burstGravity) / burstDrag;
    zoomTarget = clamp((kiku ? kiku.fit : BURST_FIT) / reach, BURST_ZOOM_MIN, 1);

    const pistilCount = kiku ? Math.round(count * kiku.pistilRatio) : 0;

    for(let i=0;i<count;i++){
      let vx, vy;
      if(shapeFn){
        // walk the outline in order so the figure actually forms, with a little
        // jitter in position and speed so it reads as sparks, not a wireframe
        const p = shapeFn((i + Math.random()*0.7) / count);
        const speed = (180 + Math.random()*35) * push;
        vx = p[0]*speed; vy = p[1]*speed;
      } else {
        const angle = Math.random()*Math.PI*2;
        // 菊は花びらが同じ長さで揃うほど本物らしい。散らばりを抑えて外周を作る
        const speed = (kiku ? (150 + Math.random()*70) : (70 + Math.random()*180)) * push;
        vx = Math.cos(angle)*speed; vy = Math.sin(angle)*speed;
      }
      // 芯で光る色玉。花びらより内側で止まり、尾を引かないので粒として際立つ
      const isPistil = i < pistilCount;
      if(isPistil){
        const a = Math.random()*Math.PI*2;
        const s = (30 + Math.random()*45) * push;
        vx = Math.cos(a)*s; vy = Math.sin(a)*s;
      }
      particles.push({
        x: player.x, y: player.y,
        vx, vy,
        r: Math.min(34, (2 + Math.random()*4) * scale * (isPistil ? 1.25 : 1)),
        life: lifeMin + Math.random()*lifeSpan,
        maxLife,
        color: isPistil
          ? kiku.pistil[Math.floor(Math.random()*kiku.pistil.length)]
          : sk.palette[Math.floor(Math.random()*sk.palette.length)],
        // 尾は座標を x,y の平坦な配列で持つ。粒ごとに配列を作り直さない
        tail: (kiku && !isPistil) ? [] : null,
        tailMax: kiku ? kiku.trail : 0,
        tailT: 0,
        // 瞬きの速さと位相。粒ごとにばらさないと全体が一斉に明滅する。
        // 打ち上げ中の噴射粒はこれを持たないので瞬かない
        twRate: kiku ? 0 : TWINKLE_RATE + Math.random()*TWINKLE_RATE_RAND,
        twPhase: Math.random()*Math.PI*2
      });
    }
    if(heightM > bestHeightM){
      bestHeightM = heightM;
      save(STORE_BEST, String(Math.floor(bestHeightM)));
    }
  }

  function endToResult(){
    state = 'result';
    document.body.classList.remove('playing'); // スワイプを解禁する
    stickRelease(); // 倒したまま終わってもノブは中央へ戻す
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

    reportScore(); // only a genuine improvement is uploaded, so replays don't spam it

    resultScreen.classList.remove('hidden');
  }

  let explodeTimer = 0;

  function update(dt){
    elapsed += dt;

    // the gauge only belongs on screen while you're actually flying
    const wantGauge = (state === 'playing' && elapsed >= WIND_START);
    windVisible = clamp(windVisible + (wantGauge ? dt*1.6 : -dt*3), 0, 1);

    // how deep into a thunderhead the shot is, softened at both edges
    let fogTarget = 0;
    if(state === 'playing'){
      for(const o of obstacles){
        if(o.type !== 'cumulo') continue;
        const depth = Math.min(player.y - o.y, (o.y + o.h) - player.y);
        if(depth > 0) fogTarget = Math.max(fogTarget, Math.min(1, depth / CUMULO_FADE));
      }
    }
    cumuloFog += (fogTarget - cumuloFog) * Math.min(1, dt*4);
    const inCumulo = fogTarget > 0;

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
      }
    }

    // The world scrolls from the moment of firing, launch animation included.
    // Without this the first 0.85s is a dead-still screen and the shot reads as
    // floating rather than being flung out of a cannon.
    if(state === 'launching' || state === 'playing'){
      boost = Math.pow(1 - Math.min(1, elapsed/BOOST_DURATION), 2); // ease-out
      // speed increases very gradually with time survived, not with height directly
      scrollSpeed = Math.min(SCROLL_CAP, SCROLL_BASE + elapsed*SCROLL_RATE) + boost*BOOST_EXTRA;
      heightM += (scrollSpeed*dt) / PIXELS_PER_METER;
      hudHeight.textContent = Math.floor(heightM) + 'm';

      // finale skin leaves a continuous spark trail (reuses the muzzle sparks,
      // which already animate and fall in every state)
      if(skin().fx === 'grand'){
        sparkleTimer -= dt;
        while(sparkleTimer <= 0){
          sparkleTimer += 0.028;
          const pal = skin().palette;
          muzzleParticles.push({
            x: player.x + (Math.random()-0.5)*10, y: player.y + player.r,
            vx: (Math.random()-0.5)*40, vy: 30 + Math.random()*50,
            r: 1.2 + Math.random()*1.8,
            life: 0.32 + Math.random()*0.22, maxLife: 0.54,
            color: pal[Math.floor(Math.random()*pal.length)]
          });
        }
      }

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
      // buttons and keys feed the same flags, so both routes move identically.
      // The stick adds an analog term, clamped to the same ceiling so that no
      // input method is faster than another — the leaderboard has to stay fair.
      let vx = 0;
      if(keyLeft) vx -= MOVE_SPEED_X;
      if(keyRight) vx += MOVE_SPEED_X;
      vx += stickX * MOVE_SPEED_X;
      player.x += clamp(vx, -MOVE_SPEED_X, MOVE_SPEED_X)*dt;

      let vy = 0;
      if(moveUp) vy -= MOVE_SPEED_Y;
      if(moveDown) vy += MOVE_SPEED_Y;
      vy += stickY * MOVE_SPEED_Y;
      player.y += clamp(vy, -MOVE_SPEED_Y, MOVE_SPEED_Y)*dt;
      player.y = clamp(player.y, PLAYER_Y-VERTICAL_RANGE, PLAYER_Y+VERTICAL_RANGE);

      spawnTimer -= dt;
      if(spawnTimer <= 0){
        spawnObstacle();
        // 間隔が詰まりきるまでを緩やかにして、最短間隔も広げてある
        spawnTimer = Math.max(0.58, 1.35 - elapsed*0.009);
      }

      if(heightM >= CUMULO_MIN_H){
        cumuloTimer -= dt;
        if(cumuloTimer <= 0 && !inCumulo){
          spawnCumulo();
          cumuloTimer = CUMULO_GAP + Math.random()*CUMULO_GAP_RAND;
        }
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
          const cap = windCap();
          windTarget = Math.random() < WIND_CALM_CHANCE
            ? 0
            : (Math.random() < 0.5 ? -1 : 1) * (1 + Math.random()*(cap-1));
          windTimer = 12 + Math.random()*13;
        }
        // eased, never snapped: the gauge needle is always creeping somewhere
        windSpeed += stepToward(windTarget - windSpeed, WIND_EASE*dt);
      }
      const windPx = windSpeed * WIND_PX_PER_MS;

      player.x += windPx*dt;

      // above WIND_DEBRIS_MIN the gale starts throwing junk across the screen,
      // more often the harder it blows
      const gale = Math.abs(windSpeed) - WIND_DEBRIS_MIN;
      if(gale > 0){
        windDebrisTimer -= dt;
        if(windDebrisTimer <= 0){
          spawnWindDebris();
          windDebrisTimer = Math.max(0.3, 1.15 - gale*0.22);
        }
      } else {
        windDebrisTimer = 0.4;
      }

      // Air streaks run faster than the shot drifts, otherwise they'd sit still
      // relative to everything else and read as scratches rather than wind.
      for(const s of windStreaks){
        s.x += windPx * s.spd * 2.4 * dt;
        s.y += scrollSpeed * 0.35 * dt;   // sinks slowly, like the rest of the sky
        if(s.y - s.len > GAME_H) s.y = -20;
        if(windPx > 0 && s.x > GAME_W){ s.x = -s.len; s.y = Math.random()*GAME_H; }
        else if(windPx < 0 && s.x + s.len < 0){ s.x = GAME_W; s.y = Math.random()*GAME_H; }
      }

      for(let i=obstacles.length-1;i>=0;i--){
        const o = obstacles[i];
        if(o.type === 'debris'){
          o.y += scrollSpeed*1.6*dt;
          o.x += o.vx*dt;
        } else if(o.type === 'windborne'){
          o.y += scrollSpeed*dt;
          o.x += windPx * o.speedMul * dt;
          o.rot += o.spin*dt;
        } else if(o.type === 'bird'){
          o.y += scrollSpeed*dt;
          o.x = o.baseX + Math.sin((elapsed - o.t0)*3.2)*60;
        } else if(o.type === 'cumulo'){
          o.y += scrollSpeed*dt; // spans the full width, so wind drift is moot
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

        // a thunderhead blinds you, it doesn't kill you
        if(o.type !== 'cumulo' && o.w > 1 &&
           circleRectHit(player.x, player.y, player.r, o.x, o.y, o.w, o.h)){
          triggerExplosion();
        }

        // windborne junk usually leaves sideways, so it needs its own exit check
        if(o.y > GAME_H + 100) obstacles.splice(i,1);
        else if(o.type === 'windborne' && (o.x < -160 || o.x > GAME_W + 160)) obstacles.splice(i,1);
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
      // eased slowly enough that you watch the camera pull back, not blink and miss it
      currentZoom += (zoomTarget - currentZoom) * Math.min(1, dt*3.2);
      explodeTimer += dt;
      const drag = Math.exp(-burstDrag*dt); // frame-rate independent decay
      for(let i=particles.length-1;i>=0;i--){
        const p = particles[i];
        p.vx *= drag;
        p.vy *= drag;
        p.vy += burstGravity*dt;
        if(p.twRate) p.twPhase += p.twRate*dt;
        // 尾は一定間隔で記録する。フレームレートで尾の長さが変わらない
        if(p.tail){
          p.tailT += dt;
          if(p.tailT >= TAIL_STEP){
            p.tailT = 0;
            p.tail.push(p.x, p.y);
            if(p.tail.length > p.tailMax*2) p.tail.splice(0, 2);
          }
        }
        p.x += p.vx*dt;
        p.y += p.vy*dt;
        p.life -= dt;
        if(p.life <= 0) particles.splice(i,1);
      }
      if(explodeTimer > explodeHold || particles.length === 0){
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
      // The grid rides the camera pull-back too - it's the clearest ruler on
      // screen for how far a burst has spread. Its extents grow by 1/zoom so the
      // shrunken grid still reaches the frame edges instead of becoming a small
      // patch floating in the middle. The vanishing line is deliberately NOT
      // padded upward: sky belongs above it.
      const z = (state === 'exploding') ? currentZoom : 1;
      const cx = GAME_W/2, cy = GAME_H/2;
      // +40 of slack: without it the padding lands exactly on the frame edge and
      // a rounding error shows a sliver of bare sky there
      const padX = (GAME_W/2) * (1/z - 1) + 40;
      const padY = (GAME_H/2) * (1/z - 1) + 40;
      const spacing = 34;
      const offset = (elapsed*40) % spacing;
      const topY = GAME_H*0.35;

      ctx.save();
      if(z !== 1){
        ctx.translate(cx, cy);
        ctx.scale(z, z);
        ctx.translate(-cx, -cy);
      }
      ctx.strokeStyle = '#29f1ff';
      ctx.lineWidth = 1;

      // batched into one path per group - this used to be one stroke per line
      ctx.globalAlpha = gridAmt * 0.5;
      ctx.beginPath();
      let y = GAME_H - offset;
      while(y < GAME_H + padY) y += spacing;
      for(; y > topY; y -= spacing){
        ctx.moveTo(-padX, y);
        ctx.lineTo(GAME_W + padX, y);
      }
      ctx.stroke();

      ctx.globalAlpha = gridAmt * 0.35;
      ctx.beginPath();
      const stretch = (GAME_H + padY - topY) / (GAME_H - topY);
      for(let x = -GAME_W - padX; x < GAME_W*2 + padX; x += 48){
        const sx = cx + (x-cx)*0.2;
        ctx.moveTo(sx, topY);
        ctx.lineTo(sx + (x - sx)*stretch, GAME_H + padY);
      }
      ctx.stroke();
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

  function drawWindStreaks(){
    // windVisible ties this to the gauge, so the air fades in and out with it
    const strength = Math.min(1, Math.abs(windSpeed)/WIND_VIS_MAX) * windVisible;
    if(strength < 0.05) return; // dead calm draws nothing at all
    const dir = windSpeed < 0 ? -1 : 1;
    ctx.save();
    for(const s of windStreaks){
      const len = s.len * (0.45 + strength*0.55); // stronger wind, longer streak
      ctx.globalAlpha = WIND_STREAK_ALPHA * strength * s.alpha;
      if(dir > 0){
        ctx.drawImage(streakSprite, s.x, s.y-1.5, len, 3);
      } else {
        // mirrored, so the bright leading edge still points where the wind goes
        ctx.save();
        ctx.translate(s.x, s.y-1.5);
        ctx.scale(-1, 1);
        ctx.drawImage(streakSprite, 0, 0, len, 3);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  function drawSpeedLines(){
    if(boost <= 0.02) return;
    ctx.save();
    for(const l of speedLines){
      // tapered so each streak reads as a trail rather than a floating stick
      ctx.globalAlpha = boost * l.alpha;
      ctx.drawImage(speedSprite, l.x-1, l.y - l.len, 2, l.len);
    }
    ctx.restore();
  }

  // Deliberately drawn OUTSIDE the camera transform and never scaled. The walls
  // are the frame of the play area rather than scenery inside it, so they stay
  // exactly where they started even while the burst pulls the camera back.
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
      } else if(o.type === 'cumulo'){
        // The bank itself stays fairly light - the screen-space wash does the
        // heavy lifting once you're inside. Fades are a fixed number of pixels
        // rather than a fraction, or a 3,000px tall cloud would fade for 700px.
        ctx.save();
        const f = Math.min(0.3, 260 / o.h);
        const g = ctx.createLinearGradient(0, o.y, 0, o.y + o.h);
        g.addColorStop(0,   'rgba(238,244,255,0)');
        g.addColorStop(f,   'rgba(238,244,255,0.28)');
        g.addColorStop(1-f, 'rgba(238,244,255,0.28)');
        g.addColorStop(1,   'rgba(238,244,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, o.y, GAME_W, o.h);
        ctx.globalAlpha = 0.32;
        ctx.fillStyle = 'rgba(244,248,255,0.85)';
        for(const l of o.base){ // leading face - this is the one you fly into
          ctx.beginPath();
          ctx.arc(l.x, o.y + o.h - l.r*0.55, l.r, 0, Math.PI*2);
          ctx.fill();
        }
        for(const l of o.lumps){ // trailing crown
          ctx.beginPath();
          ctx.arc(l.x, o.y + l.r*0.55, l.r, 0, Math.PI*2);
          ctx.fill();
        }
        ctx.restore();
      } else if(o.type === 'windborne'){
        // dusty and angular, so it never gets mistaken for a cloud or a bird
        ctx.save();
        ctx.translate(o.x + o.w/2, o.y + o.h/2);
        ctx.rotate(o.rot);
        ctx.fillStyle = 'rgba(200,188,168,0.94)';
        const r = o.w/2;
        ctx.beginPath();
        ctx.moveTo(-r, -r*0.6);
        ctx.lineTo(r*0.7, -r);
        ctx.lineTo(r, r*0.5);
        ctx.lineTo(-r*0.5, r);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
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
    // the finale cycles its glow through the spectrum and wears a pulsing halo
    const grand = sk.fx === 'grand';
    const glow = grand ? `hsl(${(elapsed*110) % 360}, 100%, 62%)` : sk.glow;

    if(grand){
      const pulse = 1 + 0.16*Math.sin(elapsed*7);
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = glow;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 16;
      ctx.shadowColor = glow;
      ctx.beginPath();
      ctx.arc(player.x, player.y, player.r*2.0*pulse, 0, Math.PI*2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.shadowBlur = grand ? 26 : 18;
    ctx.shadowColor = glow;
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

  // A 30,000m shell throws several hundred sparks. shadowBlur plus a save/restore
  // on every one of them is ruinous, so each colour gets its glow baked once and
  // every spark is a single drawImage after that.
  const glowCache = new Map();
  function glowSprite(color){
    let c = glowCache.get(color);
    if(c) return c;
    c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    if(g){
      const [r, gr, b] = hexToRgb(color);
      const grad = g.createRadialGradient(32,32,0, 32,32,32);
      grad.addColorStop(0,   `rgba(${r},${gr},${b},1)`);
      grad.addColorStop(0.5, `rgba(${r},${gr},${b},1)`);   // solid core out to p.r
      grad.addColorStop(1,   `rgba(${r},${gr},${b},0)`);   // halo fades out
      g.fillStyle = grad;
      g.fillRect(0,0,64,64);
    }
    glowCache.set(color, c);
    return c;
  }

  function drawGlowParticles(list){
    ctx.save();
    for(const p of list){
      let alpha = Math.max(0, p.life / p.maxLife);
      if(alpha <= 0) continue;
      let d = p.r * 4; // sprite is half core, half halo -> core radius lands on p.r
      if(p.twRate){
        const prog = 1 - alpha; // 0(出たて) → 1(消える)
        const amt = clamp((prog - TWINKLE_START) / TWINKLE_FADE, 0, 1);
        // sin をそのまま使うと均されて脈動になる。二乗して山を細く谷を長くすると
        // 「たまに強く光る」形になり、キラキラとして読める
        let f = 0.5 + 0.5*Math.sin(p.twPhase);
        f *= f;
        const k = 1 + amt*(TWINKLE_MIN + (TWINKLE_PEAK-TWINKLE_MIN)*f - 1);
        alpha *= k;
        d *= clamp(0.84 + 0.22*k, 0.84, 1.3); // 光った瞬間だけ粒が膨らむ
      }
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.drawImage(glowSprite(p.color), p.x - d/2, p.y - d/2, d, d);
    }
    ctx.restore();
  }

  // 菊物の尾。粒ごとに一本のポリラインを引く。区間ごとに太さを変えると
  // stroke 回数が粒数×区間数になって重いので、一粒一本に留めている
  function drawBurstTails(list){
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for(const p of list){
      const t = p.tail;
      if(!t || t.length < 4) continue;
      const alpha = Math.max(0, p.life / p.maxLife);
      if(alpha <= 0) continue;
      ctx.globalAlpha = alpha * 0.62;
      ctx.strokeStyle = p.color;
      // 写真の尾は細い。粒が大きく育っても線は太らせない
      ctx.lineWidth = clamp(p.r * 0.42, 0.7, 4.5);
      ctx.beginPath();
      ctx.moveTo(t[0], t[1]);
      for(let i=2;i<t.length;i+=2) ctx.lineTo(t[i], t[i+1]);
      ctx.lineTo(p.x, p.y); // 記録済みの末尾から今の位置までを繋ぐ
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawMuzzleParticles(){ drawGlowParticles(muzzleParticles); }
  function drawParticles(){
    drawBurstTails(particles); // 尾が先。頭の輝きを尾で潰さない
    drawGlowParticles(particles);
  }

  function drawWindGauge(){
    if(windVisible <= 0.01) return;
    const speed = Math.abs(windSpeed);
    const calm = speed < 0.15;
    const strength = Math.min(1, speed / WIND_VIS_MAX);
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

    // name the weather, so a sudden shove has an obvious cause
    const tierName  = speed >= 8.5 ? '暴風' : speed >= 5.5 ? '強風' : '風向き';
    const tierColor = speed >= 8.5 ? 'rgba(255,99,99,0.95)'
                    : speed >= 5.5 ? 'rgba(255,190,70,0.9)'
                    : 'rgba(238,242,255,0.45)';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = tierColor;
    ctx.font = (speed >= 5.5 ? 'bold ' : '') + '9px "Hiragino Sans","Yu Gothic",system-ui,sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(tierName, cx-w/2+16, cy-11);

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
    drawWindStreaks();
    drawSpeedLines();
    drawWalls(); // outside the transform - it applies the zoom itself

    // Everything that lives in the world goes inside the pull-back, the burst
    // above all - it used to be drawn after the restore, so the scenery shrank
    // while the shell stayed life-size and you couldn't tell how big it got.
    // Sky and stars stay put: they're the far backdrop, and scaling them down
    // would just expose empty corners.
    ctx.save();
    if(state === 'exploding'){
      const cx = GAME_W/2, cy = GAME_H/2;
      ctx.translate(cx, cy);
      ctx.scale(currentZoom, currentZoom);
      ctx.translate(-cx, -cy);
    }
    drawCannon(); // self-hides once it has scrolled past the bottom edge
    drawObstacles();
    ctx.restore();

    // Whiteout sits above the scenery but below the shot: inside a thunderhead
    // you lose the world, never your own position.
    if(cumuloFog > 0.002){
      ctx.save();
      ctx.globalAlpha = cumuloFog * CUMULO_MAX_ALPHA;
      ctx.fillStyle = '#eef4ff';
      ctx.fillRect(0, 0, GAME_W, GAME_H);
      ctx.restore();
    }

    ctx.save();
    if(state === 'exploding'){
      const cx = GAME_W/2, cy = GAME_H/2;
      ctx.translate(cx, cy);
      ctx.scale(currentZoom, currentZoom);
      ctx.translate(-cx, -cy);
    }
    drawPlayer();
    drawParticles();
    drawMuzzleParticles();
    ctx.restore();

    drawWindGauge(); // HUD, never scaled
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

  // While a text field has focus the game must keep its hands off the keyboard,
  // or the name box would silently eat A, D, W, S and every space.
  const typing = (e) => {
    const t = e.target;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  };

  window.addEventListener('keydown', (e) => {
    if(typing(e)) return;
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
    if(typing(e)) return;
    if(e.code === 'ArrowLeft' || e.code === 'KeyA') keyLeft = false;
    if(e.code === 'ArrowRight' || e.code === 'KeyD') keyRight = false;
    if(e.code === 'ArrowUp' || e.code === 'KeyW') moveUp = false;
    if(e.code === 'ArrowDown' || e.code === 'KeyS') moveDown = false;
  });

  // ---- on-screen pad --------------------------------------------------------
  // The canvas itself takes no touch input at all; steering is entirely through
  // these buttons, so a stray tap or swipe on the play area does nothing.
  function bindPad(btn, apply){
    const set = (v) => (e) => { e.preventDefault(); apply(v); };
    btn.addEventListener('pointerdown', set(true));
    btn.addEventListener('pointerup', set(false));
    btn.addEventListener('pointercancel', set(false));
    btn.addEventListener('pointerleave', set(false)); // sliding off releases it
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  const PAD_KEYS = {
    left:  (v) => { keyLeft = v; },
    right: (v) => { keyRight = v; },
    up:    (v) => { moveUp = v; },
    down:  (v) => { moveDown = v; }
  };
  for(const btn of document.querySelectorAll('[data-dir]')){
    const apply = PAD_KEYS[btn.dataset.dir];
    if(apply) bindPad(btn, apply);
  }

  // ---- analogue stick -------------------------------------------------------
  // Same 120px circle the CSS draws: drag anywhere inside it and the knob
  // follows, capped to the rim. Released, it springs back to dead centre.
  const stick = document.getElementById('stick');
  const knob = document.getElementById('stick-knob');
  const STICK_DEAD = 0.12; // 指を置いただけの微動で流されないよう中央を殺す
  let stickId = null;

  function stickTo(dx, dy){
    // 可動半径。基準はノブが枠からはみ出さない距離
    const r = (stick.clientWidth - knob.offsetWidth) / 2;
    const d = Math.hypot(dx, dy);
    const fit = (d > r && d > 0) ? r/d : 1; // 円の外へは出さない
    knob.style.transform = `translate(${dx*fit}px, ${dy*fit}px)`;
    if(d === 0){ stickX = stickY = 0; return; }
    // デッドゾーンを引いた残りを 0〜1 に引き直す。境目で速度が飛ばない
    const m = Math.min(d/r, 1);
    const gain = m <= STICK_DEAD ? 0 : (m - STICK_DEAD) / (1 - STICK_DEAD);
    stickX = (dx/d) * gain;
    stickY = (dy/d) * gain;
  }

  function stickRelease(){
    stickId = null;
    stickX = stickY = 0;
    stick.classList.remove('active');
    knob.style.transform = 'translate(0px, 0px)';
  }

  function stickFrom(e){
    const b = stick.getBoundingClientRect();
    stickTo(e.clientX - (b.left + b.width/2), e.clientY - (b.top + b.height/2));
  }

  stick.addEventListener('pointerdown', (e) => {
    if(stickId !== null) return; // 二本目の指は無視する
    stickId = e.pointerId;
    // 捕捉できなくても操作自体は続けられる。ここで投げさせて掴んだままにしない
    try{ stick.setPointerCapture(e.pointerId); }catch(err){ /* 枠外に出たら離すだけ */ }
    stick.classList.add('active');
    stickFrom(e);
    e.preventDefault();
  });
  stick.addEventListener('pointermove', (e) => {
    if(e.pointerId !== stickId) return;
    stickFrom(e);
    e.preventDefault();
  });
  for(const type of ['pointerup','pointercancel']){
    stick.addEventListener(type, (e) => { if(e.pointerId === stickId) stickRelease(); });
    // 捕捉に失敗して枠の外で指を離した場合の保険。掴みっぱなしで流され続けない
    window.addEventListener(type, (e) => { if(e.pointerId === stickId) stickRelease(); });
  }
  stick.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---- button / stick toggle ------------------------------------------------
  const STORE_CTRL = 'mirai-hanabi.ctrl';
  const ctrlToggle = document.getElementById('ctrl-toggle');
  let stickMode = load(STORE_CTRL, 'button') === 'stick';

  function applyCtrlMode(){
    document.body.classList.toggle('stick-mode', stickMode);
    // 「押すとどうなるか」を出す。今どちらかは見た目で分かる
    ctrlToggle.textContent = stickMode ? 'ボタン操作に切替' : 'スティック操作に切替';
    // 切り替えた瞬間に押しっぱなしが残ると勝手に流れ続けるので、両方落とす
    keyLeft = keyRight = moveUp = moveDown = false;
    stickRelease();
  }
  ctrlToggle.addEventListener('click', () => {
    stickMode = !stickMode;
    save(STORE_CTRL, stickMode ? 'stick' : 'button');
    applyCtrlMode();
  });
  applyCtrlMode();

  // ---- pinch / double-tap zoom ----------------------------------------------
  // iOS Safari は viewport の user-scalable=no を無視するので、実際に拡大を
  // 止めるには Safari 独自の gesture イベントと二本指の touchmove を潰す。
  for(const type of ['gesturestart','gesturechange','gestureend']){
    document.addEventListener(type, (e) => e.preventDefault(), { passive:false });
  }
  document.addEventListener('touchmove', (e) => {
    if(e.touches.length > 1) e.preventDefault();
  }, { passive:false });
  document.addEventListener('dblclick', (e) => e.preventDefault(), { passive:false });

  // an incoming call or a swiped-away tab must not leave inputs stuck on
  window.addEventListener('blur', () => {
    keyLeft = keyRight = moveUp = moveDown = false;
    stickRelease();
  });

  // ---- swipe-in panels ------------------------------------------------------
  // Narrow screens have no room for the side panels, so they become drawers:
  // swipe right for the guide (it lives left of the board), swipe left for the
  // ranking (right of the board). The direction matches where each one sits on
  // a wide screen, so the mental model is the same either way.
  const guideEl = document.getElementById('guide');
  const rankingEl = document.getElementById('ranking');
  const panelMQ = window.matchMedia('(max-width:1199px)');
  let openPanel = null; // null | 'guide' | 'ranking'

  // Opening a drawer hides the board, so a run in progress would be lost.
  const inFlight = () => state === 'launching' || state === 'playing' || state === 'exploding';

  function syncPanelA11y(){
    const drawer = panelMQ.matches;
    // On a wide screen both panels are simply on show; only the drawer form hides.
    guideEl.setAttribute('aria-hidden', String(drawer && openPanel !== 'guide'));
    rankingEl.setAttribute('aria-hidden', String(drawer && openPanel !== 'ranking'));
  }

  function setPanel(name){
    if(name && inFlight()) return;
    if(name === openPanel) return;
    openPanel = name;
    const cls = document.body.classList;
    cls.toggle('panel-guide', name === 'guide');
    cls.toggle('panel-ranking', name === 'ranking');
    cls.toggle('panel-open', !!name);
    syncPanelA11y();
    if(name === 'ranking') refreshRanking(); // 開くたびに最新の並びを取り直す
  }

  const SWIPE_MIN = 60;     // px。これ未満はタップの手ぶれとして捨てる
  const SWIPE_RATIO = 1.4;  // 縦移動よりこの倍率だけ横に動いていること
  const SWIPE_MS = 700;     // ゆっくりした指の置き直しをスワイプと誤認しない
  let swipe = null;

  window.addEventListener('pointerdown', (e) => {
    swipe = null;
    if(!panelMQ.matches) return;
    if(e.pointerType === 'mouse' && e.button !== 0) return;
    // 操作ボタン・閉じるボタン・名前欄の上から始まった指は、その部品のもの
    if(e.target.closest && e.target.closest('#pad, button, input, textarea')) return;
    swipe = { id:e.pointerId, x:e.clientX, y:e.clientY, t:performance.now() };
  }, { passive:true });

  window.addEventListener('pointerup', (e) => {
    const s = swipe;
    swipe = null;
    if(!s || e.pointerId !== s.id) return;
    if(performance.now() - s.t > SWIPE_MS) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if(Math.abs(dx) < SWIPE_MIN) return;
    if(Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return; // パネルの縦スクロール中
    if(dx < 0){
      setPanel(openPanel === 'guide' ? null : 'ranking');   // 左へ
    } else {
      setPanel(openPanel === 'ranking' ? null : 'guide');   // 右へ
    }
  }, { passive:true });

  window.addEventListener('pointercancel', () => { swipe = null; });

  for(const el of document.querySelectorAll('[data-close-panel]')){
    el.addEventListener('click', () => setPanel(null));
  }
  window.addEventListener('keydown', (e) => {
    if(e.key === 'Escape' && openPanel) setPanel(null);
  });
  // 画面を広げたら常駐表示に戻るので、引き出しの状態は捨てる
  panelMQ.addEventListener('change', () => { setPanel(null); syncPanelA11y(); });
  syncPanelA11y();

  startBtn.addEventListener('click', reset);
  retryBtn.addEventListener('click', reset);

  hudBest.textContent = Math.floor(bestHeightM) + 'm';
  renderSkins();
  refreshRanking();
})();
