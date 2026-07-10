/*
 * Rumpus quip game module (Quiplash-style prompt/vote loop).
 * Licensed under AGPLv3 — see LICENSE.
 */
'use strict';

const crypto = require('crypto');

const PROMPTS = [
  'Worst thing to say on a first date',
  'The real reason the dinosaurs went extinct',
  'A rejected flavor of sports drink',
  'The worst possible name for a cruise ship',
  'Something you should never say to your barber',
  'A terrible slogan for a funeral home',
  'The next big fitness craze',
  'What robots dream about',
  'The worst superpower to have',
  'A bad name for a law firm',
  'Something you would find in a haunted refrigerator',
  'The most useless smartphone app imaginable',
  'A terrible opening line for a wedding toast',
  'What cats would say if they could talk',
];

const ANSWER_MS = parseInt(process.env.RUMPUS_ANSWER_MS || '60000', 10);
const VOTE_MS = parseInt(process.env.RUMPUS_VOTE_MS || '30000', 10);
const RESULTS_MS = parseInt(process.env.RUMPUS_RESULTS_MS || '8000', 10);
const TOTAL_ROUNDS = parseInt(process.env.RUMPUS_ROUNDS || '3', 10);
const POINTS_PER_VOTE = 100;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

class QuiplashGame {
  // room: the server's room object (players Map with .score on each player)
  // push: callback that broadcasts a room:stateUpdate to host + all players
  constructor(room, push) {
    this.room = room;
    this.push = push;
    this.phase = 'answering';
    this.round = 0;
    this.totalRounds = TOTAL_ROUNDS;
    this.deck = shuffle(PROMPTS.slice());
    this.prompt = null;
    this.answers = []; // { playerId, text }
    this.votes = new Map(); // playerId -> answer index
    this.results = null;
    this.timer = null;
    this.endsAt = null;
    this.destroyed = false;
  }

  start() {
    this.nextRound();
  }

