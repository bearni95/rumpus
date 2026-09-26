/* Rumpus player (phone) view — dumb renderer of room:stateUpdate. AGPLv3, see LICENSE. */
'use strict';

const socket = io();

const joinView = document.getElementById('join-view');
const gameView = document.getElementById('game-view');
const joinForm = document.getElementById('join-form');
const joinError = document.getElementById('join-error');
const meTag = document.getElementById('me-tag');
const meActions = document.getElementById('me-actions');
const codeInput = document.getElementById('code-input');
const nickInput = document.getElementById('nick-input');

let me = null;      // { playerId, nickname }
let state = null;
let ended = false;  // kicked, room closed or taken over: stop reacting

// Our seat is remembered across reloads so the phone can reclaim it.
const IDENTITY_KEY = 'rumpus.player';

function loadIdentity() {
  try {
    const saved = JSON.parse(localStorage.getItem(IDENTITY_KEY));
    return saved && saved.code && saved.playerId && saved.playerToken ? saved : null;
  } catch (err) {
    return null;
  }
}

function saveIdentity(identity) {
  try {
    if (identity) localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
    else localStorage.removeItem(IDENTITY_KEY);
  } catch (err) {
    // Storage unavailable: the seat just won't survive a reload.
  }
}

let identity = loadIdentity();

function showMessage(html) {
  gameView.innerHTML = html;
  gameView.hidden = false;
  joinView.hidden = true;
}

function showJoinForm(code, nickname, error) {
  me = null;
  state = null;
  meTag.textContent = '';
  meActions.hidden = true;
  if (code) codeInput.value = code;
  if (nickname) nickInput.value = nickname;
  joinError.textContent = error || '';
  gameView.hidden = true;
  gameView.innerHTML = '';
  joinView.hidden = false;
}

function endSession(html) {
  ended = true;
  identity = null;
  saveIdentity(null);
  me = null;
  meActions.hidden = true;
  showMessage(html);
}

// Prefill the room code when arriving from the TV's QR code (/play?code=ABCD).
// Room codes are 4 letters, so drop anything else before seeding.
const codeParam = (new URLSearchParams(location.search).get('code') || '')
  .replace(/[^A-Za-z]/g, '')
  .slice(0, 4)
  .toUpperCase();
if (codeParam) {
  codeInput.value = codeParam;
  if (!identity) nickInput.focus();
}
if (identity) showMessage('<h1>Reconnecting...</h1><p>Getting your seat back.</p>');

socket.on('connect', () => {
  if (ended) return;
  if (identity) socket.emit('player:resume', identity);
});

socket.on('player:resumeFailed', () => {
  const old = identity || {};
  identity = null;
  saveIdentity(null);
  showJoinForm(codeParam || old.code, old.nickname, 'Your old seat is gone. Join again.');
});

joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  joinError.textContent = '';
  socket.emit('player:joinRoom', {
    code: codeInput.value,
    nickname: nickInput.value,
  });
});

socket.on('player:joinError', (msg) => {
  joinError.textContent = msg.reason || 'Could not join.';
});

socket.on('player:joined', (msg) => {
  me = { playerId: msg.playerId, nickname: msg.nickname };
  identity = {
    code: msg.roomState.code,
    playerId: msg.playerId,
    playerToken: msg.playerToken,
    nickname: msg.nickname,
  };
  saveIdentity(identity);
  joinView.hidden = true;
  gameView.hidden = false;
  meActions.hidden = false;
});

document.getElementById('rename-btn').addEventListener('click', () => {
  if (!me) return;
  const current = (state && state.you && state.you.nickname) || me.nickname || '';
  const next = prompt('New nickname', current);
  if (next == null || !next.trim() || next.trim() === current) return;
  socket.emit('player:rename', { nickname: next });
});

socket.on('player:renamed', (msg) => {
  if (me) me.nickname = msg.nickname;
  if (identity) {
    identity.nickname = msg.nickname;
    saveIdentity(identity);
  }
});

socket.on('player:renameError', (msg) => {
  alert(msg.reason || 'Could not rename.');
});

document.getElementById('leave-btn').addEventListener('click', () => {
  if (!me) return;
  if (!confirm('Leave this room and forget your player? Your score will be lost.')) return;
  const old = identity;
  if (socket.connected) socket.emit('player:leave');
  identity = null;
  saveIdentity(null);
  showJoinForm(old && old.code, old && old.nickname);
});

