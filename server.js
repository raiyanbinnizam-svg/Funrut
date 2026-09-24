const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const elo = require('./elo');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const MAX_BODY = 3 * 1024 * 1024; // 3 MB request body (base64 image inflates ~33%)
const MAX_IMAGE = 2 * 1024 * 1024; // 2 MB decoded image
const PAIR_TTL_MS = 10 * 60 * 1000;
const START_RATING = 1200;

const IMAGE_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
};

// ---------- storage ----------

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function seedEntries() {
  const palette = ['#ff6b6b', '#feca57', '#48dbfb', '#1dd1a1', '#5f27cd', '#ff9ff3', '#54a0ff', '#ee5253'];
  const names = ['Ada', 'Grace', 'Linus', 'Margaret', 'Alan', 'Barbara', 'Dennis', 'Radia'];
  return names.map((name, i) => {
    const file = `seed-${i}.svg`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
<rect width="200" height="200" fill="${palette[i]}"/>
<circle cx="100" cy="85" r="42" fill="#fff" opacity=".9"/>
<rect x="45" y="135" width="110" height="70" rx="40" fill="#fff" opacity=".9"/>
<text x="100" y="98" font-family="sans-serif" font-size="40" font-weight="700" text-anchor="middle" fill="${palette[i]}">${name[0]}</text>
</svg>`;
    fs.writeFileSync(path.join(UPLOAD_DIR, file), svg);
    return newEntry(name, file);
  });
}

function newEntry(name, image) {
  return {
    id: crypto.randomUUID(),
    name,
    image,
    rating: START_RATING,
    wins: 0,
    losses: 0,
    createdAt: new Date().toISOString(),
  };
}

function loadDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    const db = { entries: seedEntries(), votes: 0 };
    saveDb(db);
    return db;
  }
}

let saveTimer = null;
function saveDb(db) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DB_FILE);
  }, 50);
}

const db = loadDb();

// Pairs handed out to clients. A vote is only accepted for a pair the
// server actually served, and each pair can be voted on once.
const pendingPairs = new Map();

function prunePairs() {
  const now = Date.now();
  for (const [token, pair] of pendingPairs) {
    if (now - pair.issuedAt > PAIR_TTL_MS) pendingPairs.delete(token);
  }
}
setInterval(prunePairs, 60 * 1000).unref();

// ---------- helpers ----------

function publicEntry(e) {
  return {
    id: e.id,
    name: e.name,
    image: `/uploads/${e.image}`,
    rating: Math.round(e.rating),
    wins: e.wins,
    losses: e.losses,
  };
}

function pickPair() {
  const entries = db.entries;
  if (entries.length < 2) return null;
  // Favour entries with fewer matches so new arrivals get seen quickly,
  // then pick an opponent with a nearby rating for a more informative match.
  const byGames = [...entries].sort((a, b) => a.wins + a.losses - (b.wins + b.losses));
  const pool = byGames.slice(0, Math.max(2, Math.ceil(entries.length / 2)));
  const first = pool[crypto.randomInt(pool.length)];
  const others = entries
    .filter((e) => e.id !== first.id)
    .sort((a, b) => Math.abs(a.rating - first.rating) - Math.abs(b.rating - first.rating));
  const near = others.slice(0, Math.min(4, others.length));
  const second = near[crypto.randomInt(near.length)];
  return crypto.randomInt(2) ? [first, second] : [second, first];
}

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Request too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

// Check magic bytes so a renamed file can't masquerade as an image.
function sniffImage(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('ascii', 0, 3) === 'GIF') return 'gif';
  return null;
}

function serveFile(res, filePath, baseDir) {
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(baseDir + path.sep)) return send(res, 404, 'Not found');
  fs.readFile(resolved, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    const type = MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': baseDir === UPLOAD_DIR ? 'public, max-age=86400' : 'no-cache',
      ...(type === 'image/svg+xml' ? { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" } : {}),
    });
    res.end(data);
  });
}

// ---------- routes ----------

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/pair') {
    const pair = pickPair();
    if (!pair) return send(res, 409, { error: 'Need at least two entries to start voting.' });
    const token = crypto.randomBytes(16).toString('hex');
    pendingPairs.set(token, { ids: [pair[0].id, pair[1].id], issuedAt: Date.now() });
    return send(res, 200, { token, left: publicEntry(pair[0]), right: publicEntry(pair[1]) });
  }

  if (req.method === 'POST' && url.pathname === '/api/vote') {
    const { token, winnerId } = await readJson(req);
    const pair = pendingPairs.get(token);
    if (!pair) return send(res, 400, { error: 'This matchup expired. Loading a new one.' });
    if (!pair.ids.includes(winnerId)) return send(res, 400, { error: 'Winner is not part of this matchup.' });
    pendingPairs.delete(token);

    const loserId = pair.ids.find((id) => id !== winnerId);
    const winner = db.entries.find((e) => e.id === winnerId);
    const loser = db.entries.find((e) => e.id === loserId);
    if (!winner || !loser) return send(res, 410, { error: 'An entry in this matchup was removed.' });

    const before = [winner.rating, loser.rating];
    [winner.rating, loser.rating] = elo.update(winner.rating, loser.rating);
    winner.wins += 1;
    loser.losses += 1;
    db.votes += 1;
    saveDb(db);

    return send(res, 200, {
      winner: { ...publicEntry(winner), delta: Math.round(winner.rating - before[0]) },
      loser: { ...publicEntry(loser), delta: Math.round(loser.rating - before[1]) },
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/leaderboard') {
    const ranked = [...db.entries].sort((a, b) => b.rating - a.rating).map(publicEntry);
    return send(res, 200, { entries: ranked, votes: db.votes });
  }

  if (req.method === 'POST' && url.pathname === '/api/entries') {
    const { name, image, consent } = await readJson(req);
    if (consent !== true) {
      return send(res, 400, { error: 'Only add a photo of yourself, or one you have permission to use.' });
    }
    const cleanName = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!cleanName) return send(res, 400, { error: 'Please add a name.' });

    const match = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(image || ''));
    if (!match || !IMAGE_TYPES[match[1]]) {
      return send(res, 400, { error: 'Upload a PNG, JPEG, WebP or GIF image.' });
    }
    const buf = Buffer.from(match[2], 'base64');
    if (buf.length > MAX_IMAGE) return send(res, 413, { error: 'Image must be 2 MB or smaller.' });
    const ext = sniffImage(buf);
    if (!ext) return send(res, 400, { error: 'That file does not look like an image.' });

    const file = `${crypto.randomUUID()}.${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, file), buf);
    const entry = newEntry(cleanName, file);
    db.entries.push(entry);
    saveDb(db);
    return send(res, 201, publicEntry(entry));
  }

  return send(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');

    const pathname = decodeURIComponent(url.pathname);
    if (pathname.startsWith('/uploads/')) {
      return serveFile(res, path.join(UPLOAD_DIR, pathname.slice('/uploads/'.length)), UPLOAD_DIR);
    }
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    return serveFile(res, path.join(PUBLIC_DIR, rel), PUBLIC_DIR);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) send(res, status, { error: status === 500 ? 'Something went wrong.' : err.message });
  }
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`FaceSmash running at http://localhost:${PORT}`));
}

module.exports = { server };
