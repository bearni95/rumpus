/*
 * Rumpus — self-hosted Jackbox-style party game platform.
 * Copyright (C) 2026
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version. See LICENSE for details.
 */
'use strict';

const os = require('os');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const QuiplashGame = require('./games/quiplash');
const TriviaGame = require('./games/trivia');
const CAHGame = require('./games/cah');
const FibbageGame = require('./games/fibbage');

const PORT = parseInt(process.env.PORT || '3000', 10);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get('/', (req, res) => res.redirect('/play'));
app.get('/host', (req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));
app.get('/play', (req, res) => res.sendFile(path.join(__dirname, 'public', 'play.html')));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Join URL + QR code for the TV screen
// ---------------------------------------------------------------------------

// Best-guess LAN IPv4 of this machine. Skips loopback and common virtual
// bridges (Docker, libvirt), and prefers typical home-network ranges.
function lanAddress() {
  const candidates = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (/^(docker|br-|veth|virbr|vmnet|vboxnet|lo)/.test(name)) continue;
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) candidates.push(a.address);
    }
  }
  const rank = (ip) =>
    ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3;
  candidates.sort((a, b) => rank(a) - rank(b));
  return candidates[0] || null;
}

function isLoopbackHost(hostname) {
  return hostname === 'localhost' || hostname === '::1' || hostname === '[::1]' ||
    hostname.startsWith('127.');
}

// Public base URL phones should use. PUBLIC_URL wins (needed in Docker, where
// the container can't see the host's LAN IP). Otherwise, if the TV reached us
// through a non-loopback address, that address already works for phones; if it
// used localhost, swap in the LAN IP but keep the port the browser used (which
// may differ from PORT behind a Docker port mapping).
function joinBaseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  const hostHeader = req.headers.host || `localhost:${PORT}`;
  const url = new URL(`${req.protocol}://${hostHeader}`);
  if (isLoopbackHost(url.hostname)) {
    const ip = lanAddress();
    if (ip) url.hostname = ip;
  }
  return url.origin;
}

app.get('/api/join-info', async (req, res) => {
  const base = joinBaseUrl(req);
  const code = typeof req.query.code === 'string' ? req.query.code.replace(/[^A-Za-z]/g, '').slice(0, 4) : '';
  const url = `${base}/play${code ? `?code=${code.toUpperCase()}` : ''}`;
  try {
    const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    res.json({ displayUrl: `${base.replace(/^https?:\/\//, '')}/play`, url, svg });
  } catch (err) {
    res.status(500).json({ error: 'Could not generate QR code.' });
  }
});

// ---------------------------------------------------------------------------
// Rooms (in-memory, ephemeral)
// ---------------------------------------------------------------------------

const rooms = new Map(); // code -> room

const GAMES = { quiplash: QuiplashGame, trivia: TriviaGame, cah: CAHGame, fibbage: FibbageGame };
const GAME_LIST = Object.values(GAMES).map((G) => G.meta);

function makeRoomCode() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += letters[crypto.randomInt(letters.length)];
    }
    if (!rooms.has(code)) return code;
  }
  return null; // absurdly unlikely
}

function roomPhase(room) {
  return room.game ? room.game.phase : 'lobby';
}

function playersSummary(room) {
  return [...room.players.values()].map((p) => ({
    id: p.id,
    nickname: p.nickname,
    score: p.score,
  }));
}

// Push a full state update to the host and to every player. The host gets the
// shared-screen view; each player gets a personalized view that never exposes
// other players' in-progress input.
function broadcast(room) {
  if (room.closed) return;
  const base = {
    code: room.code,
    phase: roomPhase(room),
    players: playersSummary(room),
    availableGames: GAME_LIST,
  };
  if (room.hostSocket && room.hostSocket.connected) {
    room.hostSocket.emit('room:stateUpdate', {
      ...base,
      gameState: room.game ? room.game.hostGameState() : {},
    });
  }
  for (const p of room.players.values()) {
    if (!p.socket.connected) continue;
    const view = room.game
      ? room.game.playerView(p.id)
      : { gameState: {}, you: {} };
    p.socket.emit('room:stateUpdate', {
      ...base,
      gameState: view.gameState,
      you: { playerId: p.id, nickname: p.nickname, ...view.you },
    });
  }
}

function closeRoom(room) {
  if (room.closed) return;
  room.closed = true;
  if (room.game) room.game.destroy();
  room.game = null;
  for (const p of room.players.values()) {
    if (p.socket.connected) {
      p.socket.emit('room:stateUpdate', {
        code: room.code,
        phase: 'closed',
        players: [],
        gameState: {},
      });
      p.socket.disconnect(true);
    }
  }
  rooms.delete(room.code);
  console.log(`[room ${room.code}] closed`);
}

