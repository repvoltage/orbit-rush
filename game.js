/* Orbit Rush - a one-tap arcade game. Powered by Repix. */
(function () {
'use strict';

var TAU = Math.PI * 2;
var MAX_LIVES = 5;
var REGEN_MS = 10 * 60 * 1000;       // one life back every 10 minutes
var REGEN_EMPTY_MS = 50 * 60 * 1000; // drained to zero: 50 minute wait

// ---------- storage ----------
function load(key, fallback) {
    try {
        var raw = localStorage.getItem(key);
        if (raw == null) return fallback;
        return JSON.parse(raw);
    } catch (e) { return fallback; }
}
function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ }
}

var state = {
    best: load('orbit-rush-best.v1', 0),
    settings: load('orbit-rush-settings.v1', { volume: 0.8, vibration: true }),
    lives: load('orbit-rush-lives.v1', { count: MAX_LIVES, regenAt: null }),
    history: load('orbit-rush-history.v1', { runs: [], firstDay: null, plays: 0 }),
    board: load('orbit-rush-leaderboard.v1', []),
    name: load('orbit-rush-name.v1', ''),
};
if (typeof state.best !== 'number') state.best = 0;
if (!state.settings || typeof state.settings !== 'object') state.settings = { volume: 0.8, vibration: true };
if (!state.lives || typeof state.lives !== 'object') state.lives = { count: MAX_LIVES, regenAt: null };
if (!state.history || typeof state.history !== 'object') state.history = { runs: [], firstDay: null, plays: 0 };
if (!Array.isArray(state.board)) state.board = [];
if (typeof state.name !== 'string') state.name = '';

function setBest(n) { state.best = n; save('orbit-rush-best.v1', n); refreshTopbar(); }
function setSettings(s) { state.settings = s; save('orbit-rush-settings.v1', s); }
function setLives(l) { state.lives = l; save('orbit-rush-lives.v1', l); }
function setHistory(h) { state.history = h; save('orbit-rush-history.v1', h); }
function setBoard(b) { state.board = b; save('orbit-rush-leaderboard.v1', b); }
function setName(n) { state.name = n; save('orbit-rush-name.v1', n); }

