/*
 * PodcastStudio — rules.js
 * Pure functions for validation, quality checks, publish rules and analytics.
 * No DOM access, so every function can be tested on its own (see tests/).
 */
(function (root) {
  'use strict';

  /* ---------- Constants ---------- */

  /** Documented quality rule (PRD §10). */
  const QUALITY_RULES = Object.freeze({
    targetLufs: -16,
    toleranceLufs: 1,
    minBitrateKbps: 128,
    allowedFormats: Object.freeze(['mp3', 'm4a', 'mp4'])
  });

  const DAY_MS = 86400000;
  const MAX_DURATION_SEC = 6 * 3600;

  /* ---------- Date helpers (ISO "YYYY-MM-DD", calendar-day maths in UTC) ---------- */

  /** @returns {number|null} UTC timestamp for a valid ISO date, otherwise null. */
  function parseISO(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return null;
    const [y, m, d] = iso.split('-').map(Number);
    const t = Date.UTC(y, m - 1, d);
    const dt = new Date(t);
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return t;
  }

  function toISO(t) {
    return new Date(t).toISOString().slice(0, 10);
  }

  function addDays(iso, n) {
    const t = parseISO(iso);
    return t == null ? null : toISO(t + n * DAY_MS);
  }

  /** Whole days from a to b (b - a). */
  function daysBetween(a, b) {
    return Math.round((parseISO(b) - parseISO(a)) / DAY_MS);
  }

  /** Today's date in the user's local time zone. */
  function todayISO(now) {
    const d = now || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /** Every ISO date from `from` to `to`, inclusive. */
  function eachDay(from, to) {
    const out = [];
    if (parseISO(from) == null || parseISO(to) == null || from > to) return out;
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
    return out;
  }

  /* ---------- Small helpers ---------- */

  function isNumeric(v) {
    return v !== null && v !== undefined && String(v).trim() !== '' && Number.isFinite(Number(v));
  }

  /** File extension in lower case, e.g. "Episode 12.MP3" -> "mp3". */
  function getFormat(fileName) {
    const m = /\.([a-z0-9]{1,5})$/i.exec(String(fileName || '').trim());
    return m ? m[1].toLowerCase() : '';
  }

  /* ---------- Episode validation (US-01, US-02) ---------- */

  /**
   * @param {{title, description, audioFileName, durationSec, releaseDate}} f
   * @returns {{valid: boolean, errors: Object<string,string>}}
   */
  function validateEpisode(f) {
    const errors = {};
    const title = String(f.title || '').trim();
    const description = String(f.description || '').trim();
    const file = String(f.audioFileName || '').trim();

    if (!title) errors.title = 'Add a title to save this episode.';
    else if (title.length > 120) errors.title = 'Keep the title to 120 characters or fewer.';

    if (!description) errors.description = 'Add a short description so listeners know what the episode is about.';
    else if (description.length > 1000) errors.description = 'Keep the description to 1,000 characters or fewer.';

    if (!file) errors.audioFileName = 'Add the audio file name, for example episode-12.mp3.';
    else if (!getFormat(file)) errors.audioFileName = 'Include the file extension, for example .mp3, .m4a or .mp4.';
    else if (/[\\/:*?"<>|]/.test(file)) errors.audioFileName = 'Remove these characters from the file name: \\ / : * ? " < > |';

    const dur = Number(f.durationSec);
    if (!isNumeric(f.durationSec) || !(dur > 0)) errors.durationSec = 'Add a duration greater than 0 seconds to save this episode.';
    else if (dur > MAX_DURATION_SEC) errors.durationSec = 'Keep the duration under 6 hours.';

    if (!f.releaseDate) errors.releaseDate = 'Choose a release date.';
    else if (parseISO(f.releaseDate) == null) errors.releaseDate = 'Enter a valid release date.';

    return { valid: Object.keys(errors).length === 0, errors };
  }

  /** True when an episode is missing the audio details needed for review. */
  function hasMissingAudioDetails(ep) {
    return !String(ep.audioFileName || '').trim() || !(Number(ep.durationSec) > 0);
  }

  /* ---------- Quality checker (US-03) ---------- */

  /**
   * Checks loudness, bitrate and format against QUALITY_RULES.
   * @returns {{checks: Array, allPass: boolean, failed: Array}}
   */
  function checkQuality(input) {
    const r = QUALITY_RULES;
    const hasL = isNumeric(input.loudnessLufs);
    const hasB = isNumeric(input.bitrateKbps);
    const L = Number(input.loudnessLufs);
    const B = Number(input.bitrateKbps);
    const fmt = getFormat(input.audioFileName);

    const diff = hasL ? Math.round(Math.abs(L - r.targetLufs) * 100) / 100 : null;
    const loudPass = hasL && diff <= r.toleranceLufs;
    const loudness = {
      id: 'loudness',
      label: 'Loudness within ±' + r.toleranceLufs + ' LUFS of ' + r.targetLufs + ' LUFS',
      value: hasL ? L + ' LUFS' : 'Not entered',
      entered: hasL,
      pass: loudPass,
      detail: !hasL ? 'Enter the integrated loudness.'
        : loudPass ? (diff === 0 ? 'Exactly on target.' : diff + ' LUFS from target.')
          : L < r.targetLufs ? 'Too quiet by ' + Math.round((diff - r.toleranceLufs) * 100) / 100 + ' LUFS beyond the allowed range.'
            : 'Too loud by ' + Math.round((diff - r.toleranceLufs) * 100) / 100 + ' LUFS beyond the allowed range.'
    };

    const ratePass = hasB && B >= r.minBitrateKbps;
    const bitrate = {
      id: 'bitrate',
      label: 'Bitrate at least ' + r.minBitrateKbps + ' kbps',
      value: hasB ? B + ' kbps' : 'Not entered',
      entered: hasB,
      pass: ratePass,
      detail: !hasB ? 'Enter the bitrate.' : ratePass ? 'Meets the minimum.' : (r.minBitrateKbps - B) + ' kbps below the minimum.'
    };

    const fmtPass = r.allowedFormats.indexOf(fmt) !== -1;
    const format = {
      id: 'format',
      label: 'Format is mp3, m4a or mp4',
      value: fmt ? '.' + fmt : 'Unknown',
      entered: !!fmt,
      pass: fmtPass,
      detail: !fmt ? 'No file extension found in the file name.' : fmtPass ? 'Accepted format.' : '.' + fmt + ' is not accepted. Export as mp3, m4a or mp4.'
    };

    const checks = [loudness, bitrate, format];
    return { checks, allPass: checks.every(c => c.pass), failed: checks.filter(c => !c.pass) };
  }

  /* ---------- Publish rule (US-05) ---------- */

  /**
   * @returns {{ok: boolean, code?: string, reason?: string}}
   */
  function canPublish(ep, role) {
    if (!ep) return { ok: false, code: 'missing', reason: 'This episode could not be found.' };
    if (role !== 'podcaster') {
      return { ok: false, code: 'role', reason: 'Publishing is not available in the Audio Engineer view. Switch to the Podcaster view to publish.' };
    }
    if (ep.status === 'Published') return { ok: false, code: 'published', reason: 'This episode is already published.' };
    if (ep.qcStatus !== 'Passed') {
      return {
        ok: false,
        code: 'qc',
        reason: 'This episode needs a Passed quality check before it can be published.' +
          (ep.qcStatus === 'Needs fixes' ? ' The audio engineer asked for fixes. Read the note, update the audio and send it for review again.' : '')
      };
    }
    if (!validateEpisode(ep).valid) {
      return { ok: false, code: 'invalid', reason: 'Some required details are missing or invalid. Edit the episode to fix them before publishing.' };
    }
    return { ok: true };
  }

  /* ---------- Analytics calculator (US-07, US-08) ---------- */

  function statsInRange(stats, from, to, episodeIds) {
    const set = episodeIds ? new Set(episodeIds) : null;
    return stats.filter(s => s.date >= from && s.date <= to && (!set || set.has(s.episodeId)));
  }

  /**
   * Totals and averages for a list of ListenStat rows.
   * - plays: sum of plays
   * - uniqueListeners: sum of daily unique listeners
   * - avgListenSec: average listening time weighted by plays
   * - completionRate: play-weighted mean of (avgListenSec / episode duration), each capped at 1
   */
  function summarize(stats, episodesById) {
    let plays = 0, uniq = 0, listenTotal = 0, compSum = 0, compPlays = 0;
    for (const s of stats) {
      const p = Number(s.plays) || 0;
      const a = Number(s.avgListenSec) || 0;
      plays += p;
      uniq += Number(s.uniqueListeners) || 0;
      listenTotal += p * a;
      const ep = episodesById && episodesById[s.episodeId];
      if (ep && Number(ep.durationSec) > 0) {
        compSum += p * Math.min(1, a / Number(ep.durationSec));
        compPlays += p;
      }
    }
    return {
      plays,
      uniqueListeners: uniq,
      avgListenSec: plays ? listenTotal / plays : 0,
      completionRate: compPlays ? compSum / compPlays : 0,
      listenSecTotal: listenTotal
    };
  }

  /** growth % = (current − previous) / previous × 100. Null when there is no previous data. */
  function growthPct(current, previous) {
    if (!previous) return null;
    return (current - previous) / previous * 100;
  }

  /** The period of the same length immediately before [from, to]. */
  function previousPeriod(from, to) {
    const len = daysBetween(from, to) + 1;
    return { from: addDays(from, -len), to: addDays(from, -1) };
  }

  /** Plays per day for every day in the range, including days with 0 plays. */
  function playsPerDay(stats, from, to) {
    const map = {};
    for (const s of stats) map[s.date] = (map[s.date] || 0) + (Number(s.plays) || 0);
    return eachDay(from, to).map(d => ({ date: d, plays: map[d] || 0 }));
  }

  /** Trailing moving average. Early points use the values available so far. */
  function movingAverage(values, windowSize) {
    const w = windowSize || 7;
    return values.map((_, i) => {
      const start = Math.max(0, i - w + 1);
      const slice = values.slice(start, i + 1);
      return slice.reduce((a, b) => a + b, 0) / slice.length;
    });
  }

  /**
   * 7-day moving average for each day in [from, to], using the full 7-day window
   * (days before `from` are included so the first point is not partial).
   */
  function movingAverageForRange(stats, from, to, windowSize) {
    const w = windowSize || 7;
    const ext = playsPerDay(stats, addDays(from, -(w - 1)), to);
    return movingAverage(ext.map(d => d.plays), w).slice(w - 1);
  }

  /** Per-episode metrics ranked by plays (highest first). */
  function topEpisodes(stats, episodes, limit) {
    const byId = {};
    episodes.forEach(e => { byId[e.episodeId] = e; });
    const groups = {};
    stats.forEach(s => { (groups[s.episodeId] = groups[s.episodeId] || []).push(s); });
    const rows = Object.keys(groups)
      .filter(id => byId[id])
      .map(id => Object.assign({ episode: byId[id] }, summarize(groups[id], byId)))
      .filter(r => r.plays > 0)
      .sort((a, b) => b.plays - a.plays || a.episode.title.localeCompare(b.episode.title))
      .map((r, i) => Object.assign(r, { rank: i + 1 }));
    return limit ? rows.slice(0, limit) : rows;
  }

  /** Mean of per-episode metrics across the given episode rows (from topEpisodes). */
  function averageOfEpisodes(rows) {
    const n = rows.length;
    if (!n) return { plays: 0, uniqueListeners: 0, avgListenSec: 0, completionRate: 0, count: 0 };
    const sum = k => rows.reduce((a, r) => a + r[k], 0);
    return {
      plays: sum('plays') / n,
      uniqueListeners: sum('uniqueListeners') / n,
      avgListenSec: sum('avgListenSec') / n,
      completionRate: sum('completionRate') / n,
      count: n
    };
  }

  /** % difference of value vs average. Null when the average is 0. */
  function pctDiff(value, avg) {
    if (!avg) return null;
    return (value - avg) / avg * 100;
  }

  /** Groups ranked episode rows by length to show which lengths keep listeners. */
  function lengthBuckets(rows) {
    const buckets = [
      { label: 'Under 25 min', min: 0, max: 1500 },
      { label: '25–40 min', min: 1500, max: 2400 },
      { label: 'Over 40 min', min: 2400, max: Infinity }
    ];
    return buckets.map(b => {
      const inB = rows.filter(r => r.episode.durationSec >= b.min && r.episode.durationSec < b.max);
      const avg = averageOfEpisodes(inB);
      return { label: b.label, episodes: inB.length, avgPlays: avg.plays, avgCompletion: avg.completionRate };
    });
  }

  /* ---------- CSV ---------- */

  function csvCell(v) {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /** @param {Array<{label, value: function}>} columns */
  function toCSV(rows, columns) {
    const head = columns.map(c => csvCell(c.label)).join(',');
    const body = rows.map(r => columns.map(c => csvCell(c.value(r))).join(','));
    return [head].concat(body).join('\r\n');
  }

  /* ---------- File upload (mp3 / m4a / mp4 and other audio) ---------- */

  const UPLOAD_RULES = Object.freeze({
    maxBytes: 300 * 1024 * 1024,
    mediaExtensions: Object.freeze(['mp3', 'm4a', 'mp4', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'webm', 'mov', 'm4v'])
  });

  function formatBytes(bytes) {
    const b = Number(bytes) || 0;
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
    return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  /**
   * Checks a chosen file before it is read.
   * @param {{name:string, size:number, type:string}} f
   * @returns {{ok:boolean, error?:string, warning?:string, format:string}}
   */
  function validateUpload(f) {
    const name = String(f && f.name || '');
    const type = String(f && f.type || '').toLowerCase();
    const size = Number(f && f.size) || 0;
    const format = getFormat(name);
    const isMedia = /^(audio|video)\//.test(type) || UPLOAD_RULES.mediaExtensions.indexOf(format) !== -1;
    if (!name) return { ok: false, format, error: 'Choose a file to upload.' };
    if (!isMedia) return { ok: false, format, error: '"' + name + '" is not an audio or video file. Choose an mp3, m4a or mp4 file.' };
    if (size === 0) return { ok: false, format, error: 'This file is empty (0 bytes). Export the episode again and choose the new file.' };
    if (size > UPLOAD_RULES.maxBytes) {
      return { ok: false, format, error: 'This file is ' + formatBytes(size) + '. The limit is ' + formatBytes(UPLOAD_RULES.maxBytes) + ' in this demo. Export a smaller file and try again.' };
    }
    const allowed = QUALITY_RULES.allowedFormats.indexOf(format) !== -1;
    return {
      ok: true,
      format,
      warning: allowed ? '' : (format ? '.' + format : 'A file without an extension') + ' will fail the format check. Export as mp3, m4a or mp4 before sending it for review.'
    };
  }

  /** Average bitrate in kbps from file size and duration. */
  function estimateBitrateKbps(bytes, durationSec) {
    const b = Number(bytes), d = Number(durationSec);
    if (!(b > 0) || !(d > 0) || !isFinite(d)) return null;
    return Math.round(b * 8 / d / 1000);
  }

  /* ---------- Loudness (ITU-R BS.1770 integrated loudness, LUFS) ---------- */

  /** K-weighting filter coefficients for any sample rate (two biquads). */
  function kWeightingCoeffs(fs) {
    let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
    let K = Math.tan(Math.PI * f0 / fs);
    const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
    let a0 = 1 + K / Q + K * K;
    const pre = {
      b: [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0],
      a: [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0]
    };
    f0 = 38.13547087602444; Q = 0.5003270373238773;
    K = Math.tan(Math.PI * f0 / fs);
    a0 = 1 + K / Q + K * K;
    const rlb = { b: [1, -2, 1], a: [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0] };
    return { pre, rlb };
  }

  /**
   * Integrated loudness of PCM channels (Float32Array, -1..1) with absolute (-70 LUFS)
   * and relative (-10 LU) gating, 400 ms blocks with 75% overlap. Also returns the
   * sample peak in dBFS and `buckets` peak values for a waveform.
   * @returns {{lufs:number|null, peakDb:number, peaks:number[]}}  lufs is null for clips under 0.4 s, -Infinity for silence.
   */
  function measureLoudness(channels, fs, buckets) {
    const n = channels.length ? channels[0].length : 0;
    const seg = Math.round(0.1 * fs);
    const nSeg = Math.floor(n / seg);
    const energy = new Float64Array(Math.max(nSeg, 1));
    const nb = buckets || 160;
    const peaks = new Array(nb).fill(0);
    const per = Math.max(1, Math.ceil(n / nb));
    const { pre, rlb } = kWeightingCoeffs(fs);
    let peak = 0;
    channels.forEach((x, ci) => {
      let px1 = 0, px2 = 0, py1 = 0, py2 = 0, rx1 = 0, rx2 = 0, ry1 = 0, ry2 = 0;
      for (let i = 0; i < n; i++) {
        const xi = x[i];
        const ax = xi < 0 ? -xi : xi;
        if (ax > peak) peak = ax;
        if (ci === 0) { const bi = (i / per) | 0; if (ax > peaks[bi]) peaks[bi] = ax; }
        const y = pre.b[0] * xi + pre.b[1] * px1 + pre.b[2] * px2 - pre.a[0] * py1 - pre.a[1] * py2;
        px2 = px1; px1 = xi; py2 = py1; py1 = y;
        const z = rlb.b[0] * y + rlb.b[1] * rx1 + rlb.b[2] * rx2 - rlb.a[0] * ry1 - rlb.a[1] * ry2;
        rx2 = rx1; rx1 = y; ry2 = ry1; ry1 = z;
        const s = (i / seg) | 0;
        if (s < nSeg) energy[s] += z * z;
      }
    });
    const peakDb = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
    const maxPeak = Math.max.apply(null, peaks.concat([1e-9]));
    const norm = peaks.map(p => Math.round(p / maxPeak * 1000) / 1000);
    if (nSeg < 4) return { lufs: null, peakDb, peaks: norm };
    const blocks = [];
    for (let j = 0; j + 3 < nSeg; j++) blocks.push((energy[j] + energy[j + 1] + energy[j + 2] + energy[j + 3]) / (4 * seg));
    const L = z => -0.691 + 10 * Math.log10(z);
    const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
    const abs = blocks.filter(z => z > 0 && L(z) > -70);
    if (!abs.length) return { lufs: -Infinity, peakDb, peaks: norm };
    const rel = L(mean(abs)) - 10;
    const gated = abs.filter(z => L(z) > rel);
    return { lufs: L(mean(gated)), peakDb, peaks: norm };
  }

  /* ---------- Sign-in (client-side demo) ---------- */

  const SHA_K = [], SHA_H = [];
  (function () {
    const frac = x => ((x - Math.floor(x)) * 0x100000000) >>> 0;
    for (let n = 2, found = 0; found < 64; n++) {
      let prime = true;
      for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
      if (!prime) continue;
      if (found < 8) SHA_H.push(frac(Math.sqrt(n)) | 0);
      SHA_K.push(frac(Math.cbrt(n)) | 0);
      found++;
    }
  })();

  /** SHA-256 of a UTF-8 string, as lower-case hex (works without crypto.subtle). */
  function sha256Hex(str) {
    const ror = (x, r) => (x >>> r) | (x << (32 - r));
    let bytes;
    if (typeof TextEncoder !== 'undefined') bytes = Array.from(new TextEncoder().encode(String(str)));
    else { const u = unescape(encodeURIComponent(String(str))); bytes = []; for (let i = 0; i < u.length; i++) bytes.push(u.charCodeAt(i)); }
    const bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    const hi = Math.floor(bitLen / 0x100000000), lo = bitLen >>> 0;
    for (let i = 3; i >= 0; i--) bytes.push((hi >>> (i * 8)) & 255);
    for (let i = 3; i >= 0; i--) bytes.push((lo >>> (i * 8)) & 255);
    const H = SHA_H.slice();
    const W = new Array(64);
    for (let off = 0; off < bytes.length; off += 64) {
      for (let i = 0; i < 16; i++) W[i] = (bytes[off + 4 * i] << 24) | (bytes[off + 4 * i + 1] << 16) | (bytes[off + 4 * i + 2] << 8) | bytes[off + 4 * i + 3];
      for (let i = 16; i < 64; i++) {
        const s0 = ror(W[i - 15], 7) ^ ror(W[i - 15], 18) ^ (W[i - 15] >>> 3);
        const s1 = ror(W[i - 2], 17) ^ ror(W[i - 2], 19) ^ (W[i - 2] >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
      }
      let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + SHA_K[i] + W[i]) | 0;
        const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function validateLogin(f) {
    const errors = {};
    const email = String(f.email || '').trim();
    if (!email) errors.email = 'Enter your email address.';
    else if (!EMAIL_RE.test(email)) errors.email = 'Enter a valid email address, for example you@studio.com.';
    if (!f.password) errors.password = 'Enter your password.';
    return { valid: !Object.keys(errors).length, errors };
  }

  /** @param {string[]} existingEmails lower-case emails already registered */
  function validateSignup(f, existingEmails) {
    const errors = {};
    const name = String(f.name || '').trim();
    const email = String(f.email || '').trim().toLowerCase();
    const pw = String(f.password || '');
    if (!name) errors.name = 'Add your name.';
    else if (name.length > 60) errors.name = 'Keep your name to 60 characters or fewer.';
    if (!email) errors.email = 'Enter your email address.';
    else if (!EMAIL_RE.test(email)) errors.email = 'Enter a valid email address, for example you@studio.com.';
    else if ((existingEmails || []).indexOf(email) !== -1) errors.email = 'An account with this email already exists. Sign in instead.';
    if (f.role !== 'podcaster' && f.role !== 'engineer') errors.role = 'Choose a role.';
    if (pw.length < 8) errors.password = 'Use at least 8 characters.';
    else if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) errors.password = 'Use at least one letter and one number.';
    if (!errors.password && f.confirm !== pw) errors.confirm = 'The passwords do not match.';
    return { valid: !Object.keys(errors).length, errors };
  }

  /** 0–4 score with a label, for the password strength meter. */
  function passwordStrength(pw) {
    pw = String(pw || '');
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
    if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
    if (pw.length < 8) score = Math.min(score, 1);
    return { score, label: ['Too short', 'Weak', 'Fair', 'Good', 'Strong'][score] };
  }

  const api = {
    UPLOAD_RULES, formatBytes, validateUpload, estimateBitrateKbps, kWeightingCoeffs, measureLoudness,
    sha256Hex, validateLogin, validateSignup, passwordStrength,
    QUALITY_RULES, parseISO, toISO, addDays, daysBetween, todayISO, eachDay,
    isNumeric, getFormat, validateEpisode, hasMissingAudioDetails, checkQuality, canPublish,
    statsInRange, summarize, growthPct, previousPeriod, playsPerDay, movingAverage,
    movingAverageForRange, topEpisodes, averageOfEpisodes, pctDiff, lengthBuckets, toCSV, csvCell
  };

  root.PSRules = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
