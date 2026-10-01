const http = require("http");
const https = require("https");
const fs = require("fs");
const crypto = require("crypto");
const net = require("net");
const { WebSocketServer } = require("ws");

const { parseVlessHeader } = require("./src/vless");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const WS_PATH = process.env.WS_PATH || "/api/ws";
const UUID = (process.env.UUID || "").trim().toLowerCase();
const MAX_HEADER_BYTES = Number(process.env.MAX_HEADER_BYTES || 4096);
const CONNECT_TIMEOUT_MS = Number(process.env.CONNECT_TIMEOUT_MS || 10000);
const IDLE_TIMEOUT_MS = Number(process.env.IDLE_TIMEOUT_MS || 0);
const ALLOWED_HOST = (process.env.ALLOWED_HOST || "").trim().toLowerCase();

if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(UUID)) {
  console.error("Invalid UUID. Set UUID to a valid VLESS UUID.");
  process.exit(1);
}

const tlsEnabled = process.env.TLS_ENABLED === "true";
const tlsKey = process.env.TLS_KEY_FILE;
const tlsCert = process.env.TLS_CERT_FILE;

function makeServer(requestHandler) {
  if (!tlsEnabled) return http.createServer(requestHandler);
  if (!tlsKey || !tlsCert) throw new Error("TLS_ENABLED=true requires TLS_KEY_FILE and TLS_CERT_FILE");
  return https.createServer({
    key: fs.readFileSync(tlsKey),
    cert: fs.readFileSync(tlsCert)
  }, requestHandler);
}

const server = makeServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/health" || url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end("ok\n");
    return;
  }

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("not found\n");
});

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 16 * 1024 * 1024,
  perMessageDeflate: false
});

server.on("upgrade", (req, socket, head) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const host = String(req.headers.host || "").toLowerCase().split(":")[0];

    if (url.pathname !== WS_PATH) {
      socket.destroy();
      return;
    }

    if (ALLOWED_HOST && host !== ALLOWED_HOST) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, ws => {
      wss.emit("connection", ws, req);
    });
  } catch {
    socket.destroy();
  }
});

wss.on("connection", (ws, req) => {
  let tcp = null;
  let authenticated = false;
  let connected = false;
  let closed = false;
  let headerBuffer = Buffer.alloc(0);
  let pendingToTcp = [];
  let pendingBytes = 0;
  let idleTimer = null;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (idleTimer) clearTimeout(idleTimer);
    pendingToTcp = [];
    pendingBytes = 0;
    if (tcp) tcp.destroy();
    if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
      try { ws.close(); } catch {}
    }
  };

  const resetIdle = () => {
    if (!IDLE_TIMEOUT_MS) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(cleanup, IDLE_TIMEOUT_MS);
  };

  const sendVlessResponse = () => {
    // VLESS response header: version + addons length + addons
    if (ws.readyState === ws.OPEN) ws.send(Buffer.from([0x01, 0x00]));
  };

  const flushPending = () => {
    if (!tcp || !connected || tcp.destroyed) return;
    while (pendingToTcp.length) {
      const chunk = pendingToTcp[0];
      const ok = tcp.write(chunk);
      pendingToTcp.shift();
      pendingBytes -= chunk.length;
      if (!ok) {
        ws.pause();
        tcp.once("drain", () => {
          if (!closed) ws.resume();
        });
        return;
      }
    }
  };

  const connectTarget = (target) => {
    return new Promise((resolve, reject) => {
      tcp = net.createConnection({ host: target.address, port: target.port });
      tcp.setNoDelay(true);
      tcp.setKeepAlive(true, 30000);
      tcp.setTimeout(0);

      const timer = setTimeout(() => {
        tcp.destroy();
        reject(new Error("target connect timeout"));
      }, CONNECT_TIMEOUT_MS);

      tcp.once("connect", () => {
        clearTimeout(timer);
        connected = true;
        sendVlessResponse();
        flushPending();
        resolve();
      });

      tcp.once("error", err => {
        clearTimeout(timer);
        if (!connected) reject(err);
      });

      tcp.on("data", chunk => {
        resetIdle();
        if (ws.readyState !== ws.OPEN) return;

        // ws handles WebSocket framing/fragmentation. We only send application data.
        const ok = ws.send(chunk, { binary: true }, err => {
          if (err) cleanup();
        });

        // ws.send does not expose a TCP-like drain event; use bufferedAmount as
        // a bounded backpressure signal and pause the TCP source while it grows.
        if (ws.bufferedAmount > 4 * 1024 * 1024) {
          tcp.pause();
          const poll = setInterval(() => {
            if (closed || !tcp) {
              clearInterval(poll);
              return;
            }
            if (ws.bufferedAmount < 1024 * 1024) {
              clearInterval(poll);
              tcp.resume();
            }
          }, 25);
        }
      });

      tcp.on("end", () => {
        if (!closed && ws.readyState === ws.OPEN) ws.close(1000, "target closed");
      });

      tcp.on("close", () => {
        if (!closed && ws.readyState === ws.OPEN) ws.close(1000, "target closed");
      });
    });
  };

  ws.on("message", async (data, isBinary) => {
    resetIdle();
    if (closed) return;

    const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);

    try {
      if (!authenticated) {
        headerBuffer = Buffer.concat([headerBuffer, chunk]);
        if (headerBuffer.length > MAX_HEADER_BYTES) {
          cleanup();
          return;
        }

        const parsed = parseVlessHeader(headerBuffer, UUID);
        if (!parsed.complete) return;

        authenticated = true;
        headerBuffer = Buffer.alloc(0);

        await connectTarget(parsed.target);

        if (parsed.payload.length) {
          pendingToTcp.push(parsed.payload);
          pendingBytes += parsed.payload.length;
          if (pendingBytes > 8 * 1024 * 1024) {
            cleanup();
            return;
          }
          flushPending();
        }
        return;
      }

      if (!connected || !tcp || tcp.destroyed) return;

      pendingToTcp.push(chunk);
      pendingBytes += chunk.length;

      if (pendingBytes > 8 * 1024 * 1024) {
        cleanup();
        return;
      }

      flushPending();
    } catch (err) {
      cleanup();
    }
  });

  ws.on("error", cleanup);
  ws.on("close", cleanup);
  ws._socket?.setNoDelay?.(true);
  ws._socket?.setKeepAlive?.(true, 30000);
  resetIdle();
});

server.on("error", err => {
  console.error("server error:", err);
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log(`VLESS WebSocket relay listening on ${tlsEnabled ? "https" : "http"}://${HOST}:${PORT}${WS_PATH}`);
});