// ---------- nickname ----------
var BLOCKED_WORDS = ['fuck', 'shit', 'bitch', 'asshole', 'cunt', 'dick', 'bastard', 'whore', 'slut', 'nazi', 'chutiya', 'madarchod', 'bhenchod', 'randi', 'lodu', 'gandu'];
function cleanName(raw) {
    var n = String(raw || '').replace(/[^A-Za-z0-9 _-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
    if (n.length < 2) return '';
    var squashed = n.toLowerCase().replace(/[\s_-]/g, '');
    for (var i = 0; i < BLOCKED_WORDS.length; i++) if (squashed.indexOf(BLOCKED_WORDS[i]) >= 0) return '';
    return n;
}

function fmtClock(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

// ---------- leaderboard (local fallback + worldwide) ----------
var SCORES_URL = 'https://nrodpmqurwifaqnodmnd.supabase.co/rest/v1/scores';
var SCORES_KEY = 'sb_publishable_c83I-qQmA3MuvicanxmyGQ_wwQAAyPi';
var WORLD_LIMIT = 10;

var localBoard = {
    scopeLabel: 'Top scores on this device',
    submit: function (score, name) {
        var entries = state.board.concat([{ score: score, at: new Date().toISOString(), name: name }]);
        entries.sort(function (a, b) { return b.score - a.score; });
        setBoard(entries.slice(0, 10));
    },
    top: function (limit) { return state.board.slice(0, limit); },
};

var leaderboard = (function () {
    var world = null; // null until first fetch settles
    var listeners = [];
    function auth() { return { apikey: SCORES_KEY, Authorization: 'Bearer ' + SCORES_KEY }; }
    function load() {
        fetch(SCORES_URL + '?select=name,score,created_at&order=score.desc&limit=' + WORLD_LIMIT, { headers: auth() })
            .then(function (res) {
                if (!res.ok) throw new Error('scores read failed: ' + res.status);
                return res.json();
            })
            .then(function (rows) {
                world = rows.map(function (r) { return { score: r.score, at: r.created_at, name: r.name }; });
            })
            .catch(function () { world = null; })
            .then(function () { listeners.forEach(function (fn) { fn(); }); });
    }
    load();
    return {
        getScopeLabel: function () { return world ? 'Top scores worldwide' : localBoard.scopeLabel; },
        submit: function (score, name) {
            localBoard.submit(score, name);
            fetch(SCORES_URL, {
                method: 'POST',
                headers: Object.assign(auth(), { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
                body: JSON.stringify({ name: (name || 'Player').slice(0, 20), score: score }),
            }).then(function (res) { if (res.ok) load(); }).catch(function () { /* offline */ });
        },
        top: function (limit) { return (world || localBoard.top(WORLD_LIMIT)).slice(0, limit); },
        refresh: function () { load(); },
        onChange: function (fn) { listeners.push(fn); },
    };
})();

// ---------- ads (simulated provider; swap for a real network later) ----------
var adHandlers = { rewarded: null, interstitial: null };
var ads = {
    simulated: true,
    showRewarded: function (onDone) { if (adHandlers.rewarded) adHandlers.rewarded(onDone); else onDone(false); },
    showInterstitial: function (onDone) { if (adHandlers.interstitial) adHandlers.interstitial(onDone); else onDone(); },
};

// ---------- DOM overlays ----------
var els = {
    topscore: document.getElementById('topscore'),
    ovSettings: document.getElementById('ov-settings'),
    ovName: document.getElementById('ov-name'),
    ovScores: document.getElementById('ov-scores'),
    ovRewarded: document.getElementById('ov-rewarded'),
    ovInterstitial: document.getElementById('ov-interstitial'),
    setVolume: document.getElementById('set-volume'),
    setVibration: document.getElementById('set-vibration'),
    setNameInput: document.getElementById('set-name'),
    setNameErr: document.getElementById('set-name-err'),
    nameInput: document.getElementById('name-input'),
    nameErr: document.getElementById('name-err'),
    scoresScope: document.getElementById('scores-scope'),
    scoresList: document.getElementById('scores-list'),
    recentList: document.getElementById('recent-list'),
    adRemainR: document.getElementById('ad-remain-r'),
    adRemainI: document.getElementById('ad-remain-i'),
};

var overlay = 'none';
function setOverlay(o) {
    overlay = o;
    els.ovSettings.hidden = o !== 'settings';
    els.ovName.hidden = o !== 'name';
    els.ovScores.hidden = o !== 'scores';
    els.ovRewarded.hidden = o !== 'rewarded';
    els.ovInterstitial.hidden = o !== 'interstitial';
}

var liveScore = 0;
function refreshTopbar() {
    els.topscore.textContent = 'Score ' + liveScore + ' \u00B7 Best ' + state.best;
}

function scoreRow(rank, name, score) {
    var div = document.createElement('div');
    div.className = 'game-panel-line';
    var left = document.createElement('strong');
    left.textContent = (rank ? rank + '. ' : '') + (name || 'Player');
    var dots = document.createElement('span');
    dots.className = 'game-dots';
    var right = document.createElement('strong');
    right.textContent = String(score);
    div.appendChild(left); div.appendChild(dots); div.appendChild(right);
    return div;
}

function renderScores() {
    els.scoresScope.textContent = leaderboard.getScopeLabel();
    var top = leaderboard.top(10);
    els.scoresList.textContent = '';
    if (top.length === 0) {
        var none = document.createElement('div');
        none.className = 'game-panel-line';
        none.textContent = 'No scores yet. Play a run!';
        els.scoresList.appendChild(none);
    }
    top.forEach(function (e, i) { els.scoresList.appendChild(scoreRow(i + 1, e.name, e.score)); });
    var recent = state.history.runs.slice(-5).reverse();
    els.recentList.textContent = '';
    if (recent.length === 0) {
        var none2 = document.createElement('div');
        none2.className = 'game-panel-line';
        none2.textContent = 'Nothing yet.';
        els.recentList.appendChild(none2);
    }
    recent.forEach(function (r) { els.recentList.appendChild(scoreRow(0, r.name, r.score)); });
}
leaderboard.onChange(function () { if (overlay === 'scores') renderScores(); });

function showNameErr(msg) {
    els.nameErr.textContent = msg; els.nameErr.hidden = !msg;
    els.setNameErr.textContent = msg; els.setNameErr.hidden = !msg;
}

function saveName(raw, fallback) {
    var c = cleanName(raw);
    if (!c) {
        if (fallback) { setName(fallback); showNameErr(''); setOverlay('none'); return true; }
        showNameErr('Use 2-16 letters, numbers, spaces, - or _. Keep it clean.');
        return false;
    }
    setName(c); showNameErr(''); setOverlay('none');
    return true;
}

// ---------- simulated ad overlays ----------
var adRemain = 0;
var adResolve = null;
var intResolve = null;
var adTimer = null;

function runAdOverlay(kind) {
    var total = kind === 'rewarded' ? 3 : 4;
    adRemain = total;
    if (kind === 'rewarded') els.adRemainR.textContent = String(total);
    else els.adRemainI.textContent = String(total);
    setOverlay(kind);
    if (adTimer) clearInterval(adTimer);
    adTimer = setInterval(function () {
        adRemain = Math.max(0, adRemain - 1);
        if (kind === 'rewarded') els.adRemainR.textContent = String(adRemain);
        else els.adRemainI.textContent = String(adRemain);
        if (adRemain <= 0) {
            clearInterval(adTimer); adTimer = null;
            setOverlay('none');
            if (kind === 'rewarded') { var d = adResolve; adResolve = null; if (d) d(true); }
            else { var d2 = intResolve; intResolve = null; if (d2) d2(); }
        }
    }, 1000);
}

adHandlers.rewarded = function (onDone) { adResolve = onDone; runAdOverlay('rewarded'); };
adHandlers.interstitial = function (onDone) { intResolve = onDone; runAdOverlay('interstitial'); };

// ---------- settings wiring ----------
els.setVolume.addEventListener('input', function () {
    setSettings({ volume: Number(els.setVolume.value) / 100, vibration: state.settings.vibration });
});
els.setVibration.addEventListener('click', function () {
    var v = !state.settings.vibration;
    setSettings({ volume: state.settings.volume, vibration: v });
    els.setVibration.textContent = 'Vibration: ' + (v ? 'ON' : 'OFF');
});
document.getElementById('set-name-save').addEventListener('click', function () {
    if (saveName(els.setNameInput.value || state.name, null)) els.setNameInput.value = '';
});
document.getElementById('name-save').addEventListener('click', function () {
    if (saveName(els.nameInput.value, null)) els.nameInput.value = '';
});
document.getElementById('name-skip').addEventListener('click', function () {
    setName('Player'); els.nameInput.value = ''; showNameErr(''); setOverlay('none');
});
document.getElementById('btn-settings').addEventListener('click', function () {
    els.setVolume.value = String(Math.round(state.settings.volume * 100));
    els.setVibration.textContent = 'Vibration: ' + (state.settings.vibration ? 'ON' : 'OFF');
    els.setNameInput.value = state.name || '';
    showNameErr('');
    setOverlay('settings');
});
document.getElementById('btn-scores').addEventListener('click', function () {
    leaderboard.refresh();
    renderScores();
    setOverlay('scores');
});
Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (b) {
    b.addEventListener('click', function () { showNameErr(''); setOverlay('none'); });
});

// ---------- canvas game ----------
var canvas = document.getElementById('game');
var ctx = canvas.getContext('2d');

var W = 0, H = 0, k = 1;
var cx = 0, cy = 0, R1 = 0, R2 = 0;
var stars = [];

function fit() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = canvas.clientWidth || 320;
    var h = Math.round((w * 16) / 9); // 9:16 portrait game area
    var maxH = 620;
    if (h > maxH) {
        h = maxH;
        w = Math.round((h * 9) / 16);
        canvas.style.width = w + 'px';
    } else {
        canvas.style.width = '100%';
    }
    canvas.style.height = h + 'px';
    canvas.style.margin = '0 auto';
    W = w; H = h;
    k = W / 342; // scale with width; 1 at phone portrait
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = W / 2; cy = H / 2;
    R1 = Math.min(H * 0.23, W * 0.26); R2 = Math.min(H * 0.37, W * 0.44);
    stars = [];
    for (var i = 0; i < 90; i++) stars.push({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.2 + 0.3, tw: Math.random() * TAU });
}
fit();
window.addEventListener('resize', fit);

var ac = null;
function audio() {
    if (!ac) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) ac = new AC();
    }
    if (ac && ac.state === 'suspended') ac.resume();
    return ac;
}
function beep(freq, dur, type, vol, slide) {
    var a = audio(); if (!a) return;
    var v = vol * state.settings.volume;
    if (v <= 0.001) return;
    var o = a.createOscillator(); var g2 = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, a.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(slide, 1), a.currentTime + dur);
    g2.gain.setValueAtTime(v, a.currentTime);
    g2.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    o.connect(g2); g2.connect(a.destination);
    o.start(); o.stop(a.currentTime + dur + 0.02);
}
function vibrate(p) {
    try { if (state.settings.vibration && navigator.vibrate) navigator.vibrate(p); } catch (e) { /* no haptics */ }
}

