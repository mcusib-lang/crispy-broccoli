// ══════════════════════════════════════════════════════════
//  AMRAP · Capa de sincronización con Supabase
//  API pública: window.AMRAPSync
//    .enabled()      → bool (hay config válida)
//    .ready()        → Promise (cliente + sesión cargados)
//    .user()         → objeto usuario o null
//    .signIn(email)  → envía magic link
//    .signOut()      → cierra sesión
//    .pull()         → devuelve el estado remoto (objeto amrap_fn) o null
//    .push(data)     → guarda el estado en la nube (upsert)
//
//  Si no hay config, todo queda inactivo y la app sigue con
//  localStorage sin romperse.
// ══════════════════════════════════════════════════════════
(function () {
  var CFG = (window.AMRAP_CONFIG || {});
  var URL = CFG.SUPABASE_URL, KEY = CFG.SUPABASE_ANON_KEY;
  var ON = !!(URL && KEY);
  var client = null, currentUser = null, readyResolve, readyP = new Promise(function (r) { readyResolve = r; });

  function loadSDK() {
    return new Promise(function (resolve, reject) {
      if (window.supabase && window.supabase.createClient) return resolve();
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
      s.onload = resolve; s.onerror = function () { reject(new Error('No se pudo cargar el SDK de Supabase')); };
      document.head.appendChild(s);
    });
  }

  async function init() {
    if (!ON) { readyResolve(); return; }
    try {
      await loadSDK();
      client = window.supabase.createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
      var res = await client.auth.getSession();
      currentUser = (res && res.data && res.data.session) ? res.data.session.user : null;
      client.auth.onAuthStateChange(function (_e, session) { currentUser = session ? session.user : null; });
    } catch (e) {
      console.warn('AMRAPSync init:', e.message || e);
    } finally {
      readyResolve();
    }
  }

  var API = {
    enabled: function () { return ON; },
    ready: function () { return readyP; },
    user: function () { return currentUser; },
    signIn: async function (email) {
      await readyP; if (!client) throw new Error('Sync no disponible');
      var redirect = location.href.split('#')[0];
      var r = await client.auth.signInWithOtp({ email: email, options: { emailRedirectTo: redirect } });
      if (r.error) throw r.error; return true;
    },
    signOut: async function () { await readyP; if (client) { await client.auth.signOut(); currentUser = null; } },
    pull: async function () {
      await readyP; if (!client || !currentUser) return null;
      var r = await client.from('perfiles').select('data').eq('user_id', currentUser.id).maybeSingle();
      if (r.error) { console.warn('pull:', r.error.message); return null; }
      return r.data ? r.data.data : null;
    },
    push: async function (data) {
      await readyP; if (!client || !currentUser) return false;
      var row = { user_id: currentUser.id, data: data, updated_at: new Date().toISOString() };
      var r = await client.from('perfiles').upsert(row, { onConflict: 'user_id' });
      if (r.error) { console.warn('push:', r.error.message); return false; }
      return true;
    }
  };

  window.AMRAPSync = API;
  init();
})();
