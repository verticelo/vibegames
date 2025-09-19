/* ==============================
   Local-first state & utilities
   ============================== */
const DB_KEY = 'edugames_v1';
const SESSION_KEY = 'edugames_session_v1';

const GAMES = [
    { id:'multiplication_racer', name:'Multiplication racer', emoji:'✖️', blurb:'Race through times tables and beat the clock.' },
    { id:'countries_world', name:'Countries of the world', emoji:'🌍', blurb:'How many countries can you name?' },
    { id:'type_racer', name:'Type racer', emoji:'⌨️', blurb:'Type as quickly as you can.' },
    //{ id:'counties_sweden', name:'Counties of Sweden', emoji:'🗺️', blurb:'Find the Swedish counties.' },
    //{ id:'fraction_flipper', name:'Fraction flipper', emoji:'🔁', blurb:'Flip between percentages, decimals, and (mixed) fractions. Focus on common ones: 1/2, 1/3, 1/4, 1/6, 1/8, 1/10, 3/4.' },
    //{ id:'states_usa', name:'States of USA', emoji:'🇺🇸', blurb:'Can you find all 50 U.S. states?' },
    //{ id:'strange_angles', name:'Strange angles', emoji:'📐', blurb:'Train to recognize common angles like 30°, 45°, 60°, 90°.' },
];

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const fmt = new Intl.NumberFormat();
const fmtDate = ts => new Date(ts).toLocaleString();

function normalizeId(str){
    return String(str||'').trim().toLowerCase().replace(/\s+/g,'-').slice(0,64);
}

function loadDB(){
    try{ return JSON.parse(localStorage.getItem(DB_KEY)) ?? {version:1, groups:{}}; }catch{ return {version:1, groups:{}} }
}
function saveDB(db){
    try{ localStorage.setItem(DB_KEY, JSON.stringify(db)); }
    catch(e){ console.warn('Failed to save DB to localStorage', e); }
}
function getSession(){ try{ return JSON.parse(localStorage.getItem(SESSION_KEY)) ?? null }catch{ return null } }
function setSession(groupId, groupName, userId, display){
    try{ localStorage.setItem(SESSION_KEY, JSON.stringify({groupId, groupName, userId, display})) }
    catch(e){ console.warn('Failed to persist session to localStorage', e); }
}
function clearSession(){ try{ localStorage.removeItem(SESSION_KEY) }catch(e){ /* ignore */ } }

function ensureGroup(db, groupId, groupName){
    if(!db.groups[groupId]) db.groups[groupId] = { name: groupName, players:{}, createdAt: Date.now(), updatedAt: Date.now() };
    if(db.groups[groupId].name !== groupName) db.groups[groupId].name = groupName; // keep latest casing
    return db.groups[groupId];
}
function ensurePlayer(group, userId, display){
    if(!group.players[userId]) group.players[userId] = { display, scores:{}, total:0, updatedAt: Date.now() };
    // update display casing to latest
    group.players[userId].display = display;
    return group.players[userId];
}

function addScore({groupId, userId, gameId, delta, detail}){
    const db = loadDB();
    const group = db.groups[groupId];
    if(!group) return;
    const now = Date.now();
    const player = group.players[userId] ?? (group.players[userId] = {display:userId, scores:{}, total:0, updatedAt:now});

    // Normalize storage to per-session arrays for this game
    const current = player.scores[gameId];
    if(current == null){
        player.scores[gameId] = [];
    }else if(!Array.isArray(current)){
        // migrate legacy aggregated number to single session
        const legacyScore = Number(current) || 0;
        player.scores[gameId] = legacyScore > 0 ? [{ score: legacyScore, ts: player.updatedAt || now }] : [];
    }

    // Push this play session as its own entry
    const add = Number(delta) || 0;
    const entry = { score: add, ts: now };
    if(detail && typeof detail === 'object') entry.detail = detail;
    player.scores[gameId].push(entry);

    // Recompute total as sum of BEST score per game
    player.total = Object.values(player.scores).reduce((sum, v) => {
        if(Array.isArray(v)){
            const best = v.reduce((best, e) => Math.max(best, Number(e.score)||0), 0);
            return sum + best;
        }
        // legacy fallback: treat as best for that game
        return sum + (Number(v)||0);
    }, 0);

    player.updatedAt = now;
    group.updatedAt = now;
    saveDB(db);
}

