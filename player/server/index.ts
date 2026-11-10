import express, { type ErrorRequestHandler } from "express";
import { existsSync, statSync } from "node:fs";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PackageError } from "./package";
import { CourseStore } from "./store";

const playerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(playerRoot, "data");
const sampleDir = path.join(playerRoot, "sample");
const port = Number(process.env.PLAYER_PORT || 4173);
const production = process.env.NODE_ENV === "production";

const store = new CourseStore(dataDir, sampleDir);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024, files: 1 },
});

const app = express();
app.disable("x-powered-by");

app.get("/api/courses", (_req, res) => {
  res.json(store.list());
});

app.get("/api/courses/:courseId", (req, res) => {
  const course = store.get(req.params.courseId);
  if (!course) {
    res.status(404).json({ error: "That course is not in the library." });
    return;
  }
  res.json(course);
});

app.post("/api/courses", (req, res) => {
  upload.single("package")(req, res, (error) => {
    if (error) {
      const tooLarge = typeof error === "object" && error && "code" in error && error.code === "LIMIT_FILE_SIZE";
      res.status(400).json({
        error: tooLarge ? "The ZIP is larger than 200 MB." : "The upload could not be read.",
      });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "Choose a SCORM ZIP to upload." });
      return;
    }
    try {
      res.status(201).json(store.importZip(req.file.buffer));
    } catch (importError) {
      const message =
        importError instanceof PackageError ? importError.message : "The package could not be imported.";
      res.status(400).json({ error: message });
    }
  });
});

app.delete("/api/courses/:courseId", (req, res) => {
  if (!store.remove(req.params.courseId)) {
    res.status(404).json({ error: "That course cannot be removed." });
    return;
  }
  res.status(204).end();
});

app.post("/api/courses/:courseId/reset", (req, res) => {
  if (!store.reset(req.params.courseId)) {
    res.status(404).json({ error: "That course is not in the library." });
    return;
  }
  res.status(204).end();
});

app.post(
  "/api/scorm/attempts/:attemptId/commit",
  express.text({ type: "*/*", limit: "2mb" }),
  (req, res) => {
    let body: unknown = {};
    const raw = typeof req.body === "string" ? req.body.trim() : "";
    if (raw) {
      try {
        body = JSON.parse(raw) as unknown;
      } catch {
        res.status(400).json({ result: "false", errorCode: 101 });
        return;
      }
    }
    try {
      store.commit(req.params.attemptId, body, req.query.terminate === "true");
      res.json({ result: "true", errorCode: 0 });
    } catch {
      res.status(404).json({ result: "false", errorCode: 101 });
    }
  },
);

app.use("/content/:courseId", (req, res) => {
  const root = store.contentRoot(req.params.courseId);
  if (!root) {
    res.status(404).end();
    return;
  }
  const requested = decodeURIComponent((req.url || "/").split("?")[0] ?? "/").replace(/^\/+/, "");
  const base = path.resolve(root);
  const file = path.resolve(base, requested);
  if (file !== base && !file.startsWith(base + path.sep)) {
    res.status(400).end();
    return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.status(404).end();
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
  res.sendFile(file, (error) => {
    if (error && !res.headersSent) res.status(404).end();
  });
});

const reportError: ErrorRequestHandler = (error, _req, res, _next) => {
  console.error(error);
  if (!res.headersSent) res.status(500).json({ error: "The player hit an unexpected error." });
};
app.use(reportError);

if (!production) {
  const vite = await createViteServer({
    root: playerRoot,
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  const dist = path.join(playerRoot, "dist");
  app.use(express.static(dist));
  app.get(/^(?!\/api\/|\/content\/).*/, (_req, res) => {
    res.sendFile(path.join(dist, "index.html"));
  });
}

app.listen(port, () => {
  console.log(`Aspire TSS player: http://localhost:${port}`);
});
