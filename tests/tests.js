/*
 * PodcastStudio — rule tests with hand-calculated expected values.
 * Browser: open tests/index.html.  Node: node tests/tests.js
 */
(function (root) {
  'use strict';
  const R = root.PSRules || (typeof require === 'function' ? require('../js/rules.js') : null);
  const results = [];
  const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-6);
  function test(group, name, fn) {
    try {
      const ok = fn();
      results.push({ group, name, pass: ok === true, detail: ok === true ? '' : String(ok) });
    } catch (e) {
      results.push({ group, name, pass: false, detail: e.message });
    }
  }
  const eq = (actual, expected) => (actual === expected ? true : 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  const approx = (actual, expected, eps) => (near(actual, expected, eps) ? true : 'expected ≈' + expected + ', got ' + actual);

  /* ---------- Quality rule ---------- */
  const qc = (L, B, f) => R.checkQuality({ loudnessLufs: L, bitrateKbps: B, audioFileName: f });
  test('Quality', '−16.5 LUFS, 128 kbps, mp3 → pass', () => eq(qc(-16.5, 128, 'a.mp3').allPass, true));
  test('Quality', '−15 LUFS (upper edge) passes', () => eq(qc(-15, 192, 'a.mp3').checks[0].pass, true));
  test('Quality', '−17 LUFS (lower edge) passes', () => eq(qc(-17, 192, 'a.mp3').checks[0].pass, true));
  test('Quality', '−17.2 LUFS fails loudness', () => eq(qc(-17.2, 192, 'a.mp3').checks[0].pass, false));
  test('Quality', '−14.9 LUFS fails loudness', () => eq(qc(-14.9, 192, 'a.mp3').checks[0].pass, false));
  test('Quality', '127 kbps fails bitrate', () => eq(qc(-16, 127, 'a.mp3').checks[1].pass, false));
  test('Quality', '.m4a passes format (case-insensitive)', () => eq(qc(-16, 192, 'Show.M4A').checks[2].pass, true));
  test('Quality', '.wav fails format', () => eq(qc(-16, 192, 'a.wav').checks[2].pass, false));
  test('Quality', 'missing values fail', () => eq(qc('', '', 'a.mp3').allPass, false));
  test('Quality', 'failed list names the failing checks', () => eq(qc(-19, 96, 'a.wav').failed.map(c => c.id).join(','), 'loudness,bitrate,format'));

  /* ---------- Validation ---------- */
  const good = { title: 'Ep', description: 'About', audioFileName: 'ep.mp3', durationSec: 60, releaseDate: '2026-11-20' };
  test('Validation', 'valid episode passes', () => eq(R.validateEpisode(good).valid, true));
  test('Validation', 'duration 0 is rejected with PRD message', () => eq(R.validateEpisode(Object.assign({}, good, { durationSec: 0 })).errors.durationSec, 'Add a duration greater than 0 seconds to save this episode.'));
  test('Validation', 'missing title is rejected', () => eq(!!R.validateEpisode(Object.assign({}, good, { title: '  ' })).errors.title, true));
  test('Validation', 'file without extension is rejected', () => eq(!!R.validateEpisode(Object.assign({}, good, { audioFileName: 'episode' })).errors.audioFileName, true));
  test('Validation', 'invalid date is rejected', () => eq(!!R.validateEpisode(Object.assign({}, good, { releaseDate: '2026-02-30' })).errors.releaseDate, true));

  /* ---------- Publish rule ---------- */
  const approved = Object.assign({}, good, { status: 'Approved', qcStatus: 'Passed' });
  test('Publish', 'podcaster can publish a Passed episode', () => eq(R.canPublish(approved, 'podcaster').ok, true));
  test('Publish', 'audio engineer cannot publish', () => eq(R.canPublish(approved, 'engineer').code, 'role'));
  test('Publish', 'Needs fixes blocks publishing', () => eq(R.canPublish(Object.assign({}, approved, { qcStatus: 'Needs fixes' }), 'podcaster').code, 'qc'));
  test('Publish', 'Awaiting review blocks publishing', () => eq(R.canPublish(Object.assign({}, approved, { qcStatus: 'Awaiting review' }), 'podcaster').ok, false));
  test('Publish', 'invalid fields block publishing', () => eq(R.canPublish(Object.assign({}, approved, { durationSec: 0 }), 'podcaster').code, 'invalid'));
  test('Publish', 'already published cannot be published again', () => eq(R.canPublish(Object.assign({}, approved, { status: 'Published' }), 'podcaster').code, 'published'));

  /* ---------- Analytics (hand-calculated) ----------
     Episode A: 1000 s.  Day 1: 10 plays, 8 unique, avg 500 s.  Day 2: 30 plays, 20 unique, avg 700 s.
     Episode B: 2000 s.  Day 1: 20 plays, 15 unique, avg 1000 s.
     Total plays        = 10 + 30 + 20                    = 60
     Unique listeners   = 8 + 20 + 15                     = 43
     Avg listening time = (10·500 + 30·700 + 20·1000) / 60 = 46000 / 60 = 766.67 s
     Completion         = (10·0.5 + 30·0.7 + 20·0.5) / 60  = 36 / 60   = 0.60
  */
  const eps = { A: { episodeId: 'A', title: 'A', durationSec: 1000 }, B: { episodeId: 'B', title: 'B', durationSec: 2000 } };
  const stats = [
    { episodeId: 'A', date: '2026-11-01', plays: 10, uniqueListeners: 8, avgListenSec: 500 },
    { episodeId: 'A', date: '2026-11-02', plays: 30, uniqueListeners: 20, avgListenSec: 700 },
    { episodeId: 'B', date: '2026-11-01', plays: 20, uniqueListeners: 15, avgListenSec: 1000 }
  ];
  const s = R.summarize(stats, eps);
  test('Analytics', 'total plays = 60', () => eq(s.plays, 60));
  test('Analytics', 'unique listeners = 43', () => eq(s.uniqueListeners, 43));
  test('Analytics', 'avg listening time (play-weighted) = 766.67 s', () => approx(s.avgListenSec, 766.6667, 0.001));
  test('Analytics', 'completion rate = 60%', () => approx(s.completionRate, 0.6));
  test('Analytics', 'single episode completion = avg listen / duration (A: 650/1000)', () => approx(R.summarize(stats.filter(x => x.episodeId === 'A'), eps).completionRate, 0.65));
  test('Analytics', 'empty stats → zeros, no NaN', () => { const z = R.summarize([], eps); return eq(z.avgListenSec + z.completionRate + z.plays, 0); });
  test('Analytics', 'growth (120 vs 100) = +20%', () => approx(R.growthPct(120, 100), 20));
  test('Analytics', 'growth (75 vs 100) = −25%', () => approx(R.growthPct(75, 100), -25));
  test('Analytics', 'growth with no previous data = null', () => eq(R.growthPct(50, 0), null));
  test('Analytics', 'previous period of Nov 8–14 is Nov 1–7', () => { const p = R.previousPeriod('2026-11-08', '2026-11-14'); return eq(p.from + '/' + p.to, '2026-11-01/2026-11-07'); });
  test('Analytics', 'plays per day fills missing days with 0', () => eq(R.playsPerDay(stats, '2026-11-01', '2026-11-03').map(d => d.plays).join(','), '30,30,0'));
  test('Analytics', '7-day moving average of [7×6, 14] = 8', () => approx(R.movingAverage([7, 7, 7, 7, 7, 7, 14], 7)[6], 8));
  test('Analytics', 'moving average uses available values early on ([2,4] → 3)', () => approx(R.movingAverage([2, 4], 7)[1], 3));
  test('Analytics', 'moving average for range uses the 6 days before the range', () => {
    const st = [];
    for (let i = 1; i <= 7; i++) st.push({ episodeId: 'A', date: '2026-11-0' + i, plays: i });
    return approx(R.movingAverageForRange(st, '2026-11-07', '2026-11-07', 7)[0], 4); // (1+…+7)/7
  });
  test('Analytics', 'top episodes ranked by plays (A=40, B=20)', () => eq(R.topEpisodes(stats, Object.values(eps)).map(r => r.episode.episodeId + ':' + r.plays).join(','), 'A:40,B:20'));
  test('Analytics', 'show average of A and B plays = 30', () => approx(R.averageOfEpisodes(R.topEpisodes(stats, Object.values(eps))).plays, 30));
  test('Analytics', '% vs average (40 vs 30) = +33.3%', () => approx(R.pctDiff(40, 30), 33.333, 0.01));

  /* ---------- CSV ---------- */
  test('CSV', 'quotes commas and quotes', () => eq(R.toCSV([{ a: 'x, "y"' }], [{ label: 'A', value: r => r.a }]), 'A\r\n"x, ""y"""'));

  /* ---------- mp4 + upload ---------- */
  test('Upload', '.mp4 passes the format check', () => eq(qc(-16, 192, 'episode.mp4').checks[2].pass, true));
  test('Upload', 'mp3 upload is accepted with no warning', () => { const v = R.validateUpload({ name: 'ep.mp3', size: 5e6, type: 'audio/mpeg' }); return eq(v.ok && !v.warning, true); });
  test('Upload', 'mp4 video upload is accepted', () => eq(R.validateUpload({ name: 'ep.mp4', size: 5e6, type: 'video/mp4' }).ok, true));
  test('Upload', 'wav upload is accepted but warns about the format check', () => { const v = R.validateUpload({ name: 'ep.wav', size: 5e6, type: 'audio/wav' }); return eq(v.ok && /fail the format check/.test(v.warning), true); });
  test('Upload', 'a PDF is rejected', () => eq(R.validateUpload({ name: 'notes.pdf', size: 1000, type: 'application/pdf' }).ok, false));
  test('Upload', 'an empty file is rejected', () => eq(/empty/.test(R.validateUpload({ name: 'ep.mp3', size: 0, type: 'audio/mpeg' }).error), true));
  test('Upload', 'a file over 300 MB is rejected', () => eq(R.validateUpload({ name: 'ep.mp3', size: 301 * 1024 * 1024, type: 'audio/mpeg' }).ok, false));
  test('Upload', 'bitrate estimate: 24,000,000 bytes over 1000 s = 192 kbps', () => eq(R.estimateBitrateKbps(24e6, 1000), 192));
  test('Upload', 'bitrate estimate with no duration = null', () => eq(R.estimateBitrateKbps(24e6, 0), null));

  /* ---------- Loudness (BS.1770): a 0 dBFS 997 Hz sine on one channel reads −3.01 LUFS ---------- */
  const sine = (fs, sec, amp) => { const x = new Float32Array(fs * sec); for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin(2 * Math.PI * 997 * i / fs); return x; };
  test('Loudness', '0 dBFS 997 Hz sine @48 kHz = −3.01 LUFS', () => approx(R.measureLoudness([sine(48000, 3, 1)], 48000).lufs, -3.01, 0.05));
  test('Loudness', '−20 dBFS sine @48 kHz = −23.01 LUFS', () => approx(R.measureLoudness([sine(48000, 3, 0.1)], 48000).lufs, -23.01, 0.05));
  test('Loudness', 'same sine @24 kHz (coefficients adapt) = −3.01 LUFS', () => approx(R.measureLoudness([sine(24000, 3, 1)], 24000).lufs, -3.01, 0.1));
  test('Loudness', 'stereo (same signal both sides) is +3 dB = 0.00 LUFS', () => { const x = sine(48000, 3, 1); return approx(R.measureLoudness([x, x], 48000).lufs, 0, 0.05); });
  test('Loudness', 'sample peak of a full-scale sine ≈ 0 dBFS', () => approx(R.measureLoudness([sine(48000, 1, 1)], 48000).peakDb, 0, 0.01));
  test('Loudness', 'silence = −Infinity', () => eq(R.measureLoudness([new Float32Array(48000)], 48000).lufs, -Infinity));
  test('Loudness', 'clip shorter than 0.4 s = null', () => eq(R.measureLoudness([sine(48000, 0.3, 1)], 48000).lufs, null));

  /* ---------- Sign-in ---------- */
  test('Sign-in', 'SHA-256("abc") matches the standard test vector', () => eq(R.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'));
  test('Sign-in', 'SHA-256("") matches the standard test vector', () => eq(R.sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'));
  test('Sign-in', 'SHA-256 of a 56-byte message (two blocks)', () => eq(R.sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'));
  const su = { name: 'Ana', email: 'ana@studio.com', role: 'podcaster', password: 'Studio2026', confirm: 'Studio2026' };
  test('Sign-in', 'valid sign-up passes', () => eq(R.validateSignup(su, []).valid, true));
  test('Sign-in', 'duplicate email is rejected', () => eq(!!R.validateSignup(su, ['ana@studio.com']).errors.email, true));
  test('Sign-in', 'password without a number is rejected', () => eq(!!R.validateSignup(Object.assign({}, su, { password: 'Studiostudio', confirm: 'Studiostudio' }), []).errors.password, true));
  test('Sign-in', 'mismatched confirmation is rejected', () => eq(R.validateSignup(Object.assign({}, su, { confirm: 'Studio2027' }), []).errors.confirm, 'The passwords do not match.'));
  test('Sign-in', 'login needs a valid email', () => eq(!!R.validateLogin({ email: 'ana@', password: 'x' }).errors.email, true));
  test('Sign-in', 'password strength: "Studio-2026-Mix" is Strong', () => eq(R.passwordStrength('Studio-2026-Mix').label, 'Strong'));

  /* ---------- Dates ---------- */
  test('Dates', 'addDays crosses month end', () => eq(R.addDays('2026-11-30', 1), '2026-12-01'));
  test('Dates', 'daysBetween', () => eq(R.daysBetween('2026-11-01', '2026-11-15'), 14));

  const api = { results, passed: results.filter(r => r.pass).length, failed: results.filter(r => !r.pass).length };
  root.PSTestResults = api;

  if (typeof module === 'object' && module.exports && typeof window === 'undefined') {
    results.forEach(r => console.log((r.pass ? 'PASS ' : 'FAIL ') + r.group + ' · ' + r.name + (r.detail ? ' — ' + r.detail : '')));
    console.log('\n' + api.passed + ' passed, ' + api.failed + ' failed');
    if (api.failed) process.exitCode = 1;
  }
})(typeof window !== 'undefined' ? window : globalThis);
