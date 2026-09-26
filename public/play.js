/* Rumpus player (phone) view — dumb renderer of room:stateUpdate. AGPLv3, see LICENSE. */
'use strict';

const socket = io();

const joinView = document.getElementById('join-view');
const gameView = document.getElementById('game-view');
const joinForm = document.getElementById('join-form');
const joinError = document.getElementById('join-error');
const meTag = document.getElementById('me-tag');

let me = null;      // { playerId, nickname }
let state = null;
let kicked = false;

// Prefill the room code when arriving from the TV's QR code (/play?code=ABCD).
const codeParam = new URLSearchParams(location.search).get('code');
if (codeParam) document.getElementById('code-input').value = codeParam.slice(0, 4).toUpperCase();

joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  joinError.textContent = '';
  socket.emit('player:joinRoom', {
    code: document.getElementById('code-input').value,
    nickname: document.getElementById('nick-input').value,
  });
});

socket.on('player:joinError', (msg) => {
  joinError.textContent = msg.reason || 'Could not join.';
});

socket.on('player:joined', (msg) => {
  me = { playerId: msg.playerId };
  joinView.hidden = true;
  gameView.hidden = false;
});

socket.on('room:stateUpdate', (msg) => {
  state = msg;
  render();
});

socket.on('disconnect', () => {
  if (kicked) return;
  gameView.innerHTML = '<h1>Disconnected</h1><p>Reload to join again.</p>';
  gameView.hidden = false;
  joinView.hidden = true;
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

  if (state.phase === 'closed') {
    kicked = true;
    gameView.innerHTML = '<h1>Room closed</h1><p>The host left. Reload to join another room.</p>';
    return;
  }

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
