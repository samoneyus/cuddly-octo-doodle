// Daily challenge: the same 5 minimaps for everyone, new set at midnight Pacific.
// The answers never reach the browser before a guess: the server picks the maps, serves their images under
// neutral URLs, grades each guess once, and keeps the player's progress in a signed cookie.
import { createHmac, timingSafeEqual } from "node:crypto";
import { gradeMap, norm } from "./grade.mjs";

export const config = { path: ["/api/daily", "/api/daily/*"] };

const COUNT = 5;
const TZ = "America/Los_Angeles";
const EPOCH = Date.UTC(2026, 10, 6) / 864e5;  // Pacific date of Daily #1 (6 Nov 2026)
// Set DAILY_SECRET in Netlify's environment variables. It never goes in the code: anyone holding it could
// work out every future daily. Without it the daily stays switched off.
// Read per request: Netlify exposes it through Netlify.env in current functions, process.env in older ones.
const secret = () => globalThis.Netlify?.env?.get("DAILY_SECRET") || process.env.DAILY_SECRET;
const COOKIE = "cmq_daily";
const DAY_MS = 864e5;

const hmac = s => createHmac("sha256", secret()).update(s).digest("base64url");

// Pacific calendar date of a moment, as whole days since 1970 (DST-safe).
function pacificDay(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "numeric", day: "numeric" })
    .formatToParts(ms).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day) / DAY_MS;
}

// Midnight Pacific is 07:00 or 08:00 UTC depending on daylight saving; pick whichever is the real boundary.
function nextReset(day) {
  for (const h of [7, 8]) {
    const t = (day + 1) * DAY_MS + h * 36e5;
    if (pacificDay(t) === day + 1 && pacificDay(t - 1) === day) return t;
  }
  return (day + 1) * DAY_MS + 8 * 36e5;
}

// The minimap list is the site's own data.js, so the daily always matches the practice quiz.
let mapsP = null;
function loadMaps(origin) {
  mapsP ||= fetch(new URL("/data.js", origin))
    .then(r => { if (!r.ok) throw new Error("data.js " + r.status); return r.text(); })
    .then(t => {
      const maps = JSON.parse(t.slice(t.indexOf("["), t.lastIndexOf("]") + 1));
      return { maps, names: [...new Set(maps.map(m => norm(m.map)))], orders: new Map() };
    })
    .catch(e => { mapsP = null; throw e; });
  return mapsP;
}

// Each cycle shuffles every map with the secret and deals 5 a day, so no map repeats until all have been used.
function dailyMaps(data, n) {
  const perCycle = Math.floor(data.maps.length / COUNT);
  const cycle = Math.floor((n - 1) / perCycle), slot = (n - 1) % perCycle;
  if (!data.orders.has(cycle)) {
    data.orders.set(cycle, data.maps.map(m => [hmac(`order:${cycle}:${m.img}`), m])
      .sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(x => x[1]));
  }
  return data.orders.get(cycle).slice(slot * COUNT, slot * COUNT + COUNT);
}

// Progress cookie: { d: daily number, r: [[mapPts, gameOk, mapGuess, gameGuess], ...] }, HMAC-signed.
function readProgress(req, n) {
  const raw = (req.headers.get("cookie") || "").split(/;\s*/).find(s => s.startsWith(COOKIE + "="));
  if (!raw) return [];
  const [body, sig] = raw.slice(COOKIE.length + 1).split(".");
  if (!body || !sig) return [];
  const want = Buffer.from(hmac("cookie:" + body)), got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return [];
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString());
    return s.d === n && Array.isArray(s.r) ? s.r : [];
  } catch { return []; }
}
function progressCookie(n, r) {
  const body = Buffer.from(JSON.stringify({ d: n, r })).toString("base64url");
  return `${COOKIE}=${body}.${hmac("cookie:" + body)}; Path=/api/daily; Max-Age=172800; HttpOnly; Secure; SameSite=Lax`;
}

const colour = pts => (pts >= 2 ? "green" : pts > 0 ? "yellow" : "red");

function view(n, day, picks, r) {
  return {
    day: n, count: COUNT, now: Date.now(), nextReset: nextReset(day),
    results: r.map(([mapPts, gameOk, mapGuess, gameGuess], i) => {
      const m = picks[i];
      return { mapPts, gameOk: !!gameOk, mapGuess, gameGuess, colour: colour(mapPts + (gameOk ? 1 : 0)),
               answer: { map: m.map, game: m.game, year: m.year, games: m.games || [m.game], img: m.img, source: m.source } };
    }),
  };
}

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
});

export default async (req) => {
  if (!secret()) return json({ error: "daily not configured" }, 503);
  const url = new URL(req.url);
  const sub = url.pathname.replace(/^\/api\/daily\/?/, "").split("/").filter(Boolean);
  const day = pacificDay(Date.now());
  const n = Math.max(1, day - EPOCH + 1);

  let data;
  try { data = await loadMaps(url.origin); } catch { return json({ error: "maps unavailable" }, 503); }
  const picks = dailyMaps(data, n);
  const r = readProgress(req, n);

  if (req.method === "GET" && sub.length === 0) return json(view(n, day, picks, r));

  // /api/daily/img/<n>/<i>: today's pictures only, under a URL that says nothing about the map.
  if (req.method === "GET" && sub[0] === "img" && sub.length === 3) {
    const i = Number(sub[2]);
    if (Number(sub[1]) !== n || !Number.isInteger(i) || i < 0 || i >= COUNT) return new Response("Not found", { status: 404 });
    const img = await fetch(new URL("/" + picks[i].img, url.origin));
    if (!img.ok) return new Response("Image unavailable", { status: 502 });
    return new Response(await img.arrayBuffer(), {
      headers: { "content-type": "image/webp", "cache-control": "private, max-age=86400" },
    });
  }

  // Graded once per map, in order. Anything already answered (or out of order) just returns the saved state.
  if (req.method === "POST" && sub[0] === "guess" && sub.length === 1) {
    let body;
    try { body = await req.json(); } catch { return json({ error: "bad request" }, 400); }
    if (body.day !== n) return json({ error: "new-day", ...view(n, day, picks, r) }, 409);
    if (body.i !== r.length || r.length >= COUNT) return json(view(n, day, picks, r));
    const m = picks[r.length];
    const mapGuess = String(body.map ?? "").slice(0, 60), gameGuess = String(body.game ?? "").slice(0, 60);
    const graded = gradeMap(mapGuess, m.map, data.names);
    const gameOk = (m.games || [m.game]).includes(gameGuess);
    r.push([graded.pts, gameOk ? 1 : 0, mapGuess, gameGuess]);
    return json({ note: graded.note || null, ...view(n, day, picks, r) }, 200, { "set-cookie": progressCookie(n, r) });
  }

  return json({ error: "not found" }, 404);
};
