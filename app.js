// ===== Vuoronumero – kävijänäkymä =====
(function () {
  const view = document.getElementById('view');
  let lang = localStorage.getItem('lang') || 'fi';
  let myNumber = parseInt(localStorage.getItem('ticketNumber') || '', 10);
  if (Number.isNaN(myNumber)) myNumber = null;
  let pollTimer = null;
  let lastState = null;

  const sb = (window.CONFIG && window.CONFIG.SUPABASE_URL && window.CONFIG.SUPABASE_ANON_KEY && window.supabase)
    ? window.supabase.createClient(window.CONFIG.SUPABASE_URL, window.CONFIG.SUPABASE_ANON_KEY)
    : null;

  function t(key) { return (window.I18N[lang] && window.I18N[lang][key]) || key; }

  function fmtTime(date) {
    return date.toLocaleTimeString(lang === 'fi' ? 'fi-FI' : 'en-GB',
      { hour: '2-digit', minute: '2-digit' });
  }

  function applyStaticI18n() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('.lang-switch button').forEach((b) => {
      b.classList.toggle('active', b.dataset.lang === lang);
    });
  }

  // ---- Arvioidun ajan laskenta ----
  function estimateSeconds(s) {
    const avg = s.avg_sec || 360;
    const ahead = s.ahead || 0;
    let secs = ahead * avg;
    if (s.serving != null && s.serving_since) {
      const elapsed = (Date.now() - new Date(s.serving_since).getTime()) / 1000;
      secs += Math.max(0, avg - elapsed);
    }
    // Lisää väliin osuvat tauot
    const now = Date.now();
    (s.breaks || []).forEach((b) => {
      const start = new Date(b.alkaa).getTime();
      const end = new Date(b.loppuu).getTime();
      if (end > now && start < now + secs * 1000) {
        secs += (end - Math.max(start, now)) / 1000;
      }
    });
    return secs;
  }

  // ---- Näkymät ----
  function renderPreQueue(s) {
    const closed = s && s.is_open === false;
    view.innerHTML = `
      <section class="card center">
        <h1>${t('appTitle')}</h1>
        <p class="muted">${t('subtitle')}</p>
        ${closed
          ? `<p class="muted" style="margin-top:14px">${t('closed')}</p>`
          : `<button id="enrollBtn" class="btn" style="margin-top:12px">${t('enroll')}</button>`}
      </section>
      <section class="card center">
        <a class="link" href="${window.LINKS.about}" target="_blank" rel="noopener">${t('aboutLink')} →</a>
      </section>`;
    const btn = document.getElementById('enrollBtn');
    if (btn) {
      if (!sb) { btn.disabled = true; }
      else btn.addEventListener('click', onEnroll);
    }
  }

  function renderWaiting(s) {
    const secs = estimateSeconds(s);
    const turn = new Date(Date.now() + secs * 1000);
    const timeText = secs < 60 ? t('soon') : `${t('approxAt')} ${fmtTime(turn)}`;
    view.innerHTML = `
      <section class="card center">
        <div class="label">${t('yourNumber')}</div>
        <div class="ticket-number">${myNumber}</div>
      </section>
      <section class="card center">
        <div class="label">${t('estimate')}</div>
        <div style="font-family:var(--font-head);font-size:34px;font-weight:700;color:var(--ink)">${timeText}</div>
        <div class="muted" style="margin-top:6px">${t('ahead')}: <strong>${s.ahead}</strong> ${t('aheadUnit')}</div>
      </section>
      <section class="now-serving">
        <div class="label" style="color:#fff;opacity:.85">${t('nowServing')}</div>
        <div class="num">${s.serving != null ? s.serving : '–'}</div>
      </section>
      <p class="center muted" style="margin-top:12px">${t('waiting')}</p>
      <section class="card center">
        <a class="link" href="${window.LINKS.about}" target="_blank" rel="noopener">${t('aboutLink')} →</a>
      </section>`;
  }

  function renderTurn() {
    view.innerHTML = `
      <section class="card center">
        <div class="label">${t('yourNumber')}</div>
        <div class="ticket-number">${myNumber}</div>
      </section>
      <section class="card center" style="background:var(--orange);color:#fff">
        <h1 style="color:#fff;margin:0">${t('yourTurn')}</h1>
        <p style="margin:8px 0 0">${t('yourTurnSub')}</p>
      </section>`;
  }

  function renderDone(s) {
    const yes = s.tulos === 'kylla';
    view.innerHTML = `
      <section class="card center">
        <h1>${t('done')}</h1>
        <p>${yes ? t('resultYes') : t('resultNo')}</p>
        <a class="btn ${yes ? '' : 'btn--ghost'}" style="margin-top:10px"
           href="${window.LINKS.booking}" target="_blank" rel="noopener">${t('bookLink')}</a>
      </section>
      <section class="card center">
        <a class="link" href="${window.LINKS.about}" target="_blank" rel="noopener">${t('aboutLink')} →</a>
      </section>
      <p class="center" style="margin-top:8px">
        <button id="resetBtn" class="lang-switch" style="border:none;background:none;color:var(--muted);text-decoration:underline;cursor:pointer">${t('newNumber')}</button>
      </p>`;
    document.getElementById('resetBtn').addEventListener('click', newNumber);
  }

  function render() {
    const s = lastState;
    if (!myNumber || !s) { renderPreQueue(s); return; }
    if (s.status == null) { resetTicket(); return; }   // numero poistettu (reset) → alkuun
    if (s.status === 'noshow') { resetTicket(); return; }
    if (s.status === 'valmis') { renderDone(s); return; }
    if (s.status === 'vuorossa') { renderTurn(); return; }
    renderWaiting(s);
  }

  // ---- Toiminnot ----
  async function takeNumber() {
    const { data, error } = await sb.rpc('take_number');
    if (error) throw error;
    myNumber = data;
    localStorage.setItem('ticketNumber', String(myNumber));
    await poll();
    startPolling();
  }

  async function onEnroll() {
    const btn = document.getElementById('enrollBtn');
    if (btn) btn.disabled = true;
    try {
      await takeNumber();
    } catch (e) {
      if (btn) { btn.disabled = false; }
      alert(t('offline'));
    }
  }

  // "Ota uusi vuoronumero" tutkimuksen jälkeen → hakee suoraan uuden numeron
  async function newNumber() {
    const btn = document.getElementById('resetBtn');
    if (btn) btn.disabled = true;
    myNumber = null;
    localStorage.removeItem('ticketNumber');
    try {
      await takeNumber();
    } catch (e) {
      // esim. jono suljettu → palaa alkunäkymään (näyttää tilan/“suljettu”)
      lastState = null;
      stopPolling();
      bootstrap();
    }
  }

  function resetTicket() {
    myNumber = null;
    localStorage.removeItem('ticketNumber');
    lastState = null;
    stopPolling();
    bootstrap();
  }

  async function poll() {
    if (!sb) return;
    try {
      if (myNumber) {
        const { data, error } = await sb.rpc('get_ticket', { p_number: myNumber });
        if (error) throw error;
        lastState = data;
      } else {
        // pre-queue: tarkista vain onko avoinna (numero 0 ei löydy → saadaan config)
        const { data } = await sb.rpc('get_ticket', { p_number: -1 });
        lastState = data;
      }
      render();
    } catch (e) { /* offline – pidetään edellinen näkymä */ }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(poll, 5000);
  }
  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

  function bootstrap() {
    applyStaticI18n();
    render();                 // piirrä heti (pre-queue / edellinen tila)
    if (!sb) return;
    poll();
    startPolling();
  }

  // ---- Init ----
  document.querySelectorAll('.lang-switch button').forEach((b) => {
    b.addEventListener('click', () => {
      lang = b.dataset.lang;
      localStorage.setItem('lang', lang);
      applyStaticI18n();
      render();
    });
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) poll();
  });

  bootstrap();
})();
