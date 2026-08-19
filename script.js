(() => {
  const GAME_W = 480, GAME_H = 800;
  const PLAYER_Y = GAME_H * 0.62;
  // 画面が 1px 流れて何メートル稼ぐか。小さいほど高度の伸びが速い。
  // 見た目の流れる速さ（= 避けにくさ）は変えずに数字の伸びだけを上げられる
  const PIXELS_PER_METER = 5;
  const PLAY_LEFT = 26, PLAY_RIGHT = GAME_W - 26; // side walls: hit them and it's over
  const LAUNCH_Y = GAME_H - 54; // cannon mouth height
  const LAUNCH_DURATION = 0.85;
  const VERTICAL_RANGE = 100; // up/down wiggle room around the usual flight line
  const MOVE_SPEED_X = 260;
  const MOVE_SPEED_Y = 130;
  const CANNON_TOP_OFFSET = 74; // muzzle rim sits this far above the cannon's base line
  const BOOST_DURATION = 1.2;   // how long the muzzle kick keeps pushing after firing
  const BOOST_EXTRA = 340;      // px/s piled on top of cruise speed at t=0, eased to 0

  // ---- スキップ券の駆け上がり -------------------------------------------------
  // 券を使っても打ち上げは地上から。速度は「通常の打ち上げ」に「駆け上がりの山」
  // を重ねた和で作る。差し替えるのではなく足すのが要点で、
  //
  //   出だし   … 通常の打ち上げそのもの。砲口の蹴りが自然に減衰していく
  //   0.3 秒後 … 蹴りが衰え切る前に山が立ち上がり、そのまま加速へ移る
  //   着地     … 山が 0 に戻り、蹴りも尽きて、巡航速度ちょうどで着く
  //
  // 蹴りを等速で置き換えると出だしの減速が消える。砲口から出たあとに落ちる
  // 挙動こそが「撃たれた」に見える部分なので、そこを平らにすると打ち上げに
  // 見えず、最初から終わりまで一様に速い（ビュンと流れるだけの）画になる。
  // 山は smootherstep の微分なので値も傾きも両端で 0。足しても継ぎ目が出ない
  const SKIP_WARP_MIN = 1.6;     // 秒。打ち上げぶんを含んだ全体の長さ
  const SKIP_WARP_ADD = 0.7;     // 距離ぶんの上乗せ。SKIP_WARP_REF で最大
  const SKIP_WARP_REF = 2000;    // ここで伸び切る（＝いまの券の最長）
  const SKIP_WARP_PEAK = 1.875;  // 30*u^2*(1-u)^2 の最大値。強さの正規化に使う
  // 山が立ち上がり始める時刻（秒）。蹴りが尽きる BOOST_DURATION より十分早いので
  // 二つが重なり、速度に谷ができない。遅くするほど打ち上げらしさが増すが、
  // 待たされる間が出る
  const SKIP_HUMP_FROM = 0.3;
  // 砲口の蹴りが一発ぶんで稼ぐ距離。∫BOOST_EXTRA*(1-t/BOOST_DURATION)^2 dt。
  // 山はここを差し引いた残りを受け持つので、足し合わせが目標高度ぴったりになる
  const BOOST_DIST = BOOST_EXTRA * BOOST_DURATION / 3;
  // 速度線を実速度で流すと 1 フレームに数百 px 飛んで、線ではなく点滅に見える。
  // 流す速さは頭打ちにして、代わりに線を伸ばして速さを出す
  const SKIP_LINE_CAP = 1400;
  const SKIP_LINE_STRETCH = 3.4;
  // 地平線の丸め。貼り絵は topY が 1px 動くたびに引き直すので、warp 中の
  // 速さ（16m で 1px ＝ 秒間 80px 前後）だと数フレームに1回引き直すことになる。
  // 48 本の斜め線を引く処理なので、そのままでは 240Hz の持ち時間を食い潰す
  const SKIP_GRID_STEP = 8;
  // warp 中にトレイルの粒を下へ送る量。実速度に比例させると粒まで点滅するので、
  // 見て流れが分かるだけの一定量に留める
  const SKIP_SPARK_CARRY = 420;

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
  // 入口と出口でぼかす px。小さいほど早く真っ白になり、白いままの時間が延びる
  const CUMULO_FADE = 80;
  // 画面全体にかける白。障害物はこの下に描かれるので、上げるほど雲の中が見えなくなる。
  // 雲の本体がさらに 0.28 を重ねる
  const CUMULO_MAX_ALPHA = 0.7;

  // 雲の中に挟む、ところどころ濃いモヤ。一様に白いだけだと、入った瞬間の
  // 「見えない」が500m続くだけで単調になる。薄いところで体勢を立て直し、
  // 濃いところで耐える、という緩急を作るためのもの。
  // 層は雲本体にも濃く描くので、近づいてくるのが（かすかに）見えて身構えられる
  const CUMULO_VEILS = 3, CUMULO_VEILS_RAND = 2; // 一つの雲に挟む枚数
  // 半分の厚み(px)。fog は dt*4 で追いかけるので、薄すぎる層は濃くなり切る前に
  // 通り過ぎてしまう。速度上限(370px/s)でも 0.7 秒は掛かる厚みを下限にしてある
  const CUMULO_VEIL_SPAN = 130, CUMULO_VEIL_SPAN_RAND = 120;
  // fog(0..1) への上乗せ。CUMULO_MAX_ALPHA を掛けた値が実際の白さになる
  // 層は厚いので fog はほぼ狙いどおりまで濃くなる。上限(CUMULO_VEIL_PEAK)に
  // 届く値まで振ると全部の層が同じ濃さで頭打ちになり、「ところどころ」でなく
  // 「ときどき真っ白」になってしまうので、上限の手前で止まる範囲にしてある。
  // 白さにすると 0.756〜0.854（層の外は 0.7）
  const CUMULO_VEIL_GAIN = 0.08, CUMULO_VEIL_GAIN_RAND = 0.14;
  // fog の頭打ち。0.7 を掛けて 0.861 まで。ここを超えると障害物が
  // 本当に見えなくなって、避けようがない事故になる
  const CUMULO_VEIL_PEAK = 1.23;

  // 背景グリッドの地平線。低いうちは画面のかなり下にあり、登るにつれてせり上がる。
  // 上がる区間を長く取っているのは、飛んでいる最中は動いていると気づかないくらい
  // ゆっくりで、ふと見ると変わっている、という効き方にしたいため
  const GRID_TOP_LOW = 0.78;   // 出はじめの位置（画面高に対する割合）
  const GRID_TOP_HIGH = 0.35;  // 上がり切った位置
  const GRID_RISE_FROM = 550;  // グリッドが見え始める高度
  const GRID_RISE_TO = 6000;   // ここで上がり切る

  // 尾に座標を刻む間隔(秒)。粗いほど区間は減るが、trail×これが尾の「長さ(秒)」
  // 尾のグラデーションを作っておくローカル座標の長さ。噴射が抜けた平常時の
  // 長さに合わせてあるので、飛んでいる間はほぼ等倍で当たる
  const TAIL_BASE = 14;
  const HOLO_STEPS = 24; // ホログラムの尾で使う色相の段数
  const TAIL_STEP = 0.05;
  let burstTailStep = TAIL_STEP; // 玉ごとに刻み幅を変える

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

  // ---- 調査用スイッチ --------------------------------------------------------
  // カクつきが「ずっと重い」のか「たまに跳ねる」のかは、実際に遊ぶ端末で
  // 測らないと分からない。URL に付けたときだけ効くので、普通に遊ぶ人には
  // 一切影響しない。
  //   ?debug     … フレーム時間の表示を出す
  //   ?nogrid    … 背景のグリッドを描かない（原因の切り分け用）
  //   ?noshadow  … 玉のぼかし光彩を切る（同上）
  const DEBUG     = /[?&]debug/.test(location.search);
  const NO_GRID   = /[?&]nogrid/.test(location.search);
  const NO_SHADOW = /[?&]noshadow/.test(location.search);

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
  const resultSplit = document.getElementById('result-split');
  const resultPt = document.getElementById('result-pt');
  const skipBlocks = [...document.querySelectorAll('[data-skip-block]')];
  const skipRows = [...document.querySelectorAll('[data-skip-picker]')];
  const skipSubs = [...document.querySelectorAll('[data-skip-sub]')];
  const x2Buttons = [...document.querySelectorAll('[data-x2-toggle]')];
  const ptBadges = [...document.querySelectorAll('[data-pt-badge]')];

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

  // ---- gacha: saved state ----------------------------------------------------
  // 排出テーブルより先に置いてある。スキンの解放判定 isUnlocked() が
  // 「高度で解放」と「ガチャで所持」の両方を見るので、SKINS より前に要る。
  const STORE_PT     = 'mirai-hanabi.pt';      // 所持ポイント
  const STORE_OWNED  = 'mirai-hanabi.owned';   // 引き当てた目玉の id 一覧
  const STORE_TICKET = 'mirai-hanabi.ticket';  // スキップ券の枚数 {"1000":n,...}
  const STORE_PITY   = 'mirai-hanabi.pity';    // 目玉が出ていない連続回数（天井用）
  const STORE_BG     = 'mirai-hanabi.bg';      // 装備中の背景
  const STORE_TRAIL  = 'mirai-hanabi.trail';   // 装備中のトレイル

  const PT_PER_M   = 100;   // 何メートルで 1pt か
  const GACHA_COST = 50;    // 1回の値段 = 5,000m ぶん
  const PITY_MAX   = 25;    // これだけ外し続けたら次は目玉が確定で出る

  // 高度ボーナス。高く上がった回ほどポイントの倍率が上がる。
  // 上から順に見て最初に届いた段を採る（降順に並べておくこと）。
  // 判定に使うのは結果画面に大きく出る「到達高度」。スキップ券で段が上がる
  // ことはあるが、掛ける相手の素点は自力で飛んだぶんのままなので、差は数pt
  // にしかならない。それより、画面の数字と倍率が食い違わないことを取る
  const HEIGHT_BONUS = [
    { m:30000, mult:3.0 },
    { m:20000, mult:2.2 },
    { m:15000, mult:1.8 },
    { m:10000, mult:1.5 },
    { m:5000,  mult:1.2 },
    { m:3000,  mult:1.1 }
  ];
  function heightBonus(m){
    for(const t of HEIGHT_BONUS) if(m >= t.m) return t.mult;
    return 1;
  }

  let gachaPt = Math.max(0, parseInt(load(STORE_PT, '0'), 10) || 0);
  let pityCount = Math.max(0, parseInt(load(STORE_PITY, '0'), 10) || 0);

  // 壊れた JSON が入っていても既定値へ落として続行する。ここで例外を投げると
  // 以降の初期化が全部止まり、ゲームごと起動しなくなる
  function loadJSON(key, fallback){
    try{
      const v = JSON.parse(load(key, ''));
      return (v && typeof v === 'object') ? v : fallback;
    }catch(e){ return fallback; }
  }

  const owned = new Set(Array.isArray(loadJSON(STORE_OWNED, [])) ? loadJSON(STORE_OWNED, []) : []);
  const tickets = loadJSON(STORE_TICKET, {});
  const has = (id) => owned.has(id);
  // 券の枚数は一つの入れ物にまとめてある。スキップ券は高度そのものを鍵にし、
  // 高度を持たない券は名前を鍵にする
  const X2_KEY = 'x2';
  const ticketCount = (k) => Math.max(0, parseInt(tickets[k], 10) || 0);

  function saveOwned(){ save(STORE_OWNED, JSON.stringify([...owned])); }
  function saveTickets(){ save(STORE_TICKET, JSON.stringify(tickets)); }
  function addPoints(n){
    if(n <= 0) return;
    gachaPt += n;
    save(STORE_PT, String(gachaPt));
    renderPtBadges();
  }

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

  // ---- name sanitising -------------------------------------------------------
  // Emoji are rejected outright. They cost two UTF-16 units each, so a 12-unit cut
  // both undercounts them and can land mid-pair, which leaves a broken character
  // on the public board. Barring them keeps "12 units" and "12 characters" equal.
  // Extended_Pictographic alone misses two things: flags, which are pairs of
  // regional-indicator letters, and skin-tone modifiers, which would otherwise be
  // orphaned once their base emoji is stripped.
  const NAME_MAX = 12;
  const NAME_BANNED = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{20E3}\u{200D}]/gu;

  // Cuts by code point, never by UTF-16 unit, so a two-unit kanji like 𠮟 survives
  // whole. No trimming here: it runs while you type, and trimming would eat the
  // space in "長岡 花火" the moment you pressed it.
  function filterName(v){
    const cleaned = String(v == null ? '' : v).replace(NAME_BANNED, '').replace(/\s+/g, ' ');
    // 制御文字はコードポイント値で落とす。正規表現のエスケープを書かずに済む
    return Array.from(cleaned)
      .filter(ch => { const c = ch.codePointAt(0); return c >= 0x20 && c !== 0x7f; })
      .slice(0, NAME_MAX).join('');
  }
  const sanitizeName = (v) => filterName(v).trim();

  let playerName = sanitizeName(load(STORE_NAME, ''));
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
        // 以前に絵文字入りで登録された行も、表示側で同じ規則に揃える
        name: sanitizeName(r.name) || 'ななし',
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
    playerName = sanitizeName(v);
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
  if(nameInput){
    nameInput.addEventListener('keydown', (e) => {
      if(e.code === 'Enter' || e.key === 'Enter'){ setName(nameInput.value); nameInput.blur(); }
    });
    // 打っている最中に弾く。保存時に黙って消えるより、その場で分かるほうがいい。
    // 変換中は書き換えると IME が壊れるので、確定するまで手を出さない
    let composing = false;
    const scrub = () => {
      if(composing) return;
      const fixed = filterName(nameInput.value);
      // 変化したときだけ書き戻す。毎回代入するとカーソルが末尾に飛ぶ
      if(fixed !== nameInput.value) nameInput.value = fixed;
    };
    nameInput.addEventListener('compositionstart', () => { composing = true; });
    nameInput.addEventListener('compositionend', () => { composing = false; scrub(); });
    nameInput.addEventListener('input', scrub);
  }

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
        gravity:26,     // 既定 110。垂れ落ちる速さ
        drag:0.62,      // 既定 1.35。小さいほど遠くまで伸びてから沈む
        life:5.0, lifeSpan:1.6,
        // 88 × 0.08 = 7.04秒ぶん。星の寿命(最大6.6秒)より長いので軌跡が
        // 一度も切り捨てられない。開いた瞬間の中心から、垂れ切った先端までが
        // ずっと一本で残る。巻き取り式だと中心が空き、落下の線も消えていた
        trail:88, tailStep:0.08,
        // 角度の散らし幅。1.0 で等分割の枠いっぱい、0 で完全な等間隔。
        // 大きくすると隣同士が重なって隙間が空くので、控えめに散らす
        spread:0.7,
        // 芯入りの二重構造。外殻の内側にもう一枚、速度を落とした花を作る。
        // coreSpread は速度の幅で、外殻との間の中途半端な半径も埋める
        coreRatio:0.35, coreSpeed:0.45, coreSpread:0.25,
        pistilRatio:0.1, // 芯で光る色玉の割合
        pistil:['#ff69c0','#7dff9e','#b98bff','#ffffff']
      },
      burst:2.4 },

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
      burst:2.2 },

    // ガチャ限定。高度では絶対に解けないので unlock は使わず gacha 印で判定する。
    // 長岡花火は本編の前に、空襲で亡くなった方への慰霊として白一色の三尺玉
    // 「白菊」を打ち上げる。派手さで competing させたくないので、色は足さず
    // 白と銀だけで、正三尺玉よりさらに大きく、ゆっくり垂れるように振ってある。
    { id:'shirogiku', name:'白菊', gacha:true, unlock:Infinity,
      core:'#ffffff', glow:'#e8f2ff',
      trailFrom:'rgba(232,242,255,0.6)', trailTo:'rgba(160,190,230,0)',
      palette:['#ffffff','#f4f9ff','#e8f2ff','#dbe8fa','#ffffff','#eef4ff'],
      kiku:{
        fit:285,        // 正三尺玉(265)よりさらに一回り大きく framed される
        gravity:20, drag:0.55,
        life:5.8, lifeSpan:1.8,
        trail:96, tailStep:0.085,
        spread:0.6,
        coreRatio:0.34, coreSpeed:0.44, coreSpread:0.26,
        // 芯まで白で通す。色玉を混ぜると「慰霊の白菊」ではなくなる
        pistilRatio:0.08,
        pistil:['#ffffff','#f0f6ff','#ffffff','#e6efff']
      },
      burst:2.5 },

    // シークレット。長岡の「米百俵花火・尺玉100連発」から。
    // 米百俵は、目先の食料として配るはずの米を売って学校を建てた長岡の逸話で、
    // 「その一発は、未来まで届くか」というこの作品の題そのものにあたる。
    // secret 印の玉は、持っていないあいだスキン一覧にも出さない（存在を伏せる）
    { id:'kome', name:'米百俵', gacha:true, secret:true, unlock:Infinity,
      core:'#fffbe8', glow:'#f5c518',
      trailFrom:'rgba(245,197,24,0.65)', trailTo:'rgba(180,90,0,0)',
      palette:['#f5c518','#ffd23f','#fff0a8','#e8a33d','#fffbe8','#ffb14a'],
      // 追い咲き。開いたあとも小さな玉が次々に上がって咲き続ける
      volley:{
        shots:16,                 // 追い咲きの数
        gap:0.18, gapRand:0.16,   // 次の玉までの間隔(秒)
        count:24, countRand:16,   // 1発あたりの粒数
        speed:110, speedRand:70,
        life:0.9, lifeSpan:0.7,
        size:2.0
      },
      burst:1.8 }
  ];

  // "1.5k" style so the number still fits inside a locked swatch
  function shortM(m){
    if(m < 1000) return String(m);
    const k = m/1000;
    return (Number.isInteger(k) ? k : k.toFixed(1)) + 'k';
  }

  // 高度で解ける玉と、ガチャでしか手に入らない玉が混ざる。後者は unlock を見ない
  function isUnlocked(s){ return s.gacha ? has('skin:' + s.id) : bestHeightM >= s.unlock; }

  let skinIndex = Math.min(SKINS.length-1, Math.max(0, parseInt(load(STORE_SKIN, '0'), 10) || 0));
  // a cleared best must not leave a locked skin equipped
  if(!isUnlocked(SKINS[skinIndex])) skinIndex = 0;
  function skin(){ return SKINS[skinIndex]; }

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
        // シークレットは持つまで枠ごと出さない。伏せ札で並べてしまうと、
        // 「まだ何かある」と分かってしまい隠す意味がなくなる
        if(s.secret && !open) return;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'skin-dot' + (i === skinIndex ? ' on' : '') + (open ? '' : ' locked')
                    + (s.fx === 'grand' ? ' grand' : '') + (s.gacha ? ' gacha' : '');
        b.style.setProperty('--core', s.core);
        b.style.setProperty('--glow', s.glow);
        b.disabled = !open;
        // 未所持のガチャ玉に「◯m で解放」は嘘になるので、出どころを書く
        const why = s.gacha ? '花火問屋のガチャ限定' : `${s.unlock}m で解放`;
        b.setAttribute('aria-label', open ? s.name : `${s.name}（${why}）`);
        if(!open) b.textContent = s.gacha ? '限' : shortM(s.unlock);
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

  // ---- backgrounds ----------------------------------------------------------
  // 空の色・星・グリッド・街灯りを丸ごと差し替える。段の高度は既定と揃えてあり、
  // 差し替えても「どの高さで景色が変わるか」の体験は動かない。
  const BACKGROUNDS = [
    { id:'default', name:'長岡の夜', stages:STAGES,
      star:'#ffffff', grid:'#29f1ff', city:'#020208', window:'rgba(255,190,90,0.65)' },

    // ガチャ限定。長岡花火は信濃川の河川敷から上がり、玉は川面にも映る。
    // 紫の夜空を藍と碧に振り替え、グリッド（水平線のルーラー）を金にして、
    // 上がるほど水鏡の上に立っているように見せる。
    { id:'shinano', name:'信濃川', gacha:true,
      star:'#eaf6ff', grid:'#ffd23f', city:'#01060c', window:'rgba(255,236,180,0.75)',
      stages:[
        { minH: 0,    top:'#03101a', bottom:'#0a2a38', grid:0.0, stars:0.15 },
        { minH: 120,  top:'#062232', bottom:'#12495c', grid:0.0, stars:0.3  },
        { minH: 550,  top:'#07223f', bottom:'#1c5f6e', grid:0.35,stars:0.55 },
        { minH: 1000, top:'#04182f', bottom:'#12455f', grid:0.7, stars:0.75 },
        { minH: 1600, top:'#010a18', bottom:'#062033', grid:1.0, stars:1.0  }
      ] },

    // UR。夜明けの空。上がるほど地平が焼けていく
    { id:'akatsuki', name:'暁', gacha:true,
      star:'#fff0e0', grid:'#ff8a3d', city:'#0a0510', window:'rgba(255,200,140,0.7)',
      stages:[
        { minH: 0,    top:'#0a0714', bottom:'#2a1420', grid:0.0, stars:0.15 },
        { minH: 120,  top:'#140a1e', bottom:'#4a1f2a', grid:0.0, stars:0.3  },
        { minH: 550,  top:'#1e0e28', bottom:'#7a3030', grid:0.35,stars:0.55 },
        { minH: 1000, top:'#26122e', bottom:'#a8503a', grid:0.7, stars:0.75 },
        { minH: 1600, top:'#2e1636', bottom:'#d98a4a', grid:1.0, stars:1.0  }
      ] },

    // シークレット。他の背景は 1,600m で色が止まるが、これだけは
    // 30,000m まで変わり続ける。夜の地上から成層圏、そして宇宙の際まで。
    // 「どこまで届くか」を空の色そのもので見せるための一枚
    { id:'tengai', name:'天涯', gacha:true, secret:true,
      star:'#ffffff', grid:'#7bdcff', city:'#010104', window:'rgba(210,225,255,0.6)',
      stages:[
        { minH: 0,     top:'#03060f', bottom:'#0b1226', grid:0.0, stars:0.15 },
        { minH: 120,   top:'#050a1c', bottom:'#131c3a', grid:0.0, stars:0.3  },
        { minH: 550,   top:'#0a0d2a', bottom:'#22224e', grid:0.35,stars:0.55 },
        { minH: 1000,  top:'#080a26', bottom:'#2a2050', grid:0.7, stars:0.75 },
        { minH: 1600,  top:'#05061a', bottom:'#1d1440', grid:1.0, stars:1.0  },
        // ここから先が他の背景には無い領域
        { minH: 3000,  top:'#04050f', bottom:'#14103a', grid:1.0, stars:1.0  },
        { minH: 6000,  top:'#020308', bottom:'#0a1030', grid:1.0, stars:1.0  },
        { minH: 10000, top:'#010206', bottom:'#05202c', grid:1.0, stars:1.0  }, // 下端に緑が差す
        { minH: 16000, top:'#000104', bottom:'#063028', grid:1.0, stars:1.0  }, // オーロラ
        { minH: 24000, top:'#000103', bottom:'#1a0a30', grid:1.0, stars:1.0  }, // 紫に転じる
        { minH: 32000, top:'#000000', bottom:'#0a1a2e', grid:1.0, stars:1.0  }  // 地球の縁の光だけ
      ] }
  ];

  // ---- trails ---------------------------------------------------------------
  // 既定は玉ごとの trailFrom/trailTo をそのまま使う。限定だけが色を上書きする。
  const TRAILS = [
    { id:'default', name:'標準', swatch:'linear-gradient(180deg,#ffd23f,rgba(255,120,40,0))' },

    // ガチャ限定。錦の尾を引く「金糸」。太くて長く、走っている間ずっと
    // 火の粉を落とす。噴射粒(muzzleParticles)を借りているので、玉の色に
    // 関係なく金の粉が残る
    { id:'kinshi', name:'金糸', gacha:true,
      from:'rgba(255,240,190,0.9)', to:'rgba(255,140,20,0)',
      width:5, lenScale:1.45, sparkRate:0.03,
      spark:['#fff6d8','#ffe08a','#ffd23f','#ffb14a'],
      swatch:'linear-gradient(180deg,#fff6d8,#ffd23f 45%,rgba(255,140,20,0))' },

    // SR。泡だけは重力を逆にして、粒が下ではなく上へ抜けていく。
    // 水中を昇っているように見えるので、他の尾と一番はっきり区別が付く
    { id:'awa', name:'泡', gacha:true,
      from:'rgba(190,240,255,0.85)', to:'rgba(60,160,220,0)',
      width:4, lenScale:1.1, sparkRate:0.05,
      sparkSize:1.8, sparkGrav:-90, sparkVy:-10, sparkDrift:26, sparkSpread:12, sparkLife:0.8,
      spark:['#dff6ff','#a8e4ff','#7bdcff','#ffffff'],
      swatch:'linear-gradient(180deg,#dff6ff,#7bdcff 50%,rgba(60,160,220,0))' },

    // SR。細かい粒がゆっくり散る。金糸より軽く、白く光る
    { id:'hoshikuzu', name:'星屑', gacha:true,
      from:'rgba(255,253,240,0.9)', to:'rgba(160,180,255,0)',
      width:3, lenScale:1.2, sparkRate:0.026,
      sparkSize:0.9, sparkGrav:120, sparkDrift:44, sparkLife:0.55,
      spark:['#ffffff','#fff3b0','#dbe4f5','#a5b4fc'],
      swatch:'linear-gradient(180deg,#ffffff,#fff3b0 45%,rgba(160,180,255,0))' },

    // SR。横へ大きく流れながらゆっくり落ちる。舞い落ちる葉のように見せる
    { id:'wakaba', name:'若葉', gacha:true,
      from:'rgba(200,255,190,0.85)', to:'rgba(40,140,60,0)',
      width:4, lenScale:1.15, sparkRate:0.05,
      sparkSize:1.5, sparkGrav:70, sparkDrift:110, sparkVy:5, sparkLife:0.9,
      spark:['#d9f99d','#a3e635','#65a30d','#ecfccb'],
      swatch:'linear-gradient(180deg,#d9f99d,#65a30d 55%,rgba(40,140,60,0))' },

    // UR。ロケットの白煙。粒が大きくゆっくり、ほとんど落ちずに漂って残る
    { id:'hakuen', name:'白煙', gacha:true,
      from:'rgba(240,244,255,0.75)', to:'rgba(150,160,180,0)',
      width:9, lenScale:1.6, sparkRate:0.04,
      sparkSize:3.2, sparkGrav:18, sparkDrift:34, sparkVy:8, sparkLife:1.1,
      spark:['#f4f7ff','#dfe5f0','#c6cede','#ffffff'],
      swatch:'linear-gradient(180deg,#ffffff,#dfe5f0 50%,rgba(150,160,180,0))' },

    // シークレット。尾の色が虹を巡り続ける。色が毎フレーム変わるので、
    // 使い回しの帯を色の段数ぶん先に作っておく（fx:'holo' で切り替える）
    { id:'holo', name:'ホログラム', gacha:true, secret:true, fx:'holo',
      width:6, lenScale:1.35, sparkRate:0.028,
      sparkSize:1.3, sparkGrav:150, sparkDrift:50, sparkLife:0.6,
      spark:['#ff2fb0','#ffd23f','#5eead4','#29f1ff','#7b2ff7','#ffffff'],
      swatch:'linear-gradient(180deg,#ff2fb0,#ffd23f 30%,#29f1ff 60%,rgba(123,47,247,0))' }
  ];

  const findBy = (list, id) => list.find(x => x.id === id) || list[0];
  // 所持していないものが保存されていても既定へ落とす（データを消したときの保険）
  const ownedGear = (list, id) => {
    const g = findBy(list, id);
    return (g.gacha && !has(list === BACKGROUNDS ? 'bg:'+g.id : 'trail:'+g.id)) ? list[0] : g;
  };
  let bgId = String(load(STORE_BG, 'default'));
  let trailId = String(load(STORE_TRAIL, 'default'));
  // 描画中に何度も呼ばれる。中の find は毎回クロージャを作るので、
  // 装備が変わるまでは結果を持ち回す。着せ替えたら gearChanged() で捨てる
  let bgCache = null, trailCache = null;
  function background(){ return bgCache || (bgCache = ownedGear(BACKGROUNDS, bgId)); }
  function trail(){ return trailCache || (trailCache = ownedGear(TRAILS, trailId)); }
  function gearChanged(){ bgCache = trailCache = null; skyCur = null; }

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
  // 毎フレーム2回（空と背景）呼ばれる。そのたびに入れ物を作ると、
  // 小さくても 60fps ぶん積み上がって GC を呼ぶので使い回す。
  // 返り値はすぐ読み切る前提（呼び出し側で溜め込まないこと）
  const stageOut = { cur:null, next:null, t:1 };
  function getStage(heightM){
    const STAGES = background().stages;
    let cur = STAGES[0], next = STAGES[STAGES.length-1], t = 1;
    for(let i=0;i<STAGES.length;i++){
      if(heightM >= STAGES[i].minH){
        cur = STAGES[i];
        next = STAGES[i+1] || STAGES[i];
        const range = (next.minH - cur.minH) || 1;
        t = Math.min(1, (heightM - cur.minH) / range);
      }
    }
    stageOut.cur = cur; stageOut.next = next; stageOut.t = t;
    return stageOut;
  }

  let state = 'start'; // start | launching | skipping | playing | exploding | result
  let heightM = 0;
  let hudShownM = -1;  // HUD に今出ている整数メートル。変わったときだけ書き換える
  let runStartM = 0;   // スキップ券で飛ばした分。ポイントはここからの差で数える
  let runX2 = false;   // この回に pt2倍券を使ったか
  // 砲口の蹴り(boost)だけを進める時計。難易度の elapsed とは別で、
  // 券で空中から始めたときは最初から使い切った状態にして蹴りを消す
  let boostTime = 0;
  let scrollSpeed = 0;
  let spawnTimer = 0;
  let obstacles = [];
  let particles = [];
  let stars = [];
  let elapsed = 0;
  // 玉によって落ち方と見せる長さが変わるので、爆発ごとに差し替える
  let burstGravity = BURST_GRAVITY;
  let burstDrag = BURST_DRAG;
  // 開花を見せてから結果画面を出すまでの秒数。粒の寿命とは無関係なので、
  // 長く咲く玉でもここは伸ばさない（続きは結果画面の裏で咲く）
  const RESULT_DELAY = 2.5;
  // 花火が画面に出ているか。粒は爆発でしか作られず reset() で消えるので、
  // 残っていること自体が「演出中」の印になる。state で判定すると、結果画面へ
  // 移った瞬間にカメラが戻って花が原寸で飛び散ってしまう
  // カメラが戻り切るまでを含める。粒が尽きた瞬間に false にすると、戻す途中の
  // 縮んだ世界に変換が掛からなくなって一瞬跳ねる
  const bursting = () => particles.length > 0 || currentZoom < 0.999;

  const player = { x: GAME_W/2, y: LAUNCH_Y, vx: 0, r: 9 };
  let keyLeft = false, keyRight = false;
  let moveUp = false, moveDown = false;
  // スティックの倒し具合。-1〜1 で、ボタン/キーと同じ最高速度に正規化して使う
  let stickX = 0, stickY = 0;
  let launchTimer = 0;
  // 券で駆け上がる区間。skipTargetM が 0 なら普通の打ち上げ。
  // skipHumpPx は山が受け持つ距離（目標から通常の打ち上げぶんを引いた残り）、
  // skipHumpSpan はその山を配る秒数
  let skipTargetM = 0, skipTimer = 0, skipDur = 0;
  let skipHumpPx = 0, skipHumpSpan = 1;
  let warpAmt = 0;      // 0..1 駆け上がりの強さ。速度線と尾の伸びに掛ける
  let warpStretch = 1;  // 速度線を何倍に伸ばして描くか。使い回しの判定と揃える
  let muzzleParticles = [];
  let cloudWallTimer = 6;
  let wallPending = false; // a wall is due and is waiting for a clear corridor
  let sparkleTimer = 0;    // emitter for the finale skin's spark trail
  let trailSparkTimer = 0; // 同じく、装備トレイルが落とす火の粉の間隔
  let cumuloTimer = 0;     // until the next thunderhead
  let cumuloFog = 0;       // 0..1 eased whiteout while inside one
  // 上下の限界に張り付いているときだけ出す赤い線の濃さ。0..1
  let limitTopFade = 0, limitBotFade = 0;
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
  // 瞬きの濃さをまとめる段数と、その計算結果を置く場所。毎フレーム配列を
  // 作らないよう、長さを決めて一度だけ確保しておく
  const STAR_BANDS = 8;
  const starBand = new Uint8Array(stars.length);

  // 地上の街並み。中身は変わらないので毎フレーム作らない
  const buildings = [75,150,105,215,120,175,90,235,110,160];
  const BUILDING_MAX_H = Math.max(...buildings);

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

  // 難易度の時計 elapsed から高度を積分すると
  //   h(t) = (SCROLL_BASE*t + SCROLL_RATE*t^2/2) / PIXELS_PER_METER
  // になる（打ち上げの上乗せ boost は 1.2 秒で消えるので無視できる）。
  // スキップ券はこれを逆に解いて「その高度に着くまでに掛かるはずだった秒数」を
  // 出す。高度だけ飛ばすと、時間で上がる scrollSpeed が遅いまま高高度の
  // 障害物に入ってしまい、券を使ったほうが簡単になってしまう
  function timeForHeight(m){
    if(m <= 0) return 0;
    const a = SCROLL_RATE/2, b = SCROLL_BASE, c = -m*PIXELS_PER_METER;
    return (-b + Math.sqrt(b*b - 4*a*c)) / (2*a);
  }

  // 通常の打ち上げが t 秒で稼ぐ px。巡航ぶん（elapsed で少しずつ増える項は
  // 数秒では 1px 程度にしかならないので SCROLL_BASE で足りる）に、砲口の蹴りが
  // 減衰しながら積む距離を足したもの。券の駆け上がりは、目標高度からこれを
  // 引いた残りだけを山で埋める
  function baseClimbPx(t){
    const left = Math.max(0, 1 - t/BOOST_DURATION);
    return SCROLL_BASE*t + BOOST_DIST*(1 - left*left*left);
  }

  function reset(startM, useX2){
    const from = Math.max(0, startM || 0);
    runX2 = !!useX2;
    // 券を使っても打ち上げは必ず地上から。ただし券の回は打ち上げと駆け上がりを
    // ひと続きで動かすので、最初から 'skipping' に入る（砲口から出る芝居は
    // 通常の打ち上げとまったく同じものを中で回す）
    state = from > 0 ? 'skipping' : 'launching';
    // 引き出しを開いたまま打ち上がると盤が見えないので必ず畳む
    setPanel(null);
    closeGacha();
    document.body.classList.add('playing');
    bestBeforeRun = bestHeightM;
    skinUnlockMsg.classList.add('hidden');
    launchTimer = 0;
    // ポイントは「自力で飛んだぶん」なので、券の高度は最初から差し引いておく。
    // 駆け上がりで heightM は 0 から from まで動くが、その差は 0 のまま
    runStartM = from;
    heightM = 0;
    skipTargetM = from;
    skipTimer = 0;
    warpAmt = 0;
    warpStretch = 1;
    if(from > 0){
      skipDur = SKIP_WARP_MIN + SKIP_WARP_ADD*Math.min(1, from/SKIP_WARP_REF);
      skipHumpSpan = skipDur - SKIP_HUMP_FROM;
      // 通常の打ち上げをそのまま skipDur 秒ぶん走らせたら何 px 進むか。
      // 山はその残りを受け持つので、二つの和がちょうど目標高度になる
      skipHumpPx = from*PIXELS_PER_METER - baseClimbPx(skipDur);
    }
    scrollSpeed = SCROLL_BASE;
    spawnTimer = 1.0;
    cloudWallTimer = 5 + Math.random()*3;
    wallPending = false;
    cumuloTimer = 12 + Math.random()*18; // first one lands a while after 10,000m
    cumuloFog = 0;
    limitTopFade = limitBotFade = 0;
    currentZoom = 1;
    zoomTarget = 1;
    obstacles = [];
    particles = [];
    muzzleParticles = [];
    volleyQueue.length = 0; // 前の回の追い咲きが残っていると次の飛行中に咲く
    // 難易度の時計はここでは 0。券を使った回は、駆け上がりが着いた時点で
    // timeForHeight(from) まで飛ばす。そこから先は風・障害物の密度・
    // スクロール速度が「自力でそこまで飛んできた」状態と揃う
    elapsed = 0;
    boostTime = 0;
    boost = 0;
    player.x = GAME_W/2;
    player.y = LAUNCH_Y;
    player.vx = 0;
    windSpeed = 0; // every run starts calm, then builds once the gauge appears
    windTarget = 0;
    windTimer = 0;
    windVisible = 0;
    windDebrisTimer = 0.4;
    scatterSpeedLines();
    scatterWindStreaks();
    hudShownM = 0;
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

    // 濃いモヤの層。等分割した枠の中で少しだけ散らす。位置を丸ごと乱数で
    // 振ると隣同士が重なって一枚の厚い層になり、緩急が消えてしまう
    const veils = [];
    const n = CUMULO_VEILS + Math.floor(Math.random()*(CUMULO_VEILS_RAND+1));
    for(let i=0;i<n;i++){
      veils.push({
        y: h * ((i + 0.35 + Math.random()*0.3) / n), // 雲の上端からの距離(px)
        span: CUMULO_VEIL_SPAN + Math.random()*CUMULO_VEIL_SPAN_RAND,
        gain: CUMULO_VEIL_GAIN + Math.random()*CUMULO_VEIL_GAIN_RAND
      });
    }
    obstacles.push({ type:'cumulo', x:0, y:-h, w:GAME_W, h, lumps, base, veils });
  }

  function spawnCloudWall(){
    // 抜ける隙間の幅。高度とともに狭まるが、下限は花火の直径(18px)に対して
    // 余裕を残す。分母を大きくしたのは、1px あたりのメートルを 6→5 にした分だけ
    // 実時間での狭まり方が速くなっていたため
    const gapW = Math.max(120, 190 - heightM/50);
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
    burstTailStep = kiku ? kiku.tailStep : TAIL_STEP;
    const lifeMin = kiku ? kiku.life : 1.5;
    const lifeSpan = kiku ? kiku.lifeSpan : 0.9;
    const maxLife = lifeMin + lifeSpan;

    let count = Math.min(BURST_COUNT_CAP, 28 + heightM/BURST_COUNT_DIV) * sk.burst;
    // a ball still reads with a handful of sparks; a heart does not, so shaped
    // shells get a floor to stay legible even on a low, early death
    if(shapeFn) count = Math.max(110, count);
    // 菊は花びらの本数で見える。低い高度で散っても形が出るよう下限を置き、
    // 一本ずつ尾を引く分だけ描画が重いので上限も締める
    if(kiku) count = clamp(count, 560, 900);
    const push = 0.6 + scale*0.5;
    // With drag, a spark coasts to v0/burstDrag - so the fastest spark tells us
    // how wide the flower opens, and gravity sags it further than that. The
    // camera pulls back just enough to frame the result; small bursts need none.
    const reach = ((shapeFn ? 215 : 250) * push + burstGravity) / burstDrag;
    zoomTarget = clamp((kiku ? kiku.fit : BURST_FIT) / reach, BURST_ZOOM_MIN, 1);

    const pistilCount = kiku ? Math.round(count * kiku.pistilRatio) : 0;
    // 芯入りの内側の花。外殻と同じ本数比で撒くと外が薄くなるので割合で切る
    const coreCount = kiku ? Math.round(count * kiku.coreRatio) : 0;
    const outerCount = count - pistilCount - coreCount;

    // 角度を丸ごと乱数で振ると、隙間の大きさが指数分布になって必ず粗密ができる。
    // 等分割した枠の中で少しだけ散らすと、隙間なく並びつつ機械的にも見えない。
    // 層ごとに割り当てるので、内側の花も外殻もそれぞれ均等に回る
    const spoke = (k, n) => ((k + 0.5 + (Math.random()-0.5)*kiku.spread) / n) * Math.PI*2;

    for(let i=0;i<count;i++){
      let vx, vy;
      // 芯で光る色玉 → 内側の花 → 外殻、の順に割り当てる
      const isPistil = i < pistilCount;
      const isCore = !isPistil && i < pistilCount + coreCount;
      if(shapeFn){
        // walk the outline in order so the figure actually forms, with a little
        // jitter in position and speed so it reads as sparks, not a wireframe
        const p = shapeFn((i + Math.random()*0.7) / count);
        const speed = (180 + Math.random()*35) * push;
        vx = p[0]*speed; vy = p[1]*speed;
      } else {
        const angle = kiku
          ? (isCore ? spoke(i - pistilCount, coreCount)
                    : spoke(i - pistilCount - coreCount, outerCount))
          : Math.random()*Math.PI*2;
        // 菊は花びらが同じ長さで揃うほど本物らしい。散らばりを抑えて外周を作る
        let speed = (kiku ? (150 + Math.random()*70) : (70 + Math.random()*180)) * push;
        // 内側の花は速度を落として層を作る。幅を持たせて外殻との間も埋める
        if(isCore) speed *= kiku.coreSpeed + Math.random()*kiku.coreSpread;
        vx = Math.cos(angle)*speed; vy = Math.sin(angle)*speed;
      }
      // 花びらより内側で止まり、尾を引かないので粒として際立つ
      if(isPistil){
        const a = spoke(i, pistilCount);
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
        // 伸びる配列は確保のたびに作り直されて GC を招く。長さを決めて一度だけ取る
        tail: (kiku && !isPistil) ? new Float32Array(kiku.trail*2) : null,
        tailN: 0,   // 書き込み済みの要素数
        tailT: 0,
        // 瞬きの速さと位相。粒ごとにばらさないと全体が一斉に明滅する。
        // 打ち上げ中の噴射粒はこれを持たないので瞬かない
        twRate: kiku ? 0 : TWINKLE_RATE + Math.random()*TWINKLE_RATE_RAND,
        twPhase: Math.random()*Math.PI*2
      });
    }
    // 追い咲きの予約。開いた花を見せてから始めたいので少し置いてから
    volleyQueue.length = 0;
    volleyT = 0;
    volleySkin = sk.volley ? sk : null;
    if(volleySkin){
      let at = 0.4;
      for(let i=0;i<sk.volley.shots;i++){
        at += sk.volley.gap + Math.random()*sk.volley.gapRand;
        volleyQueue.push(at);
      }
    }

    // 記録は到達高度そのもの。スキップ券で飛ばした分もそのまま含める。
    // 自力で飛んだ距離（heightM - runStartM）はポイントの計算にだけ使う
    if(heightM > bestHeightM){
      bestHeightM = heightM;
      save(STORE_BEST, String(Math.floor(bestHeightM)));
    }
  }

  function endToResult(){
    state = 'result';
    document.body.classList.remove('playing'); // スワイプを解禁する
    stickRelease(); // 倒したまま終わってもノブは中央へ戻す
    // 自力で飛んだ距離。記録には使わず、ポイントの計算にだけ使う
    const flownM = Math.max(0, heightM - runStartM);
    resultHeight.textContent = Math.floor(heightM) + 'm';
    resultBest.textContent = '自己ベスト ' + Math.floor(bestHeightM) + 'm';
    hudBest.textContent = Math.floor(bestHeightM) + 'm';

    // 券を使った回は、記録（到達高度）とポイントの元になる距離が食い違う。
    // 黙って違う値で計算すると数が合わないように見えるので、内訳を出す
    if(runStartM > 0){
      resultSplit.textContent =
        `スタート ${Math.floor(runStartM)}m ／ 自力で ${Math.floor(flownM)}m`;
      resultSplit.classList.remove('hidden');
    } else {
      resultSplit.classList.add('hidden');
    }

    // ポイントは自力で飛んだぶんだけ。券で貰った高度は数えないので、
    // 券を回し続けても問屋のポイントは増えない。
    // 自己ベストではなく毎回の飛距離から出すので、失敗した回でも貯まる。
    // 掛ける順は 素点 → 高度ボーナス → 切り捨て → 2倍券。先に2倍してから
    // 切り捨てると、端数の扱いで 2倍券が損をする回が出る。
    // 素点は自力で飛んだぶん、倍率は到達高度で決まる
    const mult = heightBonus(heightM);
    let gained = Math.floor(Math.floor(flownM / PT_PER_M) * mult);
    if(runX2) gained *= 2;
    if(gained > 0){
      addPoints(gained);
      // 自己ベストと同じ行に並ぶので短く。倍率が二つ付くと総額まで載らないので
      // 所持ポイントは書かない（真下の問屋ボタンに大きく出ている）。
      // 3.0 が「×3」になると説明パネルの表と食い違うので、小数第1位で揃える
      const tags = (mult > 1 ? `×${mult.toFixed(1)}` : '') + (runX2 ? '×2' : '');
      resultPt.textContent = `問屋 ${tags ? tags + ' ' : ''}+${gained}pt`;
      resultPt.classList.remove('hidden');
    } else {
      resultPt.classList.add('hidden');
    }
    renderSkipPickers(); // 券を使った直後は残り枚数が減っている

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

  // 追い咲き（米百俵の尺玉連発）。開いたあと、控えている時刻が来るたびに
  // 小さな玉を咲かせる。撃つ位置はそのときのカメラの引き具合から決めるので、
  // 予約しておくのは時刻だけでよい
  const volleyQueue = [];
  let volleyT = 0, volleySkin = null;

  function spawnVolleyShot(sk){
    const V = sk.volley, pal = sk.palette;
    // カメラが引いているぶん見えている世界は広い。その範囲に散らし、
    // 速度と粒の大きさは引き具合で割り戻して、画面上の見た目を揃える
    const z = Math.max(0.05, currentZoom);
    const cx = GAME_W/2 + (Math.random()-0.5) * (GAME_W/z) * 0.75;
    const cy = GAME_H/2 + (Math.random()-0.5) * (GAME_H/z) * 0.75;
    const n = V.count + Math.floor(Math.random()*V.countRand);
    const maxLife = V.life + V.lifeSpan;
    for(let i=0;i<n;i++){
      // 本編の花と同じく、等分した枠の中で少しだけ散らす
      const a = ((i + 0.5 + (Math.random()-0.5)*0.85) / n) * Math.PI*2;
      const sp = (V.speed + Math.random()*V.speedRand) / z;
      particles.push({
        x:cx, y:cy,
        vx:Math.cos(a)*sp, vy:Math.sin(a)*sp,
        r:(V.size + Math.random()*1.4) / z,
        life:V.life + Math.random()*V.lifeSpan, maxLife,
        color:pal[Math.floor(Math.random()*pal.length)],
        tail:null, tailN:0, tailT:0,
        twRate: TWINKLE_RATE + Math.random()*TWINKLE_RATE_RAND,
        twPhase: Math.random()*Math.PI*2
      });
    }
  }

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
        if(depth <= 0) continue;
        const edge = Math.min(1, depth / CUMULO_FADE);

        // 通っている層の上乗せ。層は重ねずに一番濃いものを採る。足し合わせると
        // 隣り合った層が偶然重なったときだけ極端に濃くなってしまう
        let extra = 0;
        const into = player.y - o.y; // 雲の上端からどれだけ入ったか
        for(const v of o.veils){
          const d = Math.abs(into - v.y);
          if(d >= v.span) continue;
          const t = 1 - d/v.span;
          extra = Math.max(extra, v.gain * t*t*(3 - 2*t)); // 山なりに効かせて段差を消す
        }
        // 入口・出口のぼかしを掛けてから足す。雲に入った瞬間に層があっても、
        // まずは薄いところから始まる
        fogTarget = Math.max(fogTarget, edge * (1 + extra));
      }
    }
    cumuloFog += (fogTarget - cumuloFog) * Math.min(1, dt*4);
    const inCumulo = fogTarget > 0;

    // muzzle-flash sparks animate no matter what state we're in
    for(let i=muzzleParticles.length-1;i>=0;i--){
      const p = muzzleParticles[i];
      p.x += p.vx*dt; p.y += p.vy*dt;
      // 粒ごとの重力。既定は下へ落ちるが、泡のトレイルだけは負の値で昇る
      p.vy += (p.g === undefined ? 260 : p.g)*dt;
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
    const flying = state === 'launching' || state === 'playing' || state === 'skipping';
    if(state === 'skipping'){
      // 砲口から出る芝居も、蹴りの減衰も、通常の打ち上げとまったく同じものを
      // 回す。券の回で足すのは「山」だけ
      launchTimer += dt;
      const lt = Math.min(1, launchTimer/LAUNCH_DURATION);
      const le = 1 - Math.pow(1-lt, 3);
      player.y = LAUNCH_Y + (PLAYER_Y - LAUNCH_Y)*le;
      player.x = GAME_W/2 + Math.sin(lt*10)*(1-lt)*4;

      boostTime += dt;
      const kick = Math.pow(1 - Math.min(1, boostTime/BOOST_DURATION), 2); // 通常と同一
      skipTimer += dt;
      const t = Math.min(skipTimer, skipDur);
      // 位置は closed form で直に決める。速度を積むと端数が溜まって目標高度を
      // きっかり踏めず、記録が 1000m ではなく 998m になったりする
      const u = clamp((t - SKIP_HUMP_FROM)/skipHumpSpan, 0, 1);
      const sm = u*u*u*(u*(6*u - 15) + 10);             // smootherstep
      heightM = (baseClimbPx(t) + skipHumpPx*sm) / PIXELS_PER_METER;
      // 難易度の時計は高度から引き直す。着いた時点で timeForHeight(目標) に
      // 揃うので、飛行へ移るときに時計を飛ばす必要がない（飛ばすと巡航速度が
      // その場で段になる）
      elapsed = Math.max(elapsed, timeForHeight(heightM));
      // 速度は同じ和を微分したもの。山の項は smootherstep の微分なので、
      // 立ち上がりも収まりも値・傾きともに 0 から始まって 0 へ戻る
      const humpV = skipHumpPx * 30*u*u*(1-u)*(1-u) / skipHumpSpan;
      const cruise = Math.min(SCROLL_CAP, SCROLL_BASE + elapsed*SCROLL_RATE);
      scrollSpeed = cruise + kick*BOOST_EXTRA + humpV;
      // boost は飛行中と同じ「巡航よりどれだけ速いか」。蹴りの残りだけを入れると、
      // 蹴りが衰えて山がまだ低い 0.6 秒あたりで、一番加速しているのに速度線が
      // 一番薄いという逆さまの画になる
      boost = clamp((scrollSpeed - cruise)/BOOST_EXTRA, 0, 1);
      // 山を 1 とした強さ。速度線の伸ばしと粒の送りに使う
      warpAmt = clamp(humpV*skipHumpSpan/(skipHumpPx*SKIP_WARP_PEAK), 0, 1);
      if(skipTimer >= skipDur){
        heightM = skipTargetM;
        elapsed = Math.max(elapsed, timeForHeight(skipTargetM));
        // 引き継ぎの細工は要らない。山は 0 に戻り切っていて、boostTime も
        // 通常どおり進んできたので、次のフレームの飛行と式ごと地続きになる
        warpAmt = 0;
        skipTargetM = 0;
        state = 'playing';
      }
    } else if(state === 'launching' || state === 'playing'){
      boostTime += dt;
      boost = Math.pow(1 - Math.min(1, boostTime/BOOST_DURATION), 2); // ease-out
      // speed increases very gradually with time survived, not with height directly
      scrollSpeed = Math.min(SCROLL_CAP, SCROLL_BASE + elapsed*SCROLL_RATE) + boost*BOOST_EXTRA;
      heightM += (scrollSpeed*dt) / PIXELS_PER_METER;
    } else {
      boost = 0;
    }

    if(flying){
      warpStretch = 1 + warpAmt*(SKIP_LINE_STRETCH - 1);
      // 表示は整数メートル。低速なら 1 秒に 20 回ほどしか変わらないのに、
      // 毎フレーム書き込むと文字列と DOM 更新をそのぶん捨てることになる
      const shown = Math.floor(heightM);
      if(shown !== hudShownM){
        hudShownM = shown;
        hudHeight.textContent = shown + 'm';
      }

      // 駆け上がり中は世界が桁違いに速く流れる。粒だけその場に残ると玉が止まって
      // 見えるので、下へ送ってやる。実速度に比例させると粒まで点滅するので、
      // 流れが分かるだけの一定量に留める
      const carry = warpAmt * SKIP_SPARK_CARRY;

      // finale skin leaves a continuous spark trail (reuses the muzzle sparks,
      // which already animate and fall in every state)
      if(skin().fx === 'grand'){
        sparkleTimer -= dt;
        while(sparkleTimer <= 0){
          sparkleTimer += 0.028;
          const pal = skin().palette;
          muzzleParticles.push({
            x: player.x + (Math.random()-0.5)*10, y: player.y + player.r,
            vx: (Math.random()-0.5)*40, vy: carry + 30 + Math.random()*50,
            r: 1.2 + Math.random()*1.8,
            life: 0.32 + Math.random()*0.22, maxLife: 0.54,
            color: pal[Math.floor(Math.random()*pal.length)]
          });
        }
      }

      // 粒をこぼすトレイル。万華と重ねて着けても、色が別なのでどちらの粉かは
      // 見て分かる。別タイマーにしてあるので密度も干渉しない。
      // 落ち方・大きさ・散り方はトレイルごとに変えられる（泡は昇る、など）
      const tr = trail();
      if(tr.sparkRate){
        trailSparkTimer -= dt;
        while(trailSparkTimer <= 0){
          trailSparkTimer += tr.sparkRate;
          const sz = tr.sparkSize || 1;
          const life = tr.sparkLife || 0.4;
          muzzleParticles.push({
            x: player.x + (Math.random()-0.5)*(tr.sparkSpread || 8),
            y: player.y + player.r*1.6,
            vx: (Math.random()-0.5)*(tr.sparkDrift || 30),
            vy: carry + (tr.sparkVy === undefined ? 20 : tr.sparkVy) + Math.random()*60,
            r: sz + Math.random()*sz*1.6,
            g: tr.sparkGrav,
            life: life + Math.random()*0.35, maxLife: life + 0.35,
            color: tr.spark[Math.floor(Math.random()*tr.spark.length)]
          });
        }
      }

      // 流す速さは頭打ち。実速度（駆け上がりの山で 1 万 px/s 超）で動かすと
      // 1 フレームに数百 px 飛んで、線ではなく点滅にしか見えない。
      // 使い回しの判定は伸ばしたあとの長さで見る。素の長さで捨てると、
      // 伸びている尻の部分が画面に残ったまま消えてしまう
      const lineSpd = Math.min(scrollSpeed, SKIP_LINE_CAP);
      for(const l of speedLines){
        l.y += lineSpd * l.spd * dt;
        if(l.y - l.len*warpStretch > GAME_H){ // recycle off the top once it has fully passed
          l.y = -Math.random()*120;
          l.x = Math.random()*GAME_W;
        }
      }
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

    // 最後の粒が消えたらカメラを戻す。引きっぱなしで変換だけ外すと、背景が
    // その1フレームで原寸へ飛ぶ
    if(!particles.length) zoomTarget = 1;
    // eased slowly enough that you watch the camera pull back, not blink and miss it
    currentZoom += (zoomTarget - currentZoom) * Math.min(1, dt*3.2);

    // 花火は state と切り離して動かし続ける。結果画面を先に出しても、その裏で
    // 花が開き切って垂れ落ちるまで演出が続く。正三尺玉のように長く咲く玉でも
    // 記録の表示を待たされない
    if(particles.length){
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
          if(p.tailT >= burstTailStep && p.tailN < p.tail.length){
            p.tailT = 0;
            p.tail[p.tailN++] = p.x; p.tail[p.tailN++] = p.y;
          }
        }
        p.x += p.vx*dt;
        p.y += p.vy*dt;
        p.life -= dt;
        if(p.life <= 0) particles.splice(i,1);
      }
    }

    // 追い咲き。結果画面の裏でも続くよう、state とは切り離して回す
    if(volleyQueue.length){
      volleyT += dt;
      while(volleyQueue.length && volleyT >= volleyQueue[0]){
        volleyQueue.shift();
        spawnVolleyShot(volleySkin);
      }
    }

    if(state === 'exploding'){
      explodeTimer += dt;
      // 開花を見せたら結果へ移る。粒の寿命とは切り離してあるので、長く咲く玉は
      // このあと結果画面の裏で咲き続ける。
      // 追い咲きは玉と玉の間で粒が尽きることがあるので、控えが残っていれば待つ
      if(explodeTimer > RESULT_DELAY || (particles.length === 0 && !volleyQueue.length)){
        explodeTimer = 0;
        endToResult();
      }
    }

    // 上下の端に当たっているか。飛んでいる間だけ点灯し、離れると消える。
    // 出るのは速く、消えるのはゆっくり。触れた瞬間を見逃さないため
    let topHit = 0, botHit = 0;
    if(state === 'playing'){
      if(player.y <= PLAYER_Y - VERTICAL_RANGE + 0.5) topHit = 1;
      if(player.y >= PLAYER_Y + VERTICAL_RANGE - 0.5) botHit = 1;
    }
    limitTopFade += (topHit - limitTopFade) * Math.min(1, dt*(topHit ? 18 : 5));
    limitBotFade += (botHit - limitBotFade) * Math.min(1, dt*(botHit ? 18 : 5));
  }

  // 空のグラデーションは毎フレーム作り直していた。段の間の色は連続に変わるが、
  // 1/64 より細かい差は見て分からないので、丸めた値が変わったときだけ作り直す。
  // 最上段(1600m以上)は次の段が自分自身になり t が 1 で止まるため、そこから先は
  // 一度作ったものを使い続ける。
  // 比較はオブジェクトの同一性と数値だけで行う。キーを文字列で作ると、
  // 節約したいゴミを毎フレーム自分で生むことになる
  let skyGrad = null, skyCur = null, skyNext = null, skyQ = -1;
  function drawSky(){
    const { cur, next, t } = getStage(heightM);
    const q = Math.round(t * 64);
    if(cur !== skyCur || next !== skyNext || q !== skyQ){
      skyCur = cur; skyNext = next; skyQ = q;
      const tt = q / 64;
      skyGrad = ctx.createLinearGradient(0,0,0,GAME_H);
      skyGrad.addColorStop(0, lerpColor(cur.top, next.top, tt));
      skyGrad.addColorStop(1, lerpColor(cur.bottom, next.bottom, tt));
    }
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0,0,GAME_W,GAME_H);
  }

  // ---- 背景グリッド ----------------------------------------------------------
  // 横線と奥行きの線あわせて 48 本を毎フレーム stroke していた。斜めのアンチ
  // エイリアス線は塗りが重く、高リフレッシュの環境では 1 フレームの持ち時間
  // （240Hz なら 4.2ms）を超えて数百ミリ秒の詰まりになることがある。
  // 線の絵は地平線 topY が動かなければ同じなので、裏の canvas に描いて貼る。
  // 横線は 34px 周期で流れるだけなので、貼る位置をずらせば使い回せる。
  const GRID_PAD = 40;      // 画面外へはみ出させる量。端に素の空が覗かないように
  const GRID_SPACING = 34;
  const GRID_W = GAME_W + GRID_PAD*2;
  const GRID_H = GAME_H + GRID_PAD + GRID_SPACING;
  const gridPersp = document.createElement('canvas'); // 奥行きの線。流れない
  const gridRows  = document.createElement('canvas'); // 横線。下へ流れる
  let gridKeyTop = -1, gridKeyColor = '', gridKeyDpr = 0;

  // その場で引く版。カメラが引いている開花中だけここを通る
  function strokeGrid(g, topY, offset, padX, padY, color, amt){
    g.strokeStyle = color;
    g.lineWidth = 1;
    g.globalAlpha = amt * 0.5;
    g.beginPath();
    let y = GAME_H - offset;
    while(y < GAME_H + padY) y += GRID_SPACING;
    for(; y > topY; y -= GRID_SPACING){
      g.moveTo(-padX, y);
      g.lineTo(GAME_W + padX, y);
    }
    g.stroke();

    g.globalAlpha = amt * 0.35;
    g.beginPath();
    const cx = GAME_W/2;
    const stretch = (GAME_H + padY - topY) / (GAME_H - topY);
    for(let x = -GAME_W - padX; x < GAME_W*2 + padX; x += 48){
      const sx = cx + (x-cx)*0.2;
      g.moveTo(sx, topY);
      g.lineTo(sx + (x - sx)*stretch, GAME_H + padY);
    }
    g.stroke();
  }

  // 貼り絵を作る。濃さは貼るときに掛けるので、ここでは不透明で描く
  function buildGrid(topY, color, dpr){
    for(const c of [gridPersp, gridRows]){
      c.width  = Math.round(GRID_W*dpr);
      c.height = Math.round(GRID_H*dpr);
    }
    const gp = gridPersp.getContext('2d');
    const gr = gridRows.getContext('2d');
    // 画面の x=-GRID_PAD が裏 canvas の左端に来るようにずらしておく
    for(const g of [gp, gr]){
      g.setTransform(dpr, 0, 0, dpr, GRID_PAD*dpr, 0);
      g.strokeStyle = color;
      g.lineWidth = 1;
    }
    const cx = GAME_W/2;
    const stretch = (GAME_H + GRID_PAD - topY) / (GAME_H - topY);
    gp.beginPath();
    for(let x = -GAME_W - GRID_PAD; x < GAME_W*2 + GRID_PAD; x += 48){
      const sx = cx + (x-cx)*0.2;
      gp.moveTo(sx, topY);
      gp.lineTo(sx + (x - sx)*stretch, GAME_H + GRID_PAD);
    }
    gp.stroke();

    // 横線は 0 から等間隔に引いておく。どの位置に貼っても間隔が合う
    gr.beginPath();
    for(let y = 0; y <= GRID_H; y += GRID_SPACING){
      gr.moveTo(-GRID_PAD, y);
      gr.lineTo(GAME_W + GRID_PAD, y);
    }
    gr.stroke();
  }

  function blitGrid(topY, offset, color, amt, step){
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // 1px 刻み。地平線は 5,450m かけて 344px しか動かないので、作り直しは
    // 16m に1回ほど。240Hz なら「毎フレーム引く」の 200 分の 1 で済む。
    // ただし券の駆け上がりだけは秒間 80px 前後で動くので、その刻みのままだと
    // 数フレームに1回引き直すことになる。呼び側から刻みを粗くしてもらう
    const top = Math.round(topY/(step || 1))*(step || 1);
    if(top !== gridKeyTop || color !== gridKeyColor || dpr !== gridKeyDpr){
      gridKeyTop = top; gridKeyColor = color; gridKeyDpr = dpr;
      buildGrid(top, color, dpr);
    }
    ctx.globalAlpha = amt * 0.35;
    ctx.drawImage(gridPersp, -GRID_PAD, 0, GRID_W, GRID_H);

    // 横線。線が来るべき位置に合わせて貼り、地平線より上は元画像を切り落とす
    const base = (((GAME_H - offset) % GRID_SPACING) + GRID_SPACING) % GRID_SPACING;
    const sy = Math.max(0, top - base);
    if(sy < GRID_H){
      ctx.globalAlpha = amt * 0.5;
      ctx.drawImage(gridRows,
        0, sy*dpr, GRID_W*dpr, (GRID_H - sy)*dpr,
        -GRID_PAD, base + sy, GRID_W, GRID_H - sy);
    }
  }

  function drawBackgroundDetails(){
    const { cur, next, t } = getStage(heightM);
    const bg = background();

    // 星は 70 個ある。以前は 1 個ずつ fillStyle を入れ直して beginPath/fill を
    // 回していた。色文字列の解釈もパスの組み立ても 70 回ぶん毎フレーム捨てられ、
    // ここだけで描画側のゴミの半分以上を作っていた。
    // 瞬きの濃さを 8 段に丸めて、同じ濃さの星を一本のパスにまとめる。
    // 塗りは最大 8 回、色の指定は 1 回で済む（見た目の差は分からない）
    const starDensity = lerp(cur.stars, next.stars, t);
    if(starDensity > 0.004){
      ctx.save();
      ctx.fillStyle = bg.star;
      // どの段に入るかを先に決めておく。範囲の比較で振り分けると、
      // 瞬きがちょうど上限(1.0)の粒がどの段にも入らず消えてしまう
      for(let i=0;i<stars.length;i++){
        const tw = 0.55 + 0.45*Math.sin(elapsed*2 + stars[i].tw);
        starBand[i] = Math.min(STAR_BANDS-1, (tw*STAR_BANDS)|0);
      }
      for(let b=0;b<STAR_BANDS;b++){
        let any = false;
        ctx.beginPath();
        for(let i=0;i<stars.length;i++){
          if(starBand[i] !== b) continue;
          const s = stars[i];
          // arc の前に moveTo を入れないと、前の星から線で繋がれてしまう
          ctx.moveTo(s.x + s.r, s.y);
          ctx.arc(s.x, s.y, s.r, 0, Math.PI*2);
          any = true;
        }
        if(any){
          // その段の中央の濃さで代表させる
          ctx.globalAlpha = starDensity * (b + 0.5) / STAR_BANDS;
          ctx.fill();
        }
      }
      ctx.restore();
    }

    const gridAmt = lerp(cur.grid, next.grid, t);
    if(gridAmt > 0.01 && !NO_GRID){
      // The grid rides the camera pull-back too - it's the clearest ruler on
      // screen for how far a burst has spread. Its extents grow by 1/zoom so the
      // shrunken grid still reaches the frame edges instead of becoming a small
      // patch floating in the middle. The vanishing line is deliberately NOT
      // padded upward: sky belongs above it.
      const z = bursting() ? currentZoom : 1;
      const cx = GAME_W/2, cy = GAME_H/2;
      // +40 of slack: without it the padding lands exactly on the frame edge and
      // a rounding error shows a sliver of bare sky there
      const padX = (GAME_W/2) * (1/z - 1) + GRID_PAD;
      const padY = (GAME_H/2) * (1/z - 1) + GRID_PAD;
      const offset = (elapsed*40) % GRID_SPACING;
      // 地平線をせり上げる。両端で滑らかに繋がるよう smoothstep で均す
      const r = clamp((heightM - GRID_RISE_FROM) / (GRID_RISE_TO - GRID_RISE_FROM), 0, 1);
      const topY = GAME_H * lerp(GRID_TOP_LOW, GRID_TOP_HIGH, r*r*(3 - 2*r));

      ctx.save();
      if(z !== 1){
        // 開花中だけカメラが引く。はみ出す量が毎フレーム変わるので貼り絵に
        // できないが、数秒で終わるうえ結果画面の裏なのでその場で引く
        ctx.translate(cx, cy);
        ctx.scale(z, z);
        ctx.translate(-cx, -cy);
        strokeGrid(ctx, topY, offset, padX, padY, bg.grid, gridAmt);
      } else {
        // 平常時。線の絵は地平線(topY)が動かないかぎり同じなので、裏の canvas に
        // 描いておいて貼るだけにする。毎フレーム 48 本の斜め線を引き直すのが
        // カクつきの原因だった（240Hz だと 1 フレーム 4ms しか無い）
        blitGrid(topY, offset, bg.grid, gridAmt,
          state === 'skipping' ? SKIP_GRID_STEP : 1);
      }
      ctx.restore();
    }

    const cityDrop = heightM * PIXELS_PER_METER; // sinks away at the same rate the world scrolls past
    // 街は 200m ちょっとで見えなくなるのに、判定より前に配列と最大値を
    // 毎フレーム作り直していた。中身は定数なので外へ出す
    if(cityDrop < GAME_H + BUILDING_MAX_H + 40){
      ctx.save();
      ctx.fillStyle = bg.city;
      let x = 0;
      const bw = GAME_W / buildings.length;
      for(let i=0;i<buildings.length;i++){
        ctx.fillRect(x, GAME_H - buildings[i] + cityDrop, bw-3, buildings[i]);
        x += bw;
      }
      ctx.fillStyle = bg.window;
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
      // 駆け上がり中は流す速さを頭打ちにしてあるぶん、線を伸ばして速さを出す
      const len = l.len * warpStretch;
      ctx.globalAlpha = boost * l.alpha;
      ctx.drawImage(speedSprite, l.x-1, l.y - len, 2, len);
    }
    ctx.restore();
  }

  // Deliberately drawn OUTSIDE the camera transform and never scaled. The walls
  // are the frame of the play area rather than scenery inside it, so they stay
  // exactly where they started even while the burst pulls the camera back.
  // 壁の滲みは位置も色も一切変わらない。毎フレーム作り直す理由がないので
  // 初回だけ作って使い回す
  let wallGradL = null, wallGradR = null;
  function drawWalls(){
    const wallW = PLAY_LEFT;
    if(!wallGradL){
      wallGradL = ctx.createLinearGradient(0,0,wallW,0);
      wallGradL.addColorStop(0, 'rgba(255,47,176,0.55)');
      wallGradL.addColorStop(1, 'rgba(255,47,176,0)');
      wallGradR = ctx.createLinearGradient(GAME_W,0,GAME_W-wallW,0);
      wallGradR.addColorStop(0, 'rgba(255,47,176,0.55)');
      wallGradR.addColorStop(1, 'rgba(255,47,176,0)');
    }
    ctx.save();
    ctx.fillStyle = wallGradL;
    ctx.fillRect(0,0,wallW,GAME_H);
    ctx.fillStyle = wallGradR;
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
        // 雲は 500m ぶんの高さがあり、抜けるまで何百フレームも描き続ける。
        // グラデーションは雲の上端を原点にした形で一度だけ作り、
        // 毎フレームは translate で位置を合わせるだけにする
        ctx.save();
        ctx.translate(0, o.y);
        if(!o._grad){
          const f = Math.min(0.3, 260 / o.h);
          o._grad = ctx.createLinearGradient(0, 0, 0, o.h);
          o._grad.addColorStop(0,   'rgba(238,244,255,0)');
          o._grad.addColorStop(f,   'rgba(238,244,255,0.28)');
          o._grad.addColorStop(1-f, 'rgba(238,244,255,0.28)');
          o._grad.addColorStop(1,   'rgba(238,244,255,0)');
        }
        ctx.fillStyle = o._grad;
        ctx.fillRect(0, 0, GAME_W, o.h);

        // 濃いモヤの層。画面全体の白飛ばしより手前で見えるので、
        // 上から迫ってくる帯として読める。これが唯一の予告になる
        for(const v of o.veils){
          const top = v.y - v.span, span = v.span*2;
          if(o.y + top > GAME_H || o.y + top + span < 0) continue;
          if(!v._grad){
            v._grad = ctx.createLinearGradient(0, top, 0, top + span);
            v._grad.addColorStop(0,   'rgba(238,244,255,0)');
            v._grad.addColorStop(0.5, `rgba(238,244,255,${(0.10 + v.gain).toFixed(3)})`);
            v._grad.addColorStop(1,   'rgba(238,244,255,0)');
          }
          ctx.fillStyle = v._grad;
          ctx.fillRect(0, top, GAME_W, span);
        }
        ctx.translate(0, -o.y); // 以降の puff は元の絶対座標で描く

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
    if(bursting()) return; // 爆発した殻は出さない
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
    ctx.shadowBlur = NO_SHADOW ? 0 : (grand ? 26 : 18);
    ctx.shadowColor = glow;
    ctx.fillStyle = sk.core;
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.r, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();

    // exhaust trail, stretched while the muzzle kick is still pushing.
    // 装備中のトレイルが色と太さを上書きする。既定は玉自身の色をそのまま使う
    const tr = trail();
    // 駆け上がり中はさらに引き伸ばす。玉は画面に固定されているので、
    // 尾の長さが「いまどれだけ速いか」を出せる数少ない手がかりになる
    const tailLen = (14 + boost*54 + warpAmt*90) * (tr.lenScale || 1);
    const tailTop = player.y + player.r;
    // グラデーションは座標を抱え込むので、玉が動くたびに作り直していた。
    // 原点まわりの固定長で一本だけ作っておき、translate/scale で当てはめる。
    // 縦だけ伸ばしても線の太さ（横方向）は変わらないので見た目は同じ。
    // 色の出どころ（トレイル定義、既定なら玉）に持たせるので、装備ごとに一本で済む
    let grad;
    if(tr.fx === 'holo'){
      // 虹を巡る尾。毎フレーム作ると元の木阿弥なので、色相を刻んだ帯を
      // 先に作っておき、時間で選ぶだけにする
      if(!tr._holo){
        tr._holo = [];
        for(let i=0;i<HOLO_STEPS;i++){
          const h = i*360/HOLO_STEPS;
          const g = ctx.createLinearGradient(0, 0, 0, TAIL_BASE);
          g.addColorStop(0, `hsl(${h},100%,74%)`);
          g.addColorStop(1, `hsla(${(h+70)%360},100%,58%,0)`);
          tr._holo.push(g);
        }
      }
      grad = tr._holo[Math.floor(elapsed*HOLO_STEPS*0.5) % HOLO_STEPS];
    } else {
      const src = tr.from ? tr : sk;
      if(!src._tailGrad){
        src._tailGrad = ctx.createLinearGradient(0, 0, 0, TAIL_BASE);
        src._tailGrad.addColorStop(0, tr.from || sk.trailFrom);
        src._tailGrad.addColorStop(1, tr.to   || sk.trailTo);
      }
      grad = src._tailGrad;
    }
    ctx.save();
    ctx.translate(player.x, tailTop);
    ctx.scale(1, tailLen / TAIL_BASE);
    ctx.strokeStyle = grad;
    ctx.lineWidth = (tr.width || 3) + boost*2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, TAIL_BASE);
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
      // 配列は最初から満杯の長さで持っているので、書き込み済みの数で見る
      if(!t || p.tailN < 4) continue;
      const alpha = Math.max(0, p.life / p.maxLife);
      if(alpha <= 0) continue;
      // 垂れ下がるのは寿命の後半なので、頭と同じ速さで薄くすると
      // いちばん見せたい落下の線が消えてしまう。尾だけ暮れ方を緩める
      ctx.globalAlpha = Math.pow(alpha, 0.6) * 0.72;
      ctx.strokeStyle = p.color;
      // 写真の尾は細い。粒が大きく育っても線は太らせない
      ctx.lineWidth = clamp(p.r * 0.42, 0.7, 4.5);
      ctx.beginPath();
      ctx.moveTo(t[0], t[1]);
      for(let i=2;i<p.tailN;i+=2) ctx.lineTo(t[i], t[i+1]);
      ctx.lineTo(p.x, p.y); // 記録済みの末尾から今の位置までを繋ぐ
      ctx.stroke();
    }
    ctx.restore();
  }

  // 上下の限界線。押し続けている間だけ薄く出て、そこが端だと伝える。
  // 壁と同じピンクだと「当たると死ぬ」に見えるので、赤で別物として描く
  // 壁と同じく位置も色も固定。押し続けている間ずっと出るので、
  // 毎フレーム作ると押しっぱなしの間だけゴミが増える
  let limitGrad = null;
  function drawLimitLines(){
    // dir は線から見た外側。-1 = 上の線、+1 = 下の線
    const draw = (y, a, dir) => {
      if(a <= 0.004) return;
      ctx.save();
      // 中央が濃く、左右の端に向かって消える。画面を横断する枠には見せない
      if(!limitGrad){
        limitGrad = ctx.createLinearGradient(PLAY_LEFT, 0, PLAY_RIGHT, 0);
        limitGrad.addColorStop(0,    'rgba(255,60,80,0)');
        limitGrad.addColorStop(0.5,  'rgba(255,60,80,0.5)');
        limitGrad.addColorStop(1,    'rgba(255,60,80,0)');
      }
      const w = PLAY_RIGHT - PLAY_LEFT;
      ctx.globalAlpha = a;
      ctx.fillStyle = limitGrad;
      ctx.fillRect(PLAY_LEFT, y-1, w, 2);
      // 滲みは外側だけに伸ばす。内側に広げると玉にかぶる
      ctx.globalAlpha = a*0.35;
      ctx.fillRect(PLAY_LEFT, dir < 0 ? y-7 : y-1, w, 8);
      ctx.restore();
    };
    // 玉の中心ではなく、玉の上端／下端に接する位置へ。+1 は線の太さの半分
    const off = player.r + 1;
    draw(PLAYER_Y - VERTICAL_RANGE - off, limitTopFade, -1);
    draw(PLAYER_Y + VERTICAL_RANGE + off, limitBotFade, +1);
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
    const w = 168, h = 44;
    // 中身は固定 px で組んであるので、拡大は変換行列で一括して掛ける。
    // 文字・線幅・矢印の比率が崩れないし、数値を個別に直す必要もない
    const S = 1.3;
    // 下端の余白は拡大前と同じにする。大きくした分だけ中心を持ち上げる
    const cx = GAME_W/2, cy = GAME_H - 52 - (h*(S-1))/2;

    ctx.save();
    ctx.globalAlpha = windVisible;
    ctx.translate(cx, cy);
    ctx.scale(S, S);
    ctx.translate(-cx, -cy);

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
    if(bursting()){
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
      // 濃いモヤの層で 1 を超えてくる。頭打ちにしないと真っ白になる
      ctx.globalAlpha = Math.min(cumuloFog, CUMULO_VEIL_PEAK) * CUMULO_MAX_ALPHA;
      ctx.fillStyle = '#eef4ff';
      ctx.fillRect(0, 0, GAME_W, GAME_H);
      ctx.restore();
    }

    ctx.save();
    if(bursting()){
      const cx = GAME_W/2, cy = GAME_H/2;
      ctx.translate(cx, cy);
      ctx.scale(currentZoom, currentZoom);
      ctx.translate(-cx, -cy);
    }
    drawLimitLines(); // 自機の下。線が玉を隠さない
    drawPlayer();
    drawParticles();
    drawMuzzleParticles();
    ctx.restore();

    drawWindGauge(); // HUD, never scaled
    if(DEBUG) drawPerf();
  }

  // ---- フレーム時間の計測（?debug のときだけ）--------------------------------
  // 測るのは rAF が呼ばれる間隔そのもの。JS の実行時間だけでなく、
  // 描画・合成・GC も全部ここに現れるので、「重い」のか「跳ねている」のかが
  // これひとつで分かる
  // 跳ねた原因を切り分けるために、1フレームを二つに分けて見る。
  //   work … update+draw に自分で使った時間
  //   間隔 … rAF が次に呼ばれるまでの実時間（work のほか、画面への転送・GC・
  //          ブラウザ側の割り込みが全部入る）
  // work が小さいのに間隔だけ大きければ、原因は自分のコードの外にある。
  // GC かどうかは、その瞬間にヒープが減ったかで見分けられる
  const SPIKE_MS = 32; // 60fps で2フレーム落ちた相当
  const perf = { prev:0, ema:16.7, worst:0, win:0, spikes:0, work:0, heap:0, recent:[] };
  const heapNow = () => (performance.memory ? performance.memory.usedJSHeapSize : 0);
  function perfSample(ts){
    const heap = heapNow();
    if(perf.prev){
      const d = ts - perf.prev;
      perf.ema += (d - perf.ema) * 0.08;
      if(d > perf.worst) perf.worst = d;
      // 駆け上がりは背景が一番速く動く区間なので、詰まるならまずここに出る
      if(d > SPIKE_MS && (state === 'playing' || state === 'skipping')){
        perf.spikes++;
        const drop = (perf.heap - heap) / 1048576;
        perf.recent.unshift(
          `${Math.round(heightM)}m ${Math.round(d)}ms work${perf.work.toFixed(1)}`
          + (drop > 0.2 ? ` GC-${drop.toFixed(1)}M` : '')
        );
        if(perf.recent.length > 3) perf.recent.pop();
      }
      // 直近の山だけ見たいので、2秒ごとに最悪値を捨てる
      perf.win += d;
      if(perf.win > 2000){ perf.win = 0; perf.worst = 0; }
    }
    perf.prev = ts;
    perf.heap = heap;
  }
  function drawPerf(){
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.fillRect(6, 92, 300, 82);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = 'bold 12px monospace';
    ctx.fillStyle = perf.ema > 20 ? '#ff8a8a' : '#5eff9e';
    ctx.fillText(`${(1000/perf.ema).toFixed(0)}fps worst${perf.worst.toFixed(0)} work${perf.work.toFixed(1)}`, 12, 110);
    ctx.fillStyle = perf.spikes ? '#ffd23f' : 'rgba(238,242,255,0.6)';
    ctx.fillText(`spikes ${perf.spikes}  heap ${(perf.heap/1048576).toFixed(1)}M`, 12, 127);
    ctx.fillStyle = 'rgba(238,242,255,0.8)';
    ctx.font = '10px monospace';
    for(let i=0;i<perf.recent.length;i++) ctx.fillText(perf.recent[i], 12, 142 + i*13);
    ctx.restore();
  }

  // ---- 横向きの停止 ---------------------------------------------------------
  // 条件は style.css の #rotate と必ず同じにする。片方だけ変えると、
  // 「お断りは出ているのに裏でゲームが進んでいる」状態になる
  const rotateMQ = window.matchMedia('(orientation: landscape) and (max-height: 600px) and (hover: none)');
  rotateMQ.addEventListener('change', (e) => {
    if(!e.matches) return;
    // 傾けた拍子に押しっぱなしのまま止まると、縦へ戻した瞬間に横へ吹っ飛ぶ
    keyLeft = keyRight = moveUp = moveDown = false;
    stickRelease();
  });

  let lastTime = 0;
  function loop(ts){
    if(!lastTime) lastTime = ts;
    const dt = Math.min(0.05, (ts-lastTime)/1000);
    lastTime = ts;
    // 跳ねた原因の切り分けに使う。間隔(ts の差)より前にこのフレームの
    // 「自分で使った時間」を確定させたいので、計測は draw のあとに置く
    if(DEBUG) perfSample(ts);
    const w0 = DEBUG ? performance.now() : 0;
    // 横向きの間は時間を進めない。飛行中に持ち替えただけで死ぬのは理不尽なので、
    // 縦へ戻すと止まったところから続く。dt は毎フレーム捨てているので、
    // 戻した瞬間にまとめて進むこともない
    if(!rotateMQ.matches) update(dt);
    draw();
    if(DEBUG) perf.work = performance.now() - w0;
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
      // ボタンと同じ入口を通す。reset() を直接呼ぶと、選んだスキップ券が
      // 消費も適用もされないまま地上から上がってしまう
      if(state === 'start' || state === 'result') launch();
    }
  });
  window.addEventListener('keyup', (e) => {
    if(typing(e)) return;
    if(e.code === 'ArrowLeft' || e.code === 'KeyA') keyLeft = false;
    if(e.code === 'ArrowRight' || e.code === 'KeyD') keyRight = false;
    if(e.code === 'ArrowUp' || e.code === 'KeyW') moveUp = false;
    if(e.code === 'ArrowDown' || e.code === 'KeyS') moveDown = false;
  });

  // ---- gacha: pool ----------------------------------------------------------
  // 確率はレア度ごとに固定。品ごとの重みは持たせず、そのレア度の枠を
  // 中の品で等分する（同じレア度なら必ず同じ確率になる）。
  // 表示は花火の等級らしく「並・上・特上・極上・秘蔵」を添える。
  //   tier … 高いほど格上。確定演出を出すかの判定に使う
  //   hidden … 品書きに載せない。シークレットは引くまで存在を伏せる
  const RANKS = {
    N:      { label:'N',      name:'並',   color:'#dbe4f5', rate:0.695, tier:0 },
    R:      { label:'R',      name:'上',   color:'#7bdcff', rate:0.25,  tier:1 },
    SR:     { label:'SR',     name:'特上', color:'#c084fc', rate:0.04,  tier:2 },
    UR:     { label:'UR',     name:'極上', color:'#ffd23f', rate:0.01,  tier:3 },
    SECRET: { label:'SECRET', name:'秘蔵', color:'#ff5fa8', rate:0.005, tier:4, hidden:true }
  };

  // 演出の花火はレア度によらず薄い黄色なので、品ごとの色は持たせていない
  const GACHA_POOL = [
    { id:'skin:kome', kind:'skin', rank:'SECRET', name:'米百俵',
      desc:'長岡の「米百俵花火・尺玉100連発」。開いたあとも、小さな玉が次々に咲き続けます。スタート画面の「花火スキン」から選べます。' },

    { id:'bg:tengai', kind:'bg', rank:'SECRET', name:'天涯',
      desc:'他の空は1,600mで色が止まりますが、これだけは30,000mまで変わり続けます。夜の地上から成層圏、そして宇宙の際まで。' },

    { id:'trail:holo', kind:'trail', rank:'SECRET', name:'ホログラム',
      desc:'尾の色が虹を巡り続けます。どの玉に着けても、その玉の色とは無関係に光ります。' },

    { id:'skin:shirogiku', kind:'skin', rank:'UR', name:'白菊',
      desc:'長岡花火が本編の前に上げる、慰霊の白一色の三尺玉。スタート画面の「花火スキン」から選べます。' },

    { id:'bg:akatsuki', kind:'bg', rank:'UR', name:'暁',
      desc:'夜明けの空。上がるほど地平が焼けて、朝焼けの色に変わっていきます。' },

    { id:'trail:hakuen', kind:'trail', rank:'UR', name:'白煙',
      desc:'ロケットの白煙。太く長い尾を引き、大きな煙の粒がほとんど落ちずに漂って残ります。' },

    { id:'bg:shinano', kind:'bg', rank:'SR', name:'信濃川',
      desc:'玉が上がる河川敷の空。夜空が藍と碧に変わり、地平のルーラーが金になります。' },

    { id:'trail:kinshi', kind:'trail', rank:'SR', name:'金糸',
      desc:'太く長い金の尾。飛んでいるあいだ、ずっと火の粉を落とし続けます。' },

    { id:'trail:awa', kind:'trail', rank:'SR', name:'泡',
      desc:'水色の泡が、落ちるのではなく上へ抜けていきます。水の中を昇っているように見えます。' },

    { id:'trail:hoshikuzu', kind:'trail', rank:'SR', name:'星屑',
      desc:'細かく白い粒が、広がりながらゆっくり散ります。金糸より軽い尾です。' },

    { id:'trail:wakaba', kind:'trail', rank:'SR', name:'若葉',
      desc:'緑の粒が横へ大きく流れながら落ちます。舞い落ちる葉のような尾です。' },

    // key は手持ちの保存先。スキップ券は高度、それ以外は名前を使う
    { id:'ticket:x2', kind:'ticket', rank:'R', key:X2_KEY, name:'pt2倍券',
      desc:'使った回にもらえるポイントが2倍になります。打ち上げる前に「使う」を選んでください。' },

    { id:'ticket:2000', kind:'ticket', rank:'N', m:2000, key:2000, name:'2000mスキップ券',
      desc:'2000m から打ち上げます。到達高度がそのまま記録になります（ポイントだけは自力で飛んだぶんから）。' },

    { id:'ticket:1000', kind:'ticket', rank:'N', m:1000, key:1000, name:'1000mスキップ券',
      desc:'1000m から打ち上げます。到達高度がそのまま記録になります（ポイントだけは自力で飛んだぶんから）。' },

    { id:'ticket:500', kind:'ticket', rank:'N', m:500, key:500, name:'500mスキップ券',
      desc:'500m から打ち上げます。到達高度がそのまま記録になります（ポイントだけは自力で飛んだぶんから）。' }
  ];

  // スキップ券の高度。ここに足せば手持ち欄とスタート高度の選択肢に自動で並ぶ
  const TICKET_M = [500, 1000, 2000];

  const isPrize = (e) => e.kind !== 'ticket';
  const inPool  = (e) => !(isPrize(e) && has(e.id)); // 引き当て済みの目玉は出ない
  // 天井の対象。シークレットは外す。入れてしまうと、通常 0.5% の品が
  // 天井では 9%（0.5 ÷ 5.5）で出ることになり、隠し玉の意味が無くなる
  const isPityPrize = (e) => isPrize(e) && !RANKS[e.rank].hidden;

  // いま引ける品それぞれの確率を出す。合計は必ず 1。
  //   ・レア度の枠(RANKS[].rate)を、そのレア度の品数で等分する
  //   ・引き当て済みで品が無くなったレア度の枠は、残ったレア度へ按分する
  //     （そうしないと合計が 1 に足りず、確率が宙に浮く）
  // 使い回しの Map。ガチャは1回引くたびにしか呼ばれないので取り合いは起きない
  const oddsOut = new Map();
  function gachaOdds(){
    oddsOut.clear();
    const byRank = new Map();
    for(const e of GACHA_POOL){
      if(!inPool(e)) continue;
      if(!byRank.has(e.rank)) byRank.set(e.rank, []);
      byRank.get(e.rank).push(e);
    }
    let total = 0;
    for(const rank of byRank.keys()) total += RANKS[rank].rate;
    if(total <= 0) return oddsOut;
    for(const [rank, items] of byRank){
      const share = RANKS[rank].rate / total / items.length;
      for(const e of items) oddsOut.set(e, share);
    }
    return oddsOut;
  }

  function rollGacha(){
    const odds = gachaOdds();
    const prizes = [...odds.keys()].filter(isPityPrize);
    // 天井。PITY_MAX 回続けて目玉が出なければ、その回は目玉から確定で出す。
    // 目玉が全部揃っていれば天井は働かず、券だけが出続ける。
    // 目玉の中でもレア度の比は保つ（確定でも UR より SR が出やすい）
    const forced = prizes.length > 0 && pityCount + 1 >= PITY_MAX;
    const from = forced ? prizes : [...odds.keys()];

    let sum = 0;
    for(const e of from) sum += odds.get(e);
    let r = Math.random() * sum;
    let hit = from[from.length - 1];
    for(const e of from){ r -= odds.get(e); if(r <= 0){ hit = e; break; } }

    // シークレットは天井の外なので、当てても数え直さない。ここで 0 に戻すと
    // 「あと何回で目玉が確定」という約束を、対象外の品で反故にしてしまう
    pityCount = isPityPrize(hit) ? 0 : pityCount + 1;
    save(STORE_PITY, String(pityCount));

    if(hit.kind === 'ticket'){
      tickets[hit.key] = ticketCount(hit.key) + 1;
      saveTickets();
    } else {
      owned.add(hit.id);
      saveOwned();
    }
    return hit;
  }

  // ---- gacha: shop UI -------------------------------------------------------
  const gachaScreen = document.getElementById('gacha-screen');
  const gachaPtEl   = document.getElementById('gacha-pt');
  const gachaPullBtn= document.getElementById('gacha-pull');
  const gachaPityEl = document.getElementById('gacha-pity');
  const gachaRatesEl= document.getElementById('gacha-rates');
  const stockBg     = document.getElementById('stock-bg');
  const stockTrail  = document.getElementById('stock-trail');
  const stockTicket = document.getElementById('stock-ticket');

  function renderPtBadges(){
    for(const el of ptBadges) el.textContent = gachaPt + 'pt';
    if(gachaPtEl) gachaPtEl.textContent = String(gachaPt);
    if(gachaPullBtn){
      gachaPullBtn.disabled = gachaPt < GACHA_COST || fxRunning;
      gachaPullBtn.textContent = `1回引く（${GACHA_COST}pt）`;
    }
  }

  function rankBadge(rank){
    const el = document.createElement('span');
    el.className = 'rank-badge rank-' + rank;
    el.textContent = RANKS[rank].label;
    return el;
  }

  // 0.333% のような細かい値も 0.8% のような切りのいい値も素直に出す。
  // 一律に桁を揃えると 25.000% のような読みにくい表記になる
  const ratePct = (v) => (v*100).toFixed(3).replace(/\.?0+$/, '') + '%';

  // 品書きに出す順。格上から並べる（シークレットはそもそも載せない）
  const RATE_ORDER = ['UR', 'SR', 'R', 'N'];

  function renderRates(){
    if(!gachaRatesEl) return;
    gachaRatesEl.textContent = '';
    const odds = gachaOdds();
    const pool = GACHA_POOL.filter(inPool);
    // レア度ごとにまとめる。見出しにそのレア度の合計、その下に品ごとの内訳。
    // 「UR は 1%、その中で3つが等分」という仕組みが表のまま伝わる
    for(const rank of RATE_ORDER){
      // シークレットは品書きに載せない。載っていない 0.5% は、表の合計が
      // 100% に届かないことでだけ気配が残る
      if(RANKS[rank].hidden) continue;
      const items = GACHA_POOL.filter(e => e.rank === rank);
      if(!items.length) continue;

      let sum = 0;
      for(const e of items) sum += odds.get(e) || 0;

      const head = document.createElement('li');
      head.className = 'gacha-rate-head';
      head.appendChild(rankBadge(rank));
      const hn = document.createElement('span');
      hn.className = 'rate-name';
      hn.textContent = RANKS[rank].name;
      const hp = document.createElement('span');
      hp.className = 'rate-pct';
      hp.textContent = ratePct(sum);
      head.append(hn, hp);
      gachaRatesEl.appendChild(head);

      for(const e of items){
        const gone = !inPool(e);
        const li = document.createElement('li');
        li.className = 'gacha-rate' + (gone ? ' gone' : '');
        const n = document.createElement('span');
        n.className = 'rate-name';
        n.textContent = e.name;
        const p = document.createElement('span');
        p.className = 'rate-pct';
        p.textContent = gone ? '獲得済み' : ratePct(odds.get(e) || 0);
        li.append(n, p);
        gachaRatesEl.appendChild(li);
      }
    }
    if(gachaPityEl){
      const left = PITY_MAX - pityCount;
      const anyPrize = pool.some(isPityPrize);
      gachaPityEl.textContent = anyPrize
        ? `あと ${Math.max(1, left)} 回引くと、目玉のどれかが確定で出ます`
        : '目玉はすべて獲得済みです';
    }
  }

  // 背景・トレイルは持っていれば着せ替えできる。券は枚数を出すだけ
  function gearButton(list, g, ownedFlag, current, onPick){
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'stock-item' + (current ? ' on' : '') + (ownedFlag ? '' : ' locked');
    b.disabled = !ownedFlag;
    const sw = document.createElement('span');
    sw.className = 'stock-swatch';
    sw.style.background = g.swatch || `linear-gradient(180deg, ${g.stages[2].top}, ${g.stages[2].bottom})`;
    const nm = document.createElement('span');
    nm.className = 'stock-name';
    nm.textContent = ownedFlag ? g.name : '？？？';
    b.append(sw, nm);
    if(ownedFlag) b.addEventListener('click', onPick);
    return b;
  }

  function renderStock(){
    if(!stockBg) return;
    stockBg.textContent = '';
    for(const g of BACKGROUNDS){
      const ok = !g.gacha || has('bg:' + g.id);
      if(g.secret && !ok) continue; // シークレットは持つまで枠も出さない
      stockBg.appendChild(gearButton(BACKGROUNDS, g, ok, background().id === g.id, () => {
        bgId = g.id; save(STORE_BG, bgId); gearChanged(); renderStock();
      }));
    }
    stockTrail.textContent = '';
    for(const g of TRAILS){
      const ok = !g.gacha || has('trail:' + g.id);
      if(g.secret && !ok) continue;
      stockTrail.appendChild(gearButton(TRAILS, g, ok, trail().id === g.id, () => {
        trailId = g.id; save(STORE_TRAIL, trailId); gearChanged(); renderStock();
      }));
    }
    stockTicket.textContent = '';
    for(const t of [...TICKET_M.map(m => ({ key:m, label:`${m}m` })),
                    { key:X2_KEY, label:'pt2倍' }]){
      const n = ticketCount(t.key);
      const el = document.createElement('span');
      el.className = 'stock-ticket' + (n ? '' : ' zero');
      el.textContent = `${t.label} ×${n}`;
      stockTicket.appendChild(el);
    }
  }

  function openGacha(){
    if(inFlight()) return;
    renderPtBadges();
    renderRates();
    renderStock();
    gachaScreen.classList.remove('hidden');
  }
  function closeGacha(){
    gachaScreen.classList.add('hidden');
    endFx(true);
  }

  for(const id of ['gacha-open','gacha-open-2']){
    const b = document.getElementById(id);
    if(b) b.addEventListener('click', openGacha);
  }
  document.getElementById('gacha-close').addEventListener('click', closeGacha);
  for(const tab of document.querySelectorAll('.gacha-tab')){
    tab.addEventListener('click', () => {
      for(const t of document.querySelectorAll('.gacha-tab')) t.classList.toggle('on', t === tab);
      document.getElementById('gacha-tab-draw').classList.toggle('hidden', tab.dataset.tab !== 'draw');
      document.getElementById('gacha-tab-stock').classList.toggle('hidden', tab.dataset.tab !== 'stock');
    });
  }

  // ---- gacha: 抽選演出 ------------------------------------------------------
  // 盤と同じ 480x800 の座標系で、下から玉が上がって開く。レア度で尾の色・
  // 開いたときの規模・閃光が変わるので、開く前の尾の色で当たりが読める。
  const gachaFx     = document.getElementById('gacha-fx');
  const gachaCanvas = document.getElementById('gacha-canvas');
  const gctx = gachaCanvas.getContext('2d');
  const gachaCard   = document.getElementById('gacha-card');
  const gachaRankEl = document.getElementById('gacha-rank');
  const gachaItemEl = document.getElementById('gacha-item');
  const gachaDescEl = document.getElementById('gacha-desc');
  const gachaSkipEl = document.getElementById('gacha-skip');

  const FX_RISE = 1.15;   // 上がりきるまでの秒数
  const FX_CARD = 0.6;    // 開いてから札が出るまで
  // 札は盤の下寄りに出る。花はその上で開かせないと、いちばん見せたい瞬間が
  // 札に覆われてしまう
  const FX_BURST_Y = GAME_H * 0.29;
  const FX_DRAG = 1.15;   // 粒の失速。到達半径はおよそ v/FX_DRAG になる
  // レア度ごとの規模。UR だけ閃光と二段の花が付く
  const FX_SCALE = { N:{n:80,v:195,r:2.6}, R:{n:140,v:245,r:3.0},
                     SR:{n:220,v:295,r:3.4}, UR:{n:340,v:345,r:4.0},
                     SECRET:{n:420,v:395,r:4.4} };

  // 打ち上がる玉は何が当たっても薄い黄色で通す。レア度で色を変えると、
  // 開く前に結果が読めてしまい、当てる楽しみが消える。
  // 期待させるのは背景の花火（確定演出）ひとつだけにする
  const FX_SHELL = '#fff3c4';
  const FX_SHELL_BURST = ['#fffdf0','#fff8dc','#fff3c4','#ffe9a8'];

  // 確定演出。SR 以上のときだけ、本命の後ろで小さな花火がいくつか開く。
  // 出たら SR 以上が確定するが、必ず出るわけではない（出なくても望みはある）
  const FX_CONFIRM_CHANCE = 0.6;
  const FX_CONFIRM_COLORS = ['#ff2fb0','#29f1ff','#ffd23f','#7b2ff7','#5eead4','#ff6b6b'];

  let fxRunning = false, fxRaf = 0, fxT = 0, fxLast = 0;
  let fxEntry = null, fxParts = [], fxBurst = false, fxFlash = 0;
  let fxBgParts = [], fxBgQueue = [];

  function sizeGachaCanvas(){
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    gachaCanvas.width = Math.round(GAME_W*dpr);
    gachaCanvas.height = Math.round(GAME_H*dpr);
    gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  sizeGachaCanvas();
  window.addEventListener('resize', sizeGachaCanvas);

  function fxBurstNow(){
    if(fxBurst) return;
    fxBurst = true;
    const s = FX_SCALE[fxEntry.rank];
    // 色はレア度に関係なく薄い黄色。規模と閃光だけがレア度で変わるが、
    // これは開いた瞬間＝結果が分かる瞬間なので、事前の手掛かりにはならない
    const cols = FX_SHELL_BURST;
    // 格が上がるほど強く光らせる。開いた瞬間＝結果が分かる瞬間なので、
    // ここで差が付いても事前の手掛かりにはならない
    const tier = RANKS[fxEntry.rank].tier;
    fxFlash = tier >= 3 ? 1 : tier >= 2 ? 0.55 : 0.25;
    for(let i=0;i<s.n;i++){
      // 等分割の枠内で少しだけ散らす。ゲーム本編の菊と同じ考え方で、
      // 完全な乱数だと必ず粗密ができてしまう
      const a = ((i + 0.5 + (Math.random()-0.5)*0.8) / s.n) * Math.PI*2;
      // UR は内側にもう一枚。二段になると格が上がって見える
      const layer = (tier >= 3 && i % 3 === 0) ? 0.5 : 1;
      const sp = s.v * (0.72 + Math.random()*0.38) * layer;
      fxParts.push({
        x:GAME_W/2, y:FX_BURST_Y,
        vx:Math.cos(a)*sp, vy:Math.sin(a)*sp,
        r:(1.2 + Math.random()*1.9) * (s.r/3),
        // 札が出てからも花が残っているように長めに取る。ここが短いと、
        // 名前を読んでいる間に背景がただの黒板になってしまう
        life:2.2 + Math.random()*1.6, maxLife:3.8,
        color:cols[Math.floor(Math.random()*cols.length)]
      });
    }
  }

  // 確定演出の段取り。本命が上がりきる前に開き切るよう、打ち上げの前半へ寄せる
  function fxQueueConfirm(){
    const n = 3 + Math.floor(Math.random()*3); // 3〜5発
    for(let i=0;i<n;i++){
      fxBgQueue.push({
        at: 0.12 + i*0.2 + Math.random()*0.1,
        x: 70 + Math.random()*(GAME_W-140),
        // 本命が開く高さ(FX_BURST_Y)より散らして、手前と奥が重ならないようにする
        y: 90 + Math.random()*(GAME_H*0.42)
      });
    }
  }

  function fxSpawnBg(x, y){
    const n = 34 + Math.floor(Math.random()*18);
    for(let i=0;i<n;i++){
      const a = ((i + 0.5 + (Math.random()-0.5)*0.9) / n) * Math.PI*2;
      const sp = 95 + Math.random()*55;
      fxBgParts.push({
        x, y, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp,
        r:0.9 + Math.random()*1.1,
        life:1.1 + Math.random()*0.9, maxLife:2.0,
        color:FX_CONFIRM_COLORS[Math.floor(Math.random()*FX_CONFIRM_COLORS.length)]
      });
    }
  }

  function fxFrame(ts){
    if(!fxRunning) return;
    const dt = Math.min(0.05, (ts - fxLast)/1000 || 0);
    fxLast = ts;
    fxT += dt;

    gctx.clearRect(0, 0, GAME_W, GAME_H);

    // ---- 背景の花火（確定演出）。本命より先に描いて奥に置く ----
    while(fxBgQueue.length && fxT >= fxBgQueue[0].at){
      const shot = fxBgQueue.shift();
      fxSpawnBg(shot.x, shot.y);
    }
    for(let i=fxBgParts.length-1;i>=0;i--){
      const p = fxBgParts[i];
      p.vx -= p.vx * 1.6 * dt;
      p.vy -= p.vy * 1.6 * dt;
      p.vy += 70 * dt;
      p.x += p.vx*dt; p.y += p.vy*dt;
      p.life -= dt;
      if(p.life <= 0){ fxBgParts.splice(i,1); continue; }
      // 遠くで上がっている体なので、本命より小さく淡く
      gctx.globalAlpha = Math.min(1, p.life / (p.maxLife*0.5)) * 0.55;
      const size = p.r * 4;
      gctx.drawImage(glowSprite(p.color), p.x - size/2, p.y - size/2, size, size);
    }
    gctx.globalAlpha = 1;

    if(fxT < FX_RISE){
      // 打ち上げ。上がるほど減速して、開く直前に一拍ためる
      const p = fxT / FX_RISE;
      const e = 1 - Math.pow(1-p, 2.2);
      const y = GAME_H + 30 + (FX_BURST_Y - GAME_H - 30) * e;
      const tail = 90 + 80*(1-p);

      const g = gctx.createLinearGradient(0, y, 0, y + tail);
      g.addColorStop(0, FX_SHELL);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      gctx.save();
      gctx.globalAlpha = 0.85;
      gctx.strokeStyle = g;
      // 太さもレア度で変えない。色と同じく、開く前の手掛かりになってしまう
      gctx.lineWidth = 5;
      gctx.lineCap = 'round';
      gctx.beginPath();
      gctx.moveTo(GAME_W/2, y);
      gctx.lineTo(GAME_W/2, y + tail);
      gctx.stroke();
      gctx.globalAlpha = 1;
      gctx.shadowBlur = 22;
      gctx.shadowColor = FX_SHELL;
      gctx.fillStyle = '#fff';
      gctx.beginPath();
      gctx.arc(GAME_W/2, y, 5.5, 0, Math.PI*2);
      gctx.fill();
      gctx.restore();
    } else {
      fxBurstNow();
    }

    // 開花。粒は本編と同じく抗力で失速し、重力で垂れる
    for(let i=fxParts.length-1;i>=0;i--){
      const p = fxParts[i];
      p.vx -= p.vx * FX_DRAG * dt;
      p.vy -= p.vy * FX_DRAG * dt;
      p.vy += 95 * dt;
      p.x += p.vx*dt; p.y += p.vy*dt;
      p.life -= dt;
      if(p.life <= 0){ fxParts.splice(i,1); continue; }
      const a = Math.min(1, p.life / (p.maxLife*0.5));
      const spr = glowSprite(p.color);
      const size = p.r * 4; // 本編の粒(drawGlowParticles)と同じ比率にして見た目を揃える
      gctx.globalAlpha = a;
      gctx.drawImage(spr, p.x - size/2, p.y - size/2, size, size);
    }
    gctx.globalAlpha = 1;

    if(fxFlash > 0){
      gctx.fillStyle = `rgba(255,255,255,${fxFlash*0.75})`;
      gctx.fillRect(0, 0, GAME_W, GAME_H);
      fxFlash = Math.max(0, fxFlash - dt*2.4);
    }

    if(fxBurst && fxT >= FX_RISE + FX_CARD && gachaCard.classList.contains('hidden')){
      showFxCard();
    }
    fxRaf = requestAnimationFrame(fxFrame);
  }

  function showFxCard(){
    const r = RANKS[fxEntry.rank];
    gachaRankEl.textContent = r.label;
    gachaRankEl.className = 'gacha-rank rank-' + fxEntry.rank;
    gachaItemEl.textContent = fxEntry.name;
    gachaItemEl.style.color = r.color;
    gachaDescEl.textContent = r.name + '　' + fxEntry.desc;
    gachaCard.classList.remove('hidden');
    gachaSkipEl.classList.add('hidden');
  }

  function startFx(entry){
    fxEntry = entry;
    fxParts = [];
    fxBgParts = [];
    fxBgQueue = [];
    // 確定演出は SR 以上のときだけ仕込む。ここが唯一「開く前に分かる」手掛かり
    if(RANKS[entry.rank].tier >= 2 && Math.random() < FX_CONFIRM_CHANCE){
      fxQueueConfirm();
    }
    fxBurst = false;
    fxFlash = 0;
    fxT = 0;
    fxLast = performance.now();
    fxRunning = true;
    gachaCard.classList.add('hidden');
    gachaSkipEl.classList.remove('hidden');
    gachaFx.classList.remove('hidden');
    sizeGachaCanvas();
    renderPtBadges(); // 引いている間はボタンを押させない
    fxRaf = requestAnimationFrame(fxFrame);
  }

  // silent = 演出ごと畳む（打ち上げ・画面を閉じたとき）。
  // それ以外は札を消して、増えた持ち物を反映するだけ
  function endFx(silent){
    if(fxRaf) cancelAnimationFrame(fxRaf);
    fxRaf = 0;
    fxRunning = false;
    fxParts = [];
    fxBgParts = [];
    fxBgQueue = [];
    gachaFx.classList.add('hidden');
    gachaCard.classList.add('hidden');
    if(silent) return;
    gearChanged(); // 引き当てた背景・トレイルが所持判定に入るので持ち回しを捨てる
    renderPtBadges();
    renderRates();
    renderStock();
    renderSkins();
    renderSkipPickers();
  }

  gachaPullBtn.addEventListener('click', () => {
    if(fxRunning || gachaPt < GACHA_COST) return;
    gachaPt -= GACHA_COST;
    save(STORE_PT, String(gachaPt));
    startFx(rollGacha());
  });

  // 演出を最後まで見なくてよいように。札が出たあとは何もしない
  gachaFx.addEventListener('click', () => {
    if(!fxRunning) return;
    if(gachaCard.classList.contains('hidden')){
      // 未発射の背景花火を捨ててから飛ばす。残したままだと、時刻を進めた
      // 拍子に全部まとめて開いて画面が埋まる
      fxBgQueue = [];
      fxT = FX_RISE + FX_CARD;
      fxBurstNow();
      showFxCard();
    }
  });
  document.getElementById('gacha-ok').addEventListener('click', (e) => {
    e.stopPropagation();
    endFx(false);
  });

  // ---- 券を使う ---------------------------------------------------------------
  let pendingSkip = 0;     // 次の打ち上げで使うスキップ券。使った瞬間に 0 へ戻る
  let pendingX2 = false;   // pt2倍券を使うか。同じく打ち上げで false へ戻る

  function renderSkipPickers(){
    const owns = TICKET_M.filter(m => ticketCount(m) > 0);
    if(pendingSkip && ticketCount(pendingSkip) <= 0) pendingSkip = 0;
    // 券を1枚も持っていないなら、選ぶものが無いので枠ごと隠す。
    // 2倍券だけ持っている場合は枠は残し、高度の選択肢だけを畳む
    const anyTicket = owns.length > 0 || ticketCount(X2_KEY) > 0;
    for(const b of skipBlocks) b.classList.toggle('hidden', !anyTicket);
    for(const s of skipSubs) s.classList.toggle('hidden', owns.length === 0);
    for(const row of skipRows){
      row.textContent = '';
      for(const m of [0, ...owns]){
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'skip-btn' + (pendingSkip === m ? ' on' : '');
        b.textContent = m === 0 ? '地上から' : `${m}m ×${ticketCount(m)}`;
        b.addEventListener('click', () => { pendingSkip = m; renderSkipPickers(); });
        row.appendChild(b);
      }
    }
    renderX2Pickers();
  }

  function renderX2Pickers(){
    const n = ticketCount(X2_KEY);
    if(n <= 0) pendingX2 = false;
    for(const b of x2Buttons){
      b.className = 'skip-btn x2-btn' + (n <= 0 ? ' hidden' : '') + (pendingX2 ? ' on' : '');
      b.textContent = (pendingX2 ? 'pt2倍で打ち上げ' : 'pt2倍券を使う') + ` ×${n}`;
      b.setAttribute('aria-pressed', String(pendingX2));
    }
  }

  // 券は打ち上げた瞬間に1枚減る。結果画面まで持ち越さないので、
  // 途中でリロードされても「使ったのに残っている」ことにはならない。
  // 2倍券は高度に関係なく効くので、スキップ券と重ねて使える
  function launch(){
    let from = 0;
    if(pendingSkip && ticketCount(pendingSkip) > 0){
      from = pendingSkip;
      tickets[from] = ticketCount(from) - 1;
      pendingSkip = 0;
    }
    let x2 = false;
    if(pendingX2 && ticketCount(X2_KEY) > 0){
      x2 = true;
      tickets[X2_KEY] = ticketCount(X2_KEY) - 1;
      pendingX2 = false;
    }
    saveTickets();
    reset(from, x2);
  }

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
  const inFlight = () =>
    state === 'launching' || state === 'skipping' || state === 'playing' || state === 'exploding';

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
    if(e.key !== 'Escape') return;
    // 演出中でも降りられるように、手前にあるものから順に畳む
    if(fxRunning){ endFx(false); return; }
    if(!gachaScreen.classList.contains('hidden')){ closeGacha(); return; }
    if(openPanel) setPanel(null);
  });
  // 画面を広げたら常駐表示に戻るので、引き出しの状態は捨てる
  panelMQ.addEventListener('change', () => { setPanel(null); syncPanelA11y(); });
  syncPanelA11y();

  for(const b of x2Buttons){
    b.addEventListener('click', () => { pendingX2 = !pendingX2; renderX2Pickers(); });
  }

  startBtn.addEventListener('click', launch);
  retryBtn.addEventListener('click', launch);

  hudBest.textContent = Math.floor(bestHeightM) + 'm';
  renderSkins();
  renderPtBadges();
  renderSkipPickers();
  refreshRanking();
})();
