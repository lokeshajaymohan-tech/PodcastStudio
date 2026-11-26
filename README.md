# PodcastStudio

An audio podcast publishing dashboard and episode listener analytics dashboard for **Podcasters** and **Audio Engineers**.
It is a one-month OJT demo (PRD `PST_PD_032`, v0.1).

Podcasters create episodes and publish them once they pass a quality check. Audio engineers review the loudness, bitrate and format of each episode and mark it **Passed** or **Needs fixes**. A listener analytics dashboard shows plays, unique listeners, average listening time and completion rate for every published episode.

> **Demo limitations.** All shows, episodes and listener numbers are **synthetic sample data**, and no real listeners are tracked. Uploaded files stay in your browser (IndexedDB); they are never sent to a server, edited or distributed. Quality checks use simplified rules for learning. **Sign-in and role checks run in the browser and are a demonstration only, not real security.**

## Sign in

Every screen needs a sign-in. Use a demo account or create your own on the **Create account** tab.

| Account | Email | Password |
|---|---|---|
| Podcaster | `podcaster@demo.studio` | `Studio2026` |
| Audio Engineer | `engineer@demo.studio` | `Studio2026` |

Accounts are stored in this browser only. Passwords are never stored: each is saved as a salted SHA-256 hash. After 5 wrong passwords, sign-in pauses for 30 seconds.

## Tech stack

- HTML5, CSS3 (Flexbox, Grid), vanilla JavaScript (DOM, events, forms, localStorage, IndexedDB, Web Audio)
- Bootstrap 5.3 (grid, offcanvas, modals, toasts) and Bootstrap Icons
- Chart.js 4 (stretch goal) for the plays-over-time and top-episodes charts
- No build step and no framework

## Run it

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
```

Then go to http://localhost:8000. Sample data loads on the first visit.

**Deploy:** push the folder to GitHub and turn on GitHub Pages for the branch root, or import it into Vercel as a static site.

## Screens

| Screen | Route | What it does |
|---|---|---|
| Sign in / Create account | `#/login`, `#/signup` | Demo sign-in with validation, password strength meter, show/hide password, lockout after 5 failed tries |
| Home / Role select | `#/home` | Product purpose, Podcaster and Audio Engineer entry points, recent activity, the 30-second tour |
| Publishing dashboard | `#/dashboard` | Status pipeline, upcoming releases, episodes table with search, status and show filters, sorting, CSV export |
| New / Edit episode | `#/episode/new`, `#/episode/:id/edit` | Validated form, drag-and-drop file upload (mp3, m4a, mp4), preview player, loudness pre-check, readiness checklist |
| Episode detail | `#/episode/:id` | Details, player, real waveform, timeline, quality check result, notes, Publish button |
| Review Queue | `#/review/:id` | Queue and history, player, **Measure from file**, live loudness and bitrate meters, quality checklist, Passed / Needs fixes |
| Analytics dashboard | `#/analytics` | KPI cards with growth, date range, plays per day with a 7-day moving average, top episodes, ranking, insights, CSV export |
| Episode analytics | `#/analytics/:id` | One episode compared with the show average |
| About / Help | `#/about` | How checks and analytics are calculated, demo limits, data reset |

### Interactive extras

- **Dark theme.** It follows your system setting the first time; the sun/moon button (or the account menu) switches it and remembers your choice. Light mode keeps the PRD palette exactly.
- **File upload.** Drag and drop or browse for an mp3, m4a or mp4 (audio or video, up to 300 MB). The file name and duration are filled in automatically, and you can play the file back. Each failure gets a clear message: not an audio/video file, an empty file, over 300 MB, a damaged or unplayable file, browser storage full, or storage blocked (private mode).
- **Loudness measuring.** *Pre-check loudness* (Podcaster) and *Measure from file* (Audio Engineer) decode the audio in the browser and measure integrated loudness with ITU-R BS.1770 gating, plus the sample peak and a real waveform. Bitrate is estimated from the file size; for mp4 video it is shown as a total, so the engineer enters the audio bitrate.
- **30-second tour.** A timed walkthrough of the product promise: create, check, publish and measure an episode, with a live stopwatch.
- **Live quality meters.** The loudness marker and bitrate bar move as the engineer types, and checks flip between Pass and Fail.
- **Suggested notes.** Builds a Needs fixes note from the failed checks.
- **Live listen simulation.** Adds sample plays to today and updates the KPIs and charts in real time. It is clearly labelled as sample data.
- **Keyboard shortcuts.** `N` new episode, `/` search, `R` switch role, `G` then `H`/`P`/`Q`/`A` to navigate, `T` tour, `?` help.

## Rules

**Quality rule.** An episode passes the automatic checks when **all** of these are true:

- loudness is within ±1 LUFS of −16 LUFS (−17 to −15 inclusive)
- bitrate is at least 128 kbps
- the file format is `mp3`, `m4a` or `mp4` (taken from the audio file name)

The engineer then records **Passed** (allowed only when all checks pass) or **Needs fixes** (a note is required).

