
const express = require('express');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const SAVE_DIR = path.join(__dirname, 'save');

// Split files (no persistent notifications)
const FILE_MAP = {
  
  ads: 'ads.json',users: 'users.json',
  videos: 'videos.json',
  comments: 'comments.json',
  likes: 'likes.json',
  views: 'views.json',
  subs: 'subs.json',
  sponso: 'sponso.json'
  // notifications intentionally omitted (volatile, in-memory)
};
const AUTRES_FILE = 'autres.json';
const LEGACY_STORE_FILE = path.join(SAVE_DIR, 'store.json'); // legacy combined
const LEGACY_VIDEO_FILE = path.join(SAVE_DIR, 'video.json'); // legacy singular file from older version
const LEGACY_NOTIF_FILE = path.join(SAVE_DIR, 'notifications.json'); // legacy notifications file (will be read once if desired)

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static if a public dir exists
const PUBLIC_DIR = path.join(__dirname, 'public');
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
}

// Ensure save dir exists
if (!fs.existsSync(SAVE_DIR)) fs.mkdirSync(SAVE_DIR, { recursive: true });

// ---- Volatile state (not persisted) ----
let volatile = {
  notifications: [] // comment notifications live here only during process lifetime
};

// Helpers
function ensureFile(fp, defaultValue) {
  if (!fs.existsSync(fp)) {
    fs.writeFileSync(fp, JSON.stringify(defaultValue, null, 2));
  }
}

