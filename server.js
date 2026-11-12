const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const rooms = new Map();

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ status: 'ok', service: 'titan-operative-chat' }));
  }
  const requestPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const safePath = path.normalize(requestPath).replace(/^([.][.][/\\])+/, '');
  const filePath = path.join(PUBLIC, safePath);
  if (!filePath.startsWith(PUBLIC)) return respond(res, 403, 'Forbidden');
  fs.readFile(filePath, (error, data) => {
    if (error) return respond(res, error.code === 'ENOENT' ? 404 : 500, 'Not found');
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
    res.writeHead(200, { 'Content-Type': `${types[path.extname(filePath)] || 'text/plain'}; charset=utf-8` });
    res.end(data);
  });
});

function respond(res, status, message) { res.writeHead(status); res.end(message); }

const sockets = new Set();

function openSocket(socket) {
  socket.wsOpen = true;
  socket.clientId = crypto.randomUUID().slice(0, 8);
  socket.on('error', () => {});
  socket.sendJson = (payload) => {
    const body = Buffer.from(JSON.stringify(payload));
    let header;
    if (body.length < 126) header = Buffer.from([0x81, body.length]);
    else if (body.length < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(body.length, 2); }
    else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(body.length), 2); }
    socket.write(Buffer.concat([header, body]));
  };
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
  socket.on('data', (chunk) => consumeFrames(socket, chunk));
  return socket;
}

function consumeFrames(socket, chunk) {
  socket.frameBuffer = Buffer.concat([socket.frameBuffer || Buffer.alloc(0), chunk]);
  while (socket.frameBuffer.length >= 2) {
    const first = socket.frameBuffer[0]; const second = socket.frameBuffer[1];
    const opcode = first & 0x0f; const masked = (second & 0x80) !== 0; let length = second & 0x7f; let offset = 2;
    if (length === 126) { if (socket.frameBuffer.length < 4) return; length = socket.frameBuffer.readUInt16BE(2); offset = 4; }
    if (length === 127) { if (socket.frameBuffer.length < 10) return; length = Number(socket.frameBuffer.readBigUInt64BE(2)); offset = 10; }
    if (masked) offset += 4;
    if (socket.frameBuffer.length < offset + length) return;
    const frame = socket.frameBuffer.subarray(0, offset + length); socket.frameBuffer = socket.frameBuffer.subarray(offset + length);
    if (opcode === 8) return socket.end();
    if (opcode !== 1) continue;
    let payload = frame.subarray(offset);
    if (masked) { const key = frame.subarray(offset - 4, offset); payload = Buffer.from(payload); for (let index = 0; index < payload.length; index += 1) payload[index] ^= key[index % 4]; }
    handleMessage(socket, payload.toString());
  }
}

function send(socket, payload) {
  if (socket.wsOpen) socket.sendJson(payload);
}

function broadcast(room, payload, except) {
  room.forEach((client) => { if (client !== except) send(client, payload); });
}

function roomInfo(room) {
  return [...room].map((client) => ({ id: client.clientId, name: client.displayName, role: client.role }));
}

function handleMessage(socket, raw) {
  let message;
  try { message = JSON.parse(raw); } catch { return send(socket, { type: 'error', message: 'Malformed transmission.' }); }

    if (message.type === 'join') {
      const roomCode = String(message.room || 'ALPHA-01').trim().toUpperCase().slice(0, 24);
      const displayName = String(message.name || 'Unknown Operative').trim().slice(0, 24) || 'Unknown Operative';
      const role = message.role === 'host' ? 'host' : 'visitor';
      if (!rooms.has(roomCode)) rooms.set(roomCode, new Set());
      const room = rooms.get(roomCode);
      if (role === 'host' && [...room].some((client) => client.role === 'host')) {
        return send(socket, { type: 'error', message: 'A host is already active in this room.' });
      }
      socket.roomCode = roomCode;
      socket.displayName = displayName;
      socket.role = role;
      room.add(socket);
      send(socket, { type: 'joined', self: { id: socket.clientId, name: displayName, role }, room: roomCode, members: roomInfo(room) });
      broadcast(room, { type: 'presence', members: roomInfo(room), event: { kind: 'join', name: displayName, role } }, socket);
      return;
    }

    if (message.type === 'chat' && socket.roomCode && socket.displayName) {
      const text = String(message.text || '').trim().slice(0, 500);
      if (!text) return;
      const room = rooms.get(socket.roomCode);
      broadcast(room, { type: 'chat', id: crypto.randomUUID(), text, at: Date.now(), from: { id: socket.clientId, name: socket.displayName, role: socket.role } });
    }
}

function removeClient(socket) {
    socket.wsOpen = false;
    if (!socket.roomCode || !rooms.has(socket.roomCode)) return;
    const room = rooms.get(socket.roomCode);
    room.delete(socket);
    broadcast(room, { type: 'presence', members: roomInfo(room), event: { kind: 'leave', name: socket.displayName, role: socket.role } });
    if (!room.size) rooms.delete(socket.roomCode);
}

server.on('upgrade', (request, socket, head) => {
  const key = request.headers['sec-websocket-key'];
  if (!key) return socket.destroy();
  const accept = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  openSocket(socket); socket.on('close', () => removeClient(socket));
  if (head.length) consumeFrames(socket, head);
});

server.listen(PORT, '0.0.0.0', () => {
  const publicUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  console.log(`TITAN // ONLINE at ${publicUrl}`);
  console.log(`TITAN // HEALTH at ${publicUrl}/healthz`);
});
