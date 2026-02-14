import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const textEncoder = new TextEncoder();

function createError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const mode: 'spotify-to-youtube' | 'youtube-to-spotify' =
      body.mode === 'youtube-to-spotify' ? 'youtube-to-spotify' : 'spotify-to-youtube';
    const playlistUrl = typeof body.playlistUrl === 'string' ? body.playlistUrl.trim() : '';

    if (!playlistUrl) {
      return createError("Merci de fournir une URL de playlist.");
    }

    const cleanUrl = playlistUrl.split('?')[0];

    const { default: play } = await import('play-dl');

    // Optional token to reduce rate limits on Spotify; refresh_token left empty on purpose
await play.setToken({
  spotify: {
    client_id: process.env.SPOTIFY_CLIENT_ID!,
    client_secret: process.env.SPOTIFY_CLIENT_SECRET!,
    refresh_token: '', // On met une chaîne vide pour satisfaire le type
    market: 'US'
  } as any // Ce "as any" est la clé pour ignorer l'erreur TypeScript
});

    // --- Branch: Spotify -> YouTube
    if (mode === 'spotify-to-youtube') {
      if (!cleanUrl.includes('spotify.com/playlist')) {
        return createError('Veuillez fournir une URL de playlist Spotify publique valide.');
      }

      const validation = play.validate(cleanUrl);
      if (validation !== 'sp_pl') {
        return createError("L'URL fournie ne semble pas être une playlist Spotify.");
      }

      // Validate and fetch playlist metadata
      let playlist: any;
      try {
        playlist = await play.spotify(cleanUrl);
        if (!playlist || playlist.type !== 'playlist') {
          return createError("L'URL fournie n'est pas une playlist Spotify.");
        }
        if (typeof playlist.fetch === 'function') {
          await playlist.fetch();
        }
      } catch (err: any) {
        return createError(
          "Impossible de lire la playlist. Assurez-vous qu'elle est publique et réessayez dans quelques instants.",
          404
        );
      }

      // Resolve tracks array from play-dl object
      const tracks: any[] = Array.isArray(playlist.tracks)
        ? playlist.tracks
        : typeof playlist.all_tracks === 'function'
        ? await playlist.all_tracks()
        : [];

      if (!tracks.length) {
        return createError('Aucune piste trouvée dans cette playlist.');
      }

      const ids: string[] = [];
      const total = tracks.length;

      const stream = new ReadableStream({
        async start(controller) {
          for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            const title = track?.name || 'Unknown';
            const artist = Array.isArray(track?.artists) && track.artists[0]?.name ? track.artists[0].name : '';
            const durationSec = typeof track?.durationInMs === 'number' ? track.durationInMs / 1000 : undefined;

            const query = `${title} ${artist}`.trim();
            let videoId: string | undefined;

            try {
              const results = await play.search(query, { limit: 5, source: { youtube: 'video' } });
              if (Array.isArray(results) && results.length) {
                // Simple duration-aware selection
                if (durationSec) {
                  let best = results[0];
                  let bestDelta = Math.abs((best.durationInSec || 0) - durationSec);
                  for (const r of results.slice(1)) {
                    const delta = Math.abs((r.durationInSec || 0) - durationSec);
                    if (delta < bestDelta) {
                      best = r;
                      bestDelta = delta;
                    }
                  }
                  videoId = best.id;
                } else {
                  videoId = results[0].id;
                }
              }
            } catch (err) {
              // Swallow search errors for individual tracks
            }

            if (videoId) {
              ids.push(videoId);
            }

            controller.enqueue(
              textEncoder.encode(
                JSON.stringify({
                  type: 'progress',
                  mode,
                  current: i + 1,
                  total,
                  track: title,
                  artist,
                  videoId
                }) + '\n'
              )
            );
          }

          const playlistLink = ids.length
            ? `https://www.youtube.com/watch_videos?video_ids=${ids.join(',')}`
            : null;

          controller.enqueue(
            textEncoder.encode(
              JSON.stringify({ type: 'done', mode, playlistUrl: playlistLink, total, found: ids.length }) + '\n'
            )
          );
          controller.close();
        }
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'application/x-ndjson',
          'Cache-Control': 'no-store'
        }
      });
    }

    // --- Branch: YouTube -> Spotify (returns search links; no auth needed)
    const ytType = play.yt_validate(cleanUrl);
    if (ytType !== 'playlist') {
      return createError("Merci de fournir une URL de playlist YouTube valide.");
    }

    let ytPlaylist: any;
    try {
      ytPlaylist = await play.playlist_info(cleanUrl, { incomplete: true });
    } catch (err) {
      return createError("Impossible de lire la playlist YouTube. Vérifiez qu'elle est publique.", 404);
    }

    const videos = typeof ytPlaylist.all_videos === 'function' ? await ytPlaylist.all_videos() : ytPlaylist.videos || [];
    if (!Array.isArray(videos) || videos.length === 0) {
      return createError("Aucune vidéo trouvée dans cette playlist YouTube.");
    }

    const total = videos.length;
    const searches: { title: string; query: string; searchUrl: string; durationSec?: number }[] = [];

    const stream = new ReadableStream({
      async start(controller) {
        for (let i = 0; i < videos.length; i++) {
          const video = videos[i];
          const title = video?.title || 'Unknown';
          const durationSec = video?.durationInSec;
          // Try to split artist - title if formatted that way
          const [maybeArtist, maybeTitle] = title.split(' - ');
          const query = maybeTitle ? `${maybeArtist} ${maybeTitle}` : title;
          const searchUrl = `https://open.spotify.com/search/${encodeURIComponent(query)}`;

          searches.push({ title, query, searchUrl, durationSec });

          controller.enqueue(
            textEncoder.encode(
              JSON.stringify({
                type: 'progress',
                mode,
                current: i + 1,
                total,
                track: title,
                videoId: video?.id
              }) + '\n'
            )
          );
        }

        controller.enqueue(
          textEncoder.encode(
            JSON.stringify({
              type: 'done',
              mode,
              total,
              found: searches.length,
              spotifySearches: searches
            }) + '\n'
          )
        );
        controller.close();
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-store'
      }
    });
  } catch (err) {
    return createError('Erreur serveur inattendue.', 500);
  }
}
