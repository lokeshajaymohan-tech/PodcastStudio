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
    allowedFormats: Object.freeze(['mp3', 'm4a'])
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
    else if (!getFormat(file)) errors.audioFileName = 'Include the file extension, for example .mp3 or .m4a.';
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
      label: 'Format is mp3 or m4a',
      value: fmt ? '.' + fmt : 'Unknown',
      entered: !!fmt,
      pass: fmtPass,
      detail: !fmt ? 'No file extension found in the file name.' : fmtPass ? 'Accepted format.' : '.' + fmt + ' is not accepted. Export as mp3 or m4a.'
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

  const api = {
    QUALITY_RULES, parseISO, toISO, addDays, daysBetween, todayISO, eachDay,
    isNumeric, getFormat, validateEpisode, hasMissingAudioDetails, checkQuality, canPublish,
    statsInRange, summarize, growthPct, previousPeriod, playsPerDay, movingAverage,
    movingAverageForRange, topEpisodes, averageOfEpisodes, pctDiff, lengthBuckets, toCSV, csvCell
  };

  root.PSRules = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
