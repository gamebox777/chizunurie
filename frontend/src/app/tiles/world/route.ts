import { createReadStream, statSync } from 'fs';
import { join } from 'path';
import { Readable } from 'stream';

// world.pmtiles を HTTP Byte Serving（Range）対応で配信する。
// japan/route.ts と同じ理由（Turbopack の静的配信が Range を無視して pmtiles.js が
// 失敗する）で、世界版の下地 PMTiles もここで自前配信する。
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FILE = join(process.cwd(), 'public', 'data', 'world.pmtiles');

function baseHeaders(): Headers {
  return new Headers({
    'Accept-Ranges': 'bytes',
    'Content-Type': 'application/octet-stream',
    'Cache-Control': 'public, max-age=3600',
  });
}

export async function GET(req: Request) {
  let size: number;
  try {
    size = statSync(FILE).size;
  } catch {
    return new Response('pmtiles not found', { status: 404 });
  }

  const range = req.headers.get('range');
  const match = range ? /bytes=(\d+)-(\d*)/.exec(range) : null;

  if (match) {
    const start = parseInt(match[1], 10);
    const end = match[2] ? parseInt(match[2], 10) : size - 1;
    if (Number.isNaN(start) || start >= size || end >= size || start > end) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}` },
      });
    }
    const headers = baseHeaders();
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    headers.set('Content-Length', String(end - start + 1));
    const stream = Readable.toWeb(
      createReadStream(FILE, { start, end })
    ) as unknown as ReadableStream;
    return new Response(stream, { status: 206, headers });
  }

  const headers = baseHeaders();
  headers.set('Content-Length', String(size));
  const stream = Readable.toWeb(createReadStream(FILE)) as unknown as ReadableStream;
  return new Response(stream, { status: 200, headers });
}
