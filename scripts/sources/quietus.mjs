import { fetchJSON, cleanText, isoDate, normalize } from '../util.mjs';

// WordPress REST API: posts carry `artist` and `object` (album) taxonomies, so we don't have to parse the punny headlines.
const CATEGORY = 27; // Album of the Week
const API = `https://thequietus.com/wp-json/wp/v2/posts?categories=${CATEGORY}&per_page=30&_embed=wp:term&_fields=link,date_gmt,title,yoast_head_json,_links,_embedded`;

// Prefer the term whose name appears in the headline ("Headline: Album by Artist"), else join them all.
function pickTerms(terms, headline) {
  const h = ` ${normalize(headline)} `;
  const named = terms.filter((t) => h.includes(` ${normalize(t)} `));
  return (named.length ? named : terms).join(' & ').replace(/[\s,;:]+$/, '');
}

export default {
  id: 'quietus',
  name: 'The Quietus',
  list: 'Album of the Week',
  homepage: 'https://thequietus.com/columns/quietus-reviews/album-of-the-week/',

  async fetch() {
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
  },
};
