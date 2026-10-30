export const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Per-host throttle so we stay under each API's rate limit.
const lastHit = new Map();
async function throttle(url, minGapMs) {
  const host = new URL(url).host;
  const wait = (lastHit.get(host) ?? 0) + minGapMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
}

export async function fetchText(url, { gap = 0, retries = 2, headers = {}, method, body } = {}) {
  for (let attempt = 0; ; attempt++) {
    await throttle(url, gap);
    try {
      const res = await fetch(url, {
        method,
        body,
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', ...headers },
        signal: AbortSignal.timeout(20000),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} ${url}`);
        err.status = res.status;
        err.fatal = true;
        throw err;
      }
      return await res.text();
    } catch (err) {
      if (err.fatal || attempt >= retries) throw err;
      await sleep(2000 * (attempt + 1) ** 2);
    }
  }
}

export async function fetchJSON(url, opts) {
  return JSON.parse(await fetchText(url, opts));
}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…' };

export function decodeEntities(s = '') {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
}

export const stripTags = (s = '') => s.replace(/<[^>]*>/g, '');
export const cleanText = (s = '') => decodeEntities(stripTags(s)).replace(/\s+/g, ' ').trim();

export function rssItems(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    const tag = (name) => it.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? '';
    return {
      title: decodeEntities(tag('title')).trim(),
      link: decodeEntities(tag('link')).trim(),
      pubDate: tag('pubDate').trim(),
      description: decodeEntities(tag('description')),
      raw: it,
    };
  });
}

export const isoDate = (d) => {
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
};

// Normalization used for both dedup keys and fuzzy matching against streaming catalogs.
export function normalize(s = '') {
  const out = s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[\(\[][^\)\]]*(ep|live|deluxe|edition|remaster|version|mixtape|bloodluxe)[^\)\]]*[\)\]]/g, ' ')
    .replace(/\s+-\s+(ep|single)$/g, ' ')
    .replace(/\b(ep|mixtape)$/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return out || s.toLowerCase().replace(/\s+/g, '');
}

export const albumKey = (artist, title) => `${normalize(artist)}::${normalize(title)}`.replace(/\s+/g, '-');

function bigrams(s) {
  const t = s.replace(/\s+/g, ' ');
  const out = new Map();
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

// 0..1 similarity; containment counts as a strong match ("Swans" vs "Swans & Friends").
export function similarity(a, b) {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const [short, long] = x.length < y.length ? [x, y] : [y, x];
  if (short.length >= 3 && ` ${long} `.includes(` ${short} `)) return 0.9;
  const A = bigrams(x);
  const B = bigrams(y);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) ?? 0);
  const total = [...A.values(), ...B.values()].reduce((s, n) => s + n, 0);
  return total ? (2 * inter) / total : 0;
}
