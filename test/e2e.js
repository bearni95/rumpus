/*
 * Rumpus end-to-end smoke test.
 * Licensed under AGPLv3 — see LICENSE.
 *
 * Boots the real server (in-process, on an ephemeral port), then drives it
 * exactly like a browser would but via socket.io-client instead of a
 * browser: one host connection creates a room, three player connections join
 * via the room code, then we play all three games back-to-back in the same
 * room (host:startGame allows re-picking from the 'gameover' phase) —
 * Quiplash, Trivia, then Cards Against Humanity — asserting each one reaches
 * its expected terminal state before moving to the next.
 *
 * Exits 0 and prints PASS on success. Exits 1 and prints FAIL with the
 * reason on any failure or timeout.
 */
'use strict';

process.env.PORT = process.env.PORT || '0'; // ephemeral port, avoid clashing with a real instance
// Speed every game module way up so the test doesn't have to wait out real
// round timers. These envvars are read by games/quiplash.js, games/trivia.js,
// and games/cah.js respectively.
process.env.RUMPUS_ANSWER_MS = '2000';
process.env.RUMPUS_VOTE_MS = '2000';
process.env.RUMPUS_RESULTS_MS = '1000';
process.env.RUMPUS_ROUNDS = '1';
process.env.RUMPUS_TRIVIA_QUESTION_MS = '2000';
process.env.RUMPUS_TRIVIA_REVEAL_MS = '1000';
process.env.RUMPUS_TRIVIA_ROUNDS = '1';
process.env.RUMPUS_CAH_REVEAL_MS = '1000';
process.env.RUMPUS_CAH_ROUNDS = '1';
process.env.RUMPUS_FIB_BLUFF_MS = '2000';
process.env.RUMPUS_FIB_CHOOSE_MS = '2000';
process.env.RUMPUS_FIB_REVEAL_MS = '1000';
process.env.RUMPUS_FIB_ROUNDS = '1';

const path = require('path');
const http = require('http');
const { io: ioClient } = require('socket.io-client');

const TEST_TIMEOUT_MS = 30000;

let failed = false;

function fail(msg, err) {
  failed = true;
  console.error('FAIL:', msg);
  if (err) console.error(err);
  cleanupAndExit(1);
}

function pass(msg) {
  console.log('PASS:', msg);
}

let server;
let sockets = [];

function cleanupAndExit(code) {
  for (const s of sockets) {
    try { s.disconnect(); } catch (e) { /* ignore */ }
  }
  if (server) {
    server.close(() => process.exit(code));
    // Force exit if close hangs (e.g. sockets not fully drained).
    setTimeout(() => process.exit(code), 1000).unref();
  } else {
    process.exit(code);
  }
}

const overallTimer = setTimeout(() => {
  fail(`test timed out after ${TEST_TIMEOUT_MS}ms without reaching a result`);
}, TEST_TIMEOUT_MS);
overallTimer.unref ? overallTimer.unref() : null;

function connectClient(url) {
  const sock = ioClient(url, { transports: ['websocket'], forceNew: true });
  sockets.push(sock);
  return sock;
}

