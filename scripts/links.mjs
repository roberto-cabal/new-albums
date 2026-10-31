import { fetchJSON, fetchText, similarity, decodeEntities } from './util.mjs';

// Accept a catalog hit only when both artist and title are close enough.
function best(candidates, artist, title) {
  let top = null;
  for (const c of candidates) {
    const a = similarity(artist, c.artist);
    const t = similarity(title, c.title);
    if (a < 0.6 || t < 0.6) continue;
    const score = a + t;
    if (!top || score > top.score) top = { ...c, score };
  }
  return top;
}

const itunesAlbum = (r) => ({
  artist: r.artistName,
  title: r.collectionName,
  url: r.collectionViewUrl?.replace(/\?.*$/, ''),
  cover: r.artworkUrl100?.replace('100x100bb', '600x600bb'),
  releaseDate: r.releaseDate,
});

// iTunes Search allows ~20 req/min.
const itunes = (path) => fetchJSON(`https://itunes.apple.com/${path}&country=US`, { gap: 3200 });

async function appleMusic(artist, title) {
  const term = encodeURIComponent(`${artist} ${title}`);
  const data = await itunes(`search?term=${term}&entity=album&limit=15`);
  const hit = best((data.results ?? []).map(itunesAlbum), artist, title);
  if (hit) return hit;

  // The keyword index lags for new releases; the artist's discography (lookup) is current.
  const mainArtist = artist.split(/\s+(?:\/|&|x|and|feat\.?)\s+|,\s*/i)[0];
  const artists = await itunes(`search?term=${encodeURIComponent(mainArtist)}&entity=musicArtist&limit=5`);
  const match = (artists.results ?? []).find((r) => similarity(mainArtist, r.artistName) >= 0.8);
  if (!match) return null;
  const albums = await itunes(`lookup?id=${match.artistId}&entity=album&limit=200&sort=recent`);
  const candidates = (albums.results ?? []).filter((r) => r.wrapperType === 'collection').map(itunesAlbum);
  // Artist identity is already established via the lookup, so only the title needs to match.
  return best(candidates.map((c) => ({ ...c, artist })), artist, title);
}

async function deezer(artist, title) {
  const q = encodeURIComponent(`${artist} ${title}`);
  const data = await fetchJSON(`https://api.deezer.com/search/album?q=${q}&limit=15`, { gap: 250 });
  return best(
    (data.data ?? []).map((r) => ({ artist: r.artist?.name, title: r.title, url: r.link, cover: r.cover_xl })),
    artist,
    title,
  );
}

let spotifyToken;
async function getSpotifyToken() {
  const { SPOTIFY_CLIENT_ID: id, SPOTIFY_CLIENT_SECRET: secret } = process.env;
  if (!id || !secret) return null;
  if (spotifyToken && spotifyToken.expires > Date.now()) return spotifyToken.value;
  const body = await fetchText('https://accounts.spotify.com/api/token', {
    method: 'POST',
    body: 'grant_type=client_credentials',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });
  const json = JSON.parse(body);
  spotifyToken = { value: json.access_token, expires: Date.now() + (json.expires_in - 60) * 1000 };
  return spotifyToken.value;
}

export async function spotify(artist, title) {
  const token = await getSpotifyToken();
  if (!token) return null;
  const q = encodeURIComponent(`${artist} ${title}`);
  const data = await fetchJSON(`https://api.spotify.com/v1/search?type=album&limit=10&q=${q}`, {
    gap: 250,
    headers: { Authorization: `Bearer ${token}` },
  });
  return best(
    (data.albums?.items ?? []).map((r) => ({
      artist: r.artists?.map((a) => a.name).join(', '),
      title: r.name,
      url: r.external_urls?.spotify,
      cover: r.images?.[0]?.url,
      releaseDate: r.release_date,
    })),
    artist,
    title,
  );
}

// YouTube Music albums are auto-generated "OLAK5uy_" playlists, findable through the YouTube Data API.
// Each search costs 100 of the 10,000 daily quota units. Returns { hit, top } so misses can be logged.
export async function youtubeMusic(artist, title) {
  const key = process.env.YOUTUBE_API_KEY;
  const q = encodeURIComponent(`${artist} ${title}`);
  const data = await fetchJSON(
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=playlist&maxResults=10&q=${q}&key=${key}`,
  );
  const candidates = (data.items ?? [])
    .filter((r) => r.id?.playlistId?.startsWith('OLAK5uy_'))
    .map((r) => ({
      artist: decodeEntities(r.snippet?.channelTitle ?? '').replace(/\s+-\s+Topic$/, ''),
      title: decodeEntities(r.snippet?.title ?? '').replace(/^Album\s+-\s+/, ''),
      url: `https://music.youtube.com/playlist?list=${r.id.playlistId}`,
    }));
  return { hit: best(candidates, artist, title), top: candidates[0] ?? null };
}

async function safe(fn, label, artist, title) {
  try {
    return await fn(artist, title);
  } catch (err) {
    console.warn(`  ! ${label}: ${err.message}`);
    return undefined; // undefined = error (retry later), null = not found
  }
}

export const searchLinks = (artist, title) => {
  const q = encodeURIComponent(`${artist} ${title}`);
  return {
    spotify: { url: `https://open.spotify.com/search/${q}/albums`, exact: false },
    appleMusic: { url: `https://music.apple.com/us/search?term=${q}`, exact: false },
    youtubeMusic: { url: `https://music.youtube.com/search?q=${q}`, exact: false },
    bandcamp: { url: `https://bandcamp.com/search?q=${q}&item_type=a`, exact: false },
  };
};

export async function resolveLinks({ artist, title, listenUrls = [] }) {
  const [am, dz, sp] = [
    await safe(appleMusic, 'Apple Music', artist, title),
    await safe(deezer, 'Deezer', artist, title),
    await safe(spotify, 'Spotify', artist, title),
  ];
  const links = searchLinks(artist, title);
  if (sp?.url) links.spotify = { url: sp.url, exact: true };
  if (am?.url) links.appleMusic = { url: am.url, exact: true };
  if (dz?.url) links.deezer = { url: dz.url, exact: true };
  for (const u of listenUrls) {
    if (/bandcamp\.com\/album\//.test(u)) links.bandcamp = { url: u, exact: true };
    else if (/qobuz\.com/.test(u)) links.qobuz = { url: u, exact: true };
  }
  return {
    links,
    cover: am?.cover ?? sp?.cover ?? dz?.cover ?? null,
    releaseDate: (am?.releaseDate ?? sp?.releaseDate ?? null)?.slice(0, 10) ?? null,
    hadErrors: [am, dz, sp].includes(undefined),
    complete: Boolean(am?.url && (sp?.url || !process.env.SPOTIFY_CLIENT_ID)),
  };
}