var g = {
    phase: 'ready', // ready | playing | over
    angle: -Math.PI / 2,
    ring: 1,
    rPos: 1,
    rFrom: 1, rTo: 1, rT: 1,
    speed: 2.5,
    elapsed: 0,
    score: 0,
    combo: 0,
    shards: [],
    orbs: [],
    parts: [],
    nextShard: 2.0,
    nextOrb: 2.2,
    shake: 0,
    flash: 0,
    closeT: 9,
    switchPulse: 0,
    overT: 0,
    retryT: 0,
    shareNote: 0,
    newBest: false,
    corePulse: 0,
    hot: [],
};

function ringR(ring) { return ring === 0 ? R1 : R2; }
function playerR() { return R1 + (R2 - R1) * g.rPos; }

// ---- lives ----
function tickLives() {
    var l = state.lives;
    if (l.regenAt == null || l.count >= MAX_LIVES) return;
    var now = Date.now();
    if (now < l.regenAt) return;
    var count = l.count;
    var regenAt = l.regenAt;
    while (regenAt != null && now >= regenAt && count < MAX_LIVES) {
        count++;
        regenAt = count < MAX_LIVES ? regenAt + REGEN_MS : null;
    }
    setLives({ count: count, regenAt: regenAt });
}
function spendLife() {
    var l = state.lives;
    var count = Math.max(0, l.count - 1);
    var regenAt = l.regenAt;
    if (count === 0) regenAt = Date.now() + REGEN_EMPTY_MS;
    else if (regenAt == null) regenAt = Date.now() + REGEN_MS;
    setLives({ count: count, regenAt: regenAt });
}
function grantLife() {
    var l = state.lives;
    var count = Math.min(MAX_LIVES, l.count + 1);
    var regenAt = count >= MAX_LIVES ? null : l.regenAt;
    setLives({ count: count, regenAt: regenAt });
}

