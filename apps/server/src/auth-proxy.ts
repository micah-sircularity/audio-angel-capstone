import { request as httpsRequest } from "node:https";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";

/** Preserve the registered Tailscale callback while auth runs in Convex Cloud. */
export function proxyAuth(req: IncomingMessage, res: ServerResponse, origin: string) {
  const upstream = new URL(origin);
  if (upstream.protocol !== "https:" || !/^[a-z0-9-]+\.convex\.site$/.test(upstream.hostname) || upstream.username || upstream.password || upstream.port) {
    res.writeHead(503, {"Content-Type":"application/json"});
    res.end(JSON.stringify({message:"The account backend is not configured correctly."}));
    return;
  }
  const headers: IncomingHttpHeaders = {...req.headers, host: upstream.host};
  delete headers.connection;
  delete headers["forwarded"];
  delete headers["x-forwarded-host"];
  delete headers["x-forwarded-proto"];
  const proxy = httpsRequest({
    hostname: upstream.hostname,
    path: req.url,
    method: req.method,
    headers,
  }, response => {
    // Pass redirects and separate Set-Cookie headers through unchanged.
    res.writeHead(response.statusCode ?? 502, {...response.headers,"cache-control":"no-store"});
    response.pipe(res);
  });
  proxy.setTimeout(20_000, () => proxy.destroy(new Error("Auth upstream timeout")));
  proxy.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(502, {"Content-Type":"application/json","Cache-Control":"no-store"});
      res.end(JSON.stringify({message:"The account service could not be reached. Try again."}));
    } else res.end();
  });
  req.on("aborted", () => proxy.destroy());
  req.pipe(proxy);
}
