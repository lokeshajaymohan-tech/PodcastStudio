/*
 * PodcastStudio — store.js (LocalDataStore)
 * Reads and writes app data in localStorage under the documented keys and
 * builds the synthetic sample data. All names and numbers are made up.
 */
(function (root) {
  'use strict';
  const R = root.PSRules;

  const KEYS = Object.freeze({
    shows: 'podcaststudio_shows',
    episodes: 'podcaststudio_episodes',
    stats: 'podcaststudio_stats',
    prefs: 'podcaststudio_prefs',
    users: 'podcaststudio_users',
    session: 'podcaststudio_session'
  });

  const DEFAULT_PREFS = Object.freeze({
    role: 'podcaster',
    dateRange: { preset: '30', from: null, to: null },
    lastScreen: '#/home',
    sortOrder: { key: 'releaseDate', dir: 'desc' },
    theme: 'system'
  });

  function isAvailable() {
    try {
      const k = '__podcaststudio_test__';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  }

  /** @returns parsed value, or `undefined` when the key is missing or unreadable. */
  function read(kind) {
    try {
      const raw = localStorage.getItem(KEYS[kind]);
      if (raw == null) return undefined;
      return JSON.parse(raw);
    } catch (e) {
      return undefined;
    }
  }

  /** @returns {boolean} true when saved. */
  function save(kind, value) {
    try {
      localStorage.setItem(KEYS[kind], JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  function remove(kind) {
    try { localStorage.removeItem(KEYS[kind]); return true; } catch (e) { return false; }
  }

  function loadPrefs() {
    const p = read('prefs');
    const merged = Object.assign({}, JSON.parse(JSON.stringify(DEFAULT_PREFS)), p && typeof p === 'object' ? p : {});
    if (merged.role !== 'podcaster' && merged.role !== 'engineer') merged.role = 'podcaster';
    if (!merged.dateRange || typeof merged.dateRange !== 'object') merged.dateRange = Object.assign({}, DEFAULT_PREFS.dateRange);
    if (!merged.sortOrder || typeof merged.sortOrder !== 'object') merged.sortOrder = Object.assign({}, DEFAULT_PREFS.sortOrder);
    if (['light', 'dark', 'system'].indexOf(merged.theme) === -1) merged.theme = 'system';
    return merged;
  }

  /* ---------- Sample data ---------- */

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function sampleShows() {
    return [
      { showId: 'show-1', title: 'Signal & Noise', hostName: 'Ari Mendes', category: 'Technology' },
      { showId: 'show-2', title: 'Studio Hours', hostName: 'June Okafor', category: 'Arts & Culture' }
    ];
  }

  function buildSampleData(today) {
    const day = n => R.addDays(today, n);
    const at = (n, h) => day(n) + 'T' + String(h == null ? 10 : h).padStart(2, '0') + ':00:00';
    const base = {
      description: '', qcNote: '', loudnessLufs: null, bitrateKbps: null,
      publishedAt: null, reviewedAt: null, submittedAt: null, updatedAt: null, reviews: []
    };
    const E = o => Object.assign({}, base, o);
    const reviewed = (n, result, L, B, file, note) => ({
      at: at(n, 15), result, note: note || '', loudnessLufs: L, bitrateKbps: B, format: R.getFormat(file)
    });

    const P = (id, showId, title, description, file, dur, L, B, rel, note) => E({
      episodeId: id, showId, title, description, audioFileName: file, durationSec: dur,
      status: 'Published', qcStatus: 'Passed', qcNote: note, loudnessLufs: L, bitrateKbps: B,
      releaseDate: day(rel), createdAt: at(rel - 6, 9), submittedAt: at(rel - 4, 11),
      reviewedAt: at(rel - 3, 15), publishedAt: at(rel, 7),
      reviews: [reviewed(rel - 3, 'Passed', L, B, file, note)]
    });

    const episodes = [
      P('ep-101', 'show-1', 'The Future of Spatial Audio',
        'How immersive formats are changing the way shows are produced and heard, with a look at mixing for headphones.',
        'sn-ep101-spatial-audio.mp3', 2580, -16.2, 192, -58, 'Clean master. Loudness on target.'),
      P('ep-102', 'show-2', 'Inside a Film Score Session',
        'A composer walks through a live scoring session, from temp track to final cue.',
        'sh-ep102-film-score.m4a', 1920, -15.8, 160, -45, 'Good dynamics, no clipping.'),
      P('ep-103', 'show-1', 'Building a Home Studio on a Budget',
        'Room treatment, interfaces and the gear that actually matters when money is tight.',
        'sn-ep103-home-studio.mp3', 3540, -16.0, 192, -36, 'Exactly on target.'),
      P('ep-104', 'show-2', 'Voice Acting Myths, Busted',
        'Three working voice actors separate the myths from the craft.',
        'sh-ep104-voice-myths.mp3', 1260, -16.4, 128, -24, 'Minimum bitrate, still clean.'),
      P('ep-105', 'show-1', 'AI Tools Every Editor Should Know',
        'Noise removal, transcription and smart leveling: what saves time and what to avoid.',
        'sn-ep105-ai-tools.mp3', 2220, -15.6, 256, -14, 'Slightly hot but within range.'),
      P('ep-106', 'show-2', 'The Art of the Interview',
        'Preparing questions, active listening and editing a conversation so it still feels natural.',
        'sh-ep106-interview.m4a', 2880, -16.1, 192, -6, 'Great levels across both voices.'),

      E({
        episodeId: 'ep-107', showId: 'show-1', title: 'Mixing Dialogue for Clarity',
        description: 'EQ, compression and de-essing settings that make every voice easy to follow.',
        audioFileName: 'sn-ep107-dialogue-mix.mp3', durationSec: 2400, status: 'Approved', qcStatus: 'Passed',
        qcNote: 'Ready to go.', loudnessLufs: -16.3, bitrateKbps: 192, releaseDate: day(3),
        createdAt: at(-5, 9), submittedAt: at(-3, 10), reviewedAt: at(-2, 14),
        reviews: [reviewed(-2, 'Passed', -16.3, 192, 'x.mp3', 'Ready to go.')]
      }),
      E({
        episodeId: 'ep-108', showId: 'show-2', title: 'Podcasting on the Road',
        description: 'Recording on location: portable kits, noisy rooms and backing up files while travelling.',
        audioFileName: 'sh-ep108-on-the-road.m4a', durationSec: 1680, status: 'Approved', qcStatus: 'Passed',
        qcNote: 'Some room tone but acceptable.', loudnessLufs: -15.9, bitrateKbps: 160, releaseDate: day(10),
        createdAt: at(-4, 9), submittedAt: at(-2, 12), reviewedAt: at(-1, 16),
        reviews: [reviewed(-1, 'Passed', -15.9, 160, 'x.m4a', 'Some room tone but acceptable.')]
      }),
      E({
        episodeId: 'ep-109', showId: 'show-1', title: 'Microphones Under $200',
        description: 'Six affordable microphones tested side by side on the same voice.',
        audioFileName: 'sn-ep109-mics.mp3', durationSec: 2100, status: 'Draft', qcStatus: 'Needs fixes',
        qcNote: 'Loudness is about 3.4 LUFS too quiet and the bitrate is 96 kbps. Re-export at −16 LUFS and 128 kbps or higher.',
        loudnessLufs: -19.4, bitrateKbps: 96, releaseDate: day(7),
        createdAt: at(-6, 9), submittedAt: at(-3, 9), reviewedAt: at(-1, 11),
        reviews: [reviewed(-1, 'Needs fixes', -19.4, 96, 'x.mp3',
          'Loudness is about 3.4 LUFS too quiet and the bitrate is 96 kbps. Re-export at −16 LUFS and 128 kbps or higher.')]
      }),
      E({
        episodeId: 'ep-110', showId: 'show-2', title: 'Sound Design for Short Films',
        description: 'Foley, ambience and the small sounds that sell a scene.',
        audioFileName: 'sh-ep110-sound-design.wav', durationSec: 2700, status: 'Draft', qcStatus: 'Awaiting review',
        releaseDate: day(14), createdAt: at(-2, 10), submittedAt: at(-1, 17)
      }),
      E({
        episodeId: 'ep-111', showId: 'show-1', title: 'Remote Recording Workflows',
        description: 'Double-enders, backup recorders and how to keep remote guests sounding local.',
        audioFileName: 'sn-ep111-remote.mp3', durationSec: 1980, status: 'Draft', qcStatus: 'Awaiting review',
        releaseDate: day(17), createdAt: at(-1, 9), submittedAt: at(0, 8)
      }),
      E({
        episodeId: 'ep-112', showId: 'show-2', title: 'Listener Mailbag #4',
        description: 'We answer your questions about gear, guests and growing a small show.',
        audioFileName: 'sh-ep112-mailbag.m4a', durationSec: 1500, status: 'Draft', qcStatus: 'Not submitted',
        releaseDate: day(21), createdAt: at(0, 9)
      }),
      E({
        episodeId: 'ep-113', showId: 'show-1', title: 'Guest Episode (details pending)',
        description: 'Placeholder for a guest interview. Audio has not been delivered yet.',
        audioFileName: '', durationSec: 0, status: 'Draft', qcStatus: 'Not submitted',
        releaseDate: day(28), createdAt: at(0, 11)
      })
    ];

    // Listener numbers: about 30 days per published episode, from release to today.
    const profile = {
      'ep-101': { peak: 520, completion: 0.66 },
      'ep-102': { peak: 380, completion: 0.74 },
      'ep-103': { peak: 610, completion: 0.51 },
      'ep-104': { peak: 300, completion: 0.82 },
      'ep-105': { peak: 720, completion: 0.71 },
      'ep-106': { peak: 560, completion: 0.62 }
    };
    const rnd = mulberry32(20261115);
    const stats = [];
    episodes.filter(e => e.status === 'Published').forEach(ep => {
      const p = profile[ep.episodeId];
      for (let i = 0; i < 30; i++) {
        const date = R.addDays(ep.releaseDate, i);
        if (date > today) break;
        const dow = new Date(R.parseISO(date)).getUTCDay();
        const weekday = dow === 0 || dow === 6 ? 0.82 : dow === 1 || dow === 2 ? 1.1 : 1;
        const decay = 0.22 + 0.78 * Math.exp(-0.28 * i);
        const noise = 0.85 + rnd() * 0.3;
        const plays = Math.max(3, Math.round(p.peak * decay * weekday * noise));
        const uniqueListeners = Math.max(1, Math.round(plays * (0.78 + rnd() * 0.1)));
        const comp = Math.min(0.97, Math.max(0.2, p.completion + (rnd() - 0.5) * 0.08));
        stats.push({
          statId: 'st-' + ep.episodeId + '-' + date,
          episodeId: ep.episodeId,
          date,
          plays,
          uniqueListeners,
          avgListenSec: Math.round(ep.durationSec * comp)
        });
      }
    });

    return { shows: sampleShows(), episodes, stats };
  }

  /** Writes fresh sample data. @returns {{ok:boolean, data}} */
  function seed(today) {
    const data = buildSampleData(today || R.todayISO());
    const ok = save('shows', data.shows) && save('episodes', data.episodes) && save('stats', data.stats);
    return { ok, data };
  }

  /* ---------- Accounts (client-side demo sign-in) ---------- */

  const DEMO_PASSWORD = 'Studio2026';
  const DEMO_USERS = [
    { userId: 'u-demo-pod', name: 'Ari Mendes', email: 'podcaster@demo.studio', role: 'podcaster' },
    { userId: 'u-demo-eng', name: 'Sam Rivera', email: 'engineer@demo.studio', role: 'engineer' }
  ];

  function randomHex(bytes) {
    const a = new Uint8Array(bytes);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(a);
    else for (let i = 0; i < bytes; i++) a[i] = Math.floor(Math.random() * 256);
    return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
  }

  /** Builds a stored user with a salted SHA-256 password hash (never the password itself). */
  function makeUser(u, password) {
    const salt = randomHex(16);
    return {
      userId: u.userId || 'u-' + Date.now().toString(36) + randomHex(3),
      name: u.name,
      email: String(u.email).trim().toLowerCase(),
      role: u.role,
      salt,
      passwordHash: R.sha256Hex(salt + ':' + password),
      createdAt: new Date().toISOString()
    };
  }

  function checkPassword(user, password) {
    return !!user && R.sha256Hex(user.salt + ':' + password) === user.passwordHash;
  }

  /** Returns the user list, adding the demo accounts the first time. */
  function loadUsers() {
    let users = read('users');
    if (!Array.isArray(users)) {
      users = DEMO_USERS.map(u => makeUser(u, DEMO_PASSWORD));
      save('users', users);
    }
    return users;
  }

  /** Session lives in localStorage ("remember me") or sessionStorage. */
  function readSession() {
    try {
      const raw = localStorage.getItem(KEYS.session) || sessionStorage.getItem(KEYS.session);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function writeSession(userId, remember) {
    try {
      clearSession();
      const v = JSON.stringify({ userId, at: new Date().toISOString() });
      (remember ? localStorage : sessionStorage).setItem(KEYS.session, v);
      return true;
    } catch (e) { return false; }
  }
  function clearSession() {
    try { localStorage.removeItem(KEYS.session); sessionStorage.removeItem(KEYS.session); } catch (e) { /* ignore */ }
  }

  root.PSStore = {
    KEYS, DEFAULT_PREFS, isAvailable, read, save, remove, loadPrefs, seed, buildSampleData, sampleShows,
    DEMO_USERS, DEMO_PASSWORD, makeUser, checkPassword, loadUsers, readSession, writeSession, clearSession
  };
})(typeof window !== 'undefined' ? window : globalThis);
