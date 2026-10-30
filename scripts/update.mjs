// Fetches every list, merges albums across lists, resolves streaming links and writes public/data/albums.json.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import allSources from './sources/index.mjs';
import { albumKey } from './util.mjs';
import { resolveLinks } from './links.mjs';

const sources = allSources.filter((s) => s.enabled !== false);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = join(ROOT, 'public', 'data', 'albums.json');
const MAX_RESOLVE = Number(process.env.MAX_RESOLVE ?? 250);
const RECHECK_DAYS = 7;
const DAY = 86400000;

async function loadDb() {
  try {
    return JSON.parse(await readFile(DB_PATH, 'utf8'));
  } catch {
    return { albums: [] };
  }
}

const now = new Date().toISOString();
const db = await loadDb();
const albums = new Map(db.albums.map((a) => [a.id, a]));
const sourceMeta = Object.fromEntries((db.sources ?? []).map((s) => [s.id, s]));

const isKnown = (artist, title, sourceId) =>
  Boolean(albums.get(albumKey(artist, title))?.picks?.some((p) => p.source === sourceId));

// Album already saved for a review URL, so a source can keep its names stable across parsing methods.
const byUrl = new Map([...albums.values()].flatMap((a) => a.picks.map((p) => [p.url, a])));
const knownAlbum = (url) => byUrl.get(url) ?? null;

for (const source of sources) {
  const meta = (sourceMeta[source.id] ??= { id: source.id });
  Object.assign(meta, { name: source.name, list: source.list });
  try {
    console.log(`→ ${source.name} · ${source.list}`);
    const items = await source.fetch({ isKnown, knownAlbum });
    if (!items.length) throw new Error('0 álbumes (¿cambió el formato?)');
    console.log(`  ${items.length} álbumes`);
    for (const it of items) {
      const id = albumKey(it.artist, it.title);
      let album = albums.get(id);
      if (!album) {
        album = { id, artist: it.artist, title: it.title, firstSeen: now, picks: [] };
        albums.set(id, album);
        console.log(`  + ${it.artist} — ${it.title}`);
      }
      album.cover ||= it.cover ?? null;
      album.genre ||= it.genre ?? null;
      const prev = album.picks.find((p) => p.source === source.id && (p.curator ?? null) === (it.curator ?? null));
      const pick = {
        source: source.id,
        curator: it.curator ?? null,
        url: it.url,
        date: prev?.date ?? it.date ?? null,
        score: it.score ?? null,
        bnm: it.bnm ?? undefined,
        note: it.note ?? null,
        listenUrl: it.listenUrl ?? prev?.listenUrl ?? null,
        rank: it.rank,
      };
      if (prev) Object.assign(prev, pick);
      else album.picks.push(pick);
    }
    Object.assign(meta, { homepage: source.homepage, ok: true, error: null, count: items.length, checkedAt: now });
  } catch (err) {
    console.error(`  ✗ ${source.name}: ${err.message}`);
    Object.assign(meta, { ok: false, error: err.message, checkedAt: now });
  }
}

// Resolve links for new albums, and retry incomplete ones once a week.
const pending = [...albums.values()].filter(
  (a) => !a.linksCheckedAt || (!a.linksComplete && Date.now() - Date.parse(a.linksCheckedAt) > RECHECK_DAYS * DAY),
);
console.log(`→ Resolviendo links de ${Math.min(pending.length, MAX_RESOLVE)} / ${pending.length} álbumes`);
for (const album of pending.slice(0, MAX_RESOLVE)) {
  const listenUrls = album.picks.map((p) => p.listenUrl).filter(Boolean);
  const r = await resolveLinks({ artist: album.artist, title: album.title, listenUrls });
  const merged = { ...r.links };
  for (const [k, v] of Object.entries(album.links ?? {})) if (v.exact && !merged[k]?.exact) merged[k] = v;
  album.links = merged;
  album.cover ||= r.cover;
  album.releaseDate ||= r.releaseDate;
  album.linksComplete = r.complete;
  if (!r.hadErrors) album.linksCheckedAt = now;
}

for (const album of albums.values()) {
  const dates = album.picks.map((p) => p.date).filter(Boolean).sort();
  album.addedAt = dates[0] ?? (album.releaseDate ? `${album.releaseDate}T12:00:00.000Z` : album.firstSeen);
  album.lastPickAt = dates.at(-1) ?? album.addedAt;
}

const out = {
  updatedAt: now,
  sources: sources.map((s) => sourceMeta[s.id]),
  albums: [...albums.values()].sort((a, b) => b.addedAt.localeCompare(a.addedAt)),
};
await mkdir(dirname(DB_PATH), { recursive: true });
await writeFile(DB_PATH, JSON.stringify(out, null, 1) + '\n');
console.log(`✓ ${out.albums.length} álbumes guardados en public/data/albums.json`);
if (out.sources.every((s) => !s.ok)) process.exit(1);