socket.on('player:kicked', () => {
  endSession('<h1>Removed</h1><p>The host removed you from the room. Reload to join again.</p>');
});

socket.on('player:replaced', () => {
  // Another tab resumed our seat and now owns the identity: leave it alone.
  ended = true;
  me = null;
  meActions.hidden = true;
  showMessage('<h1>Opened elsewhere</h1><p>You are playing in another tab now.</p>');
});

socket.on('room:stateUpdate', (msg) => {
  if (ended) return;
  state = msg;
  if (msg.phase === 'closed') {
    endSession('<h1>Room closed</h1><p>The host left. Reload to join another room.</p>');
    return;
  }
  render();
});

socket.on('disconnect', (reason) => {
  if (ended || !me) return;
  if (reason === 'io server disconnect') {
    // The server dropped us on purpose; socket.io will not retry.
    showMessage('<h1>Disconnected</h1><p>Reload to rejoin.</p>');
  } else {
    // Transient: socket.io reconnects and the connect handler resumes our seat.
    showMessage('<h1>Reconnecting...</h1><p>Hang tight.</p>');
  }
});

function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s == null ? '' : s);
  return d.innerHTML;
}

function myScore() {
  if (!state || !me) return 0;
  const p = state.players.find((x) => x.id === me.playerId);
  return p ? p.score : 0;
}

