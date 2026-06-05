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
    const avgMin = (c.avg_sec / 60).toFixed(1);

    view.innerHTML = `
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
  }

  function quickBreak(min) {
    const now = new Date();
    const end = new Date(now.getTime() + min * 60000);
    act('admin_add_break', { p_pwd: pwd, p_alkaa: now.toISOString(), p_loppuu: end.toISOString() });
  }

  // ---- Modaali yksittäiselle numerolle ----
  function openModal(tk) {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `
      <div class="modal">
        <div class="num-big">${tk.numero}</div>
        <h2 style="margin-top:6px">Suositeltiinko jatkotutkimusta?</h2>
        <div class="row" style="margin-bottom:12px">
          <button class="btn btn--sm ${tk.tulos === 'kylla' ? '' : 'btn--ghost'}" data-r="kylla">Kyllä</button>
          <button class="btn btn--sm ${tk.tulos === 'ei' ? '' : 'btn--ghost'}" data-r="ei">Ei</button>
        </div>
        <div class="row" style="margin-bottom:8px">
          ${tk.status !== 'vuorossa' ? '<button class="btn btn--sm" data-a="call">Kutsu vuoroon</button>' : ''}
          <button class="btn" data-a="done">Merkitse valmiiksi</button>
        </div>
        <div class="row" style="margin-bottom:14px">
          <button class="btn btn--sm btn--ghost" data-a="noshow">No-show</button>
        </div>
        <button class="btn btn--sm btn--ghost" data-a="close">Sulje</button>
      </div>`;
    document.body.appendChild(back);
    const close = () => back.remove();
    back.addEventListener('click', (e) => { if (e.target === back) close(); });

    back.querySelectorAll('[data-r]').forEach((b) =>
      b.addEventListener('click', async () => {
        await act('admin_set_result', { p_pwd: pwd, p_number: tk.numero, p_result: b.dataset.r });
        close();
      }));
    back.querySelectorAll('[data-a]').forEach((b) =>
      b.addEventListener('click', async () => {
        const a = b.dataset.a;
        if (a === 'close') return close();
        const map = { call: 'admin_call', done: 'admin_complete', noshow: 'admin_noshow' };
        await act(map[a], { p_pwd: pwd, p_number: tk.numero });
        close();
      }));
  }

  // ---- Apu: suorita toiminto ja päivitä ----
  async function act(fn, args) {
    try { await rpc(fn, args); await refresh(); }
    catch (e) { alert('Toiminto epäonnistui. Tarkista yhteys.'); }
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