  destroy() {
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  setTimer(ms, fn) {
    if (this.timer) clearTimeout(this.timer);
    this.endsAt = Date.now() + ms;
    this.timer = setTimeout(() => {
      if (!this.destroyed) fn();
    }, ms);
  }

  nextRound() {
    if (this.round >= this.totalRounds) {
      this.gameOver();
      return;
    }
    this.round += 1;
    if (this.deck.length === 0) this.deck = shuffle(PROMPTS.slice());
    this.prompt = this.deck.pop();
    this.answers = [];
    this.votes = new Map();
    this.results = null;
    this.phase = 'answering';
    this.setTimer(ANSWER_MS, () => this.finishAnswering());
    this.push();
  }

  handleSubmit(playerId, payload) {
    if (this.destroyed) return;
    if (this.phase === 'answering') {
      const text = typeof payload.text === 'string' ? payload.text.trim().slice(0, 120) : '';
      if (!text) return;
      if (this.answers.some((a) => a.playerId === playerId)) return; // one answer each
      if (!this.room.players.has(playerId)) return;
      this.answers.push({ playerId, text });
      if (this.answers.length >= this.room.players.size) {
        this.finishAnswering();
      } else {
        this.push();
      }
    } else if (this.phase === 'voting') {
      const choice = payload.choice;
      if (!Number.isInteger(choice) || choice < 0 || choice >= this.answers.length) return;
      if (this.answers[choice].playerId === playerId) return; // no voting for yourself
      if (this.votes.has(playerId)) return; // one vote each
      if (!this.room.players.has(playerId)) return;
      this.votes.set(playerId, choice);
      if (this.votes.size >= this.room.players.size) {
        this.finishVoting();
      } else {
        this.push();
      }
    }
  }

  finishAnswering() {
    if (this.phase !== 'answering') return;
    if (this.answers.length < 2) {
      // Not enough answers to vote on — go straight to results.
      this.finishVoting();
      return;
    }
    shuffle(this.answers); // hide join order
    this.phase = 'voting';
    this.votes = new Map();
    this.setTimer(VOTE_MS, () => this.finishVoting());
    this.push();
  }

  finishVoting() {
    if (this.phase !== 'answering' && this.phase !== 'voting') return;
    const tally = this.answers.map(() => 0);
    for (const idx of this.votes.values()) tally[idx] += 1;

    const results = this.answers.map((a, i) => {
      const p = this.room.players.get(a.playerId);
      if (p) p.score += tally[i] * POINTS_PER_VOTE;
      return {
        index: i,
        text: a.text,
        nickname: p ? p.nickname : '(left the game)',
        votes: tally[i],
      };
    });
    results.sort((x, y) => y.votes - x.votes);
    const maxVotes = results.length ? results[0].votes : 0;
    this.results = {
      list: results,
      winners: maxVotes > 0 ? results.filter((r) => r.votes === maxVotes) : [],
    };
    this.phase = 'results';
    this.setTimer(RESULTS_MS, () => this.nextRound());
    this.push();
  }

  gameOver() {
    this.phase = 'gameover';
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.endsAt = null;
    this.push();
  }

  onPlayerLeft(playerId) {
    if (this.destroyed) return;
    this.votes.delete(playerId);
    if (this.room.players.size === 0) return;
    // A departure may mean everyone remaining has already acted.
    if (this.phase === 'answering') {
      const remaining = [...this.room.players.keys()];
      if (remaining.every((id) => this.answers.some((a) => a.playerId === id))) {
        this.finishAnswering();
      }
    } else if (this.phase === 'voting') {
      if (this.votes.size >= this.room.players.size) this.finishVoting();
    }
  }

  standings() {
    return [...this.room.players.values()]
      .map((p) => ({ nickname: p.nickname, score: p.score }))
      .sort((a, b) => b.score - a.score);
  }

  // --- views ---------------------------------------------------------------

  hostGameState() {
    const base = {
      gameId: 'quiplash',
      round: this.round,
      totalRounds: this.totalRounds,
      endsAt: this.endsAt,
    };
    switch (this.phase) {
      case 'answering':
        return {
          ...base,
          prompt: this.prompt,
          submittedCount: this.answers.length,
          totalPlayers: this.room.players.size,
        };
      case 'voting':
        return {
          ...base,
          prompt: this.prompt,
          answers: this.answers.map((a, i) => ({ index: i, text: a.text })),
          votedCount: this.votes.size,
          totalPlayers: this.room.players.size,
        };
      case 'results':
        return {
          ...base,
          prompt: this.prompt,
          results: this.results.list,
          winners: this.results.winners,
        };
      case 'gameover':
        return { ...base, standings: this.standings() };
      default:
        return base;
    }
  }

  playerView(playerId) {
    const base = {
      gameId: 'quiplash',
      round: this.round,
      totalRounds: this.totalRounds,
      endsAt: this.endsAt,
    };
    switch (this.phase) {
      case 'answering':
        return {
          gameState: { ...base, prompt: this.prompt },
          you: { submitted: this.answers.some((a) => a.playerId === playerId) },
        };
      case 'voting':
        return {
          gameState: {
            ...base,
            prompt: this.prompt,
            // Each player only sees answers they are allowed to vote for —
            // their own is filtered out server-side.
            answers: this.answers
              .map((a, i) => ({ index: i, text: a.text, mine: a.playerId === playerId }))
              .filter((a) => !a.mine)
              .map(({ index, text }) => ({ index, text })),
          },
          you: { voted: this.votes.has(playerId) },
        };
      case 'results':
        return {
          gameState: {
            ...base,
            prompt: this.prompt,
            results: this.results.list,
            winners: this.results.winners,
          },
          you: {},
        };
      case 'gameover':
        return { gameState: { ...base, standings: this.standings() }, you: {} };
      default:
        return { gameState: base, you: {} };
    }
  }
}

QuiplashGame.meta = {
  id: 'quiplash',
  name: 'Quiplash',
  blurb: 'Answer a silly prompt, then vote for the best answer.',
  minPlayers: 2,
};

module.exports = QuiplashGame;