function readJson(fp, fallback) {
  try {
    const raw = fs.readFileSync(fp, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function writeJson(fp, data) {
  fs.writeFileSync(fp, JSON.stringify(data, null, 2));
}

// Initialize split files
for (const [key, fname] of Object.entries(FILE_MAP)) {
  const defaultVal = (key === 'users' || key === 'videos' || key === 'comments' || key === 'ads') ? [] :
                     (key === 'likes' || key === 'views' || key === 'subs') ? {} : null;
  ensureFile(path.join(SAVE_DIR, fname), defaultVal);
}

// ---- Custom helpers for subs timestamps ----
function _mapifySubsEntry(entry){
  // Accept array of channelIds or object mapping chId->ts
  if (Array.isArray(entry)){
    const o = {}; entry.forEach(ch=>{ o[ch] = o[ch] || Date.now(); });
    return o;
  }
  if (entry && typeof entry === 'object') return {...entry};
  return {};
}
function _normalizeSubsForClient(subsRaw){
  const out = {};
  for (const [uid, entry] of Object.entries(subsRaw||{})){
    if (Array.isArray(entry)) out[uid] = entry.slice();
    else if (entry && typeof entry === 'object') out[uid] = Object.keys(entry);
    else out[uid] = [];
  }
  return out;
}
function _buildSubsTimesByChannel(subsRaw){
  // Returns { channelId: { subscriberId: ts } }
  const byCh = {};
  for (const [uid, entry] of Object.entries(subsRaw||{})){
    const mp = _mapifySubsEntry(entry);
    for (const [chId, ts] of Object.entries(mp)){
      byCh[chId] = byCh[chId] || {};
      byCh[chId][uid] = ts;
    }
  }
  return byCh;
}
ensureFile(path.join(SAVE_DIR, AUTRES_FILE), {});

// Migration from legacy sources (one-time, idempotent)
(function migrateIfNeeded() {
  // Migrate from legacy combined store.json if present
  if (fs.existsSync(LEGACY_STORE_FILE)) {
    try {
      const store = readJson(LEGACY_STORE_FILE, {});
      if (store && typeof store === 'object') {
        // videos (accept legacy 'video' singular as well)
        const videos = store.videos ?? store.video ?? readJson(LEGACY_VIDEO_FILE, []);
        if (videos !== undefined) writeJson(path.join(SAVE_DIR, FILE_MAP.videos), videos);

        if (Object.prototype.hasOwnProperty.call(store, 'users')) writeJson(path.join(SAVE_DIR, FILE_MAP.users), store.users);
        if (Object.prototype.hasOwnProperty.call(store, 'comments')) writeJson(path.join(SAVE_DIR, FILE_MAP.comments), store.comments);
        if (Object.prototype.hasOwnProperty.call(store, 'likes')) writeJson(path.join(SAVE_DIR, FILE_MAP.likes), store.likes);
        if (Object.prototype.hasOwnProperty.call(store, 'views')) writeJson(path.join(SAVE_DIR, FILE_MAP.views), store.views);
        if (Object.prototype.hasOwnProperty.call(store, 'subs')) writeJson(path.join(SAVE_DIR, FILE_MAP.subs), store.subs);

        // Migrate notifications only into memory (do NOT save)
        if (Array.isArray(store.notifications)) {
          volatile.notifications = store.notifications;
        } else if (store.notifications && typeof store.notifications === 'object') {
          // allow object format as well
          volatile.notifications = store.notifications;
        }

        // Move the rest into autres.json (except legacy-only keys we've handled)
        const autresPath = path.join(SAVE_DIR, AUTRES_FILE);
        const autres = readJson(autresPath, {});
        for (const [k, v] of Object.entries(store)) {
          if (!Object.prototype.hasOwnProperty.call(FILE_MAP, k) && k !== 'video' && k !== 'notifications') {
            autres[k] = v;
          }
        }
        writeJson(autresPath, autres);

        // Backup legacy file if not already backed up
        const backup = path.join(SAVE_DIR, 'store.legacy.backup.json');
        if (!fs.existsSync(backup)) fs.copyFileSync(LEGACY_STORE_FILE, backup);
      }
    } catch (e) {
      console.warn('Migration error from store.json:', e);
    }
  }

  // If an old singular 'video.json' exists, migrate it into 'videos.json' (no-op if already merged)
  if (fs.existsSync(LEGACY_VIDEO_FILE)) {
    try {
      const legacyVideos = readJson(LEGACY_VIDEO_FILE, []);
      const videosPath = path.join(SAVE_DIR, FILE_MAP.videos);
      const currentVideos = readJson(videosPath, []);
      const merged = Array.isArray(currentVideos) ? currentVideos : [];
      writeJson(videosPath, merged.length ? merged : legacyVideos);
      const backup = path.join(SAVE_DIR, 'video.legacy.backup.json');
      if (!fs.existsSync(backup)) fs.copyFileSync(LEGACY_VIDEO_FILE, backup);
    } catch (e) {
      console.warn('Migration error from video.json:', e);
    }
  }

  // If a legacy notifications.json exists, load it once into memory and keep a backup, but do not persist going forward
  if (fs.existsSync(LEGACY_NOTIF_FILE)) {
    try {
      const legacyNotifs = readJson(LEGACY_NOTIF_FILE, []);
      if (Array.isArray(legacyNotifs) || typeof legacyNotifs === 'object') {
        volatile.notifications = legacyNotifs;
      }
      const backup = path.join(SAVE_DIR, 'notifications.legacy.backup.json');
      if (!fs.existsSync(backup)) fs.copyFileSync(LEGACY_NOTIF_FILE, backup);
    } catch (e) {
      console.warn('Migration error from notifications.json:', e);
    }
  }
})();

// Read whole combined store from split files (+ volatile)
function readStore() {
  const result = {};
  for (const [key, fname] of Object.entries(FILE_MAP)) {
    result[key] = readJson(path.join(SAVE_DIR, fname),
      (key === 'users' || key === 'videos' || key === 'comments') ? [] : {});
  }
  const autres = readJson(path.join(SAVE_DIR, AUTRES_FILE), {});
  for (const [k, v] of Object.entries(autres)) {
    result[k] = v;
  }
  // normalize subs for client arrays even if stored with timestamps
  if (result.subs && typeof result.subs === 'object') {
    result.subs = _normalizeSubsForClient(result.subs);
  }
  // inject volatile notifications (not persisted)
  result.notifications = volatile.notifications;
  return result;
}

// Write a single key to the appropriate destination

function writeKey(key, value) {
  if (key === 'notifications') {
    // Keep notifications in volatile memory only (do not persist)
    volatile.notifications = value || {};
    return;
  }
  // Handle subs: persist timestamps for each subscription
  if (key === 'subs') {
    const subsPath = path.join(SAVE_DIR, FILE_MAP.subs);
    const currentRaw = readJson(subsPath, {}); // may be arrays or map
    const now = Date.now();
    const incoming = value && typeof value === 'object' ? value : {};
    const next = { ...currentRaw };
    // For comparing and notifications
    const usersPath = path.join(SAVE_DIR, FILE_MAP.users);
    const users = readJson(usersPath, []);

    // Build reverse index of existing to detect new subscriptions
    const existingMap = {};
    for (const [uid, entry] of Object.entries(currentRaw||{})){
      existingMap[uid] = new Set(Object.keys(_mapifySubsEntry(entry)));
    }

    // Merge incoming
    for (const [uid, entry] of Object.entries(incoming)){
      const incomingSet = new Set(Array.isArray(entry) ? entry : Object.keys(_mapifySubsEntry(entry)));
      const curObj = _mapifySubsEntry(currentRaw[uid]);
      // Remove channels no longer present
      for (const chId of Object.keys(curObj)){
        if (!incomingSet.has(chId)) delete curObj[chId];
      }
      // Add new with timestamp
      for (const chId of incomingSet){
        if (!curObj[chId]) {
          curObj[chId] = now;
          // Create a subscription notification item in memory for the channel owner
          try{
            const who = users.find(u=>u.id===uid);
            const notes = volatile.notifications || {};
            notes[chId] = notes[chId] || [];
            const whoName = (who?.pseudo||who?.nom||'Quelqu\'un');
            notes[chId].push(`${whoName} s'est abonné(e) à votre chaîne`);
            volatile.notifications = notes;
          }catch(e){}
        }
      }
      next[uid] = curObj;
    }
    // Also, if someone unsubscribed entirely (uid missing), keep others untouched; we only update provided uids.
    writeJson(subsPath, next);
    return;
  }

  // Handle 'notif': update autres.json.notif map with { userId, ts }
  if (key === 'notif') {
    const autresPath = path.join(SAVE_DIR, AUTRES_FILE);
    const autres = readJson(autresPath, {});
    const obj = (autres.notif && typeof autres.notif === 'object') ? autres.notif : {};
    if (value && typeof value === 'object') {
      const userId = value.userId || value.uid || value.user || null;
      const ts = Number(value.ts || value.time || value.timestamp || Date.now());
      if (userId) {
        obj[userId] = ts;
        autres.notif = obj;
        writeJson(autresPath, autres);
        return;
      }
    }
    // If value isn't an object with userId, fallback to simply setting key
    autres.notif = value;
    writeJson(autresPath, autres);
    return;
  }

  if (Object.prototype.hasOwnProperty.call(FILE_MAP, key)) {
    const fp = path.join(SAVE_DIR, FILE_MAP[key]);
    writeJson(fp, value);
  } else {
    const autresPath = path.join(SAVE_DIR, AUTRES_FILE);
    const autres = readJson(autresPath, {});
    autres[key] = value;
    writeJson(autresPath, autres);
  }
}


// Write a whole store (splits automatically)
function writeStore(store) {
  if (!store || typeof store !== 'object') return;
  for (const [k, v] of Object.entries(store)) {
    writeKey(k, v);
  }
}

// ---- API ----

// Get entire store (merged + volatile)
app.get('/api/store', (req, res) => {
  res.json(readStore());
});

// Get a single key
app.get('/api/get', (req, res) => {
  const key = (req.query.key || '').toString();
  if (!key) return res.status(400).json({ error: 'key required' });
  if (key === 'notifications') {
    return res.json({ key, value: volatile.notifications });
  }
  if (key === 'subsTimes') {
    const raw = readJson(path.join(SAVE_DIR, FILE_MAP.subs), {});
    const byCh = _buildSubsTimesByChannel(raw);
    return res.json({ key, value: byCh });
  }
  if (key === 'subs') {
    const raw = readJson(path.join(SAVE_DIR, FILE_MAP.subs), {});
    const norm = _normalizeSubsForClient(raw);
    return res.json({ key, value: norm });
  }
  if (Object.prototype.hasOwnProperty.call(FILE_MAP, key)) {
    const value = readJson(path.join(SAVE_DIR, FILE_MAP[key]), null);
    return res.json({ key, value });
  } else {
    const autres = readJson(path.join(SAVE_DIR, AUTRES_FILE), {});
    return res.json({ key, value: autres[key] });
  }
});

// Set a single key
app.post('/api/set', (req, res) => {
  const { key, value } = req.body || {};
  if (!key) return res.status(400).json({ error: 'key required' });
  writeKey(key, value);
  res.json({ ok: true });
});

// Health
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`YouVid server running on http://localhost:${PORT}`);
});