// ---- history / plays ----
function recordRunStart() {
    var h = state.history;
    var today = new Date().toISOString().slice(0, 10);
    setHistory({ runs: h.runs, firstDay: h.firstDay || today, plays: h.plays + 1 });
}
function recordRunEnd(score) {
    var h = state.history;
    var nm = state.name || 'Player';
    var runs = h.runs.concat([{ score: score, at: new Date().toISOString(), name: nm }]).slice(-10);
    setHistory({ runs: runs, firstDay: h.firstDay, plays: h.plays });
    leaderboard.submit(score, nm);
}
function isDay2Plus() {
    var fd = state.history.firstDay;
    if (!fd) return false;
    return new Date().toISOString().slice(0, 10) > fd;
}

function burst(x, y, n, color, sp) {
    for (var i = 0; i < n; i++) {
        var a = Math.random() * TAU, s = sp * (0.4 + Math.random()) * k;
        g.parts.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: 0.5 + Math.random() * 0.4, size: (1.5 + Math.random() * 2.5) * k, color: color });
    }
}

function start(free) {
    if (!free) {
        if (state.lives.count <= 0) return;
        spendLife();
    }
    recordRunStart();
    g.phase = 'playing';
    g.angle = -Math.PI / 2; g.ring = 1; g.rPos = 1; g.rFrom = 1; g.rTo = 1; g.rT = 1;
    g.speed = 2.5; g.elapsed = 0; g.score = 0; g.combo = 0;
    g.shards = []; g.orbs = []; g.parts = [];
    g.nextShard = 2.0; g.nextOrb = 2.2; g.shake = 0; g.flash = 0; g.overT = 0; g.retryT = 0; g.newBest = false; g.closeT = 9;
    beep(520, 0.12, 'triangle', 0.12, 880);
}

function die() {
    g.phase = 'over'; g.overT = 0; g.retryT = 10; g.shake = 14 * k;
    var px = cx + Math.cos(g.angle) * playerR(), py = cy + Math.sin(g.angle) * playerR();
    burst(px, py, 70, '#7ff3ff', 260);
    burst(px, py, 30, '#ed313e', 200);
    beep(320, 0.5, 'sawtooth', 0.16, 60);
    vibrate([90, 40, 140]);
    var final = Math.floor(g.score);
    recordRunEnd(final);
    if (final > state.best) { g.newBest = true; setBest(final); }
    if (isDay2Plus() && state.history.plays % 3 === 0) {
        ads.showInterstitial(function () { /* overlay closes itself */ });
    }
}


