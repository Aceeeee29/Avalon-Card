// Tiny realtime-database wrapper with two interchangeable backends:
//   - Firebase Realtime Database (when firebase-config.js exports a config)
//   - Local demo backend (localStorage + `storage` events, syncs between tabs on one device)
//
// API: get(path), set(path, value), update(path, {relPath: value|null}), remove(path),
//      listen(path, cb) -> unsubscribe, onDisconnectSet(path, value)

import config from './firebase-config.js';

const CDN = 'https://www.gstatic.com/firebasejs/10.12.2';

export async function createDb() {
  return config ? firebaseDb(config) : localDb();
}

async function firebaseDb(cfg) {
  const { initializeApp } = await import(`${CDN}/firebase-app.js`);
  const f = await import(`${CDN}/firebase-database.js`);
  const db = f.getDatabase(initializeApp(cfg));
  const R = (p) => f.ref(db, p);
  return {
    mode: 'firebase',
    get: async (p) => (await f.get(R(p))).val(),
    set: (p, v) => f.set(R(p), v),
    update: (p, o) => f.update(R(p), o),
    remove: (p) => f.remove(R(p)),
    listen: (p, cb) => f.onValue(R(p), (s) => cb(s.val())),
    onDisconnectSet: (p, v) => f.onDisconnect(R(p)).set(v)
  };
}

function localDb() {
  const KEY = 'avalon-local-db';
  const listeners = new Set();

  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const keys = (p) => p.split('/').filter(Boolean);
  const at = (t, p) => keys(p).reduce((o, k) => (o == null ? undefined : o[k]), t);
  const put = (t, p, v) => {
    const ks = keys(p); const last = ks.pop(); let o = t;
    for (const k of ks) o = (o[k] && typeof o[k] === 'object') ? o[k] : (o[k] = {});
    if (v == null) delete o[last]; else o[last] = v;
  };
  const write = (t) => { localStorage.setItem(KEY, JSON.stringify(t)); emit(); };
  function emit() {
    const t = read();
    listeners.forEach((l) => {
      const v = at(t, l.path) ?? null;
      const s = JSON.stringify(v);
      if (s !== l.last) { l.last = s; l.cb(v); }
    });
  }
  addEventListener('storage', (e) => { if (e.key === KEY) emit(); });

  return {
    mode: 'local',
    get: async (p) => at(read(), p) ?? null,
    set: async (p, v) => { const t = read(); put(t, p, v); write(t); },
    update: async (p, o) => { const t = read(); for (const k in o) put(t, `${p}/${k}`, o[k]); write(t); },
    remove: async (p) => { const t = read(); put(t, p, null); write(t); },
    listen(p, cb) {
      if (p === '.info/connected') { queueMicrotask(() => cb(true)); return () => {}; }
      const l = { path: p, cb, last: undefined };
      listeners.add(l);
      queueMicrotask(() => {
        if (!listeners.has(l)) return;
        const v = at(read(), p) ?? null;
        l.last = JSON.stringify(v);
        cb(v);
      });
      return () => listeners.delete(l);
    },
    onDisconnectSet(p, v) {
      addEventListener('beforeunload', () => {
        const t = read(); put(t, p, v); localStorage.setItem(KEY, JSON.stringify(t));
      });
    }
  };
}