function computeLeaderboards(group){
    // Global rows: total = sum of BEST score per game (not all sessions)
    const rows = Object.entries(group.players).map(([id,p])=>{
        const total = Object.values(p.scores||{}).reduce((sum, v) => {
            if(Array.isArray(v)){
                const best = v.reduce((best, e) => Math.max(best, Number(e.score)||0), 0);
                return sum + best;
            }
            return sum + (Number(v)||0); // legacy value is the best
        }, 0);
        return { id, name:p.display, total, updatedAt:p.updatedAt, scores:p.scores||{} };
    });
    rows.sort((a,b)=> b.total - a.total || a.name.localeCompare(b.name));

    // Per-game rows as per-session entries (limit top 5 attempts per user)
    const perGame = {};
    for(const g of GAMES){
        const entries = [];
        for(const r of rows){
            const v = r.scores[g.id];
            let attempts = [];
            if(Array.isArray(v)){
                attempts = v.map(sess => ({ id:r.id, name:r.name, score:Number(sess.score)||0, updatedAt:Number(sess.ts)||r.updatedAt }));
            }else if(v != null){
                // legacy single aggregated value: treat as one attempt
                attempts = [{ id:r.id, name:r.name, score:Number(v)||0, updatedAt:r.updatedAt }];
            }
            // Keep only top 5 attempts for this user for this game
            attempts.sort((a,b)=> b.score - a.score || a.updatedAt - b.updatedAt);
            entries.push(...attempts.slice(0,5));
        }
        perGame[g.id] = entries.sort((a,b)=> b.score - a.score || a.name.localeCompare(b.name));
    }
    return { global: rows, perGame };
}

/* ==============================
   DOM wiring
   ============================== */
const login = $('#login');
const hub = $('#hub');
const game = $('#game');
const gameMount = $('#gameMount');
const groupInput = $('#group');
const userInput = $('#username');
const continueBtn = $('#continue');
const resetAllBtn = $('#resetAll');
const who = $('#who');
const groupLabel = $('#groupLabel');
const yourTotal = $('#yourTotal');
const gamesWrap = $('#games');
const switchBtn = $('#switch');
const clearGroupBtn = $('#clearGroup');
const lbTabs = $$('.tab');
const lbGlobal = $('#lb-global');
const lbGame = $('#lb-game');
const lbGameSelect = $('#lbGameSelect');
const tblGlobalBody = $('#tbl-global tbody');
const tblGameBody = $('#tbl-game tbody');
const toast = $('#toast');
const toastMsg = $('#toastMsg');

let CURRENT = { groupId:null, groupName:null, userId:null, display:null, currentGame:null, pendingScore:0 };

function updateContinueState(){
    continueBtn.disabled = !(groupInput.value.trim() && userInput.value.trim());
}

['input','change'].forEach(ev=>{
    groupInput.addEventListener(ev, updateContinueState);
    userInput.addEventListener(ev, updateContinueState);
});

continueBtn.addEventListener('click', () => {
    const groupName = groupInput.value.trim();
    const display = userInput.value.trim();
    const groupId = normalizeId(groupName);
    const userId = normalizeId(display);
    if(!groupId || !userId) return;

    const db = loadDB();
    const group = ensureGroup(db, groupId, groupName);
    ensurePlayer(group, userId, display);
    saveDB(db);

    setSession(groupId, groupName, userId, display);
    CURRENT = { groupId, groupName, userId, display, currentGame:null, pendingScore:0 };
    showHub();
});

resetAllBtn.addEventListener('click', () => {
    if(confirm('Delete ALL EduGames data stored in this browser? This action cannot be undone.')){
        localStorage.removeItem(DB_KEY);
        localStorage.removeItem(SESSION_KEY);
        alert('All data cleared.');
        location.reload();
    }
});

switchBtn.addEventListener('click', () => { clearSession(); showLogin(); });

clearGroupBtn.addEventListener('click', () => {
    if(!CURRENT.groupId) return;
    if(confirm(`Reset all data for group "${CURRENT.groupName}"?`)){
        const db = loadDB();
        delete db.groups[CURRENT.groupId];
        saveDB(db);
        showLogin();
    }
});

// Tabs
lbTabs.forEach(tab => tab.addEventListener('click', () => {
    lbTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const isGlobal = tab.dataset.tab === 'global';
    lbGlobal.hidden = !isGlobal;
    lbGame.hidden = isGlobal;
}));

// Populate games in hub
function renderGames(){
    gamesWrap.innerHTML = '';
    const db = loadDB();
    const group = db.groups[CURRENT.groupId];
    const player = group && group.players[CURRENT.userId];

    function bestFor(gameId){
        if(!player || !player.scores) return 0;
        const v = player.scores[gameId];
        if(Array.isArray(v)) return v.reduce((m, e)=> Math.max(m, Number(e?.score)||0), 0);
        return Number(v)||0;
    }

    for(const g of GAMES){
        const el = document.createElement('div');
        el.className = 'game-card';
        const best = bestFor(g.id);
        el.innerHTML = `
      <div class="game-best pill" title="Your best score for ${g.name}">Best: <strong>${fmt.format(best)}</strong></div>
      <div class="game-emoji" aria-hidden="true">${g.emoji}</div>
      <div class="game-title">${g.name}</div>
      <p class="muted">${g.blurb}</p>
      <div class="game-actions">
        <button class="btn accent" data-play="${g.id}">Play</button>
        <button class="btn ghost" data-lb="${g.id}">Leaderboard</button>
      </div>
    `;
        gamesWrap.appendChild(el);
    }
}