function shareScore() {
    var score = Math.floor(g.score);
    var text = 'I scored ' + score + ' in Orbit Rush! Can you beat it? https://repvoltage.github.io/orbit-rush/';
    if (navigator.share) {
        navigator.share({ text: text }).catch(function () {});
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { g.shareNote = 1.6; }).catch(function () {});
    }
}
function tap() {
    audio();
    if (g.phase === 'ready') { start(false); return; }
    if (g.phase === 'over') { if (g.overT > 0.5 && g.retryT <= 0) start(false); return; }
    g.rFrom = g.rPos; g.rTo = g.ring === 0 ? 1 : 0; g.ring = g.rTo; g.rT = 0;
    g.closeT = 0; g.switchPulse = 1;
    beep(300, 0.07, 'triangle', 0.08, 180);
    vibrate(8);
}

// ---- canvas text / widgets ----
function text(t, x, y, size, color, weight, align) {
    ctx.font = (weight || 600) + ' ' + size + 'px system-ui, sans-serif';
    ctx.textAlign = align || 'center';
    ctx.fillStyle = color;
    ctx.fillText(t, x, y);
}
function pill(id, label, y, opts) {
    opts = opts || {};
    var w = opts.w || Math.min(210, W * 0.62);
    var h = opts.h || 32;
    var x = cx - w / 2;
    ctx.fillStyle = opts.fill || 'rgba(127,243,255,0.14)';
    ctx.strokeStyle = 'rgba(127,243,255,0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, h / 2); else ctx.rect(x, y, w, h);
    ctx.fill(); ctx.stroke();
    text(label, cx, y + h / 2 + 4.5, 12, opts.fg || '#7ff3ff', 700);
    g.hot.push({ x: x, y: y, w: w, h: h, id: id });
}
// Lives: top-right corner pips, regen countdown below them.
function drawLivesCorner() {
    var l = state.lives;
    var r = 4.5, gap = 13;
    var xEnd = W - 10;
    for (var i = 0; i < MAX_LIVES; i++) {
        var x = xEnd - (MAX_LIVES - 1 - i) * gap;
        ctx.beginPath(); ctx.arc(x, 13, r, 0, TAU);
        if (i < l.count) { ctx.fillStyle = '#ffd166'; ctx.fill(); }
        else { ctx.strokeStyle = 'rgba(255,209,102,0.45)'; ctx.lineWidth = 1.2; ctx.stroke(); }
    }
    if (l.count < MAX_LIVES && l.regenAt != null) {
        text(fmtClock(l.regenAt - Date.now()), xEnd, 34, 10, '#8f9bd8', 600, 'right');
    }
}

function drawStart() {
    ctx.fillStyle = 'rgba(6,9,26,0.5)'; ctx.fillRect(0, 0, W, H);
    text('ORBIT RUSH', cx, H * 0.24, 22 * k + 6, '#7ff3ff', 800);
    if (state.name) text(state.name, cx, H * 0.24 + 24 * k + 8, 11.5, '#8f9bd8', 700);
    text('One tap switches rings. Dodge the red shards.', cx, H * 0.40, 11.5, '#cdd6ff');
    var l = state.lives;
    if (l.count > 0) {
        var p = 0.6 + 0.4 * Math.sin(g.corePulse * 4);
        ctx.globalAlpha = p; text('TAP TO START', cx, H * 0.66, 16, '#ffd166', 800); ctx.globalAlpha = 1;
    } else {
        text('OUT OF LIVES', cx, H * 0.52, 15, '#ed313e', 800);
        pill('ad-life', 'WATCH VIDEO  +1 LIFE', H * 0.62, { fill: 'rgba(255,209,102,0.14)', fg: '#ffd166' });
    }
    if (state.best > 0) text('Best ' + state.best, cx, H * 0.84, 11, '#8f9bd8');
    text('Powered by Repix', cx, H - 8, 10, '#8f9bd8');
}

