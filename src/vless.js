const net = require("net");

function uuidToBuffer(uuid) {
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}

function parseAddress(buf, offset, atyp) {
  if (atyp === 0x01) { // IPv4
    if (buf.length < offset + 4) return null;
    return {
      address: Array.from(buf.subarray(offset, offset + 4)).join("."),
      next: offset + 4
    };
  }

  if (atyp === 0x02) { // Domain
    if (buf.length < offset + 1) return null;
    const len = buf[offset];
    if (buf.length < offset + 1 + len) return null;
    return {
      address: buf.subarray(offset + 1, offset + 1 + len).toString("utf8"),
      next: offset + 1 + len
    };
  }

  if (atyp === 0x03) { // IPv6
    if (buf.length < offset + 16) return null;
    const parts = [];
    for (let i = 0; i < 16; i += 2) {
      parts.push(buf.readUInt16BE(offset + i).toString(16));
    }
    return {
      address: parts.join(":"),
      next: offset + 16
    };
  }

  throw new Error("unsupported address type");
}

function parseVlessHeader(buf, expectedUuid) {
  // Minimum: version(1) + UUID(16) + addonsLen(1) + command(1) + port(2) + atyp(1)
  if (buf.length < 22) return { complete: false };

  const version = buf[0];
  if (version !== 0x01) throw new Error("unsupported VLESS version");

  const expected = uuidToBuffer(expectedUuid);
  if (!buf.subarray(1, 17).equals(expected)) throw new Error("bad UUID");

  const addonsLen = buf[17];
  const commandOffset = 18 + addonsLen;
  if (buf.length < commandOffset + 4) return { complete: false };

  const command = buf[commandOffset];
  if (command !== 0x01) throw new Error("only TCP command is supported");

  const port = buf.readUInt16BE(commandOffset + 1);
  const atyp = buf[commandOffset + 3];

  const address = parseAddress(buf, commandOffset + 4, atyp);
  if (!address) return { complete: false };

  const payloadOffset = address.next;
  return {
    complete: true,
    target: { address: address.address, port },
    payload: buf.subarray(payloadOffset)
  };
}

module.exports = { parseVlessHeader };
