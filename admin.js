// ===== Vuoronumero – Admin (työpöytä, suomeksi) =====
(function () {
  const view = document.getElementById('view');
  let pwd = sessionStorage.getItem('adminPwd') || '';
  let state = null;
  let timer = null;

  const sb = (window.CONFIG && window.CONFIG.SUPABASE_URL && window.CONFIG.SUPABASE_ANON_KEY && window.supabase)
    ? window.supabase.createClient(window.CONFIG.SUPABASE_URL, window.CONFIG.SUPABASE_ANON_KEY)
    : null;

  async function rpc(fn, args) {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw error;
    return data;
  }

  function fmt(ts) {
    if (!ts) return '–';
    return new Date(ts).toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' });
  }
  function toLocalInput(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // Tämän päivän sulkeutumishetki (hours_end, esim. "18:00") Date-objektina.
  function closingTimeToday(hhmm) {
    const [h, m] = (hhmm || '18:00').split(':').map(Number);
    const d = new Date();
    d.setHours(h, m || 0, 0, 0);
    return d;
  }

  // Aika sekunteina koko nykyisen jonon käsittelyyn annetulla tutkimusajalla.
  // Sama logiikka kuin asiakkaan estimateSeconds (jonossa olevat × unit +
  // parhaillaan palveltavan jäljellä oleva aika + matkalle osuvat tauot).
  function queueClearSeconds(c, tickets, breaks, unit) {
    const waiting = tickets.filter((t) => t.status === 'odottaa').length;
    let secs = waiting * unit;
    if (c.serving_num != null && c.serving_since) {
      const elapsed = (Date.now() - new Date(c.serving_since).getTime()) / 1000;
      secs += Math.max(0, unit - elapsed);
    }
    const now = Date.now();
    (breaks || []).forEach((b) => {
      const start = new Date(b.alkaa).getTime();
      const end = new Date(b.loppuu).getTime();
      if (end > now && start < now + secs * 1000) {
        secs += (end - Math.max(start, now)) / 1000;
      }
    });
    return secs;
  }

  // Palauttaa varoituksen, jos jono ei arviolta ehdi sulkeutumisaikaan.
  // Käyttää samaa arviota kuin asiakas: mediaani (unit_low)–p75 (unit_high).
  // Varoittaa kun ylärajakaan ei mahdu aukioloajan sisään. null = ei varoitusta.
  function closingWarning(c, tickets, breaks) {
    if (!c.is_open) return null;                       // jo suljettu → ei tarvetta
    const waiting = tickets.filter((t) => t.status === 'odottaa').length;
    if (waiting === 0) return null;
    const unitLow = c.unit_low || 360;
    const unitHigh = c.unit_high || unitLow;
    const now = Date.now();
    const lowEnd = new Date(now + queueClearSeconds(c, tickets, breaks, unitLow) * 1000);
    const highEnd = new Date(now + queueClearSeconds(c, tickets, breaks, unitHigh) * 1000);
    if (highEnd <= closingTimeToday(c.hours_end)) return null;
    return { low: fmt(lowEnd), high: fmt(highEnd), close: c.hours_end };
  }

  // ---- Login ----
  function renderLogin(err) {
    view.innerHTML = `
      <section class="card" style="max-width:380px;margin:40px auto">
        <h1 class="center">Admin-kirjautuminen</h1>
        <p class="muted center">Syötä admin-salasana.</p>
        <input id="pwd" type="password" style="width:100%;padding:12px;border:1px solid var(--violet-200);border-radius:8px;font-size:16px" placeholder="Salasana">
        ${err ? `<p style="color:var(--orange);text-align:center;margin-top:8px">Väärä salasana</p>` : ''}
        <button id="loginBtn" class="btn" style="margin-top:14px">Kirjaudu</button>
      </section>`;
    const input = document.getElementById('pwd');
    const go = async () => {
      pwd = input.value;
      try {
        state = await rpc('admin_login', { p_pwd: pwd });
        sessionStorage.setItem('adminPwd', pwd);
        renderDash();
        startPolling();
      } catch (e) { renderLogin(true); }
    };
    document.getElementById('loginBtn').addEventListener('click', go);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    input.focus();
  }

  // ---- Dashboard ----
  function renderDash() {
    const c = state.config;
    const tickets = state.tickets || [];
    const breaks = state.breaks || [];
    const avgMin = (c.avg_sec > 0) ? (c.avg_sec / 60).toFixed(1) : '–';
    const warn = closingWarning(c, tickets, breaks);

    view.innerHTML = `
      ${warn ? `<div class="card" style="background:var(--orange);color:#fff;margin-bottom:16px">
        <strong>⚠ Jono ei arviolta ehdi sulkemisaikaan mennessä</strong>
        <p style="margin:6px 0 0">Viimeinen vuoro arviolta n. klo ${warn.low === warn.high ? warn.high : warn.low + '–' + warn.high}, sulkeutumisaika klo ${warn.close}.<br>
        Voit sulkea jonotuksen alta (“Tila”) — jonossa olevat ehditään palvella, mutta uusia ei enää oteta.</p>
      </div>` : ''}
      <div class="stat-row" style="margin-bottom:16px">
        <div class="stat"><div class="v">${c.done_count}</div><div class="k">Tutkittu</div></div>
        <div class="stat"><div class="v">${c.yes_count}</div><div class="k">Kyllä-suositus</div></div>
        <div class="stat"><div class="v">${c.no_count}</div><div class="k">Ei-suositusta</div></div>
        <div class="stat"><div class="v">${avgMin}</div><div class="k">Keskikesto (min)</div></div>
      </div>

      <div class="admin-grid">
        <div>
          <div class="card">
            <h2>Jonossa (${tickets.length})</h2>
            <p class="muted" style="margin-top:-6px">Klikkaa numeroa käsitelläksesi sen.</p>
            <ul class="tlist" id="tlist"></ul>
            ${tickets.length === 0 ? '<p class="muted">Ei numeroita jonossa.</p>' : ''}
          </div>
        </div>
        <div>
          <div class="card">
            <h2>Tila</h2>
            <div class="row">
              <button id="openBtn" class="btn ${c.is_open ? '' : 'btn--accent'}">${c.is_open ? 'Avoinna – sulje' : 'Suljettu – avaa'}</button>
            </div>
            <p class="muted" style="margin-top:10px">Nyt vuorossa: <strong>${c.serving_num != null ? c.serving_num : '–'}</strong> ${c.serving_since ? '(alkoi ' + fmt(c.serving_since) + ')' : ''}</p>
            <p class="muted" style="margin-top:6px;font-size:13px">Uuden numeron voi ottaa vain aukioloaikana (klo ${c.hours_start}–${c.hours_end}), vaikka jono olisi auki.</p>
          </div>

          <div class="card">
            <h2>Aukioloajat</h2>
            <div class="row">
              <input id="hStart" type="time" value="${c.hours_start}">
              <span>–</span>
              <input id="hEnd" type="time" value="${c.hours_end}">
              <button id="hSave" class="btn btn--sm">Tallenna</button>
            </div>
          </div>

          <div class="card">
            <h2>Tauot</h2>
            <div class="row" style="margin-bottom:8px">
              <button id="break15" class="btn btn--sm">+15 min tauko nyt</button>
              <button id="break30" class="btn btn--sm">+30 min tauko nyt</button>
            </div>
            <div class="row" style="margin-bottom:8px">
              <input id="bStart" type="datetime-local">
              <input id="bEnd" type="datetime-local">
              <button id="bAdd" class="btn btn--sm">Lisää</button>
            </div>
            <ul class="tlist" id="blist"></ul>
          </div>

          <div class="card">
            <h2>Tapahtuman lopetus</h2>
            <p class="muted" style="margin-top:-6px">Poistaa vuoronumerot ja numero–suositus-linkit (GDPR). Ohjelma on tämän jälkeen heti uudelleenkäytettävissä.</p>
            <div class="row" style="margin-bottom:8px">
              <button id="clearBtn" class="btn btn--sm btn--ghost">Tyhjennä jono ja tauot</button>
            </div>
            <div class="row">
              <button id="resetAllBtn" class="btn btn--sm btn--accent">Nollaa kaikki (myös tilastot)</button>
            </div>
          </div>
        </div>
      </div>`;

    // Jonolista
    const tl = document.getElementById('tlist');
    tickets.forEach((tk) => {
      const li = document.createElement('li');
      if (tk.status === 'vuorossa') li.classList.add('serving');
      const tags = [];
      if (tk.status === 'vuorossa') tags.push('<span class="tag vuorossa">vuorossa</span>');
      if (tk.tulos === 'kylla') tags.push('<span class="tag kylla">kyllä</span>');
      if (tk.tulos === 'ei') tags.push('<span class="tag ei">ei</span>');
      li.innerHTML = `<span class="tnum">${tk.numero}</span>
        <span class="tmeta">otettu ${fmt(tk.created_at)}</span> ${tags.join(' ')}`;
      li.addEventListener('click', () => openModal(tk));
      tl.appendChild(li);
    });

    // Tauot
    const bl = document.getElementById('blist');
    breaks.forEach((b) => {
      const li = document.createElement('li');
      li.style.cursor = 'default';
      li.innerHTML = `<span class="tmeta">${fmt(b.alkaa)} – ${fmt(b.loppuu)}</span>
        <button class="btn btn--sm btn--ghost" data-id="${b.id}">Poista</button>`;
      li.querySelector('button').addEventListener('click', () => act('admin_remove_break', { p_pwd: pwd, p_id: b.id }));
      bl.appendChild(li);
    });

    // Napit
    document.getElementById('openBtn').addEventListener('click', () =>
      act('admin_set_open', { p_pwd: pwd, p_open: !c.is_open }));
    document.getElementById('hSave').addEventListener('click', () =>
      act('admin_set_hours', { p_pwd: pwd, p_start: document.getElementById('hStart').value, p_end: document.getElementById('hEnd').value }));
    document.getElementById('break15').addEventListener('click', () => quickBreak(15));
    document.getElementById('break30').addEventListener('click', () => quickBreak(30));
    document.getElementById('bAdd').addEventListener('click', () => {
      const s = document.getElementById('bStart').value, e = document.getElementById('bEnd').value;
      if (!s || !e) return;
      act('admin_add_break', { p_pwd: pwd, p_alkaa: new Date(s).toISOString(), p_loppuu: new Date(e).toISOString() });
    });
    document.getElementById('clearBtn').addEventListener('click', () => {
      if (confirm('Tyhjennetäänkö kaikki vuoronumerot ja tauot?\n\nTilastot (kyllä/ei/tutkitut) säilyvät. Tätä ei voi perua.')) {
        act('admin_reset', { p_pwd: pwd, p_full: false });
      }
    });
    document.getElementById('resetAllBtn').addEventListener('click', () => {
      if (confirm('NOLLATAANKO KAIKKI – myös tilastolaskurit?\n\nVuoronumerot, tauot ja kyllä/ei/tutkitut-laskurit nollataan. Tätä ei voi perua.')) {
        act('admin_reset', { p_pwd: pwd, p_full: true });
      }
    });
  }

  function quickBreak(min) {
    const now = new Date();
    const end = new Date(now.getTime() + min * 60000);
    act('admin_add_break', { p_pwd: pwd, p_alkaa: now.toISOString(), p_loppuu: end.toISOString() });
  }

  // ---- Modaali yksittäiselle numerolle ----
  function openModal(initialTk) {
    const numero = initialTk.numero;
    const back = document.createElement('div');
    back.className = 'modal-back';
    document.body.appendChild(back);
    const close = () => back.remove();

    // Hae numeron ajantasainen tila (päivittyy toiminnon jälkeen)
    const currentTk = () => (state.tickets || []).find((t) => t.numero === numero) || initialTk;

    function draw() {
      const tk = currentTk();
      const canDone = tk.tulos === 'kylla' || tk.tulos === 'ei';
      back.innerHTML = `
        <div class="modal">
          <div class="num-big">${tk.numero}</div>
          ${tk.status !== 'vuorossa' ? '<div class="row" style="margin:10px 0 16px"><button class="btn" data-a="call">Aloita tutkimus</button></div>' : ''}
          <h2 style="margin-top:6px">Suositeltiinko jatkotutkimusta?</h2>
          <div class="row" style="margin-bottom:12px">
            <button class="btn btn--sm ${tk.tulos === 'kylla' ? '' : 'btn--ghost'}" data-r="kylla">Kyllä</button>
            <button class="btn btn--sm ${tk.tulos === 'ei' ? '' : 'btn--ghost'}" data-r="ei">Ei</button>
          </div>
          <div class="row" style="margin-bottom:8px">
            <button class="btn" data-a="done" ${canDone ? '' : 'disabled'}>Merkitse valmiiksi</button>
          </div>
          ${canDone ? '' : '<p class="muted" style="margin:-2px 0 12px;font-size:13px">Valitse ensin Kyllä tai Ei.</p>'}
          <div class="row" style="margin-bottom:14px">
            <button class="btn btn--sm btn--ghost" data-a="noshow">No-show</button>
          </div>
          <button class="btn btn--sm btn--ghost" data-a="close">Sulje</button>
        </div>`;

      back.querySelectorAll('[data-r]').forEach((b) =>
        b.addEventListener('click', async () => {
          await act('admin_set_result', { p_pwd: pwd, p_number: numero, p_result: b.dataset.r });
          draw();   // päivitä valinta, pidä ikkuna auki
        }));
      back.querySelectorAll('[data-a]').forEach((b) =>
        b.addEventListener('click', async () => {
          const a = b.dataset.a;
          if (a === 'close') return close();
          const map = { call: 'admin_call', done: 'admin_complete', noshow: 'admin_noshow' };
          await act(map[a], { p_pwd: pwd, p_number: numero });
          if (a === 'done' || a === 'noshow') close();   // sulje vain päättävissä toiminnoissa
          else draw();                                   // "Kutsu vuoroon" → pidä auki
        }));
    }

    draw();
  }

  // ---- Apu: suorita toiminto ja päivitä ----
  async function act(fn, args) {
    try { await rpc(fn, args); await refresh(); }
    catch (e) { alert('Toiminto epäonnistui: ' + (e && e.message ? e.message : 'tarkista yhteys')); }
  }

  async function refresh() {
    try { state = await rpc('admin_state', { p_pwd: pwd }); renderDash(); }
    catch (e) { /* säilytä näkymä */ }
  }

  function startPolling() {
    if (timer) clearInterval(timer);
    timer = setInterval(refresh, 4000);
  }

  // ---- Init ----
  if (!sb) {
    view.innerHTML = '<p class="card center">Supabase-asetukset puuttuvat (config.js).</p>';
    return;
  }
  if (pwd) {
    rpc('admin_login', { p_pwd: pwd })
      .then((d) => { state = d; renderDash(); startPolling(); })
      .catch(() => renderLogin(false));
  } else {
    renderLogin(false);
  }
})();