function removePlayer(room, playerId) {
  const p = room.players.get(playerId);
  if (!p) return;
  room.players.delete(playerId);
  if (room.game) room.game.onPlayerLeft(playerId);
  console.log(`[room ${room.code}] player left: ${p.nickname}`);
  broadcast(room);
}

// ---------------------------------------------------------------------------
// Socket wiring
// ---------------------------------------------------------------------------

io.on('connection', (socket) => {
  // socket.data.role: 'host' | 'player'; socket.data.room; socket.data.playerId

  socket.on('host:createRoom', () => {
    if (socket.data.room) return; // one room per host socket
    const code = makeRoomCode();
    if (!code) {
      socket.emit('host:roomCreated', { code: null });
      return;
    }
    const room = {
      code,
      hostSocket: socket,
      players: new Map(),
      game: null,
      closed: false,
    };
    rooms.set(code, room);
    socket.data.role = 'host';
    socket.data.room = room;
    console.log(`[room ${code}] created`);
    socket.emit('host:roomCreated', { code });
    broadcast(room);
  });

  socket.on('host:startGame', (msg) => {
    const room = socket.data.room;
    if (!room || socket.data.role !== 'host' || room.closed) return;
    const phase = roomPhase(room);
    if (phase !== 'lobby' && phase !== 'gameover') return;
    const gameId = msg && msg.gameId;
    const GameClass = GAMES[gameId];
    if (!GameClass) return;
    if (room.players.size < (GameClass.meta.minPlayers || 2)) return;
    if (room.game) room.game.destroy();
    for (const p of room.players.values()) p.score = 0;
    room.game = new GameClass(room, () => broadcast(room));
    console.log(`[room ${room.code}] starting game: ${gameId}`);
    room.game.start();
  });

  socket.on('host:kickPlayer', (msg) => {
    const room = socket.data.room;
    if (!room || socket.data.role !== 'host' || room.closed) return;
    const playerId = msg && msg.playerId;
    const p = room.players.get(playerId);
    if (!p) return;
    const sock = p.socket;
    removePlayer(room, playerId);
    if (sock.connected) sock.disconnect(true);
  });

  socket.on('player:joinRoom', (msg) => {
    if (socket.data.room) return;
    const code = (msg && typeof msg.code === 'string' ? msg.code : '')
      .trim()
      .toUpperCase();
    const nickname = (msg && typeof msg.nickname === 'string' ? msg.nickname : '')
      .trim()
      .slice(0, 16);
    const room = rooms.get(code);
    if (!room || room.closed) {
      socket.emit('player:joinError', { reason: 'No room with that code.' });
      return;
    }
    if (roomPhase(room) !== 'lobby') {
      socket.emit('player:joinError', { reason: 'Game already in progress.' });
      return;
    }
    if (!nickname) {
      socket.emit('player:joinError', { reason: 'Pick a nickname.' });
      return;
    }
    const taken = [...room.players.values()].some(
      (p) => p.nickname.toLowerCase() === nickname.toLowerCase()
    );
    if (taken) {
      socket.emit('player:joinError', { reason: 'That nickname is taken.' });
      return;
    }
    if (room.players.size >= 8) {
      socket.emit('player:joinError', { reason: 'Room is full (8 players max).' });
      return;
    }
    const playerId = crypto.randomBytes(8).toString('hex');
    room.players.set(playerId, { id: playerId, nickname, socket, score: 0 });
    socket.data.role = 'player';
    socket.data.room = room;
    socket.data.playerId = playerId;
    console.log(`[room ${room.code}] player joined: ${nickname}`);
    socket.emit('player:joined', {
      playerId,
      roomState: {
        code: room.code,
        phase: roomPhase(room),
        players: playersSummary(room),
      },
    });
    broadcast(room);
  });

  socket.on('player:submit', (msg) => {
    const room = socket.data.room;
    if (!room || socket.data.role !== 'player' || room.closed || !room.game) return;
    const payload = msg && typeof msg.payload === 'object' && msg.payload !== null
      ? msg.payload
      : {};
    room.game.handleSubmit(socket.data.playerId, payload);
  });

  socket.on('disconnect', () => {
    const room = socket.data.room;
    if (!room || room.closed) return;
    if (socket.data.role === 'host') {
      closeRoom(room);
    } else if (socket.data.role === 'player') {
      removePlayer(room, socket.data.playerId);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Rumpus listening on port ${PORT}`);
  console.log('TV screen:  /host   Phones:  /play');
});