function drawOver() {
    ctx.fillStyle = 'rgba(6,9,26,0.6)'; ctx.fillRect(0, 0, W, H);
    var narrow = W < 480;
    var colL = narrow ? cx : cx - W * 0.26;
    var colR = narrow ? cx : cx + W * 0.26;
    var headY = narrow ? H * 0.16 : H * 0.30;
    var scoreY = narrow ? H * 0.36 : H * 0.52;
    var bestY = narrow ? H * 0.48 : H * 0.65;
    text('CRASHED', colL, headY, narrow ? 16 : 20, '#ed313e', 800);
    text(String(Math.floor(g.score)), colL, scoreY, narrow ? 24 : 30, '#ffffff', 800);
    if (g.newBest) text('NEW BEST!', colL, bestY, narrow ? 10.5 : 12, '#ffd166', 800);
    else text('Best ' + state.best, colL, bestY, 11, '#8f9bd8');
    var bw = Math.min(200, W - 24);
    var btnY = narrow ? H * 0.55 : H * 0.24;
    var bx = colR - bw / 2;
    ctx.fillStyle = 'rgba(255,209,102,0.14)'; ctx.strokeStyle = 'rgba(255,209,102,0.55)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(bx, btnY, bw, 30, 15); else ctx.rect(bx, btnY, bw, 30); ctx.fill(); ctx.stroke();
    text('WATCH VIDEO TO RETRY', bx + bw / 2, btnY + 19, 11, '#ffd166', 700);
    g.hot.push({ x: bx, y: btnY, w: bw, h: 30, id: 'ad-retry' });
    var shY = btnY + 42;
    ctx.fillStyle = 'rgba(127,243,255,0.10)'; ctx.strokeStyle = 'rgba(127,243,255,0.45)';
    ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(bx, shY, bw, 30, 15); else ctx.rect(bx, shY, bw, 30, 15); ctx.fill(); ctx.stroke();
    text('SHARE SCORE', bx + bw / 2, shY + 19, 11, '#7ff3ff', 700);
    g.hot.push({ x: bx, y: shY, w: bw, h: 30, id: 'share' });
    if (g.shareNote > 0) text('Score copied - paste it anywhere!', bx + bw / 2, shY + 48, 10, '#7ff3ff');
    var infoY = narrow ? H * 0.82 : H * 0.52;
    var subY = narrow ? H * 0.82 : H * 0.62;
    if (g.retryT > 0) {
        text('Retry in ' + Math.ceil(g.retryT) + 's', colR, infoY, narrow ? 11 : 13, '#8f9bd8', 800);
        if (!narrow) text('or continue now with the video', colR, subY, 10, '#8f9bd8');
    } else if (state.lives.count > 0) {
        var p = 0.6 + 0.4 * Math.sin(g.corePulse * 4);
        ctx.globalAlpha = p; text('TAP TO PLAY AGAIN (1 life)', colR, infoY, narrow ? 11.5 : 13, '#7ff3ff', 800); ctx.globalAlpha = 1;
    } else {
        text('No lives left - retry with the video', colR, infoY, 11, '#8f9bd8');
    }
    text('Powered by Repix', cx, H - 8, 10, '#8f9bd8');
}

