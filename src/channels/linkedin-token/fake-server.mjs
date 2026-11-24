/**
 * Loopback stand-in for the LinkedIn messaging endpoint.
 * It never writes request headers or bodies.
 */
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";

const port = Number(process.argv[2] ?? "0");
const countsPath = process.argv[3] ?? "";
let requests = 0;

function publish() {
  if (!countsPath) return;
  writeFileSync(countsPath, JSON.stringify({ requests }));
}

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ requests }));
    return;
  }
  requests += 1;
  publish();
  const status = Number(req.headers["x-aria-fake-status"] ?? "200");
  const challenge = req.headers["x-aria-challenge"] === "1";
  const slow = req.headers["x-aria-delay"] === "5000";
  const hold = req.headers["x-aria-hold"] === "1";
  req.resume();
  if (hold) {
    req.on("aborted", () => {
      if (!res.writableEnded) res.end();
    });
    return;
  }
  const respond = () => {
    if (challenge) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html>security check</html>");
      return;
    }
    if (status === 429) {
      res.writeHead(429, { "content-type": "application/json" });
      res.end("{}");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"id":"fake-msg"}');
  };
  if (slow) setTimeout(respond, 5000);
  else respond();
});

server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  const chosen = address && typeof address !== "string" ? address.port : port;
  process.stdout.write(`listening ${chosen}\n`);
});
