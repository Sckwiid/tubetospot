// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const encoder = new TextEncoder();

const jsonError = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export async function POST(req: NextRequest) {
  try {
    const { playlistUrl, mode } = await req.json();
    console.log('Incoming request:', { playlistUrl, mode });
    let normalizedMode: 'spotify-to-youtube' | 'youtube-to-spotify' =
      mode === 'youtube-to-spotify' ? 'youtube-to-spotify' : 'spotify-to-youtube';
    const url = typeof playlistUrl === 'string' ? playlistUrl.trim() : '';

    if (!url) return jsonError('Merci de fournir une URL de playlist.');

    const cleanUrl = url.split('#')[0];

    // Auto-detect mode from URL to avoid 400 when the toggle isn't synced
    if (cleanUrl.includes('youtube.com') || cleanUrl.includes('youtu.be')) {
      normalizedMode = 'youtube-to-spotify';
    }
    if (cleanUrl.includes('spotify.com/playlist')) {
      normalizedMode = 'spotify-to-youtube';
    }
    const { default: play } = await import('play-dl');
    const playAny = play as any;

    // Optional token: helps avoid Spotify rate limits; refresh_token left empty intentionally.
    if (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) {
      const tokenConfig = {
        spotify: {
          client_id: process.env.SPOTIFY_CLIENT_ID!,
          client_secret: process.env.SPOTIFY_CLIENT_SECRET!,
          refresh_token: '',
          market: 'FR'
        }
      };
      try {
        await playAny.setToken(tokenConfig as any); // force past the refresh_token typing requirement
      } catch {
        // Non-blocking if token setup fails
      }
    }

    // --- Branch A: Spotify -> YouTube
    if (normalizedMode === 'spotify-to-youtube') {
      if (!cleanUrl.includes('spotify.com/playlist')) {
        return jsonError('Veuillez fournir une URL de playlist Spotify publique valide.');
      }
      const validation = playAny.validate(cleanUrl);
      if (validation !== 'sp_pl') {
        return jsonError("L'URL fournie ne semble pas être une playlist Spotify.");
      }

      let playlist: any;
      try {
        playlist = await playAny.spotify(cleanUrl);
        if (!playlist || playlist.type !== 'playlist') {
          return jsonError("L'URL fournie n'est pas une playlist Spotify.");
        }
        if (typeof playlist.fetch === 'function') await playlist.fetch();
      } catch {
        return jsonError(
          "Impossible de lire la playlist. Assurez-vous qu'elle est publique et réessayez dans quelques instants.",
          404
        );
      }

      const tracks: any[] = Array.isArray(playlist.tracks)
        ? playlist.tracks
        : typeof playlist.all_tracks === 'function'
        ? await playlist.all_tracks()
        : [];

      if (!tracks.length) return jsonError('Aucune piste trouvée dans cette playlist.');

      const ids: string[] = [];
      const total = tracks.length;

      const stream = new ReadableStream({
        async start(controller) {
          for (let i = 0; i < tracks.length; i++) {
            const track = tracks[i];
            const title = track?.name || 'Unknown';
            const artist = Array.isArray(track?.artists) && track.artists[0]?.name ? track.artists[0].name : '';
            const durationSec = typeof track?.durationInMs === 'number' ? track.durationInMs / 1000 : undefined;

            let videoId: string | undefined;
            const query = `${title} ${artist}`.trim();
            try {
              const results = await playAny.search(query, { limit: 5, source: { youtube: 'video' } });
              if (Array.isArray(results) && results.length) {
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
            } catch {
              // ignore per-track search errors
            }

            if (videoId) ids.push(videoId);

            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  type: 'progress',
                  mode: normalizedMode,
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
            encoder.encode(
              JSON.stringify({ type: 'done', mode: normalizedMode, playlistUrl: playlistLink, total, found: ids.length }) +
                '\n'
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

    // --- Branch B: YouTube -> Spotify (returns search links; no Spotify auth needed)
    const listMatch = cleanUrl.match(/[?&]list=([^&#]+)/);
    const normalizedYtUrl =
      normalizedMode === 'youtube-to-spotify' && listMatch
        ? `https://www.youtube.com/playlist?list=${listMatch[1]}`
        : cleanUrl;

    const ytType = playAny.yt_validate(normalizedYtUrl);
    if (ytType !== 'playlist') return jsonError("Merci de fournir une URL de playlist YouTube valide.");

    let ytPlaylist: any;
    try {
      ytPlaylist = await playAny.playlist_info(normalizedYtUrl, { incomplete: true });
    } catch {
      return jsonError("Impossible de lire la playlist YouTube. Vérifiez qu'elle est publique.", 404);
    }

    const videos = typeof ytPlaylist.all_videos === 'function' ? await ytPlaylist.all_videos() : ytPlaylist.videos || [];
    if (!Array.isArray(videos) || videos.length === 0) return jsonError('Aucune vidéo trouvée dans cette playlist YouTube.');

    const total = videos.length;
    const searches: { title: string; query: string; searchUrl: string; durationSec?: number }[] = [];

    const stream = new ReadableStream({
      async start(controller) {
        for (let i = 0; i < videos.length; i++) {
          const video = videos[i];
          const title = video?.title || 'Unknown';
          const durationSec = video?.durationInSec;
          const [maybeArtist, maybeTitle] = title.split(' - ');
          const query = maybeTitle ? `${maybeArtist} ${maybeTitle}` : title;
          const searchUrl = `https://open.spotify.com/search/${encodeURIComponent(query)}`;

          searches.push({ title, query, searchUrl, durationSec });

          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                type: 'progress',
                mode: normalizedMode,
                current: i + 1,
                total,
                track: title,
                videoId: video?.id
              }) + '\n'
            )
          );
        }

        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              type: 'done',
              mode: normalizedMode,
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
    return jsonError('Erreur serveur inattendue.', 500);
  }
}
