/*
 * Rumpus trivia game module — multiple-choice, speed-scored.
 * Licensed under AGPLv3 — see LICENSE.
 */
'use strict';

const crypto = require('crypto');
const { QUESTIONS } = require('./data/trivia-questions');

const QUESTION_MS = parseInt(process.env.RUMPUS_TRIVIA_QUESTION_MS || '20000', 10);
const REVEAL_MS = parseInt(process.env.RUMPUS_TRIVIA_REVEAL_MS || '8000', 10);
const TOTAL_ROUNDS = parseInt(process.env.RUMPUS_TRIVIA_ROUNDS || '8', 10);
const BASE_POINTS = 500;
const SPEED_BONUS = 500;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

class TriviaGame {
  constructor(room, push) {
    this.room = room;
    this.push = push;
    this.phase = 'trivia-question';
    this.round = 0;
    this.totalRounds = Math.min(TOTAL_ROUNDS, QUESTIONS.length);
    this.deck = shuffle(QUESTIONS.map((q, i) => i));
    this.question = null;
    this.answers = new Map(); // playerId -> { choice, answeredAt }
    this.roundStartedAt = null;
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
    if (this.deck.length === 0) this.deck = shuffle(QUESTIONS.map((q, i) => i));
    this.question = QUESTIONS[this.deck.pop()];
    this.answers = new Map();
    this.phase = 'trivia-question';
    this.roundStartedAt = Date.now();
    this.setTimer(QUESTION_MS, () => this.reveal());
    this.push();
  }

  handleSubmit(playerId, payload) {
    if (this.destroyed || this.phase !== 'trivia-question') return;
    const choice = payload.choice;
    if (!Number.isInteger(choice) || choice < 0 || choice >= this.question.choices.length) return;
    if (this.answers.has(playerId)) return; // one answer each
    if (!this.room.players.has(playerId)) return;
    this.answers.set(playerId, { choice, answeredAt: Date.now() });
    if (this.answers.size >= this.room.players.size) {
      this.reveal();
    } else {
      this.push();
    }
  }

  reveal() {
    if (this.phase !== 'trivia-question') return;
    const correct = this.question.correct;
    const scored = [];
    for (const [playerId, a] of this.answers.entries()) {
      const p = this.room.players.get(playerId);
      if (!p) continue;
      if (a.choice === correct) {
        const elapsed = Math.min(QUESTION_MS, a.answeredAt - this.roundStartedAt);
        const speedFrac = 1 - elapsed / QUESTION_MS;
        const gained = BASE_POINTS + Math.round(SPEED_BONUS * speedFrac);
        p.score += gained;
        scored.push({ nickname: p.nickname, correct: true, gained });
      } else {
        scored.push({ nickname: p.nickname, correct: false, gained: 0 });
      }
    }
    scored.sort((a, b) => b.gained - a.gained);
    this.roundResult = { correct, scored };
    this.phase = 'trivia-reveal';
    this.setTimer(REVEAL_MS, () => this.nextRound());
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
    this.answers.delete(playerId);
    if (this.room.players.size === 0) return;
    if (this.phase === 'trivia-question' && this.answers.size >= this.room.players.size) {
      this.reveal();
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
      gameId: 'trivia',
      round: this.round,
      totalRounds: this.totalRounds,
      endsAt: this.endsAt,
    };
    switch (this.phase) {
      case 'trivia-question':
        return {
          ...base,
          question: this.question.q,
          choices: this.question.choices,
          answeredCount: this.answers.size,
          totalPlayers: this.room.players.size,
        };
      case 'trivia-reveal':
        return {
          ...base,
          question: this.question.q,
          choices: this.question.choices,
          correct: this.roundResult.correct,
          scored: this.roundResult.scored,
        };
      case 'gameover':
        return { ...base, standings: this.standings() };
      default:
        return base;
    }
  }

  playerView(playerId) {
    const base = {
      gameId: 'trivia',
      round: this.round,
      totalRounds: this.totalRounds,
      endsAt: this.endsAt,
    };
    switch (this.phase) {
      case 'trivia-question':
        return {
          gameState: { ...base, question: this.question.q, choices: this.question.choices },
          you: { answered: this.answers.has(playerId) },
        };
      case 'trivia-reveal': {
        const mine = this.answers.get(playerId);
        return {
          gameState: {
            ...base,
            question: this.question.q,
            choices: this.question.choices,
            correct: this.roundResult.correct,
          },
          you: {
            answered: !!mine,
            wasCorrect: !!mine && mine.choice === this.roundResult.correct,
          },
        };
      }
      case 'gameover':
        return { gameState: { ...base, standings: this.standings() }, you: {} };
      default:
        return { gameState: base, you: {} };
    }
  }
}

TriviaGame.meta = {
  id: 'trivia',
  name: 'Trivia Blast',
  blurb: 'Multiple-choice trivia. Fast answers score extra points.',
  minPlayers: 2,
};

module.exports = TriviaGame;
