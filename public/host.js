/* Rumpus host (TV) view — dumb renderer of room:stateUpdate. AGPLv3, see LICENSE. */
'use strict';

const socket = io();

const codeEl = document.getElementById('room-code');
const joinUrlEl = document.getElementById('join-url');
const phaseView = document.getElementById('phase-view');
const playerList = document.getElementById('player-list');

const joinQrEl = document.getElementById('join-qr');
const newRoomBtn = document.getElementById('new-room');

let state = null;
let timerInterval = null;
let joinDisplayUrl = location.host + '/play';

joinUrlEl.textContent = joinDisplayUrl;

// The room we host is remembered across reloads so the TV page can reclaim it.
const ROOM_KEY = 'rumpus.hostRoom';

function loadSavedRoom() {
  try {
    const saved = JSON.parse(localStorage.getItem(ROOM_KEY));
    return saved && saved.code && saved.hostToken ? saved : null;
  } catch (err) {
    return null;
  }
}

function saveRoom(room) {
  try {
    if (room) localStorage.setItem(ROOM_KEY, JSON.stringify(room));
    else localStorage.removeItem(ROOM_KEY);
  } catch (err) {
    // Storage unavailable: the room just won't survive a reload.
  }
}

socket.on('connect', () => {
  const saved = loadSavedRoom();
  if (saved) socket.emit('host:resumeRoom', saved);
  else socket.emit('host:createRoom');
});

socket.on('host:resumeFailed', () => {
  saveRoom(null);
  socket.emit('host:createRoom');
});

socket.on('host:roomCreated', (msg) => {
  codeEl.textContent = msg.code || 'ERR';
  if (msg.code) {
    saveRoom({ code: msg.code, hostToken: msg.hostToken });
    loadJoinInfo(msg.code);
  }
});

// The server refused the requested code; the current room is left untouched.
socket.on('host:createError', (msg) => {
  alert(msg.reason || 'Could not create the room.');
});

newRoomBtn.addEventListener('click', () => {
  if (!socket.connected) {
    alert('Not connected to the server right now. Try again in a moment.');
    return;
  }
  let code = '';
  for (;;) {
    const answer = prompt(
      'Close this room and start a new one? Everyone will be disconnected.\n\n' +
      'Room code (4 letters), or leave blank for a random one:', '');
    if (answer === null) return;
    code = answer.trim().toUpperCase();
    if (!code || /^[A-Z]{4}$/.test(code)) break;
    alert('Room codes are exactly 4 letters (A to Z).');
  }
  // The server closes the old room and answers with host:roomCreated,
  // which overwrites the saved room.
  socket.emit('host:createRoom', { code, replace: true });
});

// Ask the server for the LAN-reachable join URL (not localhost) and its QR.
async function loadJoinInfo(code) {
  try {
    const res = await fetch('/api/join-info?code=' + encodeURIComponent(code));
    if (!res.ok) return;
    const info = await res.json();
    joinDisplayUrl = info.displayUrl;
    joinUrlEl.textContent = joinDisplayUrl;
    joinQrEl.innerHTML = info.svg;
    joinQrEl.title = info.url;
    joinQrEl.hidden = false;
    render();
  } catch (err) {
    // Leave the plain-text hint in place.
  }
}

socket.on('room:stateUpdate', (msg) => {
  state = msg;
  render();
});

socket.on('disconnect', () => {
  stopCountdown();
  phaseView.innerHTML = '<h1>Disconnected from server</h1><p>Reconnecting to your room…</p>';
});

phaseView.addEventListener('click', (e) => {
  const btn = e.target.closest('.game-pick');
  if (!btn || btn.disabled) return;
  socket.emit('host:startGame', { gameId: btn.dataset.gameId });
});

function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s == null ? '' : s);
  return d.innerHTML;
}

// Full-width bar that drains as the phase timer runs out.
const timerBar = '<div class="timer-bar"><div id="timer" class="timer-fill"></div></div>';
const revealBar = timerBar.replace('"timer-bar"', '"timer-bar reveal"');