function render() {
  if (!state || !me) return;
  const g = state.gameState || {};
  const you = state.you || {};
  meTag.textContent = `${you.nickname || ''} · ${myScore()} pts · room ${state.code}`;

  let html = '';
  if (state.phase === 'lobby') {
    html = `<h1>You're in!</h1><p>Watch the TV. Waiting for the host to start…</p>`;
  } else if (state.phase === 'answering') {
    if (you.submitted) {
      html = `<h1>Got it ✓</h1><p>Waiting for the other players…</p>`;
    } else {
      html = `<p class="round-tag">Round ${g.round} of ${g.totalRounds}</p>
        <h2 class="prompt">${esc(g.prompt)}</h2>
        <form id="answer-form">
          <input id="answer-input" maxlength="120" autocomplete="off" placeholder="Your answer…" required>
          <button type="submit">Send it</button>
        </form>`;
    }
  } else if (state.phase === 'voting') {
    if (you.voted) {
      html = `<h1>Vote cast ✓</h1><p>Waiting for the other players…</p>`;
    } else {
      html = `<h2 class="prompt">${esc(g.prompt)}</h2><p>Pick your favorite:</p>
        <div class="vote-list">` +
        g.answers.map((a) =>
          `<button class="vote-btn" data-index="${a.index}">${esc(a.text)}</button>`
        ).join('') + `</div>`;
    }
  } else if (state.phase === 'results') {
    const w = (g.winners && g.winners[0]) || null;
    html = `<h1>Results</h1>` +
      (w ? `<p class="prompt">"${esc(w.text)}" — ${esc(w.nickname)} wins the round!</p>`
         : `<p>No votes this round. Tough crowd.</p>`) +
      `<p>You have <strong>${myScore()}</strong> points. Next round soon…</p>`;
  } else if (state.phase === 'trivia-question') {
    if (you.answered) {
      html = `<h1>Locked in ✓</h1><p>Waiting for the other players…</p>`;
    } else {
      html = `<p class="round-tag">Round ${g.round} of ${g.totalRounds}</p>
        <h2 class="prompt">${esc(g.question)}</h2>
        <div class="vote-list">` +
        g.choices.map((c, i) =>
          `<button class="vote-btn" data-index="${i}">${esc(c)}</button>`
        ).join('') + `</div>`;
    }
  } else if (state.phase === 'trivia-reveal') {
    html = `<h1>${you.wasCorrect ? 'Nice! ✓' : 'Nope ✗'}</h1>
      <p class="prompt">${esc(g.choices[g.correct])}</p>
      <p>You have <strong>${myScore()}</strong> points. Next round soon…</p>`;
  } else if (state.phase === 'cah-submit') {
    if (you.isCzar) {
      html = `<h1>You're the Card Czar</h1>
        <p class="prompt">${esc(g.blackCard)}</p>
        <p>Sit tight — everyone else is picking a card.</p>`;
    } else if (you.submitted) {
      html = `<h1>Card played ✓</h1><p>Waiting on the Card Czar…</p>`;
    } else {
      html = `<p class="round-tag">Card Czar: ${esc(g.czarNickname)}</p>
        <h2 class="prompt">${esc(g.blackCard)}</h2>
        <p>Pick a card:</p>
        <div class="vote-list">` +
        (you.hand || []).map((text, i) =>
          `<button class="hand-btn" data-index="${i}">${esc(text)}</button>`
        ).join('') + `</div>`;
    }
  } else if (state.phase === 'cah-czar') {
    if (you.isCzar) {
      html = `<h2 class="prompt">${esc(g.blackCard)}</h2><p>Pick the winner:</p>
        <div class="vote-list">` +
        g.submissions.map((s) =>
          `<button class="vote-btn" data-index="${s.index}">${esc(s.text)}</button>`
        ).join('') + `</div>`;
    } else {
      html = `<h1>Card played ✓</h1><p>${esc(g.czarNickname)} is judging…</p>`;
    }
  } else if (state.phase === 'cah-reveal') {
    html = `<h1>Round winner</h1>
      <p class="prompt">"${esc(g.winner.text)}" — ${esc(g.winner.nickname)}</p>
      <p>You have <strong>${myScore()}</strong> points. Next round soon…</p>`;
  } else if (state.phase === 'fib-bluff') {
    if (you.submitted) {
      html = `<h1>Lie submitted ✓</h1><p>Waiting for the other players…</p>`;
    } else {
      const oops = you.collidedWithTruth
        ? `<p class="join-error">That's the real answer! Be more creative — write a convincing fake.</p>`
        : '';
      html = `<p class="round-tag">Round ${g.round} of ${g.totalRounds}</p>
        <h2 class="prompt">${esc(g.prompt)}</h2>
        <p>Make up a fake answer to fool everyone:</p>
        ${oops}
        <form id="answer-form">
          <input id="answer-input" maxlength="120" autocomplete="off" placeholder="Your convincing lie…" required>
          <button type="submit">Send it</button>
        </form>`;
    }
  } else if (state.phase === 'fib-choose') {
    if (you.picked) {
      html = `<h1>Guess locked in ✓</h1><p>Waiting for the other players…</p>`;
    } else {
      html = `<h2 class="prompt">${esc(g.prompt)}</h2><p>Which one is the truth?</p>
        <div class="vote-list">` +
        g.options.map((o) =>
          `<button class="vote-btn" data-index="${o.index}">${esc(o.text)}</button>`
        ).join('') + `</div>`;
    }
  } else if (state.phase === 'fib-reveal') {
    html = `<h1>${you.foundTruth ? 'You found it! ✓' : 'Fooled ✗'}</h1>
      <p class="prompt">The truth: ${esc(g.answer)}</p>
      <p>You have <strong>${myScore()}</strong> points. Next round soon…</p>`;
  } else if (state.phase === 'gameover') {
    const top = g.standings && g.standings[0];
    html = `<h1>Game over</h1>` +
      (top ? `<p class="prompt">${esc(top.nickname)} wins with ${top.score}!</p>` : '') +
      `<p>You finished with <strong>${myScore()}</strong> points.</p>
       <p>Watch the TV — the host can start another game.</p>`;
  } else {
    html = `<h1>${esc(state.phase)}</h1>`;
  }

  gameView.innerHTML = html;

  const answerForm = document.getElementById('answer-form');
  if (answerForm) {
    answerForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = document.getElementById('answer-input').value;
      if (text.trim()) socket.emit('player:submit', { payload: { text } });
    });
  }
  for (const btn of gameView.querySelectorAll('.vote-btn')) {
    btn.addEventListener('click', () => {
      socket.emit('player:submit', { payload: { choice: parseInt(btn.dataset.index, 10) } });
    });
  }
  for (const btn of gameView.querySelectorAll('.hand-btn')) {
    btn.addEventListener('click', () => {
      socket.emit('player:submit', { payload: { cardIndex: parseInt(btn.dataset.index, 10) } });
    });
  }
}
