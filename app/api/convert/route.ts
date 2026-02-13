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
    const playlistUrl = typeof body.playlistUrl === 'string' ? body.playlistUrl.trim() : '';

    if (!playlistUrl || !playlistUrl.includes('spotify.com/playlist')) {
      return createError('Veuillez fournir une URL de playlist Spotify publique valide.');
    }

    const { default: play } = await import('play-dl');

    // Validate and fetch playlist metadata
    let playlist: any;
    try {
      playlist = await play.spotify(playlistUrl);
      if (!playlist || playlist.type !== 'playlist') {
        return createError("L'URL fournie n'est pas une playlist Spotify.");
      }
      if (typeof playlist.fetch === 'function') {
        await playlist.fetch();
      }
    } catch (err: any) {
      return createError("Impossible de lire la playlist. Assurez-vous qu'elle est publique.", 404);
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
            JSON.stringify({ type: 'done', playlistUrl: playlistLink, total, found: ids.length }) + '\n'
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
