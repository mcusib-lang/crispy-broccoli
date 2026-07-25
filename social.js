// ══════════════════════════════════════════════════════════
//  AMRAP · Capa social (ligas, retos y ánimos)
//  Requiere config.js + supabase-sync.js cargados antes.
//  API pública: window.AMRAPSocial
//    .enabled()            → hay nube configurada
//    .signedIn()           → hay sesión iniciada
//    .uid()                → id del usuario o null
//    .publish(db)          → sube tu ficha pública (jugadores)
//    .players(ids)         → { user_id: fichaPública }
//    .createLiga(opts)     → crea liga y te une; devuelve la liga
//    .joinByCode(code)     → te une a una liga por código
//    .myLigas()            → ligas en las que participas
//    .members(ligaId)      → [{user_id, joined_at, stats}]
//    .leave(ligaId)        → salir de una liga
//    .sendAnimo(toUser)    → mandar un 🔥
//    .animosRecibidos()    → ánimos recibidos (últimos)
//    .util                 → helpers de cálculo (isoWeek, fixtures, standings)
//  Si no hay nube/sesión, los métodos de red devuelven null/[] sin romper.
// ══════════════════════════════════════════════════════════
(function () {
  var Sync = window.AMRAPSync;
  function on(){ return !!(Sync && Sync.enabled && Sync.enabled()); }
  function cli(){ return Sync && Sync.client ? Sync.client() : null; }
  function uid(){ var u = Sync && Sync.user ? Sync.user() : null; return u ? u.id : null; }

  // ── helpers de tiempo/cálculo (puros, reutilizables desde el hub) ──
  function isoWeek(d){
    var date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var day = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - day + 3);
    var firstThu = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
    var week = 1 + Math.round(((date - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
    return date.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
  }
  function daysBetween(a, b){ return Math.round((new Date(b) - new Date(a)) / 86400000); }
  // nº de jornadas (semanas) de una liga por su periodo
  function jornadasDe(inicio, fin){ return Math.max(1, Math.floor(daysBetween(inicio, fin) / 7) + 1); }
  // clave de semana ISO de la jornada j (0-index) desde la fecha de inicio
  function semanaDeJornada(inicio, j){ var d = new Date(inicio); d.setDate(d.getDate() + j * 7); return isoWeek(d); }
  // jornada actual (0-index) según hoy; -1 si aún no empieza
  function jornadaActual(inicio, fin){
    var hoy = new Date(); var ini = new Date(inicio);
    if (hoy < ini) return -1;
    return Math.min(jornadasDe(inicio, fin) - 1, Math.floor(daysBetween(ini, hoy) / 7));
  }
  // sesiones de un jugador dentro del periodo (suma de semanas del rango)
  function sesionesEnPeriodo(stats, inicio, fin){
    var total = 0, n = jornadasDe(inicio, fin), w = (stats && stats.weeks) || {};
    for (var j = 0; j < n; j++){ total += (w[semanaDeJornada(inicio, j)] || 0); }
    return total;
  }
  // emparejamientos round-robin (método del círculo). players: array de ids.
  function fixtures(players, rounds){
    var p = players.slice();
    if (p.length % 2) p.push(null); // "descansa"
    var n = p.length, half = n / 2, out = [], arr = p.slice();
    for (var r = 0; r < rounds; r++){
      var pairs = [];
      for (var i = 0; i < half; i++){ pairs.push([arr[i], arr[n - 1 - i]]); }
      out.push(pairs);
      var fixed = arr[0], rest = arr.slice(1); rest.unshift(rest.pop()); arr = [fixed].concat(rest);
    }
    return out;
  }
  // resultado de una jornada entre a y b: 'a' | 'b' | 'draw' | null(bye)
  function resultado(sa, sb, weekKey){
    if (!weekKey) return null;
    var ca = (sa && sa.weeks && sa.weeks[weekKey]) || 0;
    var cb = (sb && sb.weeks && sb.weeks[weekKey]) || 0;
    if (ca > cb) return 'a'; if (cb > ca) return 'b'; return 'draw';
  }
  // clasificación tipo liga (PJ/G/E/P/Pts) a partir de miembros con stats
  function standingsLiga(members, liga){
    var ids = members.map(function(m){ return m.user_id; });
    var statsById = {}; members.forEach(function(m){ statsById[m.user_id] = m.stats || {}; });
    var tab = {}; ids.forEach(function(id){ tab[id] = { user_id:id, pj:0, g:0, e:0, p:0, pts:0 }; });
    var rounds = jornadasDe(liga.inicio, liga.fin);
    var actual = jornadaActual(liga.inicio, liga.fin);
    if (actual < 0) return Object.values(tab);
    var fx = fixtures(ids, rounds);
    for (var j = 0; j <= actual && j < fx.length; j++){
      var week = semanaDeJornada(liga.inicio, j);
      // solo puntúa una jornada ya cerrada (semana pasada) o la actual si ya terminó… contamos hasta la actual inclusive
      fx[j].forEach(function(pair){
        var a = pair[0], b = pair[1];
        if (!a || !b) return; // descansa
        var res = resultado(statsById[a], statsById[b], week);
        tab[a].pj++; tab[b].pj++;
        if (res === 'a'){ tab[a].g++; tab[a].pts += 3; tab[b].p++; }
        else if (res === 'b'){ tab[b].g++; tab[b].pts += 3; tab[a].p++; }
        else { tab[a].e++; tab[b].e++; tab[a].pts++; tab[b].pts++; }
      });
    }
    return Object.values(tab);
  }

  var Util = { isoWeek:isoWeek, jornadasDe:jornadasDe, semanaDeJornada:semanaDeJornada, jornadaActual:jornadaActual, sesionesEnPeriodo:sesionesEnPeriodo, fixtures:fixtures, resultado:resultado, standingsLiga:standingsLiga };

  // ── derivar tu ficha pública desde el DB local ──
  function statsFromDB(db){
    var weeks = {}, add = function(arr){ (arr || []).forEach(function(e){ if (e && e.date){ var k = isoWeek(new Date(e.date)); weeks[k] = (weeks[k] || 0) + 1; } }); };
    add(db.history); add(db.cardio);
    var rpes = (db.history || []).map(function(h){ return ({facil:6, justo:8, alto:9.5})[h.rpe] || 0; }).filter(Boolean);
    var rpe = rpes.length ? Math.round(rpes.reduce(function(s,x){return s+x;},0) / rpes.length * 10) / 10 : 0;
    var goal = (db.goal || 'full'), planTxt = (db.weeks || 8) + ' sem · ' + goal;
    return { weeks:weeks, total:(db.history || []).length, streak:db.streak || 0, rpe:rpe, plan:planTxt };
  }
  function genCode(name){
    var base = (name || 'ATL').toUpperCase().replace(/[^A-ZÑ]/g, '').slice(0, 6) || 'ATLETA';
    var rnd = Math.random().toString(36).slice(2, 5).toUpperCase();
    return base + '-' + rnd;
  }

  var API = {
    enabled: on,
    signedIn: function(){ return !!(on() && uid()); },
    uid: uid,
    ready: function(){ return Sync ? Sync.ready() : Promise.resolve(); },
    util: Util,
    statsFromDB: statsFromDB,

    // Sube/actualiza tu ficha pública. Devuelve el code usado (o null).
    publish: async function(db){
      await this.ready(); var c = cli(); var id = uid();
      if (!c || !id) return null;
      var code = db.friendCode;
      if (!code){ code = genCode(db.name); }
      var st = statsFromDB(db);
      var row = { user_id:id, code:code, name:(db.name || 'Atleta'), weeks:st.weeks, total:st.total, streak:st.streak, rpe:st.rpe, plan:st.plan, updated_at:new Date().toISOString() };
      var r = await c.from('jugadores').upsert(row, { onConflict:'user_id' });
      if (r.error){ console.warn('publish:', r.error.message); return null; }
      return code;
    },

    players: async function(ids){
      await this.ready(); var c = cli();
      if (!c || !ids || !ids.length) return {};
      var r = await c.from('jugadores').select('*').in('user_id', ids);
      if (r.error){ console.warn('players:', r.error.message); return {}; }
      var map = {}; (r.data || []).forEach(function(p){ map[p.user_id] = p; });
      return map;
    },

    createLiga: async function(o){
      await this.ready(); var c = cli(); var id = uid();
      if (!c || !id) throw new Error('Inicia sesión para crear un reto');
      var code = (o.nombre || 'LIGA').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) + Math.random().toString(36).slice(2, 5).toUpperCase();
      var row = { code:code, nombre:o.nombre || 'Reto', modo:o.modo || 'liga', formato:o.formato || 'single', inicio:o.inicio, fin:o.fin, meta:o.meta || 40, plan:o.plan || '', owner:id };
      var r = await c.from('ligas').insert(row).select().single();
      if (r.error) throw r.error;
      var m = await c.from('liga_miembros').insert({ liga_id:r.data.id, user_id:id });
      if (m.error && m.error.code !== '23505') throw m.error;
      return r.data;
    },

    joinByCode: async function(code){
      await this.ready(); var c = cli(); var id = uid();
      if (!c || !id) throw new Error('Inicia sesión para unirte');
      var r = await c.from('ligas').select('*').eq('code', code.trim().toUpperCase()).maybeSingle();
      if (r.error) throw r.error;
      if (!r.data) throw new Error('No existe ninguna liga con ese código');
      var m = await c.from('liga_miembros').insert({ liga_id:r.data.id, user_id:id });
      if (m.error && m.error.code !== '23505') throw m.error; // 23505 = ya eres miembro
      return r.data;
    },

    myLigas: async function(){
      await this.ready(); var c = cli(); var id = uid();
      if (!c || !id) return [];
      var mem = await c.from('liga_miembros').select('liga_id').eq('user_id', id);
      if (mem.error){ console.warn('myLigas:', mem.error.message); return []; }
      var ids = (mem.data || []).map(function(x){ return x.liga_id; });
      if (!ids.length) return [];
      var r = await c.from('ligas').select('*').in('id', ids).order('created_at', { ascending:false });
      if (r.error){ console.warn('myLigas2:', r.error.message); return []; }
      return r.data || [];
    },

    members: async function(ligaId){
      await this.ready(); var c = cli();
      if (!c) return [];
      var m = await c.from('liga_miembros').select('user_id, joined_at').eq('liga_id', ligaId).order('joined_at', { ascending:true });
      if (m.error){ console.warn('members:', m.error.message); return []; }
      var ids = (m.data || []).map(function(x){ return x.user_id; });
      var st = await this.players(ids);
      return (m.data || []).map(function(x){ return { user_id:x.user_id, joined_at:x.joined_at, stats:st[x.user_id] || null }; });
    },

    leave: async function(ligaId){
      await this.ready(); var c = cli(); var id = uid();
      if (!c || !id) return false;
      var r = await c.from('liga_miembros').delete().eq('liga_id', ligaId).eq('user_id', id);
      return !r.error;
    },

    sendAnimo: async function(toUser){
      await this.ready(); var c = cli(); var id = uid();
      if (!c || !id) return false;
      var r = await c.from('animos').insert({ from_user:id, to_user:toUser, kind:'fire' });
      return !r.error;
    },
    animosRecibidos: async function(){
      await this.ready(); var c = cli(); var id = uid();
      if (!c || !id) return [];
      var since = new Date(Date.now() - 86400000 * 2).toISOString();
      var r = await c.from('animos').select('*').eq('to_user', id).gte('created_at', since).order('created_at', { ascending:false });
      if (r.error) return [];
      return r.data || [];
    }
  };

  window.AMRAPSocial = API;
})();
