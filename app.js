import { createDb } from './db.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- identity ----------
// `?p=2` lets you run several "players" in one browser for testing.
const SUF = new URLSearchParams(location.search).get('p') || '';
const PID_KEY = `avalon-pid${SUF}`;
const SESSION_KEY = `avalon-session${SUF}`;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const rand = (n, chars) => Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => chars[x % chars.length]).join('');

let pid = localStorage.getItem(PID_KEY);
if (!pid) { pid = rand(10, 'abcdefghijklmnopqrstuvwxyz0123456789'); localStorage.setItem(PID_KEY, pid); }

// ---------- state ----------
let db;
let code = null;        // current room code
let role = null;        // 'player' | 'watch'
let room = null;        // latest room snapshot
let connected = false;
let unsubRoom = null, unsubConn = null;

const path = (sub = '') => `rooms/${code}${sub ? '/' + sub : ''}`;

// ---------- view helpers ----------
function view(name) {
  for (const v of ['home', 'lobby', 'game']) $(v).hidden = v !== name;
  $('header').hidden = name === 'home';
}
function homeMsg(text) { $('homeMsg').textContent = text || ''; }

function playersOf(r) {
  return Object.entries(r.players || {})
    .filter(([, p]) => p && p.name)
    .sort((x, y) => (x[1].joinedAt || 0) - (y[1].joinedAt || 0))
    .map(([id, p]) => ({ id, ...p }));
}

// ---------- boot ----------
async function boot() {
  try {
    db = await createDb();
  } catch (e) {
    homeMsg('Could not load Firebase. Check firebase-config.js and your connection.');
    console.error(e);
    return;
  }
  $('modeNote').textContent = db.mode === 'local'
    ? 'Demo mode: Firebase is not configured, so rooms only work between tabs on this device.'
    : '';

  const hash = location.hash.replace('#', '').toUpperCase();
  if (/^[A-Z]{4}$/.test(hash)) $('joinCode').value = hash;

  const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  if (saved && (!hash || hash === saved.code)) {
    const exists = await db.get(`rooms/${saved.code}`);
    if (exists) return enter(saved.code, saved.role);
    localStorage.removeItem(SESSION_KEY);
  }
  view('home');
}

// ---------- room lifecycle ----------
function enter(c, r) {
  stopListening();
  code = c; role = r; room = null;
  localStorage.setItem(SESSION_KEY, JSON.stringify({ code, role }));
  history.replaceState(null, '', `${location.pathname}${location.search}#${code}`);
  unsubConn = db.listen('.info/connected', (v) => { connected = !!v; presence(); });
  unsubRoom = db.listen(path(), onRoom);
  $('codeChip').textContent = code;
}

function stopListening() {
  unsubRoom && unsubRoom(); unsubConn && unsubConn();
  unsubRoom = unsubConn = null;
}

function leaveLocal(msg) {
  stopListening();
  code = role = room = null;
  localStorage.removeItem(SESSION_KEY);
  history.replaceState(null, '', location.pathname + location.search);
  view('home');
  homeMsg(msg);
}

function presence() {
  if (!room || role !== 'player' || !connected) return;
  const me = room.players && room.players[pid];
  if (me && me.name && me.online !== true) {
    db.set(path(`players/${pid}/online`), true);
    db.onDisconnectSet(path(`players/${pid}/online`), false);
  }
}

function onRoom(v) {
  room = v;
  if (v === null) return leaveLocal('That room was closed.');
  if (role === 'player' && !(v.players && v.players[pid] && v.players[pid].name)) {
    return leaveLocal('You were removed from the room.');
  }
  presence();
  render();
}

// ---------- render ----------
function render() {
  if (!room) return;
  const isHost = room.host === pid;
  $('exitBtn').textContent = isHost ? 'End room' : 'Leave';
  if (room.phase === 'lobby') renderLobby(isHost); else renderGame(isHost);
}

function renderLobby(isHost) {
  view('lobby');
  $('roundBtn').hidden = $('lobbyBtn').hidden = true;
  $('bigCode').textContent = code;
  const list = playersOf(room);
  $('playersTitle').textContent = `Players (${list.length})`;
  $('playerList').innerHTML = list.length
    ? list.map((p) => `
        <li>
          <span class="dot ${p.online ? 'on' : ''}"></span>
          <span class="pname">${esc(p.name)}${p.id === room.host ? ' <em>host</em>' : ''}${p.id === pid ? ' <em>you</em>' : ''}</span>
          ${isHost && p.id !== pid ? `<button class="x" data-remove="${p.id}" aria-label="Remove ${esc(p.name)}">&times;</button>` : ''}
        </li>`).join('')
    : '<li class="empty">No players yet</li>';
  $('startBtn').hidden = !isHost;
  $('startBtn').disabled = list.length < 1;
  $('waitMsg').hidden = isHost;
}