function draw() {
    g.hot = [];
    ctx.save();
    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0a0e24'); bg.addColorStop(1, '#131a3d');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    if (g.shake > 0) ctx.translate((Math.random() - 0.5) * g.shake, (Math.random() - 0.5) * g.shake);
    for (var si = 0; si < stars.length; si++) {
        var s = stars[si];
        ctx.globalAlpha = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(g.corePulse * 1.7 + s.tw));
        ctx.fillStyle = '#aebbff';
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(140,160,255,0.28)';
    ctx.beginPath(); ctx.arc(cx, cy, R1, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, R2, 0, TAU); ctx.stroke();
    if (g.phase === 'playing') {
        ctx.strokeStyle = 'rgba(127,243,255,0.5)'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(cx, cy, ringR(g.ring), 0, TAU); ctx.stroke();
    }
    var pulse = 1 + 0.08 * Math.sin(g.corePulse * 3);
    var coreR = 12 * k * pulse;
    var cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 3.4);
    cg.addColorStop(0, 'rgba(255,240,200,0.95)'); cg.addColorStop(0.25, 'rgba(255,209,102,0.5)'); cg.addColorStop(1, 'rgba(255,209,102,0)');
    ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx, cy, coreR * 3.4, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffe9b0'; ctx.beginPath(); ctx.arc(cx, cy, coreR, 0, TAU); ctx.fill();
    if (g.flash > 0) {
        ctx.globalAlpha = g.flash; ctx.strokeStyle = '#7ff3ff'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(cx, cy, playerR() + (1 - g.flash) * 40 * k, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
    }
    var i, x, y;
    for (i = 0; i < g.orbs.length; i++) {
        var o = g.orbs[i];
        var r = ringR(o.ring); x = cx + Math.cos(o.a) * r; y = cy + Math.sin(o.a) * r;
        var pr2 = (4.5 + 1.4 * Math.sin(g.corePulse * 5 + o.a * 3)) * k;
        ctx.fillStyle = 'rgba(255,209,102,0.25)'; ctx.beginPath(); ctx.arc(x, y, pr2 * 2.4, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.arc(x, y, pr2, 0, TAU); ctx.fill();
    }
    for (i = 0; i < g.shards.length; i++) {
        var sh2 = g.shards[i];
        var rr = ringR(sh2.ring); x = cx + Math.cos(sh2.a) * rr; y = cy + Math.sin(sh2.a) * rr;
        ctx.save(); ctx.translate(x, y); ctx.rotate(sh2.a + Math.PI / 2);
        ctx.fillStyle = '#ed313e';
        ctx.shadowColor = '#ed313e'; ctx.shadowBlur = 10 * k;
        var sh = 10 * k;
        ctx.beginPath(); ctx.moveTo(0, -sh); ctx.lineTo(sh * 0.8, sh * 0.7); ctx.lineTo(-sh * 0.8, sh * 0.7); ctx.closePath(); ctx.fill();
        ctx.restore();
    }
    for (i = 0; i < g.parts.length; i++) {
        var p2 = g.parts[i];
        ctx.globalAlpha = 1 - p2.life / p2.max; ctx.fillStyle = p2.color;
        ctx.beginPath(); ctx.arc(p2.x, p2.y, p2.size, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (g.phase !== 'over') {
        var pr = playerR(), px = cx + Math.cos(g.angle) * pr, py = cy + Math.sin(g.angle) * pr;
        var prad = (7 + g.switchPulse * 3.5) * k;
        var pg = ctx.createRadialGradient(px, py, 0, px, py, prad * 3);
        pg.addColorStop(0, 'rgba(127,243,255,0.9)'); pg.addColorStop(1, 'rgba(127,243,255,0)');
        ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(px, py, prad * 3, 0, TAU); ctx.fill();
        ctx.fillStyle = '#eaffff'; ctx.beginPath(); ctx.arc(px, py, prad * 0.55, 0, TAU); ctx.fill();
    }
    if (g.phase === 'playing') {
        text(String(Math.floor(g.score)), 12, 22, 20, '#ffffff', 700, 'left');
        var mult = Math.min(5, 1 + Math.floor(g.combo / 4));
        text('x' + mult, 12, 38, 11, '#ffd166', 600, 'left');
    }
    drawLivesCorner();
    if (g.phase === 'ready') drawStart();
    if (g.phase === 'over') drawOver();
    ctx.restore();
}

canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    var rect = canvas.getBoundingClientRect();
    var x = e.clientX - rect.left, y = e.clientY - rect.top;
    for (var i = g.hot.length - 1; i >= 0; i--) {
        var h = g.hot[i];
        if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
            if (h.id === 'ad-retry') { ads.showRewarded(function (ok) { if (ok) start(true); }); return; }
            if (h.id === 'ad-life') { ads.showRewarded(function (ok) { if (ok) grantLife(); }); return; }
            if (h.id === 'share') { shareScore(); return; }
            return;
        }
    }
    tap();
});

function spawnShard() {
    var a = g.angle + 2.6 + Math.random() * 2.4;
    var conflict = g.shards.some(function (s) { return !s.passed && Math.abs(s.a - a) < 0.55; });
    if (conflict) return;
    var ring = Math.random() < 0.5 ? 0 : 1;
    g.shards.push({ a: a, ring: ring, passed: false });
}
function spawnOrb() {
    var a = g.angle + 2.4 + Math.random() * 3.0;
    var blocked0 = g.shards.some(function (s) { return !s.passed && Math.abs(s.a - a) < 0.45 && s.ring === 0; });
    var blocked1 = g.shards.some(function (s) { return !s.passed && Math.abs(s.a - a) < 0.45 && s.ring === 1; });
    var ring = blocked0 ? (blocked1 ? -1 : 1) : (blocked1 ? 0 : (Math.random() < 0.5 ? 0 : 1));
    if (ring < 0) return;
    g.orbs.push({ a: a, ring: ring, taken: false });
}