**Publish rule.** An episode can be published only in the Podcaster view, only when its quality check is **Passed**, and only when all required fields are valid.

**Statuses.** `Draft` → (`Awaiting review`) → `Approved` → `Published`. If the result is **Needs fixes**, the episode stays a Draft until it is resent.

## Analytics formulas

```
Total plays        = Σ plays
Unique listeners   = Σ daily unique listeners
Avg listening time = Σ(plays × avgListenSec) / Σ plays          (weighted by plays)
Completion rate    = avg listening time / episode duration       (play-weighted across episodes, capped at 100%)
Growth %           = (current period plays − previous period plays) / previous period plays × 100
7-day moving avg   = mean plays of the day and the 6 days before it
Show average       = mean of per-episode metrics across the show's episodes with plays in the range
```

The previous period is the same number of days immediately before the selected range. The sample data has no listener IDs, so someone who listens on two days is counted on both days.

### Hand-calculated test case

| Episode | Duration | Day | Plays | Unique | Avg listen |
|---|---|---|---|---|---|
| A | 1000 s | 1 | 10 | 8 | 500 s |
| A | 1000 s | 2 | 30 | 20 | 700 s |
| B | 2000 s | 1 | 20 | 15 | 1000 s |

- Total plays = **60**, unique listeners = **43**
- Avg listening time = (5000 + 21000 + 20000) / 60 = **766.67 s**
- Completion = (10·0.5 + 30·0.7 + 20·0.5) / 60 = **60%**
- Growth 100 → 120 = **+20%**; moving average of `[7,7,7,7,7,7,14]` = **8**

**Loudness check:** a 0 dBFS 997 Hz sine on one channel measures **−3.01 LUFS**, as BS.1770 specifies. A stereo tone exported at −16 LUFS as m4a measured **−16.0 LUFS** in the app.

Run all 66 rule tests (quality, publish, analytics, upload, loudness, sign-in) in either place:

- in a browser: `tests/index.html`
- in Node: `node tests/tests.js`

## Data and persistence

Data is stored in `localStorage` under these keys:

| Key | Contents |
|---|---|
| `podcaststudio_shows` | Show: `showId, title, hostName, category` |
| `podcaststudio_episodes` | Episode: `episodeId, showId, title, description, audioFileName, durationSec, status, qcStatus, qcNote, loudnessLufs, bitrateKbps, releaseDate, publishedAt`, plus `createdAt, submittedAt, reviewedAt, reviews[]` |
| `podcaststudio_stats` | ListenStat: `statId, episodeId, date, plays, uniqueListeners, avgListenSec` |
| `podcaststudio_prefs` | Preferences: `role, dateRange, lastScreen, sortOrder, theme` |
| `podcaststudio_users` | Demo accounts: `userId, name, email, role, salt, passwordHash, createdAt` |
| `podcaststudio_session` | Signed-in user (`localStorage` with "Keep me signed in", otherwise `sessionStorage`) |

Uploaded files are kept in the IndexedDB database `podcaststudio_media`, one record per episode. Episodes with a file also store `fileStored, fileSizeBytes, fileType, fileKind, estBitrateKbps` and, if measured, `measuredLufs, peakDb, peaks`. Files exist only in the browser where they were uploaded.

If storage is full or blocked, the app shows an error, keeps the form on screen and does not lose your input. **About & Help** lets you reload sample data or clear episodes and stats.

## Project structure

```
index.html        App shell: sidebar, top bar, modals, tour
css/styles.css    Theme (PRD palette) and components
js/rules.js       Pure functions: validation, quality checker, publish rule, analytics calculator, CSV,
                  upload checks, BS.1770 loudness, SHA-256, sign-up/sign-in validation
js/store.js       LocalDataStore, demo accounts, session, synthetic sample data
js/media.js       IndexedDB file store, media metadata, audio decoding for loudness
js/app.js         Router, sign-in, theme, screens, role switch, forms, upload, review, publishing, analytics, tour
tests/            Rule tests (browser page + Node runner)
```

## Accessibility

- Every input has a visible label, and errors are linked with `aria-describedby`.
- Status badges always include text (Draft, Approved, Published, Needs fixes), never colour alone.
- Charts have a text summary and an expandable data table.
- Toasts and status messages use `aria-live`, and focus is always visible.
- A skip link is provided, and reduced motion is respected.

Palette (light): primary `#6D28D9`, text `#1F2937`, error `#B42318`, warning `#92400E`, success `#166534`, background `#F8FAFC`. Dark mode uses lighter tints of the same colours so text stays readable.

## Team

| Name | GitHub | Role |
|---|---|---|
| Koppuravuri Lokesh Ajay Mohan | [@lokeshajaymohan-tech](https://github.com/lokeshajaymohan-tech) | Student 1 |
| Perumala Jayasurya | [@suryakrishnan627-tech](https://github.com/suryakrishnan627-tech) | Student 2 |
| Madhushri Tangali | — | Mentor / Reviewer |

Live demo: https://lokeshajaymohan-tech.github.io/PodcastStudio/
