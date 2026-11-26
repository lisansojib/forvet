/* In-browser stand-in for supabase-js used by tests/t_auth.py. Implements only what Forvet calls.
   Data lives in localStorage ('mocksb-db') so it survives reloads, like a real server would. */
(function () {
  const USERS = {
    'admin@forvet.test':    { id: 'u-admin',    pw: 'admin-pass-1',  role: 'admin' },
    'viewer@forvet.test':   { id: 'u-viewer',   pw: 'viewer-pass-1', role: 'viewer' },
    'stranger@forvet.test': { id: 'u-stranger', pw: 'stranger-pass', role: null }
  };
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (_) { return d; } };
  const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const db = () => load('mocksb-db', { forvet_ingredients: {}, forvet_formulations: {}, forvet_settings: {}, forvet_revisions: {} });
  const userBy = id => Object.entries(USERS).find(([, u]) => u.id === id);
  window.__mock = { calls: [], users: USERS, fail: null };
  const listeners = [];
  const emit = (ev, s) => listeners.forEach(cb => setTimeout(() => cb(ev, s), 0));
  const session = () => load('mocksb-session', null);
  const role = () => { const s = session(); if (!s) return null; const u = userBy(s.user.id); return u ? u[1].role : null; };
  const delay = v => new Promise(r => setTimeout(() => r(v), 40));

  function query(table) {
    const st = { op: 'select', filters: [], payload: null };
    const run = () => {
      window.__mock.calls.push({ table, op: st.op });
      if (window.__mock.fail) return { data: null, error: { message: window.__mock.fail } };
      const r = role(); const all = db(); const t = all[table] || {};
      const member = r === 'admin' || r === 'viewer';
      const match = row => st.filters.every(([c, v]) => row[c] === v);
      if (st.op === 'select') return { data: member ? Object.values(t).filter(match).sort((a, b) => a.id < b.id ? -1 : 1) : [], error: null };
      if (r !== 'admin') return st.op === 'insert' ? { data: null, error: { message: 'new row violates row-level security policy', code: '42501' } } : { data: [], error: null };
      if (st.op === 'insert') {
        if (t[st.payload.id]) return { data: null, error: { message: 'duplicate', code: '23505' } };
        t[st.payload.id] = { ...st.payload, version: 1, updated_at: new Date().toISOString() }; all[table] = t; save('mocksb-db', all);
        return { data: [{ version: 1 }], error: null };
      }
      const rows = Object.values(t).filter(match);
      rows.forEach(row => { Object.assign(row, st.payload); row.version += 1; row.updated_at = new Date().toISOString(); });
      save('mocksb-db', all); return { data: rows.map(r => ({ version: r.version })), error: null };
    };
    const b = {
      select() { return b; }, order() { return b; }, range() { return b; },
      eq(c, v) { st.filters.push([c, v]); return b; },
      insert(p) { st.op = 'insert'; st.payload = p; return b; },
      update(p) { st.op = 'update'; st.payload = p; return b; },
      then(res, rej) { return delay(run()).then(res, rej); }
    };
    return b;
  }
  window.supabase = {
    createClient() {
      return {
        from: query,
        rpc(name) {
          window.__mock.calls.push({ rpc: name });
          const r = role();
          if (name === 'is_forvet_admin') return delay({ data: r === 'admin', error: null });
          if (name === 'is_forvet_member') return delay({ data: r === 'admin' || r === 'viewer', error: null });
          return delay({ data: null, error: { message: 'unknown rpc' } });
        },
        auth: {
          async getSession() { return { data: { session: session() }, error: null }; },
          onAuthStateChange(cb) { listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
          async signInWithPassword({ email, password }) {
            await delay();
            if (window.__mock.rateLimit) return { data: {}, error: { message: 'Request rate limit reached', status: 429 } };
            const u = USERS[email];
            if (!u || u.pw !== password) return { data: {}, error: { message: 'Invalid login credentials', status: 400 } };
            const s = { user: { id: u.id, email } }; save('mocksb-session', s); emit('SIGNED_IN', s); return { data: { user: s.user, session: s }, error: null };
          },
          async signOut() { localStorage.removeItem('mocksb-session'); emit('SIGNED_OUT', null); return { error: null }; },
          async resetPasswordForEmail(email, opts) { window.__mock.reset = { email, opts }; return { data: {}, error: null }; },
          async updateUser({ password }) { const s = session(); if (!s) return { error: { message: 'Auth session missing' } }; USERS[s.user.email].pw = password; window.__mock.newPw = password; return { data: { user: s.user }, error: null }; },
          async signUp() { return { data: {}, error: { message: 'Signups not allowed' } }; }
        }
      };
    }
  };
  // Test hook: simulate arriving from a password-reset email link.
  window.__mockRecovery = email => { const u = USERS[email]; const s = { user: { id: u.id, email } }; save('mocksb-session', s); emit('PASSWORD_RECOVERY', s); };
})();
