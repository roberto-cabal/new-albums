import { fetchText, cleanText, decodeEntities, normalize, isoDate } from '../util.mjs';

const listUrl = (year) => `https://theneedledrop.com/loved-list/${year}/`;

// "Artist - Album"; a few entries omit the dash, so fall back to the album slug in the link.
function splitEntry(text, href) {
  const i = text.indexOf(' - ');
  if (i > 0) return { artist: text.slice(0, i).trim(), title: text.slice(i + 3).trim() };
  const slug = href?.match(/\/album\/([^/?#]+)/)?.[1];
  if (slug) {
    const words = slug.split('-').length;
    const parts = text.split(' ');
    const title = parts.slice(-words).join(' ');
    if (normalize(title) === normalize(slug.replace(/-/g, ' '))) {
      return { artist: parts.slice(0, -words).join(' '), title };
    }
  }
  return null;
}

async function reviewDate(url) {
  try {
    const html = await fetchText(url, { gap: 500, retries: 1 });
    return isoDate(html.match(/article:published_time" content="([^"]+)"/)?.[1]);
  } catch {
    return null;
  }
}

export default {
  id: 'needledrop',
  name: 'The Needle Drop',
  list: 'Loved List',
  homepage: listUrl(new Date().getUTCFullYear()),

  async fetch({ isKnown }) {
    const year = new Date().getUTCFullYear();
    let html;
    let url;
    for (const y of [year, year - 1]) {
      try {
        url = listUrl(y);
        html = await fetchText(url);
        break;
      } catch (err) {
        if (y === year - 1) throw err;
      }
    }
    this.homepage = url;

    const items = [];
    const sections = html.split(/<h3[^>]*>/).slice(1);
    for (const sec of sections) {
      const end = sec.indexOf('</h3>');
      const heading = cleanText(sec.slice(0, end));
      if (!/albums/i.test(heading)) continue;
      const curator = /austen/i.test(heading) ? 'austen' : 'Anthony Fantano';
      const body = sec.slice(end).match(/<p>([\s\S]*?)<\/p>/)?.[1] ?? '';
      const chunks = body.split(/<br\s*\/?>/i);
      let rank = 0;
      for (const chunk of chunks) {
        const href = chunk.match(/<a\s+href="([^"]+)"/)?.[1];
        const text = cleanText(chunk);
        if (!text || /full .* list/i.test(text)) continue;
        const parsed = splitEntry(text, href);
        if (!parsed) continue;
        const review = href && /theneedledrop\.com\/album-reviews\//.test(href) ? decodeEntities(href) : null;
        items.push({
          ...parsed,
          url: review ?? url,
          listenUrl: review ? null : href ? decodeEntities(href) : null,
          note: curator === 'austen' ? 'Loved List de austen' : 'Anthony 8/10+',
          curator,
          rank: rank++,
          review,
        });
      }
    }

    // Review pages carry the publish date; only fetch it for albums we haven't seen before.
    for (const it of items) {
      if (it.review && !isKnown(it.artist, it.title, 'needledrop')) it.date = await reviewDate(it.review);
      delete it.review;
    }
    return items;
  },
};