function startCountdown(endsAt, totalMs) {
  stopCountdown();
  if (!endsAt) return;
  const el = document.getElementById('timer');
  if (!el) return;
  const total = totalMs || Math.max(1, endsAt - Date.now());
  const tick = () => {
    const left = Math.max(0, endsAt - Date.now());
    el.style.width = Math.min(100, (left / total) * 100) + '%';
  };
  tick();
  timerInterval = setInterval(tick, 250);
}

function stopCountdown() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
}

function gamePicker(label) {
  const count = state.players.length;
  const games = state.availableGames || [];
  return `<h1>${label}</h1>
    <p>Grab your phone, go to <strong>${esc(joinDisplayUrl)}</strong>
    and enter code <strong>${esc(codeEl.textContent)}</strong>.</p>
    <div class="game-grid">` +
    games.map((gm) => {
      const disabled = count < gm.minPlayers;
      return `<button class="game-pick" data-game-id="${esc(gm.id)}" ${disabled ? 'disabled' : ''}>
        <span class="game-name">${esc(gm.name)}</span>
        <span class="game-blurb">${esc(gm.blurb)}</span>
        <span class="game-min">${disabled ? `Needs ${gm.minPlayers}+ players` : ''}</span>
      </button>`;
    }).join('') +
    `</div>`;
}

