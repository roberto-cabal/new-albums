import { fetchText, rssItems, decodeEntities, cleanText, isoDate } from '../util.mjs';

const FEED = 'https://www.stereogum.com/category/album-of-the-week/feed/';

export default {
  id: 'stereogum',
  name: 'Stereogum',
  list: 'Album of the Week',
  homepage: 'https://www.stereogum.com/category/reviews/album-of-the-week/',

  async fetch() {
    const xml = await fetchText(FEED);
    const items = [];
    for (const it of rssItems(xml)) {
      // The plain <title> loses the artist/album boundary; the description keeps the album in <em>.
      const anchor = decodeEntities(it.description.match(/<a [^>]*>([\s\S]*?)<\/a>/)?.[1] ?? '');
      const m = anchor.match(/Album Of The Week:\s*(.*?)\s*<em>([\s\S]*?)<\/em>/i);
      if (!m) continue;
      items.push({
        artist: cleanText(m[1]),
        title: cleanText(m[2]),
        url: it.link,
        date: isoDate(it.pubDate),
        cover: it.raw.match(/<media:content[^>]*url="([^"]+)"/)?.[1]?.replace(/\?w=\d+/, '') ?? null,
        rank: items.length,
      });
    }
    return items;
  },
};