async function main() {
  // Boot the real server module in-process so we exercise the actual
  // server.js/game-module code, not a reimplementation.
  delete require.cache[require.resolve('../server.js')];
  process.on('uncaughtException', (err) => fail('uncaught exception in server', err));

  // server.js calls server.listen() itself; we need the resulting server
  // and its bound port. We grab it via the http.Server constructor hook.
  const OriginalServer = http.createServer;
  let capturedServer = null;
  http.createServer = function (...args) {
    capturedServer = OriginalServer.apply(http, args);
    return capturedServer;
  };
  require(path.join(__dirname, '..', 'server.js'));
  http.createServer = OriginalServer;
  server = capturedServer;

  if (!server) {
    fail('could not capture http server instance from server.js');
    return;
  }

  await new Promise((resolve, reject) => {
    if (server.listening) return resolve();
    server.once('listening', resolve);
    server.once('error', reject);
  });

  const port = server.address().port;
  const url = `http://127.0.0.1:${port}`;
  console.log(`server up at ${url}`);

  // --- Host connects and creates a room ---------------------------------
  const host = connectClient(url);
  const { code: roomCode, hostToken } = await new Promise((resolve, reject) => {
    host.on('connect_error', reject);
    host.on('connect', () => host.emit('host:createRoom'));
    host.on('host:roomCreated', (msg) => {
      if (!msg.code) return reject(new Error('host:roomCreated returned no code'));
      if (!msg.hostToken) return reject(new Error('host:roomCreated returned no hostToken'));
      resolve(msg);
    });
  });
  pass(`host created room ${roomCode}`);

  // --- Three players join -------------------------------------------------
  // Three (not two) so we can also exercise Cards Against Humanity, which
  // needs a minimum of 3 players. All three stick around for every game.
  async function joinPlayer(nickname) {
    const sock = connectClient(url);
    const joined = await new Promise((resolve, reject) => {
      sock.on('connect_error', reject);
      sock.on('connect', () => {
        sock.emit('player:joinRoom', { code: roomCode, nickname });
      });
      sock.on('player:joinError', (msg) => reject(new Error(`join error for ${nickname}: ${msg.reason}`)));
      sock.on('player:joined', (msg) => resolve(msg));
    });
    return { sock, playerId: joined.playerId, nickname };
  }

  const p1 = await joinPlayer('Alice');
  const p2 = await joinPlayer('Bob');
  const p3 = await joinPlayer('Carol');
  pass('all three players joined');

  // Track latest state pushed to each player + host.
  const latest = { host: null, p1: null, p2: null, p3: null };
  host.on('room:stateUpdate', (msg) => { latest.host = msg; });
  p1.sock.on('room:stateUpdate', (msg) => { latest.p1 = msg; });
  p2.sock.on('room:stateUpdate', (msg) => { latest.p2 = msg; });
  p3.sock.on('room:stateUpdate', (msg) => { latest.p3 = msg; });

  function waitForPhase(who, phase, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        const st = latest[who];
        if (st && st.phase === phase) return resolve(st);
        if (Date.now() - start > timeoutMs) {
          return reject(new Error(`timed out waiting for ${who} to reach phase '${phase}', last phase seen: ${st && st.phase}`));
        }
        setTimeout(check, 100);
      };
      check();
    });
  }

  async function waitForAll(phase, timeoutMs = 10000) {
    return Promise.all([
      waitForPhase('p1', phase, timeoutMs),
      waitForPhase('p2', phase, timeoutMs),
      waitForPhase('p3', phase, timeoutMs),
    ]);
  }

  // =========================================================================
  // Game 1: Quiplash
  // =========================================================================
  host.emit('host:startGame', { gameId: 'quiplash' });
  await waitForAll('answering');
  pass('quiplash started, all players see the answering phase');

  p1.sock.emit('player:submit', { payload: { text: 'Answer A' } });
  p2.sock.emit('player:submit', { payload: { text: 'Answer B' } });
  p3.sock.emit('player:submit', { payload: { text: 'Answer C' } });

  await waitForAll('voting');
  pass('all answers submitted, moved to voting phase');

  // Everyone votes for "Answer B" except Bob himself, who can't vote for his
  // own answer and votes for Alice's instead. Guarantees a clear winner:
  // "Answer B" gets 2 votes (Alice + Carol), "Answer A" gets 1 (Bob).
  function voteFor(playerView, text) {
    const entry = playerView.gameState.answers.find((a) => a.text === text);
    if (!entry) throw new Error(`could not find votable answer with text "${text}"`);
    return entry.index;
  }
  p1.sock.emit('player:submit', { payload: { choice: voteFor(latest.p1, 'Answer B') } });
  p2.sock.emit('player:submit', { payload: { choice: voteFor(latest.p2, 'Answer A') } });
  p3.sock.emit('player:submit', { payload: { choice: voteFor(latest.p3, 'Answer B') } });

  const quipResults = await waitForPhase('host', 'results');
  if (!quipResults.gameState.winners || quipResults.gameState.winners.length !== 1) {
    fail(`expected exactly one quiplash winner, got: ${JSON.stringify(quipResults.gameState.winners)}`);
    return;
  }
  const quipWinner = quipResults.gameState.winners[0];
  if (quipWinner.text !== 'Answer B') {
    fail(`expected "Answer B" to win quiplash, got "${quipWinner.text}"`);
    return;
  }
  pass(`quiplash results phase reached — winner: "${quipWinner.text}" (${quipWinner.votes} votes)`);

  await waitForPhase('host', 'gameover');
  pass('quiplash reached gameover');

  // =========================================================================
  // Game 2: Trivia
  // =========================================================================
  host.emit('host:startGame', { gameId: 'trivia' });
  await waitForAll('trivia-question');
  pass('trivia started, all players see the question phase');

  // Choice index doesn't need to be correct — we're testing the scoring
  // plumbing reaches every player, not our general-knowledge trivia.
  p1.sock.emit('player:submit', { payload: { choice: 0 } });
  p2.sock.emit('player:submit', { payload: { choice: 0 } });
  p3.sock.emit('player:submit', { payload: { choice: 0 } });

  const triviaReveal = await waitForPhase('host', 'trivia-reveal');
  if (!triviaReveal.gameState.scored || triviaReveal.gameState.scored.length !== 3) {
    fail(`expected 3 scored entries in trivia reveal, got: ${JSON.stringify(triviaReveal.gameState.scored)}`);
    return;
  }
  pass('trivia reveal reached with all 3 players scored');

  await waitForPhase('host', 'gameover', 5000);
  pass('trivia reached gameover');

  // =========================================================================
  // Game 3: Cards Against Humanity
  // =========================================================================
  host.emit('host:startGame', { gameId: 'cah' });
  const cahSubmit = await waitForPhase('host', 'cah-submit');
  pass(`cah started, Card Czar is ${cahSubmit.gameState.czarNickname}`);

  const byNickname = { Alice: p1, Bob: p2, Carol: p3 };
  const czar = byNickname[cahSubmit.gameState.czarNickname];
  if (!czar) {
    fail(`unrecognized czar nickname: ${cahSubmit.gameState.czarNickname}`);
    return;
  }
  const nonCzar = [p1, p2, p3].filter((p) => p !== czar);

  for (const p of nonCzar) {
    p.sock.emit('player:submit', { payload: { cardIndex: 0 } });
  }

  const cahCzarPhase = await waitForPhase('host', 'cah-czar');
  if (!cahCzarPhase.gameState.submissions || cahCzarPhase.gameState.submissions.length !== 2) {
    fail(`expected 2 cah submissions revealed to czar, got: ${JSON.stringify(cahCzarPhase.gameState.submissions)}`);
    return;
  }
  pass('cah submit phase complete, czar sees both submissions');

  czar.sock.emit('player:submit', { payload: { choice: 0 } });

  const cahReveal = await waitForPhase('host', 'cah-reveal');
  if (!cahReveal.gameState.winner || !cahReveal.gameState.winner.text) {
    fail(`cah reveal reached but no winner recorded: ${JSON.stringify(cahReveal.gameState)}`);
    return;
  }
  pass(`cah round winner: "${cahReveal.gameState.winner.text}" — ${cahReveal.gameState.winner.nickname}`);

  await waitForPhase('host', 'gameover', 5000);
  pass('cah reached gameover');

  // =========================================================================
  // Game 4: Fibbage
  // =========================================================================
  host.emit('host:startGame', { gameId: 'fibbage' });
  await waitForAll('fib-bluff');
  pass('fibbage started, all players see the bluff phase');

  // Each player writes a distinct fake answer. These are gibberish so they
  // can't accidentally collide with the real answer (which would be rejected).
  p1.sock.emit('player:submit', { payload: { text: 'Zzyzx the First' } });
  p2.sock.emit('player:submit', { payload: { text: 'Quxthorpe Manor' } });
  p3.sock.emit('player:submit', { payload: { text: 'Fnord Industries' } });

  await waitForAll('fib-choose');
  pass('all lies submitted, moved to the choose phase');

  // Each player picks the first option offered to them (their own lie is
  // filtered out of their view, so index 0 is always a legal pick).
  function firstOption(playerView) {
    const opts = playerView.gameState.options;
    if (!opts || !opts.length) throw new Error('no options offered to player in fib-choose');
    return opts[0].index;
  }
  p1.sock.emit('player:submit', { payload: { choice: firstOption(latest.p1) } });
  p2.sock.emit('player:submit', { payload: { choice: firstOption(latest.p2) } });
  p3.sock.emit('player:submit', { payload: { choice: firstOption(latest.p3) } });

  const fibReveal = await waitForPhase('host', 'fib-reveal');
  const fibOpts = fibReveal.gameState.result && fibReveal.gameState.result.options;
  if (!Array.isArray(fibOpts) || !fibOpts.some((o) => o.isTruth)) {
    fail(`fibbage reveal missing the truth option: ${JSON.stringify(fibReveal.gameState.result)}`);
    return;
  }
  // Truth + 3 distinct lies = 4 options.
  if (fibOpts.length !== 4) {
    fail(`expected 4 fibbage options (truth + 3 lies), got ${fibOpts.length}`);
    return;
  }
  pass(`fibbage reveal reached — truth was "${fibReveal.gameState.answer}", ${fibOpts.length} options in play`);

  await waitForPhase('host', 'gameover', 5000);
  pass('fibbage reached gameover');

  // =========================================================================
  // Host reload: the room survives the host socket dropping and can be
  // reclaimed with its token; a wrong token is refused.
  // =========================================================================
  host.disconnect();
  await new Promise((r) => setTimeout(r, 200));

  const intruder = connectClient(url);
  await new Promise((resolve, reject) => {
    intruder.on('connect', () => intruder.emit('host:resumeRoom', { code: roomCode, hostToken: 'nope' }));
    intruder.on('host:resumeFailed', resolve);
    intruder.on('host:roomCreated', () => reject(new Error('resume with a bad token succeeded')));
  });
  pass('resume with a wrong host token is refused');

  const host2 = connectClient(url);
  const resumed = await new Promise((resolve, reject) => {
    host2.on('connect', () => host2.emit('host:resumeRoom', { code: roomCode, hostToken }));
    host2.on('host:resumeFailed', () => reject(new Error('host could not resume its room')));
    host2.on('room:stateUpdate', resolve);
  });
  if (resumed.code !== roomCode || resumed.players.length !== 3) {
    fail(`resumed room mismatch: code ${resumed.code}, ${resumed.players.length} players`);
    return;
  }
  pass(`host resumed room ${roomCode} with all 3 players still in it`);

  const p1Closed = new Promise((resolve) => p1.sock.on('disconnect', resolve));
  host2.emit('host:closeRoom');
  await p1Closed;
  pass('host:closeRoom closes the room and disconnects players');

  clearTimeout(overallTimer);
  console.log('\nALL CHECKS PASSED');
  cleanupAndExit(0);
}

main().catch((err) => fail('unhandled error in test flow', err));