function render() {
  if (!state) return;
  const g = state.gameState || {};
  const phase = state.phase;

  // Player list with kick controls (host-only input), highest score first.
  // Rebuilt on every state update, so it re-sorts whenever a score changes.
  // Array sort is stable, so ties keep join order.
  playerList.innerHTML = '';
  const byScore = [...state.players].sort((a, b) => b.score - a.score);
  for (const p of byScore) {
    const li = document.createElement('li');
    if (p.connected === false) {
      li.className = 'offline';
      li.title = 'Reconnecting...';
    }
    li.innerHTML = `<span class="pname">${esc(p.nickname)}</span>` +
      `<span class="pscore">${p.score}</span>`;
    const kick = document.createElement('button');
    kick.className = 'kick';
    kick.textContent = 'kick';
    kick.addEventListener('click', () =>
      socket.emit('host:kickPlayer', { playerId: p.id }));
    li.appendChild(kick);
    playerList.appendChild(li);
  }

  stopCountdown();
  let html = '';
  const roundTag = g.round
    ? `<p class="round-tag">Round ${g.round} of ${g.totalRounds}</p>` : '';

  if (phase === 'lobby') {
    html = gamePicker('Choose a game');
  } else if (phase === 'answering') {
    html = `${timerBar}${roundTag}
      <h1 class="prompt">${esc(g.prompt)}</h1>
      <p class="big-sub">Answer on your phones!</p>
      <p>${g.submittedCount} / ${g.totalPlayers} answers in</p>`;
  } else if (phase === 'voting') {
    html = `${timerBar}${roundTag}
      <h1 class="prompt">${esc(g.prompt)}</h1>
      <p class="big-sub">Vote on your phones!</p>
      <ol class="answers">` +
      g.answers.map((a) => `<li>${esc(a.text)}</li>`).join('') +
      `</ol><p>${g.votedCount} / ${g.totalPlayers} votes in</p>`;
  } else if (phase === 'results') {
    const winnerIdx = new Set((g.winners || []).map((w) => w.index));
    html = `${revealBar}${roundTag}
      <h1 class="prompt">${esc(g.prompt)}</h1>
      <ol class="answers results">` +
      g.results.map((r) =>
        `<li class="${winnerIdx.has(r.index) ? 'winner' : ''}">
          ${esc(r.text)} <span class="byline">— ${esc(r.nickname)}</span>
          <span class="votes">${r.votes} vote${r.votes === 1 ? '' : 's'}</span>
        </li>`).join('') +
      `</ol>`;
  } else if (phase === 'trivia-question') {
    html = `${timerBar}${roundTag}
      <h1 class="prompt">${esc(g.question)}</h1>
      <p class="big-sub">Answer on your phones!</p>
      <p>${g.answeredCount} / ${g.totalPlayers} answers in</p>`;
  } else if (phase === 'trivia-reveal') {
    html = `${revealBar}${roundTag}
      <h1 class="prompt">${esc(g.question)}</h1>
      <ol class="answers results">` +
      g.choices.map((c, i) => `<li class="${i === g.correct ? 'winner' : ''}">${esc(c)}</li>`).join('') +
      `</ol><ul class="scored-list">` +
      g.scored.map((s) =>
        `<li class="${s.correct ? 'correct' : 'wrong'}">${esc(s.nickname)}
          ${s.correct ? `+${s.gained}` : '✗'}</li>`).join('') +
      `</ul>`;
  } else if (phase === 'cah-submit') {
    html = `${roundTag}
      <p class="round-tag">Card Czar: ${esc(g.czarNickname)}</p>
      <h1 class="prompt">${esc(g.blackCard)}</h1>
      <p class="big-sub">Everyone else, submit a card!</p>
      <p>${g.submittedCount} / ${g.neededCount} cards in</p>`;
  } else if (phase === 'cah-czar') {
    html = `${roundTag}
      <p class="round-tag">Card Czar: ${esc(g.czarNickname)}</p>
      <h1 class="prompt">${esc(g.blackCard)}</h1>
      <p class="big-sub">${esc(g.czarNickname)} is picking a winner…</p>
      <ol class="answers">` +
      g.submissions.map((s) => `<li>${esc(s.text)}</li>`).join('') +
      `</ol>`;
  } else if (phase === 'cah-reveal') {
    html = `${revealBar}${roundTag}
      <h1 class="prompt">${esc(g.blackCard)}</h1>
      <p class="big-sub winner-line">${esc(g.winner.text)}
        <span class="byline">— ${esc(g.winner.nickname)} wins the round!</span></p>`;
  } else if (phase === 'fib-bluff') {
    html = `${timerBar}${roundTag}
      <h1 class="prompt">${esc(g.prompt)}</h1>
      <p class="big-sub">Invent a fake answer on your phones!</p>
      <p>${g.submittedCount} / ${g.totalPlayers} lies in</p>`;
  } else if (phase === 'fib-choose') {
    html = `${timerBar}${roundTag}
      <h1 class="prompt">${esc(g.prompt)}</h1>
      <p class="big-sub">Which one's the truth? Pick on your phones!</p>
      <ol class="answers">` +
      g.options.map((o) => `<li>${esc(o.text)}</li>`).join('') +
      `</ol><p>${g.pickedCount} / ${g.totalPlayers} guesses in</p>`;
  } else if (phase === 'fib-reveal') {
    html = `${revealBar}${roundTag}
      <h1 class="prompt">${esc(g.prompt)}</h1>
      <ol class="answers results">` +
      g.result.options.map((o) =>
        `<li class="${o.isTruth ? 'winner' : ''}">
          ${esc(o.text)}
          <span class="byline">${o.isTruth ? '— the truth!' : (o.authors.length ? '— ' + esc(o.authors.join(', ')) + '\'s lie' : '')}</span>
          <span class="votes">${o.pickedBy.length ? 'fooled ' + o.pickedBy.map(esc).join(', ') : ''}</span>
        </li>`).join('') +
      `</ol><ul class="scored-list">` +
      g.result.scored.map((s) => `<li class="correct">${esc(s.nickname)} +${s.gained}</li>`).join('') +
      `</ul>`;
  } else if (phase === 'gameover') {
    html = `<h1>Final scores</h1><ol class="answers standings">` +
      g.standings.map((s, i) =>
        `<li class="${i === 0 ? 'winner' : ''}">${esc(s.nickname)}
         <span class="votes">${s.score}</span></li>`).join('') +
      `</ol>` + gamePicker('Play again?');
  } else {
    html = `<h1>${esc(phase)}</h1>`;
  }

  phaseView.innerHTML = html;
  if (g.endsAt) startCountdown(g.endsAt, g.timerMs);
}
