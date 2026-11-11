import { createReadStream } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";

/** Single-range media responses let browsers seek without downloading the whole recording. */
export function serveAudio(
  req: IncomingMessage,
  res: ServerResponse,
  file: string,
  size: number,
) {
  const headers = {
    "Content-Type": "audio/mpeg",
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  };
  const range = req.headers["if-range"] ? undefined : req.headers.range;
  let start = 0;
  let end = size - 1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match && (match[1] || match[2])) {
      start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    } else {
      start = size;
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
      res.writeHead(416, { ...headers, "Content-Range": `bytes */${size}`, "Content-Length": 0 });
      res.end();
      return;
    }
  }
  res.writeHead(range ? 206 : 200, {
    ...headers,
    "Content-Length": Math.max(0, end - start + 1),
    ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
  });
  if (req.method === "HEAD" || size === 0) {
    res.end();
    return;
  }
  createReadStream(file, { start, end }).on("error", () => res.destroy()).pipe(res);
}
