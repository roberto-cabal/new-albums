import { fetchText, decodeEntities, isoDate } from '../util.mjs';

const URL_BEST = 'https://pitchfork.com/reviews/best/albums/';

const cleanHed = (s = '') =>
  decodeEntities(s).replace(/\\(.)/g, '$1').replace(/\*/g, '').replace(/\s+/g, ' ').trim();

export default {
  id: 'pitchfork',
  name: 'Pitchfork',
  list: 'Best New Albums',
  homepage: URL_BEST,

  async fetch() {
    const html = await fetchText(URL_BEST);
    const json = html.match(/window\.__PRELOADED_STATE__\s*=\s*(\{[\s\S]*?\});?<\/script>/)?.[1];
    if (!json) throw new Error('Pitchfork: no se encontró __PRELOADED_STATE__ (¿cambió el sitio?)');
    const containers = JSON.parse(json)?.transformed?.bundle?.containers ?? [];
    const items = containers.flatMap((c) => c.items ?? []).filter((it) => it.contentType === 'review');

    return items.map((it, rank) => ({
      artist: it.subHed?.name?.trim(),
      title: cleanHed(it.source?.hed ?? it.dangerousHed?.replace(/<[^>]+>/g, '')),
      url: new URL(it.url, 'https://pitchfork.com').href,
      date: isoDate(it.pubDate),
      score: it.ratingValue?.score ?? null,
      bnm: Boolean(it.ratingValue?.isBestNewMusic),
      genre: it.rubric?.[0]?.name ?? null,
      cover: it.image?.sources?.sm?.url ?? null,
      note: it.dangerousDek ? decodeEntities(it.dangerousDek).replace(/<[^>]+>/g, '') : null,
      rank,
    })).filter((it) => it.artist && it.title);
  },
};
