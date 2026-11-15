/*
 * PodcastStudio — app.js
 * Screens, routing, role switch, forms, review, publishing, analytics and the 30-second tour.
 * Vanilla JavaScript + Bootstrap 5 (+ Chart.js for charts).
 */
(function () {
  'use strict';

  const R = window.PSRules;
  const Store = window.PSStore;

  /* =========================================================
     State
     ========================================================= */
  const state = {
    shows: [],
    episodes: [],
    stats: [],
    prefs: null,
    storageOk: true,
    ui: { search: '', stage: 'all', show: 'all', reviewTab: 'queue', analyticsShow: 'all', live: false },
    charts: {},
    cleanups: [],
    tour: null,
    firstRender: true
  };

  /* =========================================================
     Helpers
     ========================================================= */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const view = () => $('#view');
  const today = () => R.todayISO();
  const nowISO = () => new Date().toISOString();
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const epById = id => state.episodes.find(e => e.episodeId === id);
  const showById = id => state.shows.find(s => s.showId === id);
  const showTitle = id => (showById(id) || {}).title || 'Unknown show';
  const episodesMap = () => Object.fromEntries(state.episodes.map(e => [e.episodeId, e]));
  const role = () => state.prefs.role;
  const isPodcaster = () => role() === 'podcaster';
  const roleLabel = r => (r === 'engineer' ? 'Audio Engineer' : 'Podcaster');

  const nf = new Intl.NumberFormat('en-US');
  const fmtNum = n => nf.format(Math.round(Number(n) || 0));
  const fmtPct = (r, d) => ((Number(r) || 0) * 100).toFixed(d == null ? 1 : d) + '%';

  function fmtDur(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h) return h + 'h ' + String(m).padStart(2, '0') + 'm';
    return m + 'm ' + String(s).padStart(2, '0') + 's';
  }
  function fmtDate(iso) {
    const t = R.parseISO(String(iso || '').slice(0, 10));
    if (t == null) return '—';
    return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }
  function shortDate(iso) {
    const t = R.parseISO(iso);
    return t == null ? '' : new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  function fmtDateTime(ts) {
    const d = new Date(ts);
    if (!ts || isNaN(d)) return '—';
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function relDays(iso) {
    if (!R.parseISO(iso)) return '';
    const n = R.daysBetween(today(), iso);
    if (n === 0) return 'today';
    if (n === 1) return 'tomorrow';
    if (n === -1) return 'yesterday';
    return n > 0 ? 'in ' + n + ' days' : -n + ' days ago';
  }
  function timeAgo(ts) {
    const d = new Date(ts);
    if (!ts || isNaN(d)) return '';
    const s = Math.round((Date.now() - d.getTime()) / 1000);
    if (s < 0) return 'scheduled';
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    const days = Math.floor(s / 86400);
    return days === 1 ? 'yesterday' : days + ' days ago';
  }

  function hashSeed(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  /* =========================================================
     Status & badges
     ========================================================= */
  const STAGES = ['Draft', 'In review', 'Needs fixes', 'Approved', 'Published'];
  const BADGES = {
    Draft: ['b-draft', 'bi-pencil-square'],
    'In review': ['b-review', 'bi-hourglass-split'],
    'Awaiting review': ['b-review', 'bi-hourglass-split'],
    'Needs fixes': ['b-error', 'bi-exclamation-octagon-fill'],
    Approved: ['b-approved', 'bi-check2-circle'],
    Published: ['b-published', 'bi-broadcast'],
    Passed: ['b-published', 'bi-patch-check-fill'],
    'Not submitted': ['b-muted', 'bi-dash-circle']
  };
  function badge(label) {
    const b = BADGES[label] || ['b-muted', 'bi-circle'];
    return '<span class="ps-badge ' + b[0] + '"><i class="bi ' + b[1] + '" aria-hidden="true"></i>' + esc(label) + '</span>';
  }
  function stageOf(ep) {
    if (ep.status === 'Published') return 'Published';
    if (ep.status === 'Approved') return 'Approved';
    if (ep.qcStatus === 'Needs fixes') return 'Needs fixes';
    if (ep.qcStatus === 'Awaiting review') return 'In review';
    return 'Draft';
  }
  function stageCounts() {
    const c = {};
    STAGES.forEach(s => { c[s] = 0; });
    state.episodes.forEach(e => { c[stageOf(e)]++; });
    return c;
  }
  const reviewQueue = () => state.episodes
    .filter(e => e.qcStatus === 'Awaiting review')
    .sort((a, b) => (a.releaseDate || '9999').localeCompare(b.releaseDate || '9999'));

  /* =========================================================
     Persistence (LocalDataStore wrapper)
     ========================================================= */
  /** Saves several collections; rolls back on failure. @returns {boolean} */
  function commit(changes) {
    if (state.storageOk) {
      const saved = [];
      for (const kind of Object.keys(changes)) {
        if (!Store.save(kind, changes[kind])) {
          saved.forEach(k => Store.save(k, state[k]));
          toast('We could not save your changes. Browser storage may be full or blocked. Your work is still on screen, so you can try again.', 'error', 'Storage error');
          return false;
        }
        saved.push(kind);
      }
    }
    Object.assign(state, changes);
    updateNavCounts();
    return true;
  }
  function savePrefs() {
    if (state.storageOk) Store.save('prefs', state.prefs);
  }
  const replaceEpisode = ep => state.episodes.map(e => (e.episodeId === ep.episodeId ? ep : e));

  /* =========================================================
     Feedback: toasts, confirm, live region
     ========================================================= */
  function toast(message, type, title) {
    type = type || 'success';
    const icons = { success: 'bi-check-circle-fill', error: 'bi-x-octagon-fill', warning: 'bi-exclamation-triangle-fill', info: 'bi-info-circle-fill' };
    const el = document.createElement('div');
    el.className = 'toast ps-toast ps-toast-' + type;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
    el.setAttribute('aria-atomic', 'true');
    el.innerHTML =
      '<div class="d-flex align-items-start gap-2 p-3">' +
      '<i class="bi ' + icons[type] + ' fs-5" aria-hidden="true"></i>' +
      '<div class="flex-grow-1 small">' + (title ? '<strong class="d-block mb-1">' + esc(title) + '</strong>' : '') + esc(message) + '</div>' +
      '<button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Dismiss"></button></div>';
    $('#toasts').appendChild(el);
    const t = new bootstrap.Toast(el, { delay: type === 'error' ? 9000 : 5000 });
    el.addEventListener('hidden.bs.toast', () => el.remove());
    t.show();
  }

  function confirmDialog(opts) {
    return new Promise(resolve => {
      const m = $('#confirmModal');
      $('#confirmTitle').textContent = opts.title;
      $('#confirmBody').innerHTML = opts.body;
      const ok = $('#confirmOk');
      ok.textContent = opts.confirmText || 'Confirm';
      ok.className = 'btn btn-' + (opts.variant || 'primary');
      const modal = bootstrap.Modal.getOrCreateInstance(m);
      let result = false;
      const onOk = () => { result = true; modal.hide(); };
      ok.addEventListener('click', onOk);
      m.addEventListener('hidden.bs.modal', () => { ok.removeEventListener('click', onOk); resolve(result); }, { once: true });
      modal.show();
    });
  }

  function alertHTML(type, html, icon) {
    const icons = { error: 'bi-x-octagon-fill', warning: 'bi-exclamation-triangle-fill', success: 'bi-check-circle-fill', info: 'bi-info-circle-fill' };
    return '<div class="ps-alert ps-alert-' + type + '"><i class="bi ' + (icon || icons[type]) + '" aria-hidden="true"></i><div>' + html + '</div></div>';
  }

  /* =========================================================
     Routing
     ========================================================= */
  const ROUTES = [
    [/^#\/home$/, () => renderHome(), 'home'],
    [/^#\/dashboard$/, () => renderDashboard(), 'dashboard'],
    [/^#\/episode\/new$/, () => renderEpisodeForm(null), 'dashboard'],
    [/^#\/episode\/([\w-]+)\/edit$/, m => renderEpisodeForm(m[1]), 'dashboard'],
    [/^#\/episode\/([\w-]+)$/, m => renderEpisodeDetail(m[1]), 'dashboard'],
    [/^#\/review(?:\/([\w-]+))?$/, m => renderReview(m[1]), 'review'],
    [/^#\/analytics$/, () => renderAnalytics(), 'analytics'],
    [/^#\/analytics\/([\w-]+)$/, m => renderEpisodeAnalytics(m[1]), 'analytics'],
    [/^#\/about$/, () => renderAbout(), 'about']
  ];

  function cleanup() {
    Object.values(state.charts).forEach(c => { try { c.destroy(); } catch (e) { /* ignore */ } });
    state.charts = {};
    state.cleanups.forEach(fn => { try { fn(); } catch (e) { /* ignore */ } });
    state.cleanups = [];
  }

  function router(opts) {
    opts = opts || {};
    cleanup();
    const hash = location.hash || '#/home';
    let navKey = null;
    let matched = false;
    for (const [re, fn, key] of ROUTES) {
      const m = hash.match(re);
      if (m) { fn(m); navKey = key; matched = true; break; }
    }
    if (!matched) renderNotFound();
    $$('.nav-list a[data-nav]').forEach(a => {
      const on = a.dataset.nav === navKey;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (!opts.keepPosition) {
      state.prefs.lastScreen = hash;
      savePrefs();
      window.scrollTo(0, 0);
      const oc = bootstrap.Offcanvas.getInstance($('#sidebar'));
      if (oc) oc.hide();
      if (!state.firstRender) view().focus({ preventScroll: true });
    }
    state.firstRender = false;
  }
  const refresh = () => router({ keepPosition: true });
  function navigate(hash) {
    if (location.hash === hash) router(); else location.hash = hash;
  }

  function mount(title, html) {
    document.title = title + ' · PodcastStudio';
    $('#pageTitle').textContent = title;
    view().innerHTML = '<div class="fade-in">' + html + '</div>';
  }

  /* =========================================================
     Role switch
     ========================================================= */
  function setRole(r, opts) {
    opts = opts || {};
    if (r !== 'podcaster' && r !== 'engineer') return;
    const changed = r !== state.prefs.role;
    state.prefs.role = r;
    savePrefs();
    syncRoleUI();
    if (changed && !opts.silent) toast('You are now in the ' + roleLabel(r) + ' view.', 'info');
    if (changed && opts.render !== false) refresh();
  }
  function syncRoleUI() {
    const r = role();
    $$('input[name="role"]').forEach(i => { i.checked = i.value === r; });
    document.body.classList.toggle('role-podcaster', r === 'podcaster');
    document.body.classList.toggle('role-engineer', r === 'engineer');
    $('#rolePill').innerHTML = '<i class="bi ' + (r === 'engineer' ? 'bi-sliders' : 'bi-mic-fill') + '" aria-hidden="true"></i>' + roleLabel(r) + ' view';
    updateNavCounts();
  }
  function updateNavCounts() {
    const n = reviewQueue().length;
    const el = $('#navReviewCount');
    if (el) {
      el.textContent = n ? String(n) : '';
      el.setAttribute('aria-label', n + ' episodes awaiting review');
    }
  }

  /* =========================================================
     Shared fragments
     ========================================================= */
  function unauthorizedHTML(kind) {
    const review = kind === 'review';
    const target = review ? 'engineer' : 'podcaster';
    return '<div class="ps-card"><div class="empty">' +
      '<div class="empty-icon" style="background:var(--ps-warning-bg);color:var(--ps-warning)"><i class="bi bi-lock" aria-hidden="true"></i></div>' +
      '<h2>' + (review ? 'Review actions are for Audio Engineers' : 'Editing and publishing are for Podcasters') + '</h2>' +
      '<p>' + (review
        ? 'Review actions are not available in the Podcaster view. Switch to the Audio Engineer view to check loudness, bitrate and format.'
        : 'Publishing and episode editing are not available in the Audio Engineer view. Switch to the Podcaster view to create, edit or publish episodes.') + '</p>' +
      '<button type="button" class="btn btn-primary" data-action="switch-role" data-role="' + target + '"><i class="bi bi-arrow-left-right me-1" aria-hidden="true"></i>Switch to ' + roleLabel(target) + ' view</button>' +
      '<p class="small text-muted-ps mt-3 mb-0">Role checks are a client-side demo, not real security.</p>' +
      '</div></div>';
  }

  function emptyEpisodesHTML() {
    return '<div class="ps-card"><div class="empty">' +
      '<div class="empty-icon"><i class="bi bi-mic" aria-hidden="true"></i></div>' +
      '<h2>No episodes yet</h2><p>No episodes yet. Create your first episode to get started, or load the sample shows to explore every screen.</p>' +
      '<div class="d-flex flex-wrap gap-2 justify-content-center">' +
      (isPodcaster() ? '<a href="#/episode/new" class="btn btn-primary"><i class="bi bi-plus-lg me-1" aria-hidden="true"></i>Create episode</a>' : '') +
      '<button type="button" class="btn btn-outline-primary" data-action="load-sample"><i class="bi bi-database-add me-1" aria-hidden="true"></i>Load sample data</button>' +
      '</div></div></div>';
  }

  function countUp(root) {
    $$('[data-count]', root).forEach(el => {
      const target = Number(el.dataset.count) || 0;
      const fmt = el.dataset.fmt;
      const show = v => {
        if (fmt === 'pct') el.textContent = fmtPct(v);
        else if (fmt === 'dur') el.textContent = fmtDur(v);
        else el.textContent = fmtNum(v);
      };
      if (reduceMotion() || target === 0) { show(target); return; }
      const t0 = performance.now(), dur = 900;
      const step = now => {
        const p = Math.min(1, (now - t0) / dur);
        show(target * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  function waveformHTML(seedStr, bars) {
    const rnd = mulberry(hashSeed(seedStr));
    let out = '';
    for (let i = 0; i < bars; i++) {
      const env = Math.sin((i / bars) * Math.PI) * 0.6 + 0.4;
      const h = Math.round(clamp((0.25 + rnd() * 0.75) * env, 0.08, 1) * 100);
      out += '<span style="height:' + h + '%;animation-delay:' + (i * 8) + 'ms"></span>';
    }
    return '<div class="waveform" aria-hidden="true">' + out + '</div>';
  }
  function mulberry(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function downloadCSV(filename, csv) {
    try {
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    } catch (e) {
      toast('The CSV file could not be created in this browser. Try another browser.', 'error', 'Export failed');
      return false;
    }
  }

  /* =========================================================
     Screen: Home / Role select
     ========================================================= */
  function recentActivity(n) {
    const ev = [];
    state.episodes.forEach(e => {
      const link = '<a href="#/episode/' + esc(e.episodeId) + '">' + esc(e.title) + '</a>';
      if (e.createdAt) ev.push({ t: e.createdAt, icon: 'bi-plus-lg', cls: '', text: link + ' was created as a draft' });
      if (e.submittedAt) ev.push({ t: e.submittedAt, icon: 'bi-send', cls: 'wait', text: link + ' was sent for review' });
      (e.reviews || []).forEach(rv => ev.push({
        t: rv.at,
        icon: rv.result === 'Passed' ? 'bi-patch-check' : 'bi-exclamation-octagon',
        cls: rv.result === 'Passed' ? 'ok' : 'bad',
        text: link + (rv.result === 'Passed' ? ' passed the quality check' : ' was returned with fixes')
      }));
      if (e.publishedAt) ev.push({ t: e.publishedAt, icon: 'bi-broadcast', cls: 'ok', text: link + ' was published' });
    });
    return ev.filter(x => new Date(x.t) <= new Date()).sort((a, b) => new Date(b.t) - new Date(a.t)).slice(0, n);
  }

  function renderHome() {
    const counts = stageCounts();
    const from30 = R.addDays(today(), -29);
    const plays30 = R.summarize(R.statsInRange(state.stats, from30, today()), episodesMap()).plays;
    const activity = recentActivity(6);
    const q = reviewQueue().length;
    const cur = role();

    mount('Home',
      '<section class="hero mb-4" aria-labelledby="heroTitle">' +
        '<canvas class="hero-wave" id="heroWave" aria-hidden="true"></canvas>' +
        '<div class="hero-inner">' +
          '<span class="eyebrow"><span class="dot-live" aria-hidden="true"></span>Podcast media management &amp; analytics</span>' +
          '<h1 id="heroTitle" class="hero-title">Prepare, approve and measure every episode in one studio.</h1>' +
          '<p class="hero-sub">PodcastStudio connects episode status, audio quality checks and listener analytics, so your team always knows what is ready, what is live and what is working.</p>' +
          '<div class="d-flex flex-wrap gap-2 mt-4">' +
            '<button type="button" class="btn btn-light btn-lg" data-action="start-tour"><i class="bi bi-stopwatch me-1" aria-hidden="true"></i>Take the 30-second tour</button>' +
            '<a href="#/analytics" class="btn btn-outline-light btn-lg"><i class="bi bi-graph-up-arrow me-1" aria-hidden="true"></i>See the analytics</a>' +
          '</div>' +
          '<ul class="hero-proof">' +
            '<li><i class="bi bi-check2-circle" aria-hidden="true"></i>Draft → Approved → Published</li>' +
            '<li><i class="bi bi-check2-circle" aria-hidden="true"></i>Loudness, bitrate &amp; format checks</li>' +
            '<li><i class="bi bi-check2-circle" aria-hidden="true"></i>Plays, listeners &amp; completion</li>' +
          '</ul>' +
        '</div>' +
      '</section>' +

      '<h2 class="section-title">Choose your role</h2>' +
      '<div class="row g-3 mb-4 stagger">' +
        roleCardHTML('podcaster', cur, 'bi-mic-fill', 'Podcaster',
          'Create, schedule and publish episodes, then see how they perform.',
          ['Create and edit episodes', 'Publish once the quality check passes', 'Track plays, listeners and completion'],
          '#/dashboard', counts.Approved + ' approved and ready to publish') +
        roleCardHTML('engineer', cur, 'bi-sliders', 'Audio Engineer',
          'Review audio details against clear rules and approve or return each episode.',
          ['Check loudness, bitrate and format', 'Mark Passed or Needs fixes with a note', 'Keep a record of every check'],
          '#/review', q + ' episode' + (q === 1 ? '' : 's') + ' waiting for review') +
      '</div>' +

      '<div class="row g-3 mb-4 stagger">' +
        statTile('Episodes', state.episodes.length, 'bi-collection-play', 'across ' + state.shows.length + ' shows') +
        statTile('Awaiting review', q, 'bi-hourglass-split', 'in the Review Queue') +
        statTile('Published', counts.Published, 'bi-broadcast', 'live episodes') +
        statTile('Plays, last 30 days', plays30, 'bi-headphones', 'sample listener data') +
      '</div>' +

      '<div class="row g-4">' +
        '<div class="col-lg-7"><div class="ps-card h-100"><div class="card-header"><h2 class="card-title">How PodcastStudio works</h2></div><div class="card-body">' +
          '<div class="flow">' +
            flowStep(1, 'Create', 'The podcaster adds title, description, audio file and release date.') +
            flowStep(2, 'Review', 'The audio engineer checks loudness, bitrate and format against the rules.') +
            flowStep(3, 'Publish', 'Only episodes with a Passed check can go live.') +
            flowStep(4, 'Measure', 'Plays, unique listeners, listening time and completion per episode.') +
          '</div>' +
          '<div class="ps-alert ps-alert-info mt-3"><i class="bi bi-lightning-charge-fill" aria-hidden="true"></i><div><strong>Product promise:</strong> create, check, publish and measure an episode in under 30 seconds. <button type="button" class="btn btn-link p-0 align-baseline fw-bold" data-action="start-tour">Try the timed tour</button></div></div>' +
        '</div></div></div>' +
        '<div class="col-lg-5"><div class="ps-card h-100"><div class="card-header"><h2 class="card-title">Recent activity</h2></div><div class="card-body pt-2">' +
          (activity.length
            ? '<ul class="feed">' + activity.map(a =>
              '<li><span class="feed-icon ' + a.cls + '"><i class="bi ' + a.icon + '" aria-hidden="true"></i></span><div class="feed-text">' + a.text + '<span class="feed-time">' + esc(timeAgo(a.t)) + '</span></div></li>').join('') + '</ul>'
            : '<p class="text-muted-ps mb-0">No activity yet. Create your first episode to get started.</p>') +
        '</div></div></div>' +
      '</div>');

    startHeroWave();
    countUp(view());
  }

  function roleCardHTML(key, current, icon, title, desc, bullets, href, note) {
    const on = key === current;
    return '<div class="col-md-6"><div class="ps-card ps-card-hover role-card' + (on ? ' is-current' : '') + '">' +
      (on ? '<span class="current-tag ps-badge b-approved"><i class="bi bi-person-check" aria-hidden="true"></i>Current view</span>' : '') +
      '<div class="role-icon"><i class="bi ' + icon + '" aria-hidden="true"></i></div>' +
      '<h3>' + title + '</h3><p class="text-muted-ps mb-0">' + desc + '</p>' +
      '<ul>' + bullets.map(b => '<li><i class="bi bi-check2" aria-hidden="true"></i>' + b + '</li>').join('') + '</ul>' +
      '<div class="d-flex flex-wrap align-items-center gap-2 justify-content-between">' +
      '<button type="button" class="btn ' + (on ? 'btn-primary' : 'btn-outline-primary') + '" data-action="go-role" data-role="' + key + '" data-href="' + href + '">Continue as ' + title + ' <i class="bi bi-arrow-right" aria-hidden="true"></i></button>' +
      '<span class="small text-muted-ps">' + esc(note) + '</span></div>' +
      '</div></div>';
  }
  function statTile(label, value, icon, foot, fmt) {
    return '<div class="col-12 col-sm-6 col-xl-3"><div class="ps-card kpi">' +
      '<div class="kpi-top"><p class="kpi-label">' + label + '</p><span class="kpi-icon"><i class="bi ' + icon + '" aria-hidden="true"></i></span></div>' +
      '<div class="kpi-value" data-count="' + value + '"' + (fmt ? ' data-fmt="' + fmt + '"' : '') + '>0</div>' +
      '<div class="kpi-foot">' + foot + '</div></div></div>';
  }
  function flowStep(n, t, d) {
    return '<div class="flow-step"><span class="n">' + n + '</span><strong>' + t + '</strong><span>' + d + '</span></div>';
  }

  function startHeroWave() {
    const c = $('#heroWave');
    if (!c) return;
    const ctx = c.getContext('2d');
    let raf = 0, t = 0;
    const size = () => {
      const r = c.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.max(1, r.width * dpr);
      c.height = Math.max(1, r.height * dpr);
    };
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = c.width, h = c.height;
      ctx.clearRect(0, 0, w, h);
      const gap = 9 * dpr, bw = 4 * dpr;
      const bars = Math.ceil(w / gap);
      for (let i = 0; i < bars; i++) {
        const a = (Math.sin(i * 0.17 + t) * 0.5 + 0.5) * (Math.sin(i * 0.045 - t * 0.55) * 0.5 + 0.5);
        const bh = Math.max(3 * dpr, a * h * 0.85);
        ctx.fillStyle = 'rgba(255,255,255,' + (0.1 + a * 0.22).toFixed(3) + ')';
        ctx.fillRect(i * gap, h - bh, bw, bh);
      }
      t += 0.025;
      if (!reduceMotion()) raf = requestAnimationFrame(draw);
    };
    size();
    draw();
    const onResize = () => { size(); if (reduceMotion()) draw(); };
    window.addEventListener('resize', onResize);
    state.cleanups.push(() => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); });
  }

  /* =========================================================
     Screen: Publishing Dashboard
     ========================================================= */
  function renderDashboard() {
    if (!state.episodes.length) {
      mount('Publishing', pageHead('Publishing dashboard', 'Track every episode from draft to published.', '') + emptyEpisodesHTML());
      return;
    }
    const counts = stageCounts();
    const upcoming = state.episodes
      .filter(e => e.status !== 'Published' && e.releaseDate && e.releaseDate >= today())
      .sort((a, b) => a.releaseDate.localeCompare(b.releaseDate)).slice(0, 5);
    const partial = state.episodes.filter(R.hasMissingAudioDetails);

    mount('Publishing',
      pageHead('Publishing dashboard', 'Track every episode from draft to published.',
        (isPodcaster() ? '<a href="#/episode/new" class="btn btn-primary"><i class="bi bi-plus-lg me-1" aria-hidden="true"></i>New episode</a>' : '') +
        '<button type="button" class="btn btn-outline-secondary" data-action="export-episodes"><i class="bi bi-download me-1" aria-hidden="true"></i>Export CSV</button>') +

      (!isPodcaster() ? '<div class="mb-3">' + alertHTML('info', 'You are in the <strong>Audio Engineer</strong> view. You can browse episodes here; editing and publishing are available in the Podcaster view. <a href="#/review">Open the Review Queue</a>.') + '</div>' : '') +
      (partial.length ? '<div class="mb-3">' + alertHTML('warning', '<strong>' + partial.length + ' episode' + (partial.length > 1 ? 's are' : ' is') + ' missing audio details.</strong> ' +
        partial.map(p => '<a href="#/episode/' + esc(p.episodeId) + '">' + esc(p.title) + '</a>').join(', ') + ' cannot be reviewed until the file name and duration are added.') + '</div>' : '') +

      '<div class="pipeline mb-4" role="group" aria-label="Filter episodes by stage">' +
        STAGES.map(s =>
          '<button type="button" class="pipe-step' + (state.ui.stage === s ? ' active' : '') + '" data-stage="' + s + '" aria-pressed="' + (state.ui.stage === s) + '">' +
          '<span class="pipe-count" data-count="' + counts[s] + '">0</span>' + badge(s) + '</button>').join('<i class="bi bi-chevron-right pipe-arrow d-none d-md-inline" aria-hidden="true"></i>') +
      '</div>' +

      '<div class="row g-4">' +
        '<div class="col-xl-8 min-w-0">' +
          '<section class="ps-card" aria-labelledby="epsTitle">' +
            '<div class="card-header"><h2 class="card-title" id="epsTitle">Episodes</h2><span class="result-count ms-auto" id="resultCount" aria-live="polite"></span>' +
            '<button class="btn btn-sm btn-outline-secondary d-md-none" type="button" data-bs-toggle="collapse" data-bs-target="#filters" aria-expanded="false" aria-controls="filters"><i class="bi bi-funnel me-1" aria-hidden="true"></i>Filters</button></div>' +
            '<div class="collapse d-md-block" id="filters"><div class="card-body pb-0">' +
              '<div class="row g-2 filter-bar">' +
                '<div class="col-12 col-md-6"><label class="form-label small" for="search">Search</label><div class="search-wrap"><i class="bi bi-search" aria-hidden="true"></i><input type="search" class="form-control" id="search" placeholder="Title, description, file or show" value="' + esc(state.ui.search) + '"><kbd class="d-none d-md-inline" aria-hidden="true">/</kbd></div></div>' +
                '<div class="col-6 col-md-3"><label class="form-label small" for="stageFilter">Status</label><select class="form-select" id="stageFilter"><option value="all">All statuses</option>' +
                  STAGES.map(s => '<option value="' + s + '"' + (state.ui.stage === s ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></div>' +
                '<div class="col-6 col-md-3"><label class="form-label small" for="showFilter">Show</label><select class="form-select" id="showFilter"><option value="all">All shows</option>' +
                  state.shows.map(s => '<option value="' + esc(s.showId) + '"' + (state.ui.show === s.showId ? ' selected' : '') + '>' + esc(s.title) + '</option>').join('') + '</select></div>' +
              '</div></div></div>' +
            '<div id="episodeResults" class="mt-3"></div>' +
          '</section>' +
        '</div>' +
        '<div class="col-xl-4">' +
          '<section class="ps-card mb-4" aria-labelledby="upTitle"><div class="card-header"><h2 class="card-title" id="upTitle"><i class="bi bi-calendar-event me-2 text-primary" aria-hidden="true"></i>Upcoming releases</h2></div><div class="card-body pt-2">' +
            (upcoming.length ? '<ul class="upcoming">' + upcoming.map(upcomingItem).join('') + '</ul>' : '<p class="text-muted-ps mb-0">No upcoming releases scheduled.</p>') +
          '</div></section>' +
          '<section class="ps-card" aria-labelledby="readyTitle"><div class="card-header"><h2 class="card-title" id="readyTitle"><i class="bi bi-rocket-takeoff me-2 text-primary" aria-hidden="true"></i>Ready to publish</h2></div><div class="card-body pt-2">' +
            readyListHTML() +
          '</div></section>' +
        '</div>' +
      '</div>');

    countUp(view());
    const search = $('#search');
    search.addEventListener('input', () => { state.ui.search = search.value; renderEpisodeResults(); });
    $('#stageFilter').addEventListener('change', e => { state.ui.stage = e.target.value; syncPipeline(); renderEpisodeResults(); });
    $('#showFilter').addEventListener('change', e => { state.ui.show = e.target.value; renderEpisodeResults(); });
    $$('.pipe-step').forEach(b => b.addEventListener('click', () => {
      state.ui.stage = state.ui.stage === b.dataset.stage ? 'all' : b.dataset.stage;
      $('#stageFilter').value = state.ui.stage;
      syncPipeline();
      renderEpisodeResults();
    }));
    renderEpisodeResults();
  }

  function pageHead(title, sub, actions) {
    return '<div class="page-head"><div><h1 class="page-title">' + title + '</h1>' + (sub ? '<p class="page-sub">' + sub + '</p>' : '') + '</div>' +
      (actions ? '<div class="d-flex flex-wrap gap-2">' + actions + '</div>' : '') + '</div>';
  }

  function syncPipeline() {
    $$('.pipe-step').forEach(b => {
      const on = b.dataset.stage === state.ui.stage;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  function upcomingItem(e) {
    const t = R.parseISO(e.releaseDate);
    const d = new Date(t);
    return '<li><span class="date-tile"><b>' + d.getUTCDate() + '</b><small>' + d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }) + '</small></span>' +
      '<div class="min-w-0 flex-grow-1"><a class="ep-title d-block text-truncate" href="#/episode/' + esc(e.episodeId) + '">' + esc(e.title) + '</a>' +
      '<span class="ep-meta">' + esc(showTitle(e.showId)) + ' · ' + esc(relDays(e.releaseDate)) + '</span></div>' + badge(stageOf(e)) + '</li>';
  }

  function readyListHTML() {
    const ready = state.episodes.filter(e => e.status === 'Approved' && e.qcStatus === 'Passed');
    if (!ready.length) return '<p class="text-muted-ps mb-0">Nothing is waiting to be published. Approved episodes will appear here.</p>';
    return '<ul class="upcoming">' + ready.map(e =>
      '<li><span class="feed-icon ok"><i class="bi bi-patch-check" aria-hidden="true"></i></span><div class="min-w-0 flex-grow-1">' +
      '<a class="ep-title d-block text-truncate" href="#/episode/' + esc(e.episodeId) + '">' + esc(e.title) + '</a><span class="ep-meta">Scheduled ' + esc(fmtDate(e.releaseDate)) + '</span></div>' +
      (isPodcaster() ? '<button type="button" class="btn btn-sm btn-primary" data-action="publish" data-id="' + esc(e.episodeId) + '">Publish</button>' : '') +
      '</li>').join('') + '</ul>';
  }

  function filteredEpisodes() {
    const q = state.ui.search.trim().toLowerCase();
    const rows = state.episodes.filter(e =>
      (state.ui.stage === 'all' || stageOf(e) === state.ui.stage) &&
      (state.ui.show === 'all' || e.showId === state.ui.show) &&
      (!q || [e.title, e.description, e.audioFileName, showTitle(e.showId)].join(' ').toLowerCase().indexOf(q) !== -1));
    const so = state.prefs.sortOrder || { key: 'releaseDate', dir: 'desc' };
    const m = so.dir === 'asc' ? 1 : -1;
    const val = e => {
      switch (so.key) {
        case 'title': return e.title.toLowerCase();
        case 'status': return STAGES.indexOf(stageOf(e));
        case 'qc': return e.qcStatus || '';
        case 'durationSec': return Number(e.durationSec) || 0;
        default: return e.releaseDate || '';
      }
    };
    return rows.sort((a, b) => { const va = val(a), vb = val(b); return va < vb ? -m : va > vb ? m : 0; });
  }

  function sortTh(key, label, cls) {
    const so = state.prefs.sortOrder || {};
    const active = so.key === key;
    const aria = active ? (so.dir === 'asc' ? 'ascending' : 'descending') : 'none';
    const icon = active ? (so.dir === 'asc' ? 'bi-sort-up' : 'bi-sort-down') : 'bi-arrow-down-up';
    return '<th scope="col" class="' + (cls || '') + '" aria-sort="' + aria + '"><button type="button" class="sort-btn" data-sort="' + key + '">' + label + '<i class="bi ' + icon + '" aria-hidden="true"></i></button></th>';
  }

  function renderEpisodeResults() {
    const box = $('#episodeResults');
    if (!box) return;
    const rows = filteredEpisodes();
    $('#resultCount').textContent = 'Showing ' + rows.length + ' of ' + state.episodes.length;
    if (!rows.length) {
      box.innerHTML = '<div class="empty"><div class="empty-icon"><i class="bi bi-search" aria-hidden="true"></i></div><h3>No episodes match your filters</h3>' +
        '<p>Try a different search term or status, or reset the filters to see every episode.</p>' +
        '<button type="button" class="btn btn-outline-primary" data-action="reset-filters"><i class="bi bi-arrow-counterclockwise me-1" aria-hidden="true"></i>Reset filters</button></div>';
      return;
    }
    const pod = isPodcaster();
    const table =
      '<div class="table-responsive d-none d-md-block"><table class="table ps-table align-middle">' +
      '<caption class="visually-hidden">Episodes with status, quality check result and release date</caption>' +
      '<thead><tr>' + sortTh('title', 'Episode') + sortTh('status', 'Status') + sortTh('qc', 'Quality check') + sortTh('releaseDate', 'Release date') + sortTh('durationSec', 'Duration', 'text-end') + '<th scope="col" class="text-end">Actions</th></tr></thead><tbody>' +
      rows.map(e => {
        const can = R.canPublish(e, role()).ok;
        const missing = R.hasMissingAudioDetails(e);
        return '<tr class="row-link" data-href="#/episode/' + esc(e.episodeId) + '">' +
          '<td style="min-width:220px"><a class="ep-title" href="#/episode/' + esc(e.episodeId) + '">' + esc(e.title) + '</a>' +
          '<div class="ep-meta">' + esc(showTitle(e.showId)) + (missing ? ' · <span style="color:var(--ps-warning)"><i class="bi bi-exclamation-triangle-fill" aria-hidden="true"></i> Missing audio details</span>' : ' · ' + esc(e.audioFileName)) + '</div></td>' +
          '<td>' + badge(e.status) + '</td>' +
          '<td>' + badge(e.qcStatus) + '</td>' +
          '<td class="text-nowrap">' + esc(fmtDate(e.releaseDate)) + '<div class="ep-meta">' + esc(relDays(e.releaseDate)) + '</div></td>' +
          '<td class="num">' + (e.durationSec ? esc(fmtDur(e.durationSec)) : '—') + '</td>' +
          '<td class="text-end text-nowrap">' +
            (can ? '<button type="button" class="btn btn-sm btn-primary me-1" data-action="publish" data-id="' + esc(e.episodeId) + '">Publish</button>' : '') +
            (pod ? '<a class="btn btn-sm btn-outline-secondary me-1" href="#/episode/' + esc(e.episodeId) + '/edit" aria-label="Edit ' + esc(e.title) + '"><i class="bi bi-pencil" aria-hidden="true"></i></a>' : '') +
            (e.status === 'Published' ? '<a class="btn btn-sm btn-outline-secondary" href="#/analytics/' + esc(e.episodeId) + '" aria-label="Analytics for ' + esc(e.title) + '"><i class="bi bi-graph-up" aria-hidden="true"></i></a>' : '') +
          '</td></tr>';
      }).join('') + '</tbody></table></div>';

    const cards = '<div class="d-md-none px-3 pb-3">' + rows.map(e =>
      '<a class="ep-card" href="#/episode/' + esc(e.episodeId) + '">' +
      '<div class="d-flex justify-content-between gap-2 mb-1"><strong>' + esc(e.title) + '</strong></div>' +
      '<div class="ep-meta mb-2">' + esc(showTitle(e.showId)) + ' · ' + esc(fmtDate(e.releaseDate)) + (e.durationSec ? ' · ' + esc(fmtDur(e.durationSec)) : '') + '</div>' +
      '<div class="d-flex flex-wrap gap-1">' + badge(e.status) + badge(e.qcStatus) +
      (R.hasMissingAudioDetails(e) ? '<span class="ps-badge b-review"><i class="bi bi-exclamation-triangle-fill" aria-hidden="true"></i>Missing audio details</span>' : '') + '</div></a>').join('') + '</div>';

    box.innerHTML = table + cards;

    $$('.sort-btn', box).forEach(b => b.addEventListener('click', () => {
      const so = state.prefs.sortOrder || {};
      state.prefs.sortOrder = { key: b.dataset.sort, dir: so.key === b.dataset.sort && so.dir === 'asc' ? 'desc' : 'asc' };
      savePrefs();
      renderEpisodeResults();
      const again = $('.sort-btn[data-sort="' + b.dataset.sort + '"]');
      if (again) again.focus();
    }));
    $$('tr.row-link', box).forEach(tr => tr.addEventListener('click', e => {
      if (e.target.closest('a,button')) return;
      navigate(tr.dataset.href);
    }));
  }

  function exportEpisodes() {
    const rows = $('#episodeResults') ? filteredEpisodes() : state.episodes;
    if (!rows.length) { toast('There are no rows to export. Reset the filters and try again.', 'warning'); return; }
    const csv = R.toCSV(rows, [
      { label: 'Episode ID', value: e => e.episodeId },
      { label: 'Title', value: e => e.title },
      { label: 'Show', value: e => showTitle(e.showId) },
      { label: 'Status', value: e => e.status },
      { label: 'Quality check', value: e => e.qcStatus },
      { label: 'Release date', value: e => e.releaseDate },
      { label: 'Duration (sec)', value: e => e.durationSec },
      { label: 'Audio file', value: e => e.audioFileName },
      { label: 'Loudness (LUFS)', value: e => e.loudnessLufs == null ? '' : e.loudnessLufs },
      { label: 'Bitrate (kbps)', value: e => e.bitrateKbps == null ? '' : e.bitrateKbps },
      { label: 'Published at', value: e => e.publishedAt || '' }
    ]);
    if (downloadCSV('podcaststudio-episodes-' + today() + '.csv', csv)) toast('Exported ' + rows.length + ' episode' + (rows.length === 1 ? '' : 's') + ' to CSV.', 'success', 'Export ready');
  }

  /* =========================================================
     Screen: New / Edit Episode
     ========================================================= */
  function renderEpisodeForm(id) {
    const editing = id ? epById(id) : null;
    const title = editing ? 'Edit episode' : 'New episode';
    if (id && !editing) { renderNotFound(); return; }
    if (!isPodcaster()) { mount(title, crumb() + unauthorizedHTML('edit')); return; }

    const ep = editing || { showId: (state.shows[0] || {}).showId, title: '', description: '', audioFileName: '', durationSec: '', releaseDate: R.addDays(today(), 7) };
    const published = editing && editing.status === 'Published';
    const approved = editing && editing.qcStatus === 'Passed' && !published;
    const canSend = !editing || ['Not submitted', 'Needs fixes'].indexOf(editing.qcStatus) !== -1;
    const dur = Number(ep.durationSec) || 0;
    const mins = dur ? Math.floor(dur / 60) : '';
    const secs = dur ? dur % 60 : '';

    mount(title,
      crumb(editing ? '#/episode/' + editing.episodeId : '#/dashboard', editing ? 'Back to episode' : 'Back to publishing') +
      pageHead(title, editing ? esc(editing.title) : 'Add the details. The episode is saved as a draft until it passes the quality check.',
        !editing ? '<button type="button" class="btn btn-outline-primary" id="autofill"><i class="bi bi-magic me-1" aria-hidden="true"></i>Autofill example</button>' : '') +
      (published ? '<div class="mb-3">' + alertHTML('warning', '<strong>This episode is already published.</strong> Changes are visible to listeners straight away. Audio details are locked after publishing.') + '</div>' : '') +
      (approved ? '<div class="mb-3">' + alertHTML('info', 'This episode passed its quality check. If you change the audio file name or duration, it will need a new check before it can be published.') + '</div>' : '') +
      (editing && editing.qcStatus === 'Needs fixes' ? '<div class="mb-3">' + alertHTML('error', '<strong>Needs fixes:</strong> ' + esc(editing.qcNote || 'See the engineer note.')) + '</div>' : '') +

      '<div class="row g-4">' +
        '<div class="col-lg-8">' +
          '<form id="epForm" class="ps-card" novalidate><div class="card-body">' +
            '<div id="formSummary" tabindex="-1"></div>' +
            '<div class="row g-3">' +
              '<div class="col-12 col-md-6"><label class="form-label" for="f-show">Show</label><select class="form-select" id="f-show" name="showId">' +
                state.shows.map(s => '<option value="' + esc(s.showId) + '"' + (s.showId === ep.showId ? ' selected' : '') + '>' + esc(s.title) + ' · ' + esc(s.hostName) + '</option>').join('') + '</select></div>' +
              '<div class="col-12 col-md-6"><label class="form-label" for="f-releaseDate">Release date <span class="text-danger" aria-hidden="true">*</span></label>' +
                '<input type="date" class="form-control" id="f-releaseDate" name="releaseDate" value="' + esc(ep.releaseDate || '') + '" required aria-describedby="err-releaseDate">' +
                '<div class="invalid-feedback" id="err-releaseDate"></div></div>' +
              '<div class="col-12"><div class="d-flex justify-content-between"><label class="form-label" for="f-title">Title <span class="text-danger" aria-hidden="true">*</span></label><span class="counter" id="c-title"></span></div>' +
                '<input type="text" class="form-control" id="f-title" name="title" maxlength="140" value="' + esc(ep.title) + '" required aria-describedby="err-title" placeholder="e.g. Mixing Dialogue for Clarity">' +
                '<div class="invalid-feedback" id="err-title"></div></div>' +
              '<div class="col-12"><div class="d-flex justify-content-between"><label class="form-label" for="f-description">Description <span class="text-danger" aria-hidden="true">*</span></label><span class="counter" id="c-description"></span></div>' +
                '<textarea class="form-control" id="f-description" name="description" rows="4" maxlength="1100" required aria-describedby="err-description" placeholder="What is this episode about?">' + esc(ep.description) + '</textarea>' +
                '<div class="invalid-feedback" id="err-description"></div></div>' +
              '<div class="col-12 col-md-7"><label class="form-label" for="f-audioFileName">Audio file name <span class="text-danger" aria-hidden="true">*</span></label>' +
                '<div class="input-group has-validation"><span class="input-group-text"><i class="bi bi-file-earmark-music" aria-hidden="true"></i></span>' +
                '<input type="text" class="form-control" id="f-audioFileName" name="audioFileName" value="' + esc(ep.audioFileName) + '" required aria-describedby="hint-file err-audioFileName" placeholder="episode-12.mp3"' + (published ? ' readonly' : '') + '>' +
                '<div class="invalid-feedback" id="err-audioFileName"></div></div>' +
                '<div class="form-text" id="hint-file">mp3 or m4a passes the format check. No audio is uploaded; only the name is stored.</div></div>' +
              '<fieldset class="col-12 col-md-5"><legend class="form-label float-none mb-1" style="font-size:.9rem">Duration <span class="text-danger" aria-hidden="true">*</span></legend>' +
                '<div class="input-group has-validation">' +
                  '<input type="number" inputmode="numeric" class="form-control" id="f-min" min="0" max="359" step="1" value="' + mins + '" aria-label="Minutes" aria-describedby="err-durationSec dur-out"' + (published ? ' readonly' : '') + '><span class="input-group-text">min</span>' +
                  '<input type="number" inputmode="numeric" class="form-control" id="f-sec" min="0" max="59" step="1" value="' + secs + '" aria-label="Seconds" aria-describedby="err-durationSec dur-out"' + (published ? ' readonly' : '') + '><span class="input-group-text">sec</span>' +
                  '<div class="invalid-feedback" id="err-durationSec"></div>' +
                '</div><div class="form-text" id="dur-out"></div></fieldset>' +
            '</div>' +
          '</div>' +
          '<div class="card-footer bg-transparent border-top d-flex flex-wrap gap-2 p-3">' +
            '<button type="submit" class="btn btn-primary" data-intent="save"><i class="bi bi-floppy me-1" aria-hidden="true"></i>' + (editing ? 'Save changes' : 'Save as draft') + '</button>' +
            (canSend ? '<button type="submit" class="btn btn-outline-primary" data-intent="send"><i class="bi bi-send me-1" aria-hidden="true"></i>Save &amp; send for review</button>' : '') +
            '<a class="btn btn-outline-secondary ms-sm-auto" href="' + (editing ? '#/episode/' + esc(editing.episodeId) : '#/dashboard') + '">Cancel</a>' +
          '</div></form>' +
        '</div>' +
        '<div class="col-lg-4">' +
          '<aside class="ps-card" aria-labelledby="readyHead"><div class="card-header"><h2 class="card-title" id="readyHead">Ready to save?</h2><span class="ms-auto small fw-bold" id="readyPct">0%</span></div><div class="card-body">' +
            '<div class="progress-thin mb-3" aria-hidden="true"><i id="readyBar" style="width:0%"></i></div>' +
            '<ul class="readiness" id="readiness"></ul>' +
            '<hr><p class="small text-muted-ps mb-2"><strong>Format check preview</strong></p><div id="fmtPreview"></div>' +
          '</div></aside>' +
        '</div>' +
      '</div>');

    const form = $('#epForm');
    let attempted = false;

    const read = () => {
      const minRaw = $('#f-min').value.trim(), secRaw = $('#f-sec').value.trim();
      const mn = minRaw === '' ? 0 : Number(minRaw), sc = secRaw === '' ? 0 : Number(secRaw);
      let durErr = null;
      if (!Number.isInteger(mn) || !Number.isInteger(sc) || mn < 0 || sc < 0) durErr = 'Use whole numbers for minutes and seconds.';
      else if (sc > 59) durErr = 'Seconds must be between 0 and 59.';
      return {
        fields: {
          showId: $('#f-show').value,
          title: $('#f-title').value.trim(),
          description: $('#f-description').value.trim(),
          audioFileName: $('#f-audioFileName').value.trim(),
          durationSec: durErr ? NaN : mn * 60 + sc,
          releaseDate: $('#f-releaseDate').value
        },
        durErr
      };
    };

    const validate = () => {
      const r = read();
      const v = R.validateEpisode(r.fields);
      if (r.durErr) v.errors.durationSec = r.durErr;
      v.valid = Object.keys(v.errors).length === 0;
      return Object.assign(v, { fields: r.fields });
    };

    const showErrors = errors => {
      ['title', 'description', 'audioFileName', 'durationSec', 'releaseDate'].forEach(k => {
        const inputs = k === 'durationSec' ? [$('#f-min'), $('#f-sec')] : [$('#f-' + k)];
        const msg = errors[k];
        inputs.forEach(i => { i.classList.toggle('is-invalid', !!msg); i.setAttribute('aria-invalid', msg ? 'true' : 'false'); });
        $('#err-' + k).textContent = msg || '';
      });
    };

    const updateSide = () => {
      const v = validate();
      const f = v.fields;
      const items = [
        ['title', 'Title added'],
        ['description', 'Description added'],
        ['audioFileName', 'Audio file name with extension'],
        ['durationSec', 'Duration greater than 0'],
        ['releaseDate', 'Release date chosen']
      ];
      const okCount = items.filter(i => !v.errors[i[0]]).length;
      $('#readiness').innerHTML = items.map(i => {
        const ok = !v.errors[i[0]];
        return '<li class="' + (ok ? 'ok' : '') + '"><i class="bi ' + (ok ? 'bi-check-circle-fill' : 'bi-circle') + '" aria-hidden="true"></i>' + i[1] + '<span class="visually-hidden">' + (ok ? ' (done)' : ' (to do)') + '</span></li>';
      }).join('');
      const pct = Math.round(okCount / items.length * 100);
      $('#readyPct').textContent = pct + '%';
      $('#readyBar').style.width = pct + '%';
      const fmt = R.getFormat(f.audioFileName);
      $('#fmtPreview').innerHTML = !fmt ? '<span class="small text-muted-ps">Add a file name to preview the format check.</span>'
        : R.QUALITY_RULES.allowedFormats.indexOf(fmt) !== -1
          ? '<span class="ps-badge b-published"><i class="bi bi-check-circle-fill" aria-hidden="true"></i>.' + esc(fmt) + ' passes</span>'
          : '<span class="ps-badge b-error"><i class="bi bi-x-circle-fill" aria-hidden="true"></i>.' + esc(fmt) + ' will fail</span><p class="small mt-2 mb-0" style="color:var(--ps-warning)">Export as mp3 or m4a before sending for review.</p>';
      const d = Number.isFinite(f.durationSec) && f.durationSec > 0 ? fmtDur(f.durationSec) : '';
      $('#dur-out').textContent = d ? 'Total: ' + d + ' (' + fmtNum(f.durationSec) + ' seconds)' : 'Enter minutes and seconds.';
      [['title', 120], ['description', 1000]].forEach(([k, max]) => {
        const len = $('#f-' + k).value.length;
        const c = $('#c-' + k);
        c.textContent = len + ' / ' + max;
        c.classList.toggle('over', len > max);
      });
      if (attempted) showErrors(v.errors);
    };

    form.addEventListener('input', updateSide);
    form.addEventListener('change', updateSide);
    updateSide();

    const auto = $('#autofill');
    if (auto) auto.addEventListener('click', () => {
      $('#f-show').value = (state.shows[0] || {}).showId || '';
      $('#f-title').value = 'Behind the Mic: A Live Studio Demo';
      $('#f-description').value = 'We take one episode from draft to published in real time and look at its first listener numbers.';
      $('#f-audioFileName').value = 'sn-live-demo.mp3';
      $('#f-min').value = 24;
      $('#f-sec').value = 30;
      $('#f-releaseDate').value = today();
      updateSide();
      toast('Example details added. Choose "Save & send for review" to continue.', 'info');
      const send = form.querySelector('[data-intent="send"]');
      if (send) send.focus();
    });

    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      attempted = true;
      const intent = ev.submitter && ev.submitter.dataset.intent === 'send' ? 'send' : 'save';
      const v = validate();
      showErrors(v.errors);
      const summary = $('#formSummary');
      if (!v.valid) {
        const labels = { title: 'Title', description: 'Description', audioFileName: 'Audio file name', durationSec: 'Duration', releaseDate: 'Release date' };
        summary.innerHTML = '<div class="mb-3" role="alert">' + alertHTML('error', '<strong>Fix ' + Object.keys(v.errors).length + ' field' + (Object.keys(v.errors).length > 1 ? 's' : '') + ' to save this episode:</strong><ul>' +
          Object.keys(v.errors).map(k => '<li><a href="#f-' + (k === 'durationSec' ? 'min' : k) + '" data-focus="f-' + (k === 'durationSec' ? 'min' : k) + '">' + labels[k] + '</a>: ' + esc(v.errors[k]) + '</li>').join('') + '</ul>') + '</div>';
        $$('[data-focus]', summary).forEach(a => a.addEventListener('click', e => { e.preventDefault(); const t = document.getElementById(a.dataset.focus); if (t) t.focus(); }));
        summary.focus();
        return;
      }
      summary.innerHTML = '';
      const f = v.fields;

      if (published) {
        const ok = await confirmDialog({
          title: 'Change a published episode?',
          body: '<p class="mb-0"><strong>' + esc(editing.title) + '</strong> is live. Your changes will be visible to listeners straight away.</p>',
          confirmText: 'Save changes'
        });
        if (!ok) return;
      }

      const now = nowISO();
      let saved, message, type = 'success', title2;
      if (editing) {
        saved = Object.assign({}, editing, f, { updatedAt: now });
        if (published) { saved.audioFileName = editing.audioFileName; saved.durationSec = editing.durationSec; }
        const audioChanged = editing.audioFileName !== saved.audioFileName || Number(editing.durationSec) !== Number(saved.durationSec);
        if (approved && audioChanged) {
          Object.assign(saved, { status: 'Draft', qcStatus: 'Not submitted', loudnessLufs: null, bitrateKbps: null, qcNote: '' });
          message = 'Changes saved. The audio details changed, so this episode needs a new quality check.';
          type = 'warning';
        } else message = 'Changes saved.';
        if (intent === 'send' && ['Not submitted', 'Needs fixes'].indexOf(saved.qcStatus) !== -1) {
          saved.qcStatus = 'Awaiting review';
          saved.submittedAt = now;
          message = 'Changes saved and sent for review. The audio engineer will see it in the Review Queue.';
          type = 'success';
        }
        if (!commit({ episodes: replaceEpisode(saved) })) { summary.innerHTML = '<div class="mb-3">' + alertHTML('error', '<strong>Data could not be saved.</strong> Your form is still here. Free up browser storage or try again.') + '</div>'; summary.focus(); return; }
        title2 = 'Saved';
      } else {
        saved = {
          episodeId: 'ep-' + Date.now().toString(36),
          showId: f.showId, title: f.title, description: f.description, audioFileName: f.audioFileName,
          durationSec: f.durationSec, status: 'Draft', qcStatus: intent === 'send' ? 'Awaiting review' : 'Not submitted',
          qcNote: '', loudnessLufs: null, bitrateKbps: null, releaseDate: f.releaseDate, publishedAt: null,
          createdAt: now, submittedAt: intent === 'send' ? now : null, reviewedAt: null, updatedAt: now, reviews: []
        };
        if (!commit({ episodes: state.episodes.concat([saved]) })) { summary.innerHTML = '<div class="mb-3">' + alertHTML('error', '<strong>Data could not be saved.</strong> Your form is still here. Free up browser storage or try again.') + '</div>'; summary.focus(); return; }
        message = intent === 'send'
          ? 'Episode saved and sent for review. The audio engineer will see it in the Review Queue.'
          : 'Episode saved as a draft. Send it for review when the audio is ready.';
        title2 = 'Episode saved';
        tourEvent('create', saved);
      }
      toast(message, type, title2);
      navigate('#/episode/' + saved.episodeId);
    });
  }

  function crumb(href, label) {
    return '<a class="crumb" href="' + (href || '#/dashboard') + '"><i class="bi bi-arrow-left" aria-hidden="true"></i>' + (label || 'Back to publishing') + '</a>';
  }

  /* =========================================================
     Screen: Episode Detail
     ========================================================= */
  function renderEpisodeDetail(id) {
    const ep = epById(id);
    if (!ep) { renderNotFound(); return; }
    const pod = isPodcaster();
    const pub = R.canPublish(ep, role());
    const missing = R.hasMissingAudioDetails(ep);
    const q = R.checkQuality(ep);
    const hasQC = ep.qcStatus === 'Passed' || ep.qcStatus === 'Needs fixes';
    const fmt = R.getFormat(ep.audioFileName);

    const timeline = [
      { done: !!ep.createdAt, label: 'Created', t: ep.createdAt },
      { done: !!ep.submittedAt, label: 'Sent for review', t: ep.submittedAt },
      { done: hasQC, bad: ep.qcStatus === 'Needs fixes', label: ep.qcStatus === 'Needs fixes' ? 'Returned with fixes' : 'Quality check passed', t: ep.reviewedAt },
      { done: ep.status === 'Published', label: 'Published', t: ep.publishedAt }
    ];

    let publishBox;
    if (ep.status === 'Published') {
      publishBox = '<div class="publish-box is-live"><div class="d-flex align-items-center gap-2 mb-2">' + badge('Published') + '<span class="small">' + esc(fmtDateTime(ep.publishedAt)) + '</span></div>' +
        '<p class="small mb-3">This episode is live. Listener numbers are on the Analytics dashboard.</p>' +
        '<a class="btn btn-success w-100" href="#/analytics/' + esc(ep.episodeId) + '"><i class="bi bi-graph-up-arrow me-1" aria-hidden="true"></i>View episode analytics</a></div>';
    } else {
      publishBox = '<div class="publish-box"><p class="fw-bold mb-1">Publish</p><p class="small text-muted-ps mb-3">Scheduled for ' + esc(fmtDate(ep.releaseDate)) + (ep.releaseDate ? ' (' + esc(relDays(ep.releaseDate)) + ')' : '') + '</p>' +
        '<button type="button" class="btn btn-primary btn-lg w-100 btn-publish" data-action="publish" data-id="' + esc(ep.episodeId) + '"' + (pub.ok ? '' : ' disabled aria-describedby="pubReason"') + '>' +
        '<i class="bi bi-broadcast me-1" aria-hidden="true"></i>Publish episode</button>' +
        (pub.ok ? '<p class="small mt-2 mb-0" style="color:var(--ps-success)"><i class="bi bi-check-circle-fill me-1" aria-hidden="true"></i>Quality check passed. Ready to publish.</p>'
          : '<p class="publish-reason" id="pubReason"><i class="bi ' + (pub.code === 'role' ? 'bi-lock-fill' : 'bi-info-circle-fill') + '" aria-hidden="true"></i><span>' + esc(pub.reason) + '</span></p>') +
        '</div>';
    }

    const canSend = pod && ['Not submitted', 'Needs fixes'].indexOf(ep.qcStatus) !== -1 && ep.status !== 'Published';
    const canDelete = pod && ep.status !== 'Published';

    mount(ep.title,
      crumb() +
      '<div class="page-head"><div class="min-w-0"><div class="eyebrow-sm mb-1">' + esc(showTitle(ep.showId)) + '</div><h1 class="page-title">' + esc(ep.title) + '</h1>' +
        '<div class="d-flex flex-wrap gap-2 mt-2">' + badge(ep.status) + badge(ep.qcStatus) + '</div></div>' +
        '<div class="d-flex flex-wrap gap-2">' +
          (pod ? '<a class="btn btn-outline-secondary" href="#/episode/' + esc(ep.episodeId) + '/edit"><i class="bi bi-pencil me-1" aria-hidden="true"></i>Edit</a>' : '') +
          (canSend ? '<button type="button" class="btn btn-outline-primary" data-action="send-review" data-id="' + esc(ep.episodeId) + '"><i class="bi bi-send me-1" aria-hidden="true"></i>' + (ep.qcStatus === 'Needs fixes' ? 'Resend for review' : 'Send for review') + '</button>' : '') +
          (!pod && ep.qcStatus === 'Awaiting review' ? '<a class="btn btn-primary" href="#/review/' + esc(ep.episodeId) + '"><i class="bi bi-clipboard2-check me-1" aria-hidden="true"></i>Review this episode</a>' : '') +
          (canDelete ? '<button type="button" class="btn btn-outline-danger" data-action="delete" data-id="' + esc(ep.episodeId) + '" aria-label="Delete ' + esc(ep.title) + '"><i class="bi bi-trash" aria-hidden="true"></i></button>' : '') +
        '</div></div>' +

      (missing ? '<div class="mb-3">' + alertHTML('warning', '<strong>Missing audio details.</strong> Add the audio file name and a duration greater than 0 before this episode can be reviewed.' + (pod ? ' <a href="#/episode/' + esc(ep.episodeId) + '/edit">Edit episode</a>' : '')) + '</div>' : '') +
      (ep.qcStatus === 'Needs fixes' ? '<div class="mb-3">' + alertHTML('error', '<strong>Needs fixes.</strong> ' + esc(ep.qcNote || '') + '<br>Failed checks: ' + (q.failed.map(c => esc(c.label)).join('; ') || 'none recorded') + '. Publishing is blocked until a new check passes.') + '</div>' : '') +

      '<div class="row g-4">' +
        '<div class="col-lg-8">' +
          '<section class="ps-card mb-4"><div class="card-header"><h2 class="card-title">Episode details</h2></div><div class="card-body">' +
            waveformHTML(ep.episodeId, 90) +
            '<p class="small text-muted-ps mt-1 mb-3"><i class="bi bi-info-circle me-1" aria-hidden="true"></i>Illustrative waveform. No audio is hosted in this demo.</p>' +
            '<p>' + esc(ep.description || 'No description yet.') + '</p>' +
            '<dl class="meta-grid">' +
              '<div><dt>Audio file</dt><dd>' + (ep.audioFileName ? esc(ep.audioFileName) : '<span style="color:var(--ps-warning)">Missing</span>') + '</dd></div>' +
              '<div><dt>Format</dt><dd>' + (fmt ? '.' + esc(fmt) : '—') + '</dd></div>' +
              '<div><dt>Duration</dt><dd>' + (ep.durationSec ? esc(fmtDur(ep.durationSec)) : '<span style="color:var(--ps-warning)">Missing</span>') + '</dd></div>' +
              '<div><dt>Release date</dt><dd>' + esc(fmtDate(ep.releaseDate)) + '</dd></div>' +
              '<div><dt>Host</dt><dd>' + esc((showById(ep.showId) || {}).hostName || '—') + '</dd></div>' +
              '<div><dt>Episode ID</dt><dd><code>' + esc(ep.episodeId) + '</code></dd></div>' +
            '</dl>' +
          '</div></section>' +
          '<section class="ps-card"><div class="card-header"><h2 class="card-title">Timeline</h2></div><div class="card-body"><ol class="timeline">' +
            timeline.map(t => '<li class="' + (t.bad ? 'bad' : t.done ? 'done' : '') + '"><span class="tl-dot"><i class="bi ' + (t.bad ? 'bi-x-lg' : t.done ? 'bi-check-lg' : 'bi-dot') + '" aria-hidden="true"></i></span><strong>' + t.label + '</strong><span>' + (t.done ? esc(fmtDateTime(t.t)) : 'Not yet') + '</span></li>').join('') +
          '</ol></div></section>' +
        '</div>' +
        '<div class="col-lg-4">' +
          '<section class="ps-card mb-4"><div class="card-body">' + publishBox + '</div></section>' +
          '<section class="ps-card"><div class="card-header"><h2 class="card-title">Quality check</h2><span class="ms-auto">' + badge(ep.qcStatus) + '</span></div><div class="card-body">' +
            (hasQC
              ? '<ul class="checklist mb-3">' + q.checks.map(checkItemHTML).join('') + '</ul>' +
                (ep.qcNote ? '<p class="small fw-bold mb-1">Engineer note</p><blockquote class="small mb-2 p-2 rounded" style="background:var(--ps-bg);border-left:3px solid var(--ps-primary)">' + esc(ep.qcNote) + '</blockquote>' : '') +
                '<p class="small text-muted-ps mb-0">Reviewed ' + esc(fmtDateTime(ep.reviewedAt)) + '</p>'
              : '<p class="text-muted-ps small mb-0">' + (ep.qcStatus === 'Awaiting review' ? 'Waiting for the audio engineer. Loudness, bitrate and format will be checked against the rules.' : 'Not sent for review yet. Send it when the audio is ready.') + '</p>') +
          '</div></section>' +
        '</div>' +
      '</div>');
  }

  function checkItemHTML(c) {
    const st = !c.entered && c.id !== 'format' ? 'pending' : c.pass ? 'pass' : 'fail';
    return '<li class="check ' + st + '" data-check="' + c.id + '"><span class="ci"><i class="bi ' + (st === 'pass' ? 'bi-check-lg' : st === 'fail' ? 'bi-x-lg' : 'bi-three-dots') + '" aria-hidden="true"></i></span>' +
      '<span class="ct"><strong>' + esc(c.label) + '</strong><span>' + esc(c.value) + ' · ' + esc(c.detail) + '</span></span>' +
      '<span class="cs">' + (st === 'pass' ? 'Pass' : st === 'fail' ? 'Fail' : 'Pending') + '</span></li>';
  }

  /* ---------- Actions: send for review, publish, delete ---------- */
  function sendForReview(id) {
    const ep = epById(id);
    if (!ep) return;
    if (!isPodcaster()) { toast('Only the Podcaster view can send episodes for review.', 'warning'); return; }
    const v = R.validateEpisode(ep);
    if (!v.valid) {
      toast('Complete the missing details before sending for review: ' + Object.values(v.errors)[0], 'error', 'Cannot send yet');
      return;
    }
    const updated = Object.assign({}, ep, { qcStatus: 'Awaiting review', submittedAt: nowISO() });
    if (!commit({ episodes: replaceEpisode(updated) })) return;
    toast('Sent for review. The audio engineer will see it in the Review Queue.', 'success', 'Sent');
    refresh();
  }

  async function publishEpisode(id) {
    const ep = epById(id);
    const chk = R.canPublish(ep, role());
    if (!chk.ok) { toast(chk.reason, chk.code === 'role' ? 'warning' : 'error', 'Cannot publish'); return; }
    let releaseDate = ep.releaseDate;
    if (ep.releaseDate > today()) {
      const ok = await confirmDialog({
        title: 'Publish ahead of schedule?',
        body: '<p class="mb-0"><strong>' + esc(ep.title) + '</strong> is scheduled for ' + esc(fmtDate(ep.releaseDate)) + '. Publishing now moves its release date to today.</p>',
        confirmText: 'Publish now'
      });
      if (!ok) return;
      releaseDate = today();
    }
    const updated = Object.assign({}, ep, { status: 'Published', publishedAt: nowISO(), releaseDate });
    // Sample launch-day listener numbers so analytics has data straight away (synthetic).
    const t = today();
    const newStats = state.stats.some(s => s.episodeId === id && s.date === t) ? [] : [launchStat(updated, t)];
    if (!commit({ episodes: replaceEpisode(updated), stats: state.stats.concat(newStats) })) return;
    toast('Episode published. Listener numbers will appear on the Analytics dashboard.', 'success', 'Published');
    tourEvent('publish', updated);
    refresh();
  }

  function launchStat(ep, date) {
    const plays = 60 + Math.floor(Math.random() * 120);
    return {
      statId: 'st-' + ep.episodeId + '-' + date,
      episodeId: ep.episodeId,
      date,
      plays,
      uniqueListeners: Math.round(plays * (0.8 + Math.random() * 0.08)),
      avgListenSec: Math.round(ep.durationSec * (0.55 + Math.random() * 0.25))
    };
  }

  async function deleteEpisode(id) {
    const ep = epById(id);
    if (!ep) return;
    if (!isPodcaster()) { toast('Episode editing is not available in the Audio Engineer view.', 'warning'); return; }
    if (ep.status === 'Published') { toast('Published episodes cannot be deleted in this demo.', 'warning'); return; }
    const ok = await confirmDialog({
      title: 'Delete this episode?',
      body: '<p class="mb-0"><strong>' + esc(ep.title) + '</strong> and its quality check history will be removed from this browser. This cannot be undone.</p>',
      confirmText: 'Delete episode', variant: 'danger'
    });
    if (!ok) return;
    if (!commit({ episodes: state.episodes.filter(e => e.episodeId !== id), stats: state.stats.filter(s => s.episodeId !== id) })) return;
    toast('Episode deleted.', 'success');
    navigate('#/dashboard');
  }

  /* =========================================================
     Screen: Review Queue (Audio Engineer)
     ========================================================= */
  function renderReview(id) {
    if (isPodcaster()) { mount('Review Queue', pageHead('Review Queue', 'Audio quality checks before release.', '') + unauthorizedHTML('review')); return; }
    const queue = reviewQueue();
    const history = state.episodes.filter(e => (e.reviews || []).length)
      .sort((a, b) => new Date(b.reviews[b.reviews.length - 1].at) - new Date(a.reviews[a.reviews.length - 1].at));
    let selected = id ? epById(id) : queue[0];
    if (id && !selected) { renderNotFound(); return; }
    if (selected && selected.qcStatus !== 'Awaiting review' && state.ui.reviewTab === 'queue' && id) state.ui.reviewTab = 'history';
    const tab = state.ui.reviewTab;
    const list = tab === 'queue' ? queue : history;

    mount('Review Queue',
      pageHead('Review Queue', 'Check loudness, bitrate and format, then mark each episode Passed or Needs fixes.',
        '<span class="chip chip-primary"><i class="bi bi-bullseye" aria-hidden="true"></i>Target ' + R.QUALITY_RULES.targetLufs + ' LUFS ±' + R.QUALITY_RULES.toleranceLufs + '</span>' +
        '<span class="chip chip-primary"><i class="bi bi-speedometer2" aria-hidden="true"></i>≥ ' + R.QUALITY_RULES.minBitrateKbps + ' kbps</span>' +
        '<span class="chip chip-primary"><i class="bi bi-file-earmark-music" aria-hidden="true"></i>mp3 / m4a</span>') +
      '<div class="row g-4">' +
        '<div class="col-md-5 col-xl-4">' +
          '<div class="seg-tabs mb-3" role="tablist" aria-label="Review lists">' +
            '<button type="button" role="tab" aria-selected="' + (tab === 'queue') + '" data-tab="queue">Awaiting (' + queue.length + ')</button>' +
            '<button type="button" role="tab" aria-selected="' + (tab === 'history') + '" data-tab="history">History (' + history.length + ')</button>' +
          '</div>' +
          (list.length
            ? '<ul class="queue-list">' + list.map(e => {
                const days = e.releaseDate ? R.daysBetween(today(), e.releaseDate) : null;
                const last = (e.reviews || [])[e.reviews ? e.reviews.length - 1 : 0];
                return '<li><a class="queue-item' + (selected && selected.episodeId === e.episodeId ? ' active' : '') + '" href="#/review/' + esc(e.episodeId) + '"' + (selected && selected.episodeId === e.episodeId ? ' aria-current="true"' : '') + '>' +
                  '<span class="qi-title">' + esc(e.title) + '</span>' +
                  '<span class="ep-meta d-block mb-2">' + esc(showTitle(e.showId)) + ' · ' + esc(e.audioFileName || 'no file') + '</span>' +
                  '<span class="d-flex flex-wrap gap-1 align-items-center">' +
                  (tab === 'queue'
                    ? (days != null ? '<span class="due' + (days <= 7 ? ' soon' : '') + '"><i class="bi bi-clock me-1" aria-hidden="true"></i>Release ' + esc(relDays(e.releaseDate)) + '</span>' : '') +
                      ((e.reviews || []).length ? '<span class="due">Resubmitted</span>' : '')
                    : badge(last.result) + '<span class="ep-meta ms-1">' + esc(timeAgo(last.at)) + '</span>') +
                  '</span></a></li>';
              }).join('') + '</ul>'
            : '<div class="ps-card"><div class="empty py-4"><div class="empty-icon"><i class="bi bi-headphones" aria-hidden="true"></i></div><h3>' + (tab === 'queue' ? 'All caught up' : 'No reviews yet') + '</h3><p class="mb-0">' + (tab === 'queue' ? 'No episodes are waiting for review.' : 'Reviewed episodes will appear here.') + '</p></div></div>') +
        '</div>' +
        '<div class="col-md-7 col-xl-8" id="reviewPanel">' + (selected ? reviewPanelHTML(selected) :
          '<div class="ps-card h-100"><div class="empty"><div class="empty-icon"><i class="bi bi-check2-all" aria-hidden="true"></i></div><h2>Nothing to review</h2><p>When a podcaster sends an episode for review, it appears in the queue.</p></div></div>') +
        '</div>' +
      '</div>');

    $$('[data-tab]').forEach(b => b.addEventListener('click', () => { state.ui.reviewTab = b.dataset.tab; refresh(); }));
    if (selected && selected.qcStatus === 'Awaiting review') bindReviewPanel(selected);
    if (id && window.innerWidth < 768) { const p = $('#reviewPanel'); if (p) p.scrollIntoView({ block: 'start' }); }
  }

  function reviewPanelHTML(ep) {
    const fmt = R.getFormat(ep.audioFileName);
    const missing = R.hasMissingAudioDetails(ep);
    const reviews = (ep.reviews || []).slice().reverse();
    const header =
      '<div class="card-header"><div class="min-w-0"><div class="eyebrow-sm">' + esc(showTitle(ep.showId)) + '</div><h2 class="card-title text-truncate">' + esc(ep.title) + '</h2></div>' +
      '<a class="ms-auto small fw-semibold" href="#/episode/' + esc(ep.episodeId) + '">Open episode <i class="bi bi-box-arrow-up-right" aria-hidden="true"></i></a></div>';
    const facts =
      '<dl class="meta-grid mb-3">' +
        '<div><dt>Audio file</dt><dd>' + (ep.audioFileName ? esc(ep.audioFileName) : '<span style="color:var(--ps-warning)">Missing</span>') + '</dd></div>' +
        '<div><dt>Format</dt><dd>' + (fmt ? '.' + esc(fmt) : '—') + '</dd></div>' +
        '<div><dt>Duration</dt><dd>' + (ep.durationSec ? esc(fmtDur(ep.durationSec)) : '—') + '</dd></div>' +
        '<div><dt>Release</dt><dd>' + esc(fmtDate(ep.releaseDate)) + '</dd></div>' +
      '</dl>';
    const historyHTML = reviews.length
      ? '<hr class="my-4"><h3 class="h6 fw-bold">Past checks for this episode</h3><ul class="history">' + reviews.map(rv =>
          '<li><div class="d-flex flex-wrap gap-2 align-items-center mb-1">' + badge(rv.result) + '<span class="ep-meta">' + esc(fmtDateTime(rv.at)) + '</span></div>' +
          '<span class="ep-meta">' + esc(rv.loudnessLufs) + ' LUFS · ' + esc(rv.bitrateKbps) + ' kbps · .' + esc(rv.format || '?') + '</span>' +
          (rv.note ? '<div class="small mt-1">“' + esc(rv.note) + '”</div>' : '') + '</li>').join('') + '</ul>'
      : '';

    if (ep.qcStatus !== 'Awaiting review') {
      const q = R.checkQuality(ep);
      return '<section class="ps-card">' + header + '<div class="card-body">' + facts +
        alertHTML('info', 'This episode is not waiting for review. Current result: <strong>' + esc(ep.qcStatus) + '</strong>.' + (ep.qcStatus === 'Needs fixes' ? ' It returns to the queue when the podcaster resends it.' : '')) +
        (ep.qcStatus === 'Passed' || ep.qcStatus === 'Needs fixes' ? '<ul class="checklist mt-3">' + q.checks.map(checkItemHTML).join('') + '</ul>' : '') +
        historyHTML + '</div></section>';
    }

    return '<section class="ps-card" aria-labelledby="rvTitle">' + header.replace('class="card-title text-truncate"', 'class="card-title text-truncate" id="rvTitle"') + '<div class="card-body">' +
      waveformHTML(ep.episodeId, 80) +
      '<p class="small text-muted-ps mt-1">Illustrative waveform. Measure the real file in your audio tools and enter the values below.</p>' +
      facts +
      (missing ? '<div class="mb-3">' + alertHTML('warning', '<strong>Missing audio details.</strong> This episode has no file name or duration. Mark it Needs fixes and ask the podcaster to add them.') + '</div>' : '') +
      '<form id="reviewForm" novalidate>' +
        '<div id="reviewSummary" tabindex="-1"></div>' +
        '<div class="row g-4">' +
          '<div class="col-xl-6">' +
            '<label class="form-label" for="lufs">Integrated loudness <span class="text-danger" aria-hidden="true">*</span></label>' +
            '<div class="input-group has-validation"><input type="number" class="form-control" id="lufs" step="0.1" min="-70" max="0" inputmode="decimal" placeholder="-16.0" value="' + (ep.loudnessLufs == null ? '' : esc(ep.loudnessLufs)) + '" aria-describedby="lufsHelp err-lufs"><span class="input-group-text">LUFS</span><div class="invalid-feedback" id="err-lufs"></div></div>' +
            '<div class="meter" aria-hidden="true"><div class="meter-track"><div class="meter-zone" style="left:43.75%;width:12.5%"></div><div class="meter-marker hidden" id="lufsMarker"></div></div>' +
              '<div class="meter-scale"><span>-24</span><span>-20</span><span>-16</span><span>-12</span><span>-8</span></div></div>' +
            '<div class="form-text" id="lufsHelp">Target −16 LUFS. Allowed range −17 to −15.</div>' +
          '</div>' +
          '<div class="col-xl-6">' +
            '<label class="form-label" for="bitrate">Bitrate <span class="text-danger" aria-hidden="true">*</span></label>' +
            '<div class="input-group has-validation"><input type="number" class="form-control" id="bitrate" step="1" min="8" max="1411" inputmode="numeric" placeholder="192" value="' + (ep.bitrateKbps == null ? '' : esc(ep.bitrateKbps)) + '" aria-describedby="rateHelp err-bitrate"><span class="input-group-text">kbps</span><div class="invalid-feedback" id="err-bitrate"></div></div>' +
            '<div class="meter" aria-hidden="true"><div class="meter-track bitrate"><div class="meter-fill" id="rateFill" style="width:0%"></div><div class="meter-threshold" style="left:40%"></div></div>' +
              '<div class="meter-scale"><span>0</span><span>128 min</span><span>320</span></div></div>' +
            '<div class="form-text" id="rateHelp">At least 128 kbps.</div>' +
          '</div>' +
        '</div>' +
        '<div class="d-flex align-items-center gap-3 mt-4 mb-2"><div class="score-ring" id="scoreRing" aria-hidden="true"><b id="scoreText">0/3</b></div>' +
          '<div><h3 class="h6 fw-bold mb-0">Automatic checks</h3><p class="small text-muted-ps mb-0" id="scoreSummary" aria-live="polite">Enter loudness and bitrate to run the checks.</p></div></div>' +
        '<ul class="checklist" id="checklist">' + R.checkQuality(ep).checks.map(checkItemHTML).join('') + '</ul>' +
        '<div class="mt-4"><label class="form-label" for="qcNote">Note for the podcaster <span class="small text-muted-ps fw-normal">(required for Needs fixes)</span></label>' +
          '<textarea class="form-control" id="qcNote" rows="3" maxlength="500" aria-describedby="err-qcNote" placeholder="What did you check? What needs to change?"></textarea>' +
          '<div class="invalid-feedback" id="err-qcNote"></div>' +
          '<div class="note-chips"><button type="button" id="suggestNote"><i class="bi bi-stars me-1" aria-hidden="true"></i>Suggest from failed checks</button>' +
            '<button type="button" data-chip="Clean master, loudness on target.">Clean master</button>' +
            '<button type="button" data-chip="Re-export at −16 LUFS integrated.">Re-export at −16 LUFS</button>' +
            '<button type="button" data-chip="Raise the bitrate to 128 kbps or higher.">Raise bitrate</button>' +
            '<button type="button" data-chip="Export as mp3 or m4a.">Export as mp3/m4a</button></div>' +
        '</div>' +
        '<div class="d-flex flex-wrap gap-2 mt-4">' +
          '<button type="submit" class="btn btn-success" id="btnPassed" data-result="Passed" aria-describedby="passHint"><i class="bi bi-patch-check-fill me-1" aria-hidden="true"></i>Mark Passed</button>' +
          '<button type="submit" class="btn btn-outline-danger" data-result="Needs fixes"><i class="bi bi-arrow-return-left me-1" aria-hidden="true"></i>Needs fixes</button>' +
        '</div>' +
        '<p class="small mt-2 mb-0 text-muted-ps" id="passHint"></p>' +
      '</form>' + historyHTML + '</div></section>';
  }

  function bindReviewPanel(ep) {
    const form = $('#reviewForm');
    if (!form) return;
    let attempted = false;
    let noteError = '';
    const lufs = $('#lufs'), rate = $('#bitrate'), note = $('#qcNote');

    const fieldErrors = () => {
      const e = {};
      if (noteError) e.qcNote = noteError;
      const L = lufs.value.trim(), B = rate.value.trim();
      if (!R.isNumeric(L)) e.lufs = 'Enter the loudness in LUFS, for example -16.';
      else if (Number(L) < -70 || Number(L) > 0) e.lufs = 'Loudness must be between -70 and 0 LUFS.';
      if (!R.isNumeric(B)) e.bitrate = 'Enter the bitrate in kbps, for example 192.';
      else if (!Number.isInteger(Number(B)) || Number(B) < 8 || Number(B) > 1411) e.bitrate = 'Bitrate must be a whole number between 8 and 1411 kbps.';
      return e;
    };
    const paint = errs => {
      [['lufs', lufs], ['bitrate', rate], ['qcNote', note]].forEach(([k, el]) => {
        el.classList.toggle('is-invalid', !!errs[k]);
        el.setAttribute('aria-invalid', errs[k] ? 'true' : 'false');
        $('#err-' + k).textContent = errs[k] || '';
      });
    };

    const update = () => {
      const q = R.checkQuality({ loudnessLufs: lufs.value, bitrateKbps: rate.value, audioFileName: ep.audioFileName });
      q.checks.forEach(c => {
        const li = $('[data-check="' + c.id + '"]');
        if (!li) return;
        const st = !c.entered && c.id !== 'format' ? 'pending' : c.pass ? 'pass' : 'fail';
        if (!li.classList.contains(st)) {
          const tmp = document.createElement('div');
          tmp.innerHTML = checkItemHTML(c);
          li.replaceWith(tmp.firstChild);
        } else {
          li.querySelector('.ct span').textContent = c.value + ' · ' + c.detail;
        }
      });
      const marker = $('#lufsMarker');
      if (R.isNumeric(lufs.value)) {
        marker.style.left = clamp((Number(lufs.value) + 24) / 16 * 100, 0, 100) + '%';
        marker.className = 'meter-marker ' + (q.checks[0].pass ? 'ok' : 'bad');
      } else marker.className = 'meter-marker hidden';
      $('#rateFill').style.width = (R.isNumeric(rate.value) ? clamp(Number(rate.value) / 320 * 100, 0, 100) : 0) + '%';
      $('#rateFill').style.background = R.isNumeric(rate.value) ? (q.checks[1].pass ? 'var(--ps-success)' : 'var(--ps-error)') : '';
      const passed = q.checks.filter(c => c.pass).length;
      const ring = $('#scoreRing');
      ring.style.setProperty('--p', String(passed / 3 * 100));
      ring.style.setProperty('--ring', q.allPass ? 'var(--ps-success)' : passed ? 'var(--ps-primary)' : '#D1D5DB');
      $('#scoreText').textContent = passed + '/3';
      $('#scoreSummary').textContent = q.allPass ? 'All checks pass. You can mark this episode Passed.'
        : passed + ' of 3 checks pass. Failed: ' + q.failed.map(c => c.id).join(', ') + '.';
      const btn = $('#btnPassed');
      btn.disabled = !q.allPass;
      $('#passHint').textContent = q.allPass ? '' : 'Mark Passed unlocks when all three checks pass. Otherwise choose Needs fixes and add a note.';
      if (attempted) paint(fieldErrors());
      return q;
    };

    [lufs, rate].forEach(i => i.addEventListener('input', update));
    note.addEventListener('input', () => {
      if (noteError && note.value.trim()) { noteError = ''; paint(fieldErrors()); }
    });
    $$('[data-chip]', form).forEach(b => b.addEventListener('click', () => {
      note.value = (note.value.trim() ? note.value.trim() + ' ' : '') + b.dataset.chip;
      note.focus();
    }));
    $('#suggestNote').addEventListener('click', () => {
      const q = update();
      if (q.allPass) { note.value = 'All automatic checks pass. Clean master, loudness on target.'; return; }
      const parts = q.failed.map(c => {
        if (c.id === 'loudness') return c.entered ? 'Loudness is ' + c.value + '; re-export at −16 LUFS (allowed −17 to −15).' : 'Add the loudness measurement.';
        if (c.id === 'bitrate') return c.entered ? 'Bitrate is ' + c.value + '; export at 128 kbps or higher.' : 'Add the bitrate.';
        return 'File format ' + c.value + ' is not accepted; export as mp3 or m4a.';
      });
      note.value = parts.join(' ');
      note.focus();
    });
    update();

    form.addEventListener('submit', ev => {
      ev.preventDefault();
      attempted = true;
      const result = ev.submitter ? ev.submitter.dataset.result : 'Needs fixes';
      if (role() !== 'engineer') { toast('Review actions are not available in the Podcaster view.', 'warning'); return; }
      const txt = note.value.trim();
      noteError = result === 'Needs fixes' && !txt ? 'Add a note so the podcaster knows what to fix.' : '';
      const errs = fieldErrors();
      paint(errs);
      const q = update();
      const summary = $('#reviewSummary');
      if (Object.keys(errs).length) {
        summary.innerHTML = '<div class="mb-3" role="alert">' + alertHTML('error', '<strong>The review was not saved.</strong><ul>' + Object.values(errs).map(m => '<li>' + esc(m) + '</li>').join('') + '</ul>') + '</div>';
        summary.focus();
        return;
      }
      if (result === 'Passed' && !q.allPass) {
        summary.innerHTML = '<div class="mb-3" role="alert">' + alertHTML('error', 'Passed is available only when every automatic check passes. Choose Needs fixes and add a note instead.') + '</div>';
        summary.focus();
        return;
      }
      const now = nowISO();
      const L = Number(lufs.value), B = Number(rate.value);
      const updated = Object.assign({}, ep, {
        loudnessLufs: L, bitrateKbps: B, qcStatus: result, qcNote: txt, reviewedAt: now,
        status: result === 'Passed' ? 'Approved' : 'Draft',
        reviews: (ep.reviews || []).concat([{ at: now, result, note: txt, loudnessLufs: L, bitrateKbps: B, format: R.getFormat(ep.audioFileName) }])
      });
      if (!commit({ episodes: replaceEpisode(updated) })) {
        summary.innerHTML = '<div class="mb-3">' + alertHTML('error', '<strong>Data could not be saved.</strong> Your values are still on screen. Try again.') + '</div>';
        return;
      }
      toast(result === 'Passed'
        ? 'Review saved: Passed. The podcaster can now publish this episode.'
        : 'Review saved: Needs fixes. The podcaster will see your note and the failed checks.', result === 'Passed' ? 'success' : 'warning', 'Review saved');
      tourEvent('review', updated, result);
      const next = reviewQueue()[0];
      state.ui.reviewTab = 'queue';
      if (state.tour && !state.tour.finished) navigate('#/review/' + updated.episodeId);
      else navigate(next ? '#/review/' + next.episodeId : '#/review');
    });
  }

  /* =========================================================
     Screen: Analytics Dashboard
     ========================================================= */
  function currentRange() {
    const dr = state.prefs.dateRange || {};
    if (dr.preset === 'custom' && R.parseISO(dr.from) != null && R.parseISO(dr.to) != null && dr.from <= dr.to) {
      return { from: dr.from, to: dr.to, label: fmtDate(dr.from) + ' – ' + fmtDate(dr.to), days: R.daysBetween(dr.from, dr.to) + 1 };
    }
    const n = Number(dr.preset) || 30;
    return { from: R.addDays(today(), -(n - 1)), to: today(), label: 'Last ' + n + ' days', days: n };
  }

  function rangeBarHTML() {
    const dr = state.prefs.dateRange || {};
    const preset = dr.preset || '30';
    const range = currentRange();
    return '<div class="ps-card mb-4"><div class="card-body py-3">' +
      '<form id="rangeForm" class="row g-2 align-items-end" novalidate>' +
        '<div class="col-12 col-lg-auto"><span class="form-label small d-block" id="presetLabel">Date range</span>' +
          '<div class="btn-group range-group flex-wrap" role="group" aria-labelledby="presetLabel">' +
          ['7', '14', '30', '90'].map(p => '<input type="radio" class="btn-check" name="preset" id="p' + p + '" value="' + p + '"' + (preset === p ? ' checked' : '') + '><label class="btn btn-outline-secondary" for="p' + p + '">' + p + ' days</label>').join('') +
          '<input type="radio" class="btn-check" name="preset" id="pcustom" value="custom"' + (preset === 'custom' ? ' checked' : '') + '><label class="btn btn-outline-secondary" for="pcustom">Custom</label>' +
          '</div></div>' +
        '<div class="col-6 col-lg-auto"><label class="form-label small" for="rFrom">From</label><input type="date" class="form-control" id="rFrom" value="' + esc(range.from) + '" max="' + today() + '" aria-describedby="rangeErr"></div>' +
        '<div class="col-6 col-lg-auto"><label class="form-label small" for="rTo">To</label><input type="date" class="form-control" id="rTo" value="' + esc(range.to) + '" max="' + today() + '" aria-describedby="rangeErr"></div>' +
        '<div class="col-12 col-lg"><div id="rangeErr" class="small fw-semibold" style="color:var(--ps-error)" role="alert"></div></div>' +
      '</form></div></div>';
  }

  function bindRangeBar(onChange) {
    const form = $('#rangeForm');
    if (!form) return;
    $$('input[name="preset"]', form).forEach(r => r.addEventListener('change', () => {
      if (r.value === 'custom') {
        const c = currentRange();
        state.prefs.dateRange = { preset: 'custom', from: c.from, to: c.to };
        $('#rFrom').focus();
      } else {
        state.prefs.dateRange = { preset: r.value, from: null, to: null };
        const c = currentRange();
        $('#rFrom').value = c.from;
        $('#rTo').value = c.to;
      }
      $('#rangeErr').textContent = '';
      savePrefs();
      onChange();
    }));
    const onDate = () => {
      const f = $('#rFrom').value, t = $('#rTo').value;
      const err = $('#rangeErr');
      [$('#rFrom'), $('#rTo')].forEach(i => i.classList.remove('is-invalid'));
      if (R.parseISO(f) == null || R.parseISO(t) == null) { err.textContent = 'Choose both a start and an end date.'; return; }
      if (f > t) { err.textContent = 'The start date must be on or before the end date.'; $('#rFrom').classList.add('is-invalid'); return; }
      if (R.daysBetween(f, t) > 365) { err.textContent = 'Choose a range of one year or less.'; return; }
      err.textContent = '';
      state.prefs.dateRange = { preset: 'custom', from: f, to: t };
      $('#pcustom').checked = true;
      savePrefs();
      onChange();
    };
    $('#rFrom').addEventListener('change', onDate);
    $('#rTo').addEventListener('change', onDate);
  }

  function deltaHTML(v, unit, suffix) {
    if (v == null || !isFinite(v)) return '<span class="delta delta-flat">—</span><span>no data in the previous period</span>';
    const r = Math.round(v * 10) / 10;
    const cls = r > 0 ? 'delta-up' : r < 0 ? 'delta-down' : 'delta-flat';
    const icon = r > 0 ? 'bi-arrow-up-right' : r < 0 ? 'bi-arrow-down-right' : 'bi-dash';
    return '<span class="delta ' + cls + '"><i class="bi ' + icon + '" aria-hidden="true"></i>' + (r > 0 ? '+' : '') + r + (unit || '%') + '</span><span>' + (suffix || 'vs previous period') + '</span>';
  }

  function kpiHTML(id, label, icon) {
    return '<div class="col-12 col-sm-6 col-xl-3"><div class="ps-card kpi" id="kpi-' + id + '"><div class="kpi-top"><p class="kpi-label">' + label + '</p><span class="kpi-icon"><i class="bi ' + icon + '" aria-hidden="true"></i></span></div>' +
      '<div class="kpi-value" data-kpi="' + id + '">—</div><div class="kpi-foot" data-kpi-foot="' + id + '"></div></div></div>';
  }

  function chartBase() {
    if (!window.Chart) return;
    Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
    Chart.defaults.color = '#4B5563';
    Chart.defaults.plugins.tooltip.backgroundColor = '#1F2937';
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.cornerRadius = 8;
    // Re-measure labels once the web font has loaded so axis text is not clipped.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => Object.values(state.charts).forEach(c => { try { c.update('none'); } catch (e) { /* destroyed */ } }));
    }
  }
  const areaFill = ctx => {
    const ch = ctx.chart;
    if (!ch.chartArea) return 'rgba(109,40,217,.12)';
    const g = ch.ctx.createLinearGradient(0, ch.chartArea.top, 0, ch.chartArea.bottom);
    g.addColorStop(0, 'rgba(109,40,217,.28)');
    g.addColorStop(1, 'rgba(109,40,217,0)');
    return g;
  };

  function renderAnalytics() {
    state.ui.live = false;
    const hasAny = state.stats.length > 0;
    mount('Analytics',
      pageHead('Listener analytics', 'Plays, unique listeners, listening time and completion for published episodes. <span class="chip ms-1"><i class="bi bi-database" aria-hidden="true"></i>Sample data</span>',
        '<div class="form-check form-switch d-flex align-items-center gap-2 me-2 mb-0"><input class="form-check-input" type="checkbox" role="switch" id="liveToggle"' + (hasAny ? '' : ' disabled') + '><label class="form-check-label small fw-semibold" for="liveToggle">Simulate live listens</label></div>' +
        '<button type="button" class="btn btn-outline-secondary" data-action="export-analytics"><i class="bi bi-download me-1" aria-hidden="true"></i>Export CSV</button>') +
      rangeBarHTML() +
      '<div class="d-flex flex-wrap align-items-center gap-2 mb-3">' +
        '<label class="form-label small mb-0" for="aShow">Show</label><select class="form-select form-select-sm w-auto" id="aShow"><option value="all">All shows</option>' +
          state.shows.map(s => '<option value="' + esc(s.showId) + '"' + (state.ui.analyticsShow === s.showId ? ' selected' : '') + '>' + esc(s.title) + '</option>').join('') + '</select>' +
        '<span class="live-ticker ms-auto" id="liveTicker" aria-live="off"></span>' +
      '</div>' +
      '<div id="analyticsEmpty" class="d-none"></div>' +
      '<div id="analyticsBody">' +
        '<div class="row g-3 mb-4 stagger">' +
          kpiHTML('plays', 'Total plays', 'bi-play-circle') +
          kpiHTML('uniq', 'Unique listeners', 'bi-people') +
          kpiHTML('listen', 'Avg listening time', 'bi-clock-history') +
          kpiHTML('comp', 'Completion rate', 'bi-bullseye') +
        '</div>' +
        '<div class="row g-4 mb-4">' +
          '<div class="col-lg-8 min-w-0"><section class="ps-card h-100" aria-labelledby="ppdTitle"><div class="card-header"><h2 class="card-title" id="ppdTitle">Plays per day</h2><span class="ms-auto small text-muted-ps" id="rangeLabel"></span></div><div class="card-body">' +
            '<div class="chart-box"><canvas id="playsChart" role="img" aria-label="Line chart of plays per day with a 7-day moving average. A text summary and data table follow."></canvas><p class="chart-fallback">Charts could not load. The summary and table below show the same numbers.</p></div>' +
            '<p class="chart-summary" id="playsSummary"></p>' +
            '<details class="data-table"><summary>Show the daily numbers as a table</summary><div class="table-wrap" id="dailyTable"></div></details>' +
          '</div></section></div>' +
          '<div class="col-lg-4 min-w-0"><section class="ps-card h-100" aria-labelledby="topTitle"><div class="card-header"><h2 class="card-title" id="topTitle">Top episodes</h2></div><div class="card-body">' +
            '<div class="chart-box sm"><canvas id="topChart" role="img" aria-label="Bar chart of the top five episodes by plays. The ranked table below lists all episodes."></canvas><p class="chart-fallback">See the ranked table below.</p></div>' +
          '</div></section></div>' +
        '</div>' +
        '<section class="ps-card mb-4" aria-labelledby="rankTitle"><div class="card-header"><h2 class="card-title" id="rankTitle">Episode ranking</h2><span class="ms-auto small text-muted-ps">Select an episode to compare it with the show average</span></div>' +
          '<div id="rankTable"></div></section>' +
        '<section class="ps-card" aria-labelledby="insTitle"><div class="card-header"><h2 class="card-title" id="insTitle"><i class="bi bi-lightbulb me-2 text-primary" aria-hidden="true"></i>What attracts listeners</h2></div><div class="card-body"><div id="insights"></div></div></section>' +
      '</div>');

    chartBase();
    bindRangeBar(() => refreshAnalytics());
    $('#aShow').addEventListener('change', e => { state.ui.analyticsShow = e.target.value; refreshAnalytics(); });
    const live = $('#liveToggle');
    live.addEventListener('change', () => { state.ui.live = live.checked; live.checked ? startLive() : stopLive(); });
    state.cleanups.push(stopLive);
    refreshAnalytics(true);
    tourEvent('measure');
  }

  function analyticsData() {
    const range = currentRange();
    const sf = state.ui.analyticsShow;
    const eps = state.episodes.filter(e => sf === 'all' || e.showId === sf);
    const ids = eps.map(e => e.episodeId);
    const map = episodesMap();
    const prev = R.previousPeriod(range.from, range.to);
    const cur = R.statsInRange(state.stats, range.from, range.to, ids);
    const prv = R.statsInRange(state.stats, prev.from, prev.to, ids);
    return {
      range, prev, eps, cur,
      sCur: R.summarize(cur, map),
      sPrev: R.summarize(prv, map),
      daily: R.playsPerDay(cur, range.from, range.to),
      ma: R.movingAverageForRange(R.statsInRange(state.stats, R.addDays(range.from, -6), range.to, ids), range.from, range.to, 7),
      top: R.topEpisodes(cur, eps)
    };
  }

  function refreshAnalytics(first, liveTick) {
    if (!$('#analyticsBody')) return;
    const d = analyticsData();
    state.lastAnalytics = d;
    const empty = d.sCur.plays === 0;
    $('#analyticsBody').classList.toggle('d-none', empty);
    const emptyBox = $('#analyticsEmpty');
    emptyBox.classList.toggle('d-none', !empty);
    if (empty) {
      emptyBox.innerHTML = '<div class="ps-card"><div class="empty"><div class="empty-icon"><i class="bi bi-bar-chart" aria-hidden="true"></i></div><h2>No listener data for this date range</h2>' +
        '<p>' + (state.stats.length ? 'Try a longer range or a different show. Listener numbers appear after an episode is published.' : 'There is no listener data yet. Publish an episode or load the sample data.') + '</p>' +
        '<div class="d-flex flex-wrap gap-2 justify-content-center">' +
        (state.stats.length ? '<button type="button" class="btn btn-primary" data-action="range-90">Show last 90 days</button>' : '') +
        '<button type="button" class="btn btn-outline-primary" data-action="load-sample">Load sample data</button></div></div></div>';
      return;
    }

    const s = d.sCur, p = d.sPrev;
    const setKpi = (id, text, foot) => {
      const v = $('[data-kpi="' + id + '"]');
      if (liveTick && v.textContent !== text) {
        const card = $('#kpi-' + id);
        card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');
      }
      v.textContent = text;
      $('[data-kpi-foot="' + id + '"]').innerHTML = foot;
    };
    setKpi('plays', fmtNum(s.plays), deltaHTML(R.growthPct(s.plays, p.plays)));
    setKpi('uniq', fmtNum(s.uniqueListeners), deltaHTML(R.growthPct(s.uniqueListeners, p.uniqueListeners)));
    setKpi('listen', fmtDur(s.avgListenSec), deltaHTML(R.growthPct(s.avgListenSec, p.avgListenSec)));
    setKpi('comp', fmtPct(s.completionRate), deltaHTML(p.plays ? (s.completionRate - p.completionRate) * 100 : null, ' pts'));
    if (first && !reduceMotion()) {
      $$('[data-kpi]').forEach(el => { el.parentElement.classList.add('flash'); });
    }
    $('#rangeLabel').textContent = d.range.label;

    // Plays chart
    const labels = d.daily.map(x => shortDate(x.date));
    const plays = d.daily.map(x => x.plays);
    const ma = d.ma.map(v => Math.round(v * 10) / 10);
    if (window.Chart) {
      if (!state.charts.plays) {
        state.charts.plays = new Chart($('#playsChart'), {
          type: 'line',
          data: { labels, datasets: [
            { label: 'Plays per day', data: plays, borderColor: '#6D28D9', backgroundColor: areaFill, fill: true, tension: 0.35, pointRadius: 0, pointHoverRadius: 5, pointBackgroundColor: '#6D28D9', borderWidth: 2.5 },
            { label: '7-day moving average', data: ma, borderColor: '#1F2937', borderDash: [6, 5], borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, fill: false, tension: 0.35 }
          ] },
          options: {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, padding: 16 } },
              tooltip: { callbacks: { label: c => ' ' + c.dataset.label + ': ' + fmtNum(c.parsed.y) } } },
            scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0, autoSkip: true } },
              y: { beginAtZero: true, grid: { color: '#F3F4F6' }, border: { display: false }, ticks: { precision: 0 } } }
          }
        });
      } else {
        const ch = state.charts.plays;
        ch.data.labels = labels;
        ch.data.datasets[0].data = plays;
        ch.data.datasets[1].data = ma;
        ch.update(liveTick ? 'none' : undefined);
      }
      const top5 = d.top.slice(0, 5);
      const tl = top5.map(r => r.episode.title.length > 22 ? r.episode.title.slice(0, 21) + '…' : r.episode.title);
      if (!state.charts.top) {
        state.charts.top = new Chart($('#topChart'), {
          type: 'bar',
          data: { labels: tl, datasets: [{ label: 'Plays', data: top5.map(r => r.plays), backgroundColor: ['#6D28D9', '#7C3AED', '#8B5CF6', '#A78BFA', '#C4B5FD'], borderRadius: 8, maxBarThickness: 28 }] },
          options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false, layout: { padding: { left: 4 } },
            plugins: { legend: { display: false }, tooltip: { callbacks: { title: c => top5[c[0].dataIndex] ? top5[c[0].dataIndex].episode.title : '', label: c => ' ' + fmtNum(c.parsed.x) + ' plays' } } },
            scales: { x: { beginAtZero: true, grid: { color: '#F3F4F6' }, border: { display: false }, ticks: { precision: 0, maxTicksLimit: 5 } }, y: { grid: { display: false } } },
            onClick: (e, els) => { if (els[0] && top5[els[0].index]) navigate('#/analytics/' + top5[els[0].index].episode.episodeId); }
          }
        });
      } else {
        const ch = state.charts.top;
        ch.data.labels = tl;
        ch.data.datasets[0].data = top5.map(r => r.plays);
        ch.options.plugins.tooltip.callbacks.title = c => top5[c[0].dataIndex] ? top5[c[0].dataIndex].episode.title : '';
        ch.options.onClick = (e, els) => { if (els[0] && top5[els[0].index]) navigate('#/analytics/' + top5[els[0].index].episode.episodeId); };
        ch.update(liveTick ? 'none' : undefined);
      }
    } else {
      $$('.chart-box').forEach(b => b.classList.add('no-chart'));
    }

    // Text summary + data table (accessibility)
    const peak = d.daily.reduce((a, b) => (b.plays > a.plays ? b : a), d.daily[0]);
    const avgDay = s.plays / d.daily.length;
    const g = R.growthPct(s.plays, p.plays);
    $('#playsSummary').innerHTML = 'From <strong>' + esc(fmtDate(d.range.from)) + '</strong> to <strong>' + esc(fmtDate(d.range.to)) + '</strong>, episodes were played <strong>' + fmtNum(s.plays) + '</strong> times, about <strong>' + fmtNum(avgDay) + '</strong> a day. ' +
      'The busiest day was <strong>' + esc(fmtDate(peak.date)) + '</strong> with ' + fmtNum(peak.plays) + ' plays.' +
      (g == null ? '' : ' Plays are <strong>' + (g >= 0 ? 'up ' : 'down ') + Math.abs(g).toFixed(1) + '%</strong> compared with the previous ' + d.range.days + ' days.');
    if (!liveTick || $('details.data-table[open]')) {
      $('#dailyTable').innerHTML = '<table class="table table-sm ps-table mb-0"><caption class="visually-hidden">Plays per day</caption><thead><tr><th scope="col">Date</th><th scope="col" class="text-end">Plays</th><th scope="col" class="text-end">7-day average</th></tr></thead><tbody>' +
        d.daily.map((x, i) => '<tr><td>' + esc(fmtDate(x.date)) + '</td><td class="num">' + fmtNum(x.plays) + '</td><td class="num">' + ma[i].toFixed(1) + '</td></tr>').join('') + '</tbody></table>';
    }

    // Ranking table
    const maxPlays = d.top.length ? d.top[0].plays : 1;
    $('#rankTable').innerHTML = '<div class="table-responsive"><table class="table ps-table align-middle"><caption class="visually-hidden">Episodes ranked by plays in the selected range</caption><thead><tr>' +
      '<th scope="col">#</th><th scope="col">Episode</th><th scope="col">Plays</th><th scope="col" class="text-end">Unique listeners</th><th scope="col" class="text-end">Avg listen</th><th scope="col" class="text-end">Completion</th><th scope="col" class="text-end">Length</th><th scope="col"><span class="visually-hidden">Open</span></th></tr></thead><tbody>' +
      d.top.map(r => '<tr class="row-link" data-href="#/analytics/' + esc(r.episode.episodeId) + '">' +
        '<td><span class="rank' + (r.rank <= 3 ? ' r' + r.rank : '') + '">' + r.rank + '</span></td>' +
        '<td style="min-width:200px"><a class="ep-title" href="#/analytics/' + esc(r.episode.episodeId) + '">' + esc(r.episode.title) + '</a><div class="ep-meta">' + esc(showTitle(r.episode.showId)) + '</div></td>' +
        '<td><div class="bar-cell"><span class="num" style="min-width:3.5rem;text-align:left">' + fmtNum(r.plays) + '</span><span class="bar" aria-hidden="true"><i style="width:' + (r.plays / maxPlays * 100).toFixed(1) + '%"></i></span></div></td>' +
        '<td class="num">' + fmtNum(r.uniqueListeners) + '</td>' +
        '<td class="num">' + fmtDur(r.avgListenSec) + '</td>' +
        '<td class="num">' + fmtPct(r.completionRate) + '</td>' +
        '<td class="num">' + fmtDur(r.episode.durationSec) + '</td>' +
        '<td class="text-end"><i class="bi bi-chevron-right text-muted-ps" aria-hidden="true"></i></td></tr>').join('') +
      '</tbody></table></div>';
    $$('#rankTable tr.row-link').forEach(tr => tr.addEventListener('click', e => { if (!e.target.closest('a')) navigate(tr.dataset.href); }));

    if (!liveTick) renderInsights(d);
  }

  function renderInsights(d) {
    const top = d.top;
    const out = [];
    if (top[0]) out.push(['bi-trophy', '<strong>' + esc(top[0].episode.title) + '</strong> leads with ' + fmtNum(top[0].plays) + ' plays, ' + fmtPct(top[0].plays / d.sCur.plays, 0) + ' of all plays in this range.']);
    const bestComp = top.slice().sort((a, b) => b.completionRate - a.completionRate)[0];
    if (bestComp) out.push(['bi-bullseye', '<strong>' + esc(bestComp.episode.title) + '</strong> keeps listeners longest: ' + fmtPct(bestComp.completionRate) + ' completion at ' + fmtDur(bestComp.episode.durationSec) + ' long.']);
    const g = R.growthPct(d.sCur.plays, d.sPrev.plays);
    if (g != null) out.push([g >= 0 ? 'bi-graph-up-arrow' : 'bi-graph-down-arrow', 'Plays are <strong>' + (g >= 0 ? 'up ' : 'down ') + Math.abs(g).toFixed(1) + '%</strong> on the previous ' + d.range.days + ' days (' + fmtNum(d.sPrev.plays) + ' → ' + fmtNum(d.sCur.plays) + ').']);
    const byShow = state.shows.map(sh => ({ sh, plays: top.filter(r => r.episode.showId === sh.showId).reduce((a, r) => a + r.plays, 0) })).filter(x => x.plays > 0).sort((a, b) => b.plays - a.plays);
    if (byShow.length > 1) out.push(['bi-collection-play', '<strong>' + esc(byShow[0].sh.title) + '</strong> drew ' + fmtPct(byShow[0].plays / d.sCur.plays, 0) + ' of plays across ' + byShow.length + ' shows.']);

    const buckets = R.lengthBuckets(top);
    const withEps = buckets.filter(b => b.episodes > 0);
    const bestBucket = withEps.slice().sort((a, b) => b.avgCompletion - a.avgCompletion)[0];
    const maxComp = Math.max.apply(null, withEps.map(b => b.avgCompletion).concat([0.01]));

    $('#insights').innerHTML =
      '<div class="row g-4"><div class="col-lg-7"><div class="row g-3">' +
        out.map(o => '<div class="col-md-6"><div class="insight"><i class="bi ' + o[0] + '" aria-hidden="true"></i><p>' + o[1] + '</p></div></div>').join('') +
      '</div></div>' +
      '<div class="col-lg-5"><h3 class="h6 fw-bold">Completion by episode length</h3>' +
        (bestBucket ? '<p class="small text-muted-ps">Episodes <strong>' + esc(bestBucket.label.toLowerCase()) + '</strong> have the highest average completion in this range.</p>' : '') +
        buckets.map(b => '<div class="bucket"><span>' + esc(b.label) + '</span><span class="bar" aria-hidden="true"><i style="width:' + (b.episodes ? (b.avgCompletion / maxComp * 100).toFixed(1) : 0) + '%"></i></span>' +
          '<strong class="num">' + (b.episodes ? fmtPct(b.avgCompletion, 0) : '—') + '<span class="visually-hidden"> average completion</span></strong></div>' +
          '<div class="ep-meta mb-2" style="margin-left:0">' + b.episodes + ' episode' + (b.episodes === 1 ? '' : 's') + (b.episodes ? ' · ' + fmtNum(b.avgPlays) + ' plays each on average' : '') + '</div>').join('') +
      '</div></div>';
  }

  function exportAnalytics() {
    const d = state.lastAnalytics || analyticsData();
    if (!d.top.length) { toast('There are no rows to export for this date range.', 'warning'); return; }
    const csv = R.toCSV(d.top, [
      { label: 'Rank', value: r => r.rank },
      { label: 'Episode ID', value: r => r.episode.episodeId },
      { label: 'Title', value: r => r.episode.title },
      { label: 'Show', value: r => showTitle(r.episode.showId) },
      { label: 'Plays', value: r => r.plays },
      { label: 'Unique listeners', value: r => r.uniqueListeners },
      { label: 'Avg listening time (sec)', value: r => Math.round(r.avgListenSec) },
      { label: 'Completion rate (%)', value: r => (r.completionRate * 100).toFixed(1) },
      { label: 'Duration (sec)', value: r => r.episode.durationSec },
      { label: 'From', value: () => d.range.from },
      { label: 'To', value: () => d.range.to }
    ]);
    if (downloadCSV('podcaststudio-analytics-' + d.range.from + '-to-' + d.range.to + '.csv', csv)) toast('Exported ' + d.top.length + ' rows to CSV.', 'success', 'Export ready');
  }

  /* ---------- Live listen simulation (sample data) ---------- */
  let liveTimer = null;
  function startLive() {
    stopLive();
    const published = state.episodes.filter(e => e.status === 'Published' && e.durationSec > 0);
    if (!published.length) { toast('Publish an episode first to simulate listens.', 'warning'); $('#liveToggle').checked = false; return; }
    if (currentRange().to !== today()) toast('Live listens are added to today. Choose a range that includes today to see them.', 'info');
    $('#liveTicker').innerHTML = '<span class="live-dot" aria-hidden="true"></span>Live simulation on';
    liveTimer = setInterval(() => {
      const eps = state.episodes.filter(e => e.status === 'Published' && e.durationSec > 0);
      if (!eps.length) return;
      const ep = eps[Math.floor(Math.random() * eps.length)];
      const t = today();
      const add = 1 + Math.floor(Math.random() * 4);
      const listen = Math.round(ep.durationSec * (0.45 + Math.random() * 0.45));
      let found = false;
      const stats = state.stats.map(s => {
        if (s.episodeId === ep.episodeId && s.date === t) {
          found = true;
          const plays = s.plays + add;
          return Object.assign({}, s, {
            plays,
            uniqueListeners: s.uniqueListeners + Math.max(1, Math.round(add * 0.8)),
            avgListenSec: Math.round((s.avgListenSec * s.plays + listen * add) / plays)
          });
        }
        return s;
      });
      if (!found) stats.push({ statId: 'st-' + ep.episodeId + '-' + t, episodeId: ep.episodeId, date: t, plays: add, uniqueListeners: Math.max(1, Math.round(add * 0.8)), avgListenSec: listen });
      if (!commit({ stats })) { stopLive(); const lt = $('#liveToggle'); if (lt) lt.checked = false; return; }
      const ticker = $('#liveTicker');
      if (ticker) ticker.innerHTML = '<span class="live-dot" aria-hidden="true"></span>+' + add + ' play' + (add > 1 ? 's' : '') + ' · ' + esc(ep.title);
      refreshAnalytics(false, true);
    }, 1400);
  }
  function stopLive() {
    if (liveTimer) clearInterval(liveTimer);
    liveTimer = null;
    const ticker = $('#liveTicker');
    if (ticker) ticker.textContent = '';
  }

  /* =========================================================
     Screen: Episode Analytics
     ========================================================= */
  function renderEpisodeAnalytics(id) {
    const ep = epById(id);
    if (!ep) { renderNotFound(); return; }
    const range = currentRange();
    const map = episodesMap();
    const showEps = state.episodes.filter(e => e.showId === ep.showId);
    const showStats = R.statsInRange(state.stats, range.from, range.to, showEps.map(e => e.episodeId));
    const epStats = showStats.filter(s => s.episodeId === id);
    const m = R.summarize(epStats, map);
    const rows = R.topEpisodes(showStats, showEps);
    const avg = R.averageOfEpisodes(rows);
    const rank = rows.find(r => r.episode.episodeId === id);

    const head = crumb('#/analytics', 'Back to analytics') +
      '<div class="page-head"><div class="min-w-0"><div class="eyebrow-sm mb-1">' + esc(showTitle(ep.showId)) + ' · Episode analytics</div><h1 class="page-title">' + esc(ep.title) + '</h1>' +
      '<div class="d-flex flex-wrap gap-2 mt-2">' + badge(ep.status) + '<span class="chip"><i class="bi bi-clock" aria-hidden="true"></i>' + esc(fmtDur(ep.durationSec)) + '</span>' +
      (ep.publishedAt ? '<span class="chip"><i class="bi bi-broadcast" aria-hidden="true"></i>Published ' + esc(fmtDate(ep.publishedAt.slice(0, 10))) + '</span>' : '') +
      (rank ? '<span class="chip chip-primary"><i class="bi bi-trophy" aria-hidden="true"></i>#' + rank.rank + ' of ' + rows.length + ' in show</span>' : '') + '</div></div>' +
      '<a class="btn btn-outline-secondary" href="#/episode/' + esc(ep.episodeId) + '"><i class="bi bi-file-text me-1" aria-hidden="true"></i>Episode details</a></div>';

    if (ep.status !== 'Published' || !m.plays) {
      mount('Episode analytics', head + rangeBarHTML() + '<div class="ps-card"><div class="empty"><div class="empty-icon"><i class="bi bi-bar-chart" aria-hidden="true"></i></div><h2>No listener data' + (ep.status === 'Published' ? ' in this date range' : ' yet') + '</h2><p>' +
        (ep.status === 'Published' ? 'Choose a longer date range to see this episode\'s numbers.' : 'Listener numbers appear after the episode is published.') + '</p>' +
        (ep.status === 'Published' ? '<button type="button" class="btn btn-primary" data-action="range-90">Show last 90 days</button>' : '<a class="btn btn-primary" href="#/episode/' + esc(ep.episodeId) + '">Go to episode</a>') + '</div></div>');
      bindRangeBar(() => refresh());
      if (ep.status === 'Published') tourEvent('measure');
      return;
    }

    const metrics = [
      { id: 'plays', label: 'Plays', icon: 'bi-play-circle', v: m.plays, a: avg.plays, f: fmtNum },
      { id: 'uniq', label: 'Unique listeners', icon: 'bi-people', v: m.uniqueListeners, a: avg.uniqueListeners, f: fmtNum },
      { id: 'listen', label: 'Avg listening time', icon: 'bi-clock-history', v: m.avgListenSec, a: avg.avgListenSec, f: fmtDur },
      { id: 'comp', label: 'Completion rate', icon: 'bi-bullseye', v: m.completionRate, a: avg.completionRate, f: x => fmtPct(x) }
    ];

    // Daily: this episode vs average per episode in the show
    const days = R.eachDay(range.from, range.to);
    const epDaily = R.playsPerDay(epStats, range.from, range.to).map(x => x.plays);
    const byDay = {};
    showStats.forEach(s => { (byDay[s.date] = byDay[s.date] || []).push(s.plays); });
    const showAvgDaily = days.map(d2 => byDay[d2] ? Math.round(byDay[d2].reduce((a, b) => a + b, 0) / byDay[d2].length * 10) / 10 : 0);

    mount('Episode analytics', head + rangeBarHTML() +
      '<div class="row g-3 mb-4 stagger">' + metrics.map(x => {
        const diff = R.pctDiff(x.v, x.a);
        const mx = Math.max(x.v, x.a) || 1;
        return '<div class="col-12 col-sm-6 col-xl-3"><div class="ps-card kpi"><div class="kpi-top"><p class="kpi-label">' + x.label + '</p><span class="kpi-icon"><i class="bi ' + x.icon + '" aria-hidden="true"></i></span></div>' +
          '<div class="kpi-value">' + esc(x.f(x.v)) + '</div>' +
          '<div class="kpi-foot">' + deltaHTML(diff, '%', 'vs show average') + '</div>' +
          '<div class="compare-bars" aria-hidden="true"><div class="cmp-row"><span>This episode</span><span class="cmp-track"><i class="ep" style="width:' + (x.v / mx * 100).toFixed(1) + '%"></i></span></div>' +
          '<div class="cmp-row"><span>Show avg</span><span class="cmp-track"><i class="avg" style="width:' + (x.a / mx * 100).toFixed(1) + '%"></i></span></div></div>' +
          '<div class="small text-muted-ps mt-1">Show average: ' + esc(x.f(x.a)) + ' (' + avg.count + ' episodes)</div></div></div>';
      }).join('') + '</div>' +
      '<section class="ps-card" aria-labelledby="epDailyTitle"><div class="card-header"><h2 class="card-title" id="epDailyTitle">Plays per day vs show average</h2><span class="ms-auto small text-muted-ps">' + esc(range.label) + '</span></div><div class="card-body">' +
        '<div class="chart-box"><canvas id="epChart" role="img" aria-label="Bar chart of this episode\'s plays per day with a line for the show average per episode. A summary follows."></canvas><p class="chart-fallback">Charts could not load. The summary below has the numbers.</p></div>' +
        '<p class="chart-summary">In this range the episode had <strong>' + fmtNum(m.plays) + '</strong> plays from <strong>' + fmtNum(m.uniqueListeners) + '</strong> unique listeners. On average people listened for <strong>' + fmtDur(m.avgListenSec) + '</strong> of ' + fmtDur(ep.durationSec) + ' (<strong>' + fmtPct(m.completionRate) + '</strong> completion). ' +
          'That is ' + (R.pctDiff(m.plays, avg.plays) >= 0 ? '<strong>above</strong>' : '<strong>below</strong>') + ' the show average of ' + fmtNum(avg.plays) + ' plays per episode.</p>' +
        '<details class="data-table"><summary>Show the daily numbers as a table</summary><div class="table-wrap"><table class="table table-sm ps-table mb-0"><thead><tr><th scope="col">Date</th><th scope="col" class="text-end">This episode</th><th scope="col" class="text-end">Show avg per episode</th></tr></thead><tbody>' +
          days.map((d2, i) => '<tr><td>' + esc(fmtDate(d2)) + '</td><td class="num">' + fmtNum(epDaily[i]) + '</td><td class="num">' + showAvgDaily[i].toFixed(1) + '</td></tr>').join('') + '</tbody></table></div></details>' +
      '</div></section>');

    bindRangeBar(() => refresh());
    chartBase();
    if (window.Chart) {
      state.charts.ep = new Chart($('#epChart'), {
        type: 'bar',
        data: { labels: days.map(shortDate), datasets: [
          { type: 'bar', label: 'This episode', data: epDaily, backgroundColor: 'rgba(109,40,217,.85)', borderRadius: 4, maxBarThickness: 18, order: 2 },
          { type: 'line', label: 'Show average per episode', data: showAvgDaily, borderColor: '#1F2937', borderDash: [6, 5], borderWidth: 2, pointRadius: 0, tension: 0.35, order: 1 }
        ] },
        options: {
          responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
          plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, padding: 16 } } },
          scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0 } }, y: { beginAtZero: true, grid: { color: '#F3F4F6' }, border: { display: false }, ticks: { precision: 0 } } }
        }
      });
    } else $$('.chart-box').forEach(b => b.classList.add('no-chart'));
    tourEvent('measure', ep);
  }

  /* =========================================================
     Screen: About / Help
     ========================================================= */
  function renderAbout() {
    const r = R.QUALITY_RULES;
    mount('About & Help',
      pageHead('About &amp; Help', 'How PodcastStudio works, how numbers are calculated and what this demo does not do.', '') +
      '<div class="row g-4">' +
        '<div class="col-lg-7">' +
          '<section class="ps-card mb-4"><div class="card-header"><h2 class="card-title"><i class="bi bi-clipboard2-check me-2 text-primary" aria-hidden="true"></i>How quality checks work</h2></div><div class="card-body">' +
            '<p>The audio engineer enters loudness and bitrate. The format comes from the audio file name. An episode passes the automatic checks when all three rules pass:</p>' +
            '<div class="table-responsive"><table class="table ps-table"><thead><tr><th scope="col">Check</th><th scope="col">Rule</th><th scope="col">Example</th></tr></thead><tbody>' +
              '<tr><td>Loudness</td><td>Within ±' + r.toleranceLufs + ' LUFS of ' + r.targetLufs + ' LUFS (−17 to −15)</td><td>−16.4 passes, −17.2 fails</td></tr>' +
              '<tr><td>Bitrate</td><td>At least ' + r.minBitrateKbps + ' kbps</td><td>128 passes, 96 fails</td></tr>' +
              '<tr><td>Format</td><td>mp3 or m4a</td><td>.m4a passes, .wav fails</td></tr>' +
            '</tbody></table></div>' +
            '<p class="mb-2">The engineer then records the final result as <strong>Passed</strong> (only when every check passes) or <strong>Needs fixes</strong> (a note is required).</p>' +
            '<p class="mb-0"><strong>Publish rule:</strong> an episode can be published only when its quality check is Passed and all required fields are valid.</p>' +
          '</div></section>' +
          '<section class="ps-card mb-4"><div class="card-header"><h2 class="card-title"><i class="bi bi-calculator me-2 text-primary" aria-hidden="true"></i>How analytics are calculated</h2></div><div class="card-body">' +
            '<div class="formula mb-3">Total plays        = sum of daily plays in the range\nUnique listeners   = sum of daily unique listeners\nAvg listening time = Σ(plays × avgListenSec) ÷ Σ plays\nCompletion rate    = avg listening time ÷ episode duration\n                     (play-weighted across episodes, max 100%)\nGrowth %           = (current − previous) ÷ previous × 100\n7-day moving avg   = mean of plays for the day and the 6 days before</div>' +
            '<p class="small text-muted-ps mb-0">The previous period is the same number of days immediately before the selected range. Sample data has no listener IDs, so a person who listens on two different days is counted on both days. The show average on Episode Analytics is the mean across the show\'s episodes that have plays in the range.</p>' +
          '</div></section>' +
          '<section class="ps-card"><div class="card-header"><h2 class="card-title"><i class="bi bi-diagram-3 me-2 text-primary" aria-hidden="true"></i>Statuses</h2></div><div class="card-body">' +
            '<div class="d-flex flex-wrap gap-2 align-items-center mb-3">' + badge('Draft') + '<i class="bi bi-arrow-right" aria-hidden="true"></i>' + badge('Awaiting review') + '<i class="bi bi-arrow-right" aria-hidden="true"></i>' + badge('Approved') + '<i class="bi bi-arrow-right" aria-hidden="true"></i>' + badge('Published') + '</div>' +
            '<p class="small mb-0">If the engineer chooses ' + badge('Needs fixes') + ' the episode stays a Draft until the podcaster updates it and sends it for review again. Every badge shows text as well as colour.</p>' +
          '</div></section>' +
        '</div>' +
        '<div class="col-lg-5">' +
          '<section class="ps-card mb-4"><div class="card-header"><h2 class="card-title"><i class="bi bi-exclamation-diamond me-2 text-primary" aria-hidden="true"></i>Demo limits</h2></div><div class="card-body"><ul class="mb-0 small d-grid gap-2">' +
            '<li><strong>All data is sample data.</strong> Shows, episodes and listener numbers are synthetic. They are not real listeners.</li>' +
            '<li><strong>No audio is hosted, edited or distributed.</strong> Only the file name is stored. There is no RSS feed.</li>' +
            '<li><strong>Role checks are a client-side demonstration only</strong>, not real security. There are no accounts or server-side login.</li>' +
            '<li><strong>Quality checks use simplified rules</strong> for learning.</li>' +
            '<li><strong>Live listens</strong> on the Analytics screen are simulated and labelled as sample data.</li>' +
          '</ul></div></section>' +
          '<section class="ps-card mb-4"><div class="card-header"><h2 class="card-title"><i class="bi bi-hdd me-2 text-primary" aria-hidden="true"></i>Your data</h2></div><div class="card-body">' +
            '<p class="small">Data is saved in this browser\'s localStorage under these keys:</p>' +
            '<p class="small">' + Object.values(Store.KEYS).map(k => '<code>' + k + '</code>').join('<br>') + '</p>' +
            (state.storageOk ? '' : alertHTML('warning', 'Browser storage is not available, so changes will be lost when you close this tab.')) +
            '<div class="d-flex flex-wrap gap-2 mt-3"><button type="button" class="btn btn-outline-primary" data-action="load-sample"><i class="bi bi-arrow-repeat me-1" aria-hidden="true"></i>Reload sample data</button>' +
            '<button type="button" class="btn btn-outline-danger" data-action="clear-data"><i class="bi bi-trash me-1" aria-hidden="true"></i>Clear episodes &amp; stats</button></div>' +
          '</div></section>' +
          '<section class="ps-card"><div class="card-header"><h2 class="card-title"><i class="bi bi-bug me-2 text-primary" aria-hidden="true"></i>Tested rules</h2></div><div class="card-body">' +
            '<p class="small">The quality, publish and analytics rules are tested against hand-calculated cases.</p>' +
            '<a class="btn btn-outline-secondary" href="tests/index.html" target="_blank" rel="noopener">Open the test page <i class="bi bi-box-arrow-up-right" aria-hidden="true"></i></a>' +
          '</div></section>' +
        '</div>' +
      '</div>');
  }

  function renderNotFound() {
    mount('Not found', '<div class="ps-card"><div class="empty"><div class="empty-icon"><i class="bi bi-question-lg" aria-hidden="true"></i></div><h2>We could not find that page</h2><p>The episode may have been deleted, or the link is out of date.</p><a href="#/dashboard" class="btn btn-primary">Go to Publishing</a></div></div>');
  }

  /* =========================================================
     Data management
     ========================================================= */
  async function loadSample() {
    if (state.episodes.length) {
      const ok = await confirmDialog({ title: 'Reload sample data?', body: '<p class="mb-0">This replaces the episodes and listener numbers in this browser with fresh sample data. Your role and filters are kept.</p>', confirmText: 'Reload sample data' });
      if (!ok) return;
    }
    const data = Store.buildSampleData(today());
    if (!commit({ shows: data.shows, episodes: data.episodes, stats: data.stats })) return;
    toast('Sample data loaded. Every screen now has data.', 'success', 'Sample data');
    refresh();
  }
  async function clearData() {
    const ok = await confirmDialog({ title: 'Clear episodes and stats?', body: '<p class="mb-0">All episodes, quality checks and listener numbers will be removed from this browser. Shows are kept so you can create new episodes. You can reload sample data at any time.</p>', confirmText: 'Clear data', variant: 'danger' });
    if (!ok) return;
    if (!commit({ episodes: [], stats: [] })) return;
    toast('Episodes and listener numbers cleared.', 'success');
    navigate('#/dashboard');
  }

  /* =========================================================
     30-second tour (product promise)
     ========================================================= */
  const TOUR_STEPS = [
    { key: 'create', label: 'Create' },
    { key: 'review', label: 'Check' },
    { key: 'publish', label: 'Publish' },
    { key: 'measure', label: 'Measure' }
  ];
  const TOUR_HINTS = {
    create: ['Fill the form (try Autofill example) and choose Save & send for review.', 'Open form'],
    review: ['Switch to the Audio Engineer view and pass the quality check (try −16 LUFS, 192 kbps).', 'Switch & review'],
    publish: ['Switch back to the Podcaster view and press Publish.', 'Switch & publish'],
    measure: ['Open Analytics to see the first listener numbers.', 'Open analytics']
  };

  function startTour() {
    stopTourTimer();
    state.tour = { start: performance.now(), epId: null, done: {}, finished: false, timer: null, elapsed: 0 };
    $('#tourPill').classList.remove('d-none');
    state.tour.timer = setInterval(tickTour, 100);
    setRole('podcaster', { silent: true, render: false });
    renderTourPill();
    navigate('#/episode/new');
    toast('The clock is running. Use Autofill example to move fast.', 'info', '30-second tour started');
  }
  function tickTour() {
    if (!state.tour || state.tour.finished) return;
    state.tour.elapsed = (performance.now() - state.tour.start) / 1000;
    const el = $('#tourTime');
    el.textContent = state.tour.elapsed.toFixed(1) + 's';
    el.style.color = state.tour.elapsed > 30 ? '#FCA5A5' : '';
  }
  function stopTourTimer() {
    if (state.tour && state.tour.timer) clearInterval(state.tour.timer);
  }
  function endTour() {
    stopTourTimer();
    state.tour = null;
    $('#tourPill').classList.add('d-none');
  }
  function nextTourStep() {
    return TOUR_STEPS.find(s => !state.tour.done[s.key]);
  }
  function renderTourPill() {
    const t = state.tour;
    if (!t) return;
    const next = t.finished ? null : nextTourStep();
    $('#tourSteps').innerHTML = TOUR_STEPS.map(s => '<li class="' + (t.done[s.key] ? 'done' : next && next.key === s.key ? 'current' : '') + '">' + s.label + '<span class="visually-hidden">' + (t.done[s.key] ? ' done' : '') + '</span></li>').join('');
    if (t.finished) {
      const under = t.elapsed <= 30;
      $('#tourNext').innerHTML = '<span class="tour-result">' + (under ? '<i class="bi bi-trophy-fill me-1" aria-hidden="true"></i>Done in ' + t.elapsed.toFixed(1) + 's. Promise kept.' : 'Done in ' + t.elapsed.toFixed(1) + 's. Try again to beat 30s.') + '</span>' +
        '<button type="button" class="btn btn-light" data-action="start-tour">Try again</button>';
    } else {
      const h = TOUR_HINTS[next.key];
      $('#tourNext').innerHTML = '<span>' + esc(h[0]) + '</span><button type="button" class="btn btn-light" data-action="tour-go">' + esc(h[1]) + '</button>';
    }
  }
  function tourGo() {
    const t = state.tour;
    if (!t) return;
    const next = nextTourStep();
    if (!next) return;
    const ep = t.epId ? epById(t.epId) : null;
    if (next.key === 'create') { setRole('podcaster', { silent: true, render: false }); navigate('#/episode/new'); return; }
    if (!ep) { endTour(); return; }
    if (next.key === 'review') {
      if (ep.qcStatus !== 'Awaiting review') {
        if (!R.validateEpisode(ep).valid) { toast('Complete the episode details first.', 'warning'); navigate('#/episode/' + ep.episodeId + '/edit'); return; }
        commit({ episodes: replaceEpisode(Object.assign({}, ep, { qcStatus: 'Awaiting review', submittedAt: nowISO() })) });
      }
      setRole('engineer', { silent: true, render: false });
      state.ui.reviewTab = 'queue';
      navigate('#/review/' + ep.episodeId);
      setTimeout(() => { const l = $('#lufs'); if (l) l.focus(); }, 60);
      return;
    }
    if (next.key === 'publish') { setRole('podcaster', { silent: true, render: false }); navigate('#/episode/' + ep.episodeId); return; }
    if (next.key === 'measure') navigate('#/analytics/' + ep.episodeId);
  }
  function tourEvent(kind, ep, result) {
    const t = state.tour;
    if (!t || t.finished) return;
    if (kind === 'create' && !t.done.create) { t.epId = ep.episodeId; t.done.create = true; }
    else if (kind === 'review' && t.done.create && ep.episodeId === t.epId && result === 'Passed') t.done.review = true;
    else if (kind === 'publish' && t.done.review && ep.episodeId === t.epId) t.done.publish = true;
    else if (kind === 'measure' && t.done.publish) {
      t.done.measure = true;
      t.finished = true;
      t.elapsed = (performance.now() - t.start) / 1000;
      stopTourTimer();
      $('#tourTime').textContent = t.elapsed.toFixed(1) + 's';
      celebrate();
      toast((t.elapsed <= 30 ? 'Created, checked, published and measured in ' : 'Finished in ') + t.elapsed.toFixed(1) + ' seconds.', 'success', t.elapsed <= 30 ? 'Product promise kept' : 'Tour complete');
    }
    renderTourPill();
  }
  function celebrate() {
    if (reduceMotion()) return;
    const box = $('#confetti');
    const colors = ['#6D28D9', '#8B5CF6', '#A78BFA', '#166534', '#F59E0B', '#EDE9FE'];
    let html = '';
    for (let i = 0; i < 70; i++) {
      html += '<i style="left:' + (Math.random() * 100).toFixed(1) + '%;background:' + colors[i % colors.length] +
        ';--dx:' + ((Math.random() - 0.5) * 240).toFixed(0) + 'px;--rot:' + (Math.random() * 720).toFixed(0) + 'deg;animation-delay:' + (Math.random() * 0.4).toFixed(2) + 's"></i>';
    }
    box.innerHTML = html;
    setTimeout(() => { box.innerHTML = ''; }, 3200);
  }

  /* =========================================================
     Global events
     ========================================================= */
  function bindGlobal() {
    window.addEventListener('hashchange', () => router());
    $$('input[name="role"]').forEach(i => i.addEventListener('change', () => setRole(i.value)));
    $('#tourClose').addEventListener('click', endTour);

    document.addEventListener('click', e => {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const a = el.dataset.action;
      const id = el.dataset.id;
      switch (a) {
        case 'start-tour': startTour(); break;
        case 'tour-go': tourGo(); break;
        case 'shortcuts': bootstrap.Modal.getOrCreateInstance($('#shortcutsModal')).show(); break;
        case 'export-episodes': exportEpisodes(); break;
        case 'export-analytics': exportAnalytics(); break;
        case 'publish': publishEpisode(id); break;
        case 'send-review': sendForReview(id); break;
        case 'delete': deleteEpisode(id); break;
        case 'load-sample': loadSample(); break;
        case 'clear-data': clearData(); break;
        case 'switch-role': setRole(el.dataset.role); break;
        case 'go-role': setRole(el.dataset.role, { render: false }); navigate(el.dataset.href); break;
        case 'range-90': state.prefs.dateRange = { preset: '90', from: null, to: null }; savePrefs(); refresh(); break;
        case 'reset-filters':
          state.ui.search = ''; state.ui.stage = 'all'; state.ui.show = 'all';
          if ($('#search')) { $('#search').value = ''; $('#stageFilter').value = 'all'; $('#showFilter').value = 'all'; syncPipeline(); renderEpisodeResults(); $('#search').focus(); }
          break;
        default: break;
      }
    });

    let gPending = false, gTimer = null;
    document.addEventListener('keydown', e => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (['INPUT', 'TEXTAREA', 'SELECT'].indexOf(t.tagName) !== -1 || t.isContentEditable)) {
        if (e.key === 'Escape' && t.id === 'search') t.blur();
        return;
      }
      if ($('.modal.show')) return;
      const k = e.key.toLowerCase();
      if (gPending) {
        gPending = false;
        clearTimeout(gTimer);
        const map = { h: '#/home', p: '#/dashboard', q: '#/review', a: '#/analytics' };
        if (map[k]) { e.preventDefault(); navigate(map[k]); }
        return;
      }
      if (e.key === '/') {
        e.preventDefault();
        if (!$('#search')) { navigate('#/dashboard'); setTimeout(() => { const s = $('#search'); if (s) s.focus(); }, 50); }
        else $('#search').focus();
      } else if (k === 'n') {
        if (isPodcaster()) navigate('#/episode/new'); else toast('Creating episodes is available in the Podcaster view. Press R to switch.', 'info');
      } else if (k === 'r') {
        setRole(isPodcaster() ? 'engineer' : 'podcaster');
      } else if (k === 't') {
        startTour();
      } else if (k === 'g') {
        gPending = true;
        gTimer = setTimeout(() => { gPending = false; }, 1200);
      } else if (e.key === '?') {
        bootstrap.Modal.getOrCreateInstance($('#shortcutsModal')).show();
      }
    });
  }

  /* =========================================================
     Boot
     ========================================================= */
  function boot() {
    state.storageOk = Store.isAvailable();
    state.prefs = state.storageOk ? Store.loadPrefs() : JSON.parse(JSON.stringify(Store.DEFAULT_PREFS));

    let shows = state.storageOk ? Store.read('shows') : undefined;
    let episodes = state.storageOk ? Store.read('episodes') : undefined;
    let stats = state.storageOk ? Store.read('stats') : undefined;

    if (episodes === undefined && stats === undefined) {
      const res = state.storageOk ? Store.seed(today()) : { ok: false, data: Store.buildSampleData(today()) };
      shows = res.data.shows; episodes = res.data.episodes; stats = res.data.stats;
    }
    if (!Array.isArray(shows) || !shows.length) {
      shows = Store.sampleShows();
      if (state.storageOk) Store.save('shows', shows);
    }
    if (!Array.isArray(episodes)) episodes = [];
    if (!Array.isArray(stats)) stats = [];
    episodes = episodes.filter(e => e && e.episodeId).map(e => Object.assign({ reviews: [] }, e, { reviews: Array.isArray(e.reviews) ? e.reviews : [] }));
    stats = stats.filter(s => s && s.episodeId && s.date);

    Object.assign(state, { shows, episodes, stats });

    if (!state.storageOk) {
      $('#globalBanner').innerHTML = '<div class="px-3 px-md-4 pt-3">' + alertHTML('warning', '<strong>Browser storage is not available.</strong> You can explore with sample data, but changes will be lost when you close this tab.') + '</div>';
    }

    bindGlobal();
    syncRoleUI();

    if (!location.hash) {
      const last = state.prefs.lastScreen;
      history.replaceState(null, '', last && /^#\//.test(last) ? last : '#/home');
    }
    router();
    setTimeout(() => {
      const l = $('#loading');
      l.classList.add('hide');
      l.setAttribute('aria-hidden', 'true');
    }, 450);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
