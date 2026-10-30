import { fetchJSON, fetchText, rssItems, cleanText, isoDate, normalize } from '../util.mjs';

// WordPress REST API: posts carry `artist` and `object` (album) taxonomies, so we don't have to parse the punny headlines.
// It answers 403 from some networks (e.g. GitHub Actions), so the RSS feed is the fallback.
const CATEGORY = 27; // Album of the Week
const API = `https://thequietus.com/wp-json/wp/v2/posts?categories=${CATEGORY}&per_page=30&_embed=wp:term&_fields=link,date_gmt,title,yoast_head_json,_links,_embedded`;
const FEED = 'https://thequietus.com/columns/quietus-reviews/album-of-the-week/feed/';

// Prefer the term whose name appears in the headline ("Headline: Album by Artist"), else join them all.
function pickTerms(terms, headline) {
  const h = ` ${normalize(headline)} `;
  const named = terms.filter((t) => h.includes(` ${normalize(t)} `));
  return (named.length ? named : terms).join(' & ').replace(/[\s,;:]+$/, '');
}

async function fromApi() {
  const posts = await fetchJSON(API);
  const items = [];
  for (const p of posts) {
    const terms = (p._embedded?.['wp:term'] ?? []).flat();
    const names = (tax) => terms.filter((t) => t.taxonomy === tax).map((t) => cleanText(t.name));
    const headline = cleanText(p.title?.rendered);
    const byline = headline.match(/:\s*(.+?)\s+by\s+(.+)$/);
    const artists = names('artist');
    const albums = names('object');
    const artist = byline && artists.some((a) => normalize(a) && normalize(byline[2]).includes(normalize(a)))
      ? byline[2]
      : pickTerms(artists, headline);
    const title = albums.length ? pickTerms(albums, headline) : byline?.[1];
    if (!artist || !title) continue;
    const genre = names('genre')[0];
    items.push({
      artist,
      title,
      url: p.link,
      date: isoDate(p.date_gmt + 'Z'),
      genre: genre ? genre[0].toUpperCase() + genre.slice(1) : null,
      cover: p.yoast_head_json?.og_image?.[0]?.url ?? null,
      note: cleanText(p.yoast_head_json?.description) || null,
      rank: items.length,
    });
  }
  return items;
}

// "Headline: Album by Artist" or "Headline: Artist’s Album"; anything else is skipped.
function parseHeadline(headline) {
  const rest = headline.replace(/^[^:]*?\s*:\s*/, '');
  const by = rest.lastIndexOf(' by ');
  if (by > 0) return { title: rest.slice(0, by), artist: rest.slice(by + 4) };
  const poss = rest.match(/^(.+?)[’']s\s+(.+)$/);
  return poss ? { artist: poss[1], title: poss[2] } : null;
}

async function fromFeed(knownAlbum) {
  const xml = await fetchText(FEED);
  const items = [];
  for (const it of rssItems(xml)) {
    // Reuse the names already saved for this review so the feed's looser parsing doesn't create duplicates.
    const parsed = knownAlbum(it.link) ?? parseHeadline(cleanText(it.title));
    if (!parsed?.artist || !parsed?.title) continue;
    const standfirst = it.description.match(/<p>([\s\S]*?)<\/p>/)?.[1].replace(/<img[^>]*>/g, '');
    items.push({
      artist: parsed.artist.trim(),
      title: parsed.title.trim(),
      url: it.link,
      date: isoDate(it.pubDate),
      cover: it.description.match(/<img [^>]*src="([^"]+)"/)?.[1] ?? null,
      note: cleanText(standfirst) || null,
      rank: items.length,
    });
  }
  return items;
}

export default {
  id: 'quietus',
  name: 'The Quietus',
  list: 'Album of the Week',
  homepage: 'https://thequietus.com/columns/quietus-reviews/album-of-the-week/',

  async fetch({ knownAlbum = () => null } = {}) {
    try {
      return await fromApi();
    } catch (err) {
      console.log(`  API falló (${err.message}); usando RSS`);
      return fromFeed(knownAlbum);
    }
  },
};
