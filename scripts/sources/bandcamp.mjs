import { fetchText, rssItems, cleanText, isoDate } from '../util.mjs';

// Disabled: Bandcamp answers automated requests with a bot challenge. Re-enable if it starts serving the feed.

const FEED = 'https://daily.bandcamp.com/feed/album-of-the-day';

export default {
  id: 'bandcamp',
  name: 'Bandcamp Daily',
  list: 'Album of the Day',
  homepage: 'https://daily.bandcamp.com/album-of-the-day',
  enabled: false,

  async fetch() {
    const xml = await fetchText(FEED);
    const items = [];
    for (const it of rssItems(xml)) {
      if (!it.link.includes('/album-of-the-day/')) continue;
      // Title format: Artist, “Album”
      const m = it.title.match(/^(.*?),\s*[“"](.*)[”"]\s*$/);
      if (!m) continue;
      const paragraphs = [...it.description.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((p) => cleanText(p[1])).filter(Boolean);
      items.push({
        artist: m[1].trim(),
        title: m[2].trim(),
        url: it.link,
        date: isoDate(it.pubDate),
        cover: it.description.match(/<img src="([^"]+)"/)?.[1] ?? null,
        note: paragraphs.find((p) => !/^Read full story/i.test(p)) ?? null,
        rank: items.length,
      });
    }
    return items;
  },
};