function renderGame(isHost) {
  view('game');
  $('roundBtn').hidden = $('lobbyBtn').hidden = !isHost;

  const roster = room.roster || {};
  const votes = room.votes || {};
  const ids = Object.keys(roster);
  const N = ids.length;
  let a = 0, r = 0;
  ids.forEach((id) => { if (votes[id] === 'approve') a++; else if (votes[id] === 'reject') r++; });
  const voted = a + r;
  const done = N > 0 && voted >= N;
  const hidden = !done; // votes stay secret until everyone has voted

  // the result is the winning card; both overlap while nothing leads
  let show = 'both';
  if (!hidden) { if (a > r) show = 'approve'; else if (done || r > a) show = 'reject'; }
  $('stage').dataset.show = show;
  $('stage').setAttribute('aria-label', show === 'both' ? 'No result yet' : show === 'approve' ? 'Approved' : 'Rejected');

  $('a').textContent = hidden ? '?' : a;
  $('r').textContent = hidden ? '?' : r;
  $('sub').textContent = `${voted} / ${N} voted` + (done ? ' — final' : '');

  // vote buttons
  const inRoster = role === 'player' && !!roster[pid];
  const mine = votes[pid];
  $('buttons').hidden = !inRoster;
  $('approve').disabled = $('reject').disabled = done || !!mine;
  $('approve').classList.toggle('chosen', mine === 'approve');
  $('reject').classList.toggle('chosen', mine === 'reject');

  // status line
  let status = '';
  if (role !== 'player') status = done ? '' : 'Watching';
  else if (!inRoster) status = 'A round is in progress — you will join the next one.';
  else if (mine) status = 'Your vote is locked in.';
  if (!done) {
    const waiting = ids.filter((id) => !votes[id]).map((id) => roster[id]);
    if (waiting.length && waiting.length <= 6) status += `${status ? ' ' : ''}Waiting on: ${waiting.join(', ')}`;
  }
  $('status').textContent = status;
}

// ---------- actions ----------
// Players have no names: they are "Player 1", "Player 2", ... in join order.
function nextPlayerName(players) {
  const used = new Set(Object.values(players || {}).filter((p) => p && p.name).map((p) => p.name));
  let n = 1;
  while (used.has(`Player ${n}`)) n++;
  return `Player ${n}`;
}

async function createRoom() {
  homeMsg('');
  let c, tries = 0;
  do { c = rand(4, ALPHABET); tries++; } while ((await db.get(`rooms/${c}`)) && tries < 20);
  await db.set(`rooms/${c}`, { host: pid, phase: 'lobby', round: 1, createdAt: Date.now() });
  await db.set(`rooms/${c}/players/${pid}`, { name: 'Player 1', joinedAt: Date.now(), online: true });
  enter(c, 'player');
}

async function joinRoom() {
  homeMsg('');
  const c = $('joinCode').value.trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(c)) return homeMsg('Enter the 4-letter room code.');
  const existing = await db.get(`rooms/${c}`);
  if (!existing) return homeMsg('No room with that code.');
  const prev = existing.players && existing.players[pid];
  const name = (prev && prev.name) || nextPlayerName(existing.players);
  await db.set(`rooms/${c}/players/${pid}`, { name, joinedAt: (prev && prev.joinedAt) || Date.now(), online: true });
  enter(c, 'player');
}

function snapshotRoster() {
  const roster = {};
  playersOf(room).forEach((p) => { roster[p.id] = p.name; });
  return roster;
}

const startVote = () => db.update(path(), { phase: 'voting', roster: snapshotRoster(), votes: null, round: (room.round || 1) + 1 });
const newRound = () => db.update(path(), { roster: snapshotRoster(), votes: null, round: (room.round || 1) + 1 });
const backToLobby = () => db.update(path(), { phase: 'lobby', roster: null, votes: null });

function castVote(kind) {
  const roster = room && room.roster;
  const votes = (room && room.votes) || {};
  if (role !== 'player' || !roster || !roster[pid] || votes[pid]) return;
  const total = Object.keys(roster).filter((id) => votes[id]).length;
  if (total >= Object.keys(roster).length) return;
  if (navigator.vibrate) navigator.vibrate(30);
  db.set(path(`votes/${pid}`), kind);
}

async function exitRoom() {
  if (!room) return leaveLocal('');
  if (room.host === pid) {
    if (!confirm('End this room for everyone?')) return;
    await db.remove(path());
  } else if (role === 'player') {
    await db.update(path(), { [`players/${pid}`]: null, [`roster/${pid}`]: null, [`votes/${pid}`]: null });
  }
  leaveLocal('');
}

async function copyInvite() {
  const url = `${location.origin}${location.pathname}#${code}`;
  try { await navigator.clipboard.writeText(url); flash('Invite link copied'); }
  catch { prompt('Copy this invite link:', url); }
}

function flash(text) {
  const old = $('codeChip').textContent;
  $('codeChip').textContent = text;
  setTimeout(() => { if (code) $('codeChip').textContent = code; }, 1200);
  void old;
}

// ---------- events ----------
// Firebase calls hang silently when the database URL is wrong or the database doesn't exist.
const withTimeout = (p) => Promise.race([
  p,
  new Promise((_, rej) => setTimeout(() => rej(new Error('No response from the database. Check databaseURL in firebase-config.js and that Realtime Database is created.')), 8000))
]);
$('createBtn').onclick = () => withTimeout(createRoom()).catch((e) => homeMsg(`Could not create room: ${e.message}`));
$('joinBtn').onclick = () => withTimeout(joinRoom()).catch((e) => homeMsg(`Could not join: ${e.message}`));
$('joinCode').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
$('joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('joinBtn').click(); });

$('startBtn').onclick = startVote;
$('roundBtn').onclick = newRound;
$('lobbyBtn').onclick = backToLobby;
$('exitBtn').onclick = exitRoom;
$('copyBtn').onclick = copyInvite;
$('codeChip').onclick = copyInvite;
$('playerList').addEventListener('click', (e) => {
  const id = e.target.dataset && e.target.dataset.remove;
  if (id) db.update(path(), { [`players/${id}`]: null, [`roster/${id}`]: null, [`votes/${id}`]: null });
});
$('approve').onclick = () => castVote('approve');
$('reject').onclick = () => castVote('reject');

boot();