var last = performance.now();
function frame(now) {
    requestAnimationFrame(frame);
    var dt = (now - last) / 1000; last = now;
    if (dt > 0.06) dt = 0.06;

    g.corePulse += dt;
    if (g.shake > 0) g.shake = Math.max(0, g.shake - dt * 26);
    if (g.flash > 0) g.flash = Math.max(0, g.flash - dt * 2.4);
    if (g.switchPulse > 0) g.switchPulse = Math.max(0, g.switchPulse - dt * 4);
    if (g.shareNote > 0) g.shareNote -= dt;
    if (g.phase === 'over') { g.overT += dt; if (g.retryT > 0) g.retryT = Math.max(0, g.retryT - dt); }

    tickLives();

    if (g.phase === 'playing') {
        g.elapsed += dt; g.closeT += dt;
        g.speed = Math.min(5.6, 2.5 + g.elapsed * 0.05);
        g.angle += g.speed * dt;
        g.score += dt * 4;
        liveScore = Math.floor(g.score);
        if (g.rT < 1) {
            g.rT = Math.min(1, g.rT + dt / 0.11);
            var e2 = 1 - Math.pow(1 - g.rT, 3);
            g.rPos = g.rFrom + (g.rTo - g.rFrom) * e2;
        }
        g.nextShard -= dt;
        if (g.nextShard <= 0) { spawnShard(); g.nextShard = Math.max(0.5, 1.25 - g.elapsed * 0.012) * (0.8 + Math.random() * 0.5); }
        g.nextOrb -= dt;
        if (g.nextOrb <= 0) { spawnOrb(); g.nextOrb = 1.5 + Math.random() * 1.2; }
        var pr = playerR();
        var i, d;
        for (i = 0; i < g.shards.length; i++) {
            var s = g.shards[i];
            if (s.passed) continue;
            d = s.a - g.angle;
            if (d < -0.06) {
                s.passed = true;
                if (Math.abs(pr - ringR(s.ring)) > 20 * k) {
                    g.score += 2;
                    if (g.closeT < 0.4) {
                        g.score += 6; g.flash = 1; g.shake = Math.max(g.shake, 4 * k);
                        beep(760, 0.09, 'square', 0.06, 1180); vibrate(18);
                    }
                }
                continue;
            }
            if (Math.abs(d) < 0.13 && Math.abs(pr - ringR(s.ring)) < 16 * k) { die(); break; }
        }
        for (i = 0; i < g.orbs.length; i++) {
            var o = g.orbs[i];
            if (o.taken) continue;
            d = o.a - g.angle;
            if (d < -0.06) {
                o.taken = true;
                if (Math.abs(pr - ringR(o.ring)) < 20 * k) g.combo = 0;
                continue;
            }
            if (Math.abs(d) < 0.11 && Math.abs(pr - ringR(o.ring)) < 19 * k) {
                o.taken = true; g.combo++;
                var mult = Math.min(5, 1 + Math.floor(g.combo / 4));
                g.score += 10 * mult;
                var ox = cx + Math.cos(o.a) * ringR(o.ring), oy = cy + Math.sin(o.a) * ringR(o.ring);
                burst(ox, oy, 12, '#ffd166', 120);
                beep(460 + g.combo * 30, 0.09, 'sine', 0.1, (460 + g.combo * 30) * 1.5);
            }
        }
        g.shards = g.shards.filter(function (s) { return s.a > g.angle - 1.2; });
        g.orbs = g.orbs.filter(function (o) { return !o.taken && o.a > g.angle - 1.2; });
        g.parts.push({ x: cx + Math.cos(g.angle) * pr, y: cy + Math.sin(g.angle) * pr, vx: (Math.random() - 0.5) * 20, vy: (Math.random() - 0.5) * 20, life: 0, max: 0.35, size: 2 * k, color: '#7ff3ff' });
    }

    for (var i2 = 0; i2 < g.parts.length; i2++) {
        var p = g.parts[i2];
        p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96;
    }
    g.parts = g.parts.filter(function (p) { return p.life < p.max; });

    draw();
}
requestAnimationFrame(frame);

// 1s ticker: topbar score + countdown labels
setInterval(function () { refreshTopbar(); }, 1000);
refreshTopbar();

// First-run nickname prompt
if (!state.name) setOverlay('name');

})();
