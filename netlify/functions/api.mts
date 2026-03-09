import { getStore } from '@netlify/blobs';

function getDataStore() {
  return getStore('youvid-data');
}

const FILE_KEYS = ['ads', 'users', 'videos', 'comments', 'likes', 'views', 'subs', 'sponso'];
const DEFAULTS = {
  ads: [],
  users: [],
  videos: [],
  comments: [],
  likes: {},
  views: {},
  subs: {},
  sponso: {},
  notifications: {},
  autres: {},
};

function isObject(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

async function readJsonKey(key, fallback) {
  const store = getDataStore();
  const value = await store.get(key, { type: 'json' });
  return value === null || value === undefined ? (fallback ?? null) : value;
}

async function writeJsonKey(key, value) {
  const store = getDataStore();
  await store.setJSON(key, value);
}

// Subscription helpers (ported from server.js)

function mapifySubsEntry(entry) {
  if (Array.isArray(entry)) {
    const o = {};
    const now = Date.now();
    entry.forEach((ch) => {
      if (!o[ch]) o[ch] = now;
    });
    return o;
  }
  if (entry && typeof entry === 'object') {
    return { ...entry };
  }
  return {};
}

function normalizeSubsForClient(subsRaw) {
  const out = {};
  for (const [uid, entry] of Object.entries(subsRaw || {})) {
    if (Array.isArray(entry)) out[uid] = entry.slice();
    else if (entry && typeof entry === 'object') out[uid] = Object.keys(entry);
    else out[uid] = [];
  }
  return out;
}

function buildSubsTimesByChannel(subsRaw) {
  const byCh = {};
  for (const [uid, entry] of Object.entries(subsRaw || {})) {
    const mp = mapifySubsEntry(entry);
    for (const [chId, ts] of Object.entries(mp)) {
      if (!byCh[chId]) byCh[chId] = {};
      byCh[chId][uid] = ts;
    }
  }
  return byCh;
}

async function readStore() {
  const result = {};
  for (const key of FILE_KEYS) {
    const fallback =
      key === 'users' || key === 'videos' || key === 'comments' || key === 'ads'
        ? []
        : key === 'likes' || key === 'views' || key === 'subs'
        ? {}
        : null;
    result[key] = await readJsonKey(key, fallback);
  }

  // autres: generic key/value map
  const autres = await readJsonKey('autres', DEFAULTS.autres);
  if (isObject(autres)) {
    for (const [k, v] of Object.entries(autres)) {
      result[k] = v;
    }
  }

  // Normalize subs to arrays for the client
  if (result.subs && typeof result.subs === 'object') {
    result.subs = normalizeSubsForClient(result.subs);
  }

  // Notifications are now persisted instead of volatile
  result.notifications = await readJsonKey('notifications', DEFAULTS.notifications);

  return result;
}

async function readKey(key) {
  if (key === 'notifications') {
    return await readJsonKey('notifications', DEFAULTS.notifications);
  }

  if (key === 'subsTimes') {
    const subsRaw = await readJsonKey('subs', DEFAULTS.subs);
    return buildSubsTimesByChannel(subsRaw);
  }

  if (key === 'subs') {
    const subsRaw = await readJsonKey('subs', DEFAULTS.subs);
    return normalizeSubsForClient(subsRaw);
  }

  if (FILE_KEYS.includes(key)) {
    const fallback =
      key === 'users' || key === 'videos' || key === 'comments' || key === 'ads'
        ? []
        : key === 'likes' || key === 'views' || key === 'subs'
        ? {}
        : null;
    return await readJsonKey(key, fallback);
  }

  // Everything else lives in 'autres'
  const autres = await readJsonKey('autres', DEFAULTS.autres);
  if (!isObject(autres)) return undefined;
  return autres[key];
}

async function writeKey(key, value) {
  if (key === 'notifications') {
    await writeJsonKey('notifications', value || DEFAULTS.notifications);
    return;
  }

  // Persist subs with timestamps and emit subscription notifications
  if (key === 'subs') {
    const currentRaw = await readJsonKey('subs', DEFAULTS.subs);
    const now = Date.now();
    const incoming = value && typeof value === 'object' ? value : {};
    const next = { ...currentRaw };
    const users = await readJsonKey('users', DEFAULTS.users);

    for (const [uid, entry] of Object.entries(incoming)) {
      const incomingSet = new Set(
        Array.isArray(entry) ? entry : Object.keys(mapifySubsEntry(entry)),
      );
      const curObj = mapifySubsEntry(currentRaw[uid]);

      // Remove channels no longer present
      for (const chId of Object.keys(curObj)) {
        if (!incomingSet.has(chId)) delete curObj[chId];
      }

      // Add new with timestamp and push notifications
      for (const chId of incomingSet) {
        if (!curObj[chId]) {
          curObj[chId] = now;

          try {
            const who = users.find((u) => u && u.id === uid);
            const whoName = (who?.pseudo || who?.nom || "Quelqu'un");

            const notes = await readJsonKey('notifications', DEFAULTS.notifications);
            const existingList = Array.isArray(notes[chId]) ? notes[chId].slice() : [];
            existingList.push(`${whoName} s'est abonné(e) à votre chaîne`);
            notes[chId] = existingList;
            await writeJsonKey('notifications', notes);
          } catch (e) {
            // ignore
          }
        }
      }

      next[uid] = curObj;
    }

    await writeJsonKey('subs', next);
    return;
  }

  // 'notif' key: store last-open timestamp per user in autres.notif
  if (key === 'notif') {
    const autres = await readJsonKey('autres', DEFAULTS.autres);
    const obj = isObject(autres.notif) ? autres.notif : {};

    if (value && typeof value === 'object') {
      const userId = value.userId || value.uid || value.user || null;
      const ts = Number(value.ts || value.time || value.timestamp || Date.now());
      if (userId) {
        obj[userId] = ts;
        autres.notif = obj;
        await writeJsonKey('autres', autres);
        return;
      }
    }

    autres.notif = value;
    await writeJsonKey('autres', autres);
    return;
  }

  if (FILE_KEYS.includes(key)) {
    await writeJsonKey(key, value);
    return;
  }

  // Fallback to autres
  const autres = await readJsonKey('autres', DEFAULTS.autres);
  if (value === undefined) {
    delete autres[key];
  } else {
    autres[key] = value;
  }
  await writeJsonKey('autres', autres);
}

export default async (req, context) => {
  const url = new URL(req.url);
  const pathname = url.pathname;
  const method = req.method || 'GET';

  try {
    if (method === 'GET' && pathname === '/api/health') {
      return new Response('ok', { status: 200 });
    }

    if (method === 'GET' && pathname === '/api/store') {
      const data = await readStore();
      return Response.json(data);
    }

    if (method === 'GET' && pathname === '/api/get') {
      const key = url.searchParams.get('key');
      if (!key) {
        return Response.json({ error: 'Missing key' }, { status: 400 });
      }
      const value = await readKey(key);
      return Response.json({ key, value });
    }

    if (method === 'POST' && pathname === '/api/set') {
      let body;
      try {
        body = await req.json();
      } catch {
        body = {};
      }
      const key = body?.key;
      const value = body?.value;
      if (!key) {
        return Response.json({ error: 'Missing key in body' }, { status: 400 });
      }
      await writeKey(key, value);
      return Response.json({ ok: true });
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  } catch (e) {
    console.error('API error', e);
    return Response.json({ error: 'Server error', details: String(e?.message || e) }, { status: 500 });
  }
};

export const config = {
  // Handle the same paths used by the existing front-end API helper
  path: ['/api/store', '/api/get', '/api/set', '/api/health'],
};
