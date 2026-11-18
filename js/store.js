// Speicher: Einstellungen in localStorage, Geschichten in IndexedDB (lokal)
// und – wenn eingerichtet – als Dateien in einem GitHub-Repository.

const EKEY = 'erzaehlwerk.einstellungen';

export function einstellungen() {
  try {
    return JSON.parse(localStorage.getItem(EKEY)) || {};
  } catch {
    return {};
  }
}

export function speichereEinstellungen(neu) {
  const e = { ...einstellungen(), ...neu };
  try {
    localStorage.setItem(EKEY, JSON.stringify(e));
  } catch {}
  return e;
}

// ---------------------------------------------------------------- IndexedDB
let dbPromise;
function db() {
  dbPromise ||= new Promise((res, rej) => {
    const r = indexedDB.open('erzaehlwerk', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('geschichten', { keyPath: 'slug' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction('geschichten', mode);
    const req = fn(t.objectStore('geschichten'));
    t.oncomplete = () => res(req?.result);
    t.onerror = () => rej(t.error);
  });
}

export const lokal = {
  alle: () => tx('readonly', (s) => s.getAll()),
  hole: (slug) => tx('readonly', (s) => s.get(slug)),
  speichere: (g) => tx('readwrite', (s) => s.put(g)),
  loesche: (slug) => tx('readwrite', (s) => s.delete(slug)),
};

// ---------------------------------------------------------------- GitHub
function gh() {
  const e = einstellungen();
  if (!e.ghToken || !e.ghRepo) return null;
  const [owner, repo] = e.ghRepo.split('/');
  return {
    token: e.ghToken,
    owner,
    repo,
    branch: e.ghBranch || 'main',
    pfad: (e.ghPfad || 'geschichten').replace(/^\/+|\/+$/g, ''),
  };
}

export const githubAktiv = () => !!gh();

async function api(cfg, pfad, opts = {}) {
  const r = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}${pfad}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: opts.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (r.status === 404 && opts.erlaube404) return null;
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return opts.raw ? r.text() : r.json();
}

// Mehrere Dateien in EINEM Commit schreiben (Git-Data-API).
async function commit(cfg, dateien, nachricht) {
  const ref = await api(cfg, `/git/ref/heads/${cfg.branch}`);
  const basis = await api(cfg, `/git/commits/${ref.object.sha}`);
  const baum = await api(cfg, '/git/trees', {
    method: 'POST',
    body: JSON.stringify({
      base_tree: basis.tree.sha,
      tree: dateien.map((d) => ({ path: d.pfad, mode: '100644', type: 'blob', content: d.inhalt })),
    }),
  });
  const neu = await api(cfg, '/git/commits', {
    method: 'POST',
    body: JSON.stringify({ message: nachricht, tree: baum.sha, parents: [ref.object.sha] }),
  });
  await api(cfg, `/git/refs/heads/${cfg.branch}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: neu.sha }),
  });
  return neu.sha;
}

const nr3 = (n) => String(n).padStart(3, '0');

export async function aufGithub(geschichte, dateienExtra, nachricht, nurKapitel) {
  const cfg = gh();
  if (!cfg) return null;
  const basis = `${cfg.pfad}/${geschichte.slug}`;
  const dateien = [
    { pfad: `${basis}/kanon.json`, inhalt: JSON.stringify(geschichte.kanon, null, 2) + '\n' },
    ...dateienExtra.map((d) => ({ pfad: `${basis}/${d.pfad}`, inhalt: d.inhalt })),
  ];
  const kap = nurKapitel ? geschichte.kapitel.filter((k) => nurKapitel.includes(k.nr)) : geschichte.kapitel;
  for (const k of kap) dateien.push({ pfad: `${basis}/kapitel/${nr3(k.nr)}.md`, inhalt: k.text + '\n' });
  return commit(cfg, dateien, nachricht);
}

export async function githubListe() {
  const cfg = gh();
  if (!cfg) return [];
  const inhalt = await api(cfg, `/contents/${cfg.pfad}?ref=${encodeURIComponent(cfg.branch)}`, { erlaube404: true });
  return (inhalt || []).filter((x) => x.type === 'dir').map((x) => x.name);
}

export async function vonGithub(slug) {
  const cfg = gh();
  const basis = `${cfg.pfad}/${slug}`;
  const ref = `?ref=${encodeURIComponent(cfg.branch)}`;
  const kanon = JSON.parse(await api(cfg, `/contents/${basis}/kanon.json${ref}`, { raw: true }));
  const liste = (await api(cfg, `/contents/${basis}/kapitel${ref}`, { erlaube404: true })) || [];
  const kapitel = [];
  for (const d of liste.filter((x) => /^\d+\.md$/.test(x.name)).sort((a, b) => a.name.localeCompare(b.name))) {
    const text = (await api(cfg, `/contents/${d.path}${ref}`, { raw: true })).trimEnd();
    const nr = parseInt(d.name, 10);
    const titel = kanon.kapitel?.find((k) => k.nr === nr)?.titel || `Kapitel ${nr}`;
    kapitel.push({ nr, titel, text });
  }
  return { slug, kanon, kapitel };
}
