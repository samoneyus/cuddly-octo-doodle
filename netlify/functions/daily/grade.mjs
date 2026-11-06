// Map-name spelling grader, ported from the "spelling" section of index.html. Keep the two in sync.
const FILLER = new Set(["the", "st", "saint", "uss", "el", "al", "las", "du", "de", "la", "of", "and"]);

function words(s) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
}
export function norm(s) { return words(s).join(""); }
function core(s) { return words(s).filter(w => !FILLER.has(w)).join(""); }
// Rough sound-alike key: "Skidrowe", "Hyjacked", "Zarkwa" collapse to the same thing as the real name.
function sound(s) {
  return norm(s).replace(/ph/g, "f").replace(/ck|q|c(?=[aou]|$)/g, "k").replace(/c/g, "s").replace(/z/g, "s")
    .replace(/x/g, "ks").replace(/y/g, "i").replace(/h(?![aeiou])/g, "").replace(/([a-z])\1+/g, "$1")
    .replace(/(?!^)[aeiou]/g, "");
}
const tolerance = len => len >= 12 ? 3 : len >= 8 ? 2 : len >= 5 ? 1 : 0;
const near = (a, b) => lev(a, b) <= tolerance(b.length);

// Returns { pts: 1 | 0.5 | 0, note }. allNames: every map name in the pool, normalised with norm().
export function gradeMap(guess, answer, allNames) {
  const g = norm(guess), a = norm(answer);
  if (!g) return { pts: 0 };
  if (g === a) return { pts: 1 };
  // Never credit a guess that is (or is a near-miss of) a different map's name, e.g. "Carbon" for Cargo.
  const dist = lev(g, a);
  if (allNames.some(n => n !== a && lev(g, n) < dist && near(g, n))) return { pts: 0 };
  if (near(g, a) || (a.length >= 5 && sound(guess) === sound(answer)) || (core(guess) && near(core(guess), core(answer))))
    return { pts: 1, note: "spelling accepted" };
  // Part of a multi-word name: "Zarqwa" for Zarqwa Hydroelectric, "Santa Sena" for Santa Seña Border Crossing.
  const ws = words(answer).filter(w => !FILLER.has(w)), runs = [];
  for (let i = 0; i < ws.length; i++)
    for (let j = i + 1; j <= ws.length; j++) if (j - i < ws.length) runs.push(ws.slice(i, j).join(""));
  if (runs.some(r => r.length >= 5 && (near(g, r) || sound(guess) === sound(r))))
    return { pts: 0.5, note: "half credit, partial name" };
  if (a.length >= 5 && (1 - dist / Math.max(g.length, a.length) >= 0.6 || lev(sound(guess), sound(answer)) <= 1))
    return { pts: 0.5, note: "half credit, close spelling" };
  return { pts: 0 };
}

function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