gamesWrap.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if(!btn) return;
    const playId = btn.getAttribute('data-play');
    const lbId = btn.getAttribute('data-lb');
    if(playId){ openGame(playId); }
    if(lbId){
        // switch to Game leaderboard tab and select that game
        $$('.tab').forEach(t => t.classList.remove('active'));
        $$('.tab').find(t=>t.dataset.tab==='game').classList.add('active');
        lbGlobal.hidden = true; lbGame.hidden = false;
        lbGameSelect.value = lbId; renderGameLeaderboard();
    }
});

// Leaderboards
function renderLeaderboards(){
    const db = loadDB();
    const group = db.groups[CURRENT.groupId];
    if(!group) return;
    const {global, perGame} = computeLeaderboards(group);

    // Global
    tblGlobalBody.innerHTML = global.map((row, i) => `
    <tr>
      <td>${i+1}</td>
      <td>${row.name}</td>
      <td>${fmt.format(row.total)}</td>
      <td>${fmtDate(row.updatedAt)}</td>
    </tr>`).join('') || `<tr><td colspan="4">No players yet.</td></tr>`;

    // Game select
    lbGameSelect.innerHTML = GAMES.map(g => `<option value="${g.id}">${g.name}</option>`).join('');

    // Game-specific (default to first or keep current selection)
    if(!lbGameSelect.value) lbGameSelect.value = GAMES[0].id;
    renderGameLeaderboard();

    // Your total (use computed global to handle legacy data)
    const meRow = (global || []).find(r => r.id === CURRENT.userId);
    yourTotal.textContent = meRow ? fmt.format(meRow.total) : '0';
}

function renderGameLeaderboard(){
    const db = loadDB();
    const group = db.groups[CURRENT.groupId];
    if(!group) return;
    const { perGame } = computeLeaderboards(group);
    const rows = perGame[lbGameSelect.value] || [];
    tblGameBody.innerHTML = rows.map((r,i)=>`
    <tr>
      <td>${i+1}</td>
      <td>${r.name}</td>
      <td>${fmt.format(r.score)}</td>
      <td>${fmtDate(r.updatedAt)}</td>
    </tr>`).join('') || `<tr><td colspan="4">No scores yet for this game.</td></tr>`;
}
lbGameSelect.addEventListener('change', renderGameLeaderboard);

// Simple toast
let toastTimer = null;
function showToast(msg='Saved!'){
    toastMsg.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=>toast.classList.remove('show'), 1400);
}

/* ==============================
   Screen switching
   ============================== */
let ACTIVE_GAME = null; // controller with destroy()
function cleanupActiveGame(){
    if(ACTIVE_GAME && typeof ACTIVE_GAME.destroy === 'function'){
        try{ ACTIVE_GAME.destroy(); }catch(e){ console.warn('cleanupActiveGame error', e); }
    }
    ACTIVE_GAME = null;
    const mock = document.getElementById('mockControls');
    if(mock) mock.hidden = false;
    if(gameMount) gameMount.innerHTML = '';
}
function showLogin(){
    login.hidden = false; hub.hidden = true; game.hidden = true;
    groupInput.value = ''; userInput.value = ''; updateContinueState();
    if(typeof cleanupActiveGame === 'function') cleanupActiveGame();
}

function showHub(){
    login.hidden = true; hub.hidden = false; game.hidden = true;
    if(typeof cleanupActiveGame === 'function') cleanupActiveGame();
    who.textContent = CURRENT.display;
    groupLabel.textContent = CURRENT.groupName;
    renderGames();
    renderLeaderboards();
}

