/*
 * PodcastStudio — media.js
 * Uploaded audio/video files are kept in this browser's IndexedDB (never sent to a server),
 * plus helpers to read a file's duration and to measure loudness with the Web Audio API.
 */
(function (root) {
  'use strict';
  const R = root.PSRules;
  const DB_NAME = 'podcaststudio_media';
  const STORE = 'files';
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!root.indexedDB) { reject(new Error('unsupported')); return; }
      let req;
      try { req = root.indexedDB.open(DB_NAME, 1); } catch (e) { reject(e); return; }
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('open failed'));
      req.onblocked = () => reject(new Error('blocked'));
    });
    dbPromise.catch(() => { dbPromise = null; });
    return dbPromise;
  }

  function run(mode, fn) {
    return openDB().then(db => new Promise((resolve, reject) => {
      let t;
      try { t = db.transaction(STORE, mode); } catch (e) { reject(e); return; }
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error || new Error('transaction failed'));
      t.onabort = () => reject(t.error || new Error('transaction aborted'));
    }));
  }

  /** FileStore: one record per episode {blob, name, type, size, savedAt}. */
  const FileStore = {
    put: (episodeId, file) => run('readwrite', s => s.put({ blob: file, name: file.name, type: file.type, size: file.size, savedAt: new Date().toISOString() }, episodeId)),
    get: episodeId => run('readonly', s => s.get(episodeId)),
    remove: episodeId => run('readwrite', s => s.delete(episodeId)),
    clear: () => run('readwrite', s => s.clear())
  };

  /** Friendly message for a storage failure. */
  function storageMessage(err) {
    const n = err && (err.name || err.message) || '';
    if (/Quota/i.test(n)) return 'There is not enough browser storage for this file. Remove older uploads or use a smaller file.';
    if (/unsupported/i.test(n)) return 'This browser cannot store files (it may be in private mode). The episode details can still be saved without the file.';
    return 'The file could not be stored in this browser. Try again, or save the episode without the file.';
  }

  /**
   * Reads duration and whether the file has video.
   * @returns {Promise<{duration:number, hasVideo:boolean, width:number, height:number}>}
   */
  function readMetadata(file) {
    return new Promise((resolve, reject) => {
      const fmt = R.getFormat(file.name);
      const maybeVideo = /^video\//.test(file.type) || ['mp4', 'm4v', 'mov', 'webm'].indexOf(fmt) !== -1;
      const el = document.createElement(maybeVideo ? 'video' : 'audio');
      const url = URL.createObjectURL(file);
      let done = false;
      const finish = (fn, val) => { if (done) return; done = true; clearTimeout(timer); el.removeAttribute('src'); el.load(); URL.revokeObjectURL(url); fn(val); };
      const timer = setTimeout(() => finish(reject, new Error('timeout')), 20000);
      el.preload = 'metadata';
      el.muted = true;
      el.onloadedmetadata = () => {
        const read = () => finish(resolve, { duration: el.duration, hasVideo: !!el.videoWidth, width: el.videoWidth || 0, height: el.videoHeight || 0 });
        if (el.duration === Infinity) {
          // Some VBR files report Infinity until the end is reached.
          el.ondurationchange = () => { if (isFinite(el.duration)) read(); };
          try { el.currentTime = 1e9; } catch (e) { read(); }
        } else read();
      };
      el.onerror = () => finish(reject, new Error('unreadable'));
      el.src = url;
    });
  }

  /**
   * Decodes the audio and measures integrated loudness (LUFS), sample peak and a waveform.
   * Runs at 24 kHz to keep memory use reasonable; files longer than maxSec are refused.
   */
  async function analyzeAudio(blob, opts) {
    const o = Object.assign({ maxSec: 30 * 60, sampleRate: 24000 }, opts || {});
    if (o.durationSec && o.durationSec > o.maxSec) {
      const err = new Error('too-long'); err.code = 'too-long'; throw err;
    }
    const Ctx = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    if (!Ctx) { const err = new Error('no-webaudio'); err.code = 'no-webaudio'; throw err; }
    const data = await blob.arrayBuffer();
    const ctx = new Ctx(2, o.sampleRate, o.sampleRate);
    let buffer;
    try {
      buffer = await new Promise((resolve, reject) => {
        const p = ctx.decodeAudioData(data, resolve, reject);
        if (p && p.then) p.then(resolve, reject);
      });
    } catch (e) {
      const err = new Error('decode'); err.code = 'decode'; throw err;
    }
    const chans = [];
    for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) chans.push(buffer.getChannelData(c));
    await new Promise(r => setTimeout(r, 0));
    const res = R.measureLoudness(chans, buffer.sampleRate, 160);
    return Object.assign(res, { channels: buffer.numberOfChannels, durationSec: buffer.duration });
  }

  function analysisMessage(err) {
    switch (err && err.code) {
      case 'too-long': return 'Loudness can be measured in the browser for files up to 30 minutes. Enter the value from your audio tool instead.';
      case 'no-webaudio': return 'This browser cannot analyse audio. Enter the loudness from your audio tool instead.';
      case 'decode': return 'This browser could not decode the audio in this file. Enter the loudness from your audio tool instead.';
      default: return 'The file could not be measured. Enter the loudness from your audio tool instead.';
    }
  }

  root.PSMedia = { FileStore, storageMessage, readMetadata, analyzeAudio, analysisMessage };
})(window);
