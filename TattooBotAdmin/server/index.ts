// server/index.ts
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import path from "path";
import fs from "fs";
import uploadRouter from "./routes/upload";

import { db } from "./db";
import { runMigrations } from "./migrations";
import { getStorage } from "./storage";

const app = express();

// Disable automatic ETag generation so API responses are never served with 304
// status codes that break fetch callers expecting JSON bodies.
app.set("etag", false);
app.disable("x-powered-by");

// Prevent browsers and intermediary caches from keeping API responses. We also
// strip conditional request headers so Express never downgrades the status code
// to 304, which would otherwise leave fetch callers without a JSON body.
app.use((req, res, next) => {
  if (req.path.startsWith("/api")) {
    const headers = req.headers as Record<string, unknown>;
    Reflect.deleteProperty(headers, "if-none-match");
    Reflect.deleteProperty(headers, "if-modified-since");

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
  }
  next();
});

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
app.use("/uploads", express.static(UPLOAD_DIR));
app.use("/api", uploadRouter);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const started = Date.now();
  const p = req.path;
  let captured: any;
  const origJson = res.json.bind(res);
  (res as any).json = (body: any, ...args: any[]) => {
    if (p.startsWith("/api")) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.setHeader("Surrogate-Control", "no-store");
      res.removeHeader("Last-Modified");
      res.removeHeader("ETag");
      if (res.statusCode === 304) {
        res.status(200);
      }
    }
    captured = body;
    return origJson(body, ...args);
  };
  res.on("finish", () => {
    if (!p.startsWith("/api")) return;
    let line = `${req.method} ${p} ${res.statusCode} in ${Date.now() - started}ms`;
    if (captured) line += ` :: ${JSON.stringify(captured)}`;
    if (line.length > 80) line = line.slice(0,79) + "…";
    log(line);
  });
  next();
});

(async () => {
  await runMigrations(db);

  getStorage();

  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    console.error(err);
  });

  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen({ port, host: "0.0.0.0", reusePort: true }, () => { log(`serving on port ${port}`); });
})();