function openGame(gameId){
    const meta = GAMES.find(g=>g.id===gameId);
    CURRENT.currentGame = meta; CURRENT.pendingScore = 0;
    $('#gameTitle').textContent = meta.name;
    cleanupActiveGame();
    // Toggle fullscreen mode only for certain games (e.g., world map)
    const gameSection = document.getElementById('game');
    if(gameSection){ gameSection.classList.toggle('fullscreen', meta.id === 'countries_world'); }

    let usedCustom = false;
    if(meta.id === 'multiplication_racer'){
        usedCustom = true;
        const desc = document.getElementById('gameDesc');
        if(desc) desc.textContent = meta.blurb;
        const mock = document.getElementById('mockControls');
        if(mock) mock.hidden = true;

        const startGame = () => {
            if(!window.EduGames || !window.EduGames.multiplication_racer){ console.error('Game module missing'); return; }
            if(gameMount) gameMount.innerHTML = '';
            ACTIVE_GAME = window.EduGames.multiplication_racer.start(gameMount, {
                durationMs: 30000,
                onFinish: (score) => {
                    addScore({ groupId: CURRENT.groupId, userId: CURRENT.userId, gameId: meta.id, delta: score });
                    showToast('Score saved!');
                    showHub();
                }
            });
        };
        if(window.EduGames && window.EduGames.multiplication_racer){
            startGame();
        }else{
            const s = document.createElement('script');
            s.src = 'games/multiplication_racer.js';
            s.onload = startGame;
            s.onerror = () => console.error('Failed to load multiplication racer');
            document.head.appendChild(s);
        }
    }
    if(meta.id === 'countries_world'){
        usedCustom = true;
        const desc = document.getElementById('gameDesc');
        if(desc) desc.textContent = meta.blurb;
        const mock = document.getElementById('mockControls');
        if(mock) mock.hidden = true;

        const startGame = () => {
            if(!window.EduGames || !window.EduGames.countries_world){ console.error('Game module missing'); return; }
            if(gameMount) gameMount.innerHTML = '';
            ACTIVE_GAME = window.EduGames.countries_world.start(gameMount, {
                durationMs: 60000,
                onFinish: (score, detail) => {
                    addScore({ groupId: CURRENT.groupId, userId: CURRENT.userId, gameId: meta.id, delta: score, detail });
                    showToast('Score saved!');
                    showHub();
                }
            });
        };
        if(window.EduGames && window.EduGames.countries_world){
            startGame();
        }else{
            const s = document.createElement('script');
            s.src = 'games/countries_world.js';
            s.onload = startGame;
            s.onerror = () => console.error('Failed to load countries of the world');
            document.head.appendChild(s);
        }
    }

    if(meta.id === 'type_racer'){
        usedCustom = true;
        const desc = document.getElementById('gameDesc');
        if(desc) desc.textContent = meta.blurb;
        const mock = document.getElementById('mockControls');
        if(mock) mock.hidden = true;

        const startGame = () => {
            if(!window.EduGames || !window.EduGames.type_racer){ console.error('Game module missing'); return; }
            if(gameMount) gameMount.innerHTML = '';
            ACTIVE_GAME = window.EduGames.type_racer.start(gameMount, {
                durationMs: 60000,
                onFinish: (score) => {
                    addScore({ groupId: CURRENT.groupId, userId: CURRENT.userId, gameId: meta.id, delta: score });
                    showToast('Score saved!');
                    showHub();
                }
            });
        };
        if(window.EduGames && window.EduGames.type_racer){
            startGame();
        }else{
            const s = document.createElement('script');
            s.src = 'games/type_racer.js';
            s.onload = startGame;
            s.onerror = () => console.error('Failed to load type racer');
            document.head.appendChild(s);
        }
    }

    if(!usedCustom){
        $('#gameDesc').innerHTML = `${meta.blurb} <br><br><em>Demo controls:</em> use the buttons below to add points. When finished, click <strong>Finish & save</strong>.`;
        const mock = document.getElementById('mockControls');
        if(mock) mock.hidden = false;
        if(gameMount) gameMount.innerHTML = '';
    }
    login.hidden = true; hub.hidden = true; game.hidden = false;
}

// Mock game scoring
$('#game').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if(!btn) return;
    const add = Number(btn.getAttribute('data-add'));
    if(add){
        CURRENT.pendingScore += add;
        showToast(`+${add} points (pending: ${CURRENT.pendingScore})`);
    }
});

$('#finishGame').addEventListener('click', () => {
    if(!CURRENT.currentGame) return;
    if(CURRENT.pendingScore <= 0){
        if(!confirm('No points added. Save 0 for this session?')) return;
    }
    addScore({ groupId: CURRENT.groupId, userId: CURRENT.userId, gameId: CURRENT.currentGame.id, delta: CURRENT.pendingScore });
    showToast('Score saved!');
    showHub();
});

$('#backToHub').addEventListener('click', showHub);

// Boot: restore session if available
(function init(){
    // Fill game select now to avoid first flicker
    lbGameSelect.innerHTML = GAMES.map(g => `<option value="${g.id}">${g.name}</option>`).join('');

    const sess = getSession();
    if(sess){
        CURRENT = { ...sess, currentGame:null, pendingScore:0 };
        // ensure entities exist (in case storage cleared)
        const db = loadDB();
        const group = ensureGroup(db, sess.groupId, sess.groupName);
        ensurePlayer(group, sess.userId, sess.display);
        saveDB(db);
        showHub();
    }else{
        showLogin();
    }
})();
