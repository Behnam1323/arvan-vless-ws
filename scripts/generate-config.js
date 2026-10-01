const crypto = require("crypto");

const uuid = process.env.UUID || crypto.randomUUID();
const host = process.env.PUBLIC_HOST || "film4u.ir";
const port = Number(process.env.PUBLIC_PORT || 443);
const path = process.env.PUBLIC_PATH || "/api/ws";
const tls = String(process.env.PUBLIC_TLS || "true") === "true";
const sni = process.env.PUBLIC_SNI || host;
const name = process.env.PUBLIC_NAME || "film4u-arvan";

const config = {
  v: "2",
  ps: name,
  add: host,
  port,
  id: uuid,
  aid: "0",
  scy: "auto",
  net: "ws",
  type: "none",
  host,
  path,
  tls: tls ? "tls" : "",
  sni,
  alpn: "http/1.1"
};

console.log("UUID:", uuid);
console.log("VLESS URL:");
const params = new URLSearchParams({
  encryption: "none",
  security: tls ? "tls" : "none",
  type: "ws",
  host,
  path,
  sni
});
console.log(`vless://${uuid}@${host}:${port}?${params.toString()}#${encodeURIComponent(name)}`);
console.log("\nJSON:");
console.log(JSON.stringify(config, null, 2));
