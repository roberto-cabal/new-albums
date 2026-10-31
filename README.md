# Discos Nuevos

Página que reúne los mejores álbumes nuevos de varias listas curadas y enlaza a dónde escucharlos.

**Listas incluidas**

| Lista | Cómo se obtiene |
| --- | --- |
| [The Needle Drop · Loved List](https://theneedledrop.com/loved-list/2026/) (Anthony 8/10+ y austen) | HTML de la página del año en curso |
| [Pitchfork · Best New Albums](https://pitchfork.com/reviews/best/albums/) | JSON embebido en la página (incluye calificación, género y portada) |
| [Stereogum · Album of the Week](https://www.stereogum.com/category/reviews/album-of-the-week/) | RSS |
| [The Quietus · Album of the Week](https://thequietus.com/columns/quietus-reviews/album-of-the-week/) | API REST de WordPress (artista y álbum vienen como taxonomías) |
| Bandcamp Daily · Album of the Day | **Desactivada**: Bandcamp responde con un bloqueo anti-bot. El código está en `scripts/sources/bandcamp.mjs` |

Los álbumes que aparecen en varias listas se fusionan en una sola tarjeta (filtro “Solo en 2+ listas”).

**Links de escucha**

- **Apple Music**: iTunes Search API (gratis, sin llave).
- **Deezer**: API pública de búsqueda.
- **Spotify**: link directo al álbum si configuras `SPOTIFY_CLIENT_ID` y `SPOTIFY_CLIENT_SECRET`; si no, link de búsqueda.
- **Bandcamp**: link de búsqueda (o directo si la lista ya lo trae).

Los links con fondo sólido van directo al álbum; los punteados son búsquedas.

Cada tarjeta incluye también un link de búsqueda a [Album of the Year](https://www.albumoftheyear.org/) para ver sus calificaciones. AOTY no se integra como lista porque bloquea las peticiones automáticas (Cloudflare) y no tiene API pública.

## Uso local

```bash
npm run update   # descarga listas y genera public/data/albums.json
npm run dev      # sirve el sitio en http://localhost:8080
```

No hay dependencias; requiere Node 20+.

## Publicar con actualización automática (GitHub Pages)

1. Crea un repo en GitHub y sube este proyecto a la rama `main`.
2. En **Settings → Pages**, elige **Source: GitHub Actions**.
3. (Opcional) En **Settings → Secrets and variables → Actions** agrega `SPOTIFY_CLIENT_ID` y `SPOTIFY_CLIENT_SECRET` (créalos en <https://developer.spotify.com/dashboard>).
4. El workflow `.github/workflows/update.yml` corre cada 3 horas: actualiza las listas, guarda `albums.json` en el repo y vuelve a publicar el sitio. También puedes lanzarlo a mano desde la pestaña **Actions**.

La página vuelve a consultar los datos cada 10 minutos mientras está abierta.

## Agregar otra lista

Crea un archivo en `scripts/sources/` que exporte `{ id, name, list, homepage, fetch() }`, donde `fetch` devuelve `[{ artist, title, url, date?, score?, genre?, cover?, note? }]`, y regístralo en `scripts/sources/index.mjs`. Añade su color en `SOURCE_COLORS` de `public/app.js`.
