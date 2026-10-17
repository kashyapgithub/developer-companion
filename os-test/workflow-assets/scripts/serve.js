// -----------------------------------------------------------------------------
// serve.js
//
// Zero-dependency local static HTTP server using Node.js built-in modules.
// Used by the GitHub Actions runner when testing directly from repository files,
// allowing Playwright to test HTML/CSS/JS without needing public web hosting.
//
// Usage: node scripts/serve.js [port] [rootDir]
// -----------------------------------------------------------------------------

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = parseInt(process.env.PORT || process.argv[2] || "3000", 10);
const ROOT_DIR = path.resolve(process.argv[3] || process.cwd());

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
};

const server = http.createServer((req, res) => {
  try {
    // Parse URL and normalize path
    const parsedUrl = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    let decodedPath = decodeURIComponent(parsedUrl.pathname);

    // Prevent directory traversal
    const safePath = path.normalize(decodedPath).replace(/^(\.\.[/\\])+/, "");
    let filePath = path.join(ROOT_DIR, safePath);

    // Check if target is a directory, look for index.html
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<h1>404 Not Found</h1><p>File not found: ${safePath}</p>`);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    res.writeHead(200, {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache",
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`Server Error: ${err.message}`);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Local repo server running at http://127.0.0.1:${PORT}/ (root: ${ROOT_DIR})`);
});
