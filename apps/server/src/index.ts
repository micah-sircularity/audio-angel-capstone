import { proxyAuth } from "./auth-proxy";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { Config, Effect, Schema } from "effect";
import { HealthResponse, ApiError } from "@audio-angel/contracts";
import { LrclibProvider } from "./lrclib";
import { handleLyricsRoute } from "./lyrics-route";
import { TaddyProvider } from "./taddy";
import { handlePodcastTranscriptRoute } from "./podcast-route";

const config = Effect.all({
  authUpstream: Config.string("AUTH_UPSTREAM_URL").pipe(Config.withDefault("")),
  port: Config.integer("PORT").pipe(Config.withDefault(3101)),
  host: Config.string("HOST").pipe(Config.withDefault("0.0.0.0")),
  staticDir: Config.string("STATIC_DIR").pipe(
    Config.withDefault("../app/dist"),
  ),
});
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};
Effect.runPromise(config)
  .then(({ port, host, staticDir, authUpstream }) => {
    const root = resolve(staticDir);
    const lyricsProvider = new LrclibProvider({ fetch });
    const taddyProvider = new TaddyProvider({
      fetch,
      userId: process.env.TADDY_USER_ID ?? "",
      apiKey: process.env.TADDY_API_KEY ?? "",
    });
    const server = createServer((req, res) => {
      const json = (
        status: number,
        value: unknown,
        headers?: Record<string, string>,
      ) => {
        res.writeHead(status, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          ...headers,
        });
        res.end(JSON.stringify(value));
      };
      const request = Effect.tryPromise(async () => {
        const pathname = new URL(req.url ?? "/", "http://server").pathname;
        if (authUpstream && pathname.startsWith("/api/auth/")) {
          proxyAuth(req, res, authUpstream);
          return;
        }
        if (pathname === "/health" && req.method === "GET") {
          json(
            200,
            Schema.decodeUnknownSync(HealthResponse)({
              status: "ok",
              service: "audio-angel",
              mode: "scaffold",
            }),
          );
          return;
        }
        if (pathname === "/api/lyrics") {
          const result = await handleLyricsRoute(
            new URL(req.url ?? "/", "http://server"),
            req.method ?? "GET",
            lyricsProvider,
          );
          if (result)
            json(result.status, result.body, result.headers);
          return;
        }
        if (pathname === "/api/podcast-transcript") {
          const result = await handlePodcastTranscriptRoute(
            new URL(req.url ?? "/", "http://server"),
            req.method ?? "GET",
            taddyProvider,
          );
          if (result)
            json(result.status, result.body, result.headers);
          return;
        }
        if (pathname.startsWith("/api/")) {
          json(
            501,
            Schema.decodeUnknownSync(ApiError)({
              error: {
                code: "NOT_IMPLEMENTED",
                message: "This API endpoint is not implemented.",
              },
            }),
          );
          return;
        }
        if (req.method !== "GET" && req.method !== "HEAD") {
          json(405, {
            error: { code: "METHOD_NOT_ALLOWED", message: "Use GET or HEAD." },
          });
          return;
        }
        let file = resolve(root, "." + decodeURIComponent(pathname));
        if (file !== root && !file.startsWith(root + sep)) {
          json(403, { error: { code: "FORBIDDEN", message: "Invalid path." } });
          return;
        }
        try {
          if ((await stat(file)).isDirectory())
            file = resolve(file, "index.html");
          await stat(file);
        } catch {
          if (extname(pathname)) {
            json(404, {
              error: { code: "NOT_FOUND", message: "File not found." },
            });
            return;
          }
          file = resolve(root, "index.html");
        }
        const body = await readFile(file);
        res.writeHead(200, {
          "Content-Type": types[extname(file)] ?? "application/octet-stream",
          "Cache-Control": pathname.startsWith("/auth/")
            ? "no-store"
            : extname(file) === ".html" || file.endsWith("sw.js")
              ? "no-cache"
              : "public, max-age=3600",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(req.method === "HEAD" ? undefined : body);
      }).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            console.error("request_failed", String(error));
            if (!res.headersSent)
              json(503, {
                error: {
                  code: "UNAVAILABLE",
                  message: "Build the web app before serving it.",
                },
              });
            else res.end();
          }),
        ),
      );
      void Effect.runPromise(request);
    });
    server.listen(port, host, () =>
      console.log(`Audio Angel listening on ${host}:${port}`),
    );
    for (const signal of ["SIGTERM", "SIGINT"] as const)
      process.on(signal, () => server.close(() => process.exit(0)));
  })
  .catch((error) => {
    console.error("configuration_failed", error);
    process.exitCode = 1;
  });
