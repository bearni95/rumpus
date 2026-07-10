/*
 * Rumpus Fibbage-style game module — bluffing trivia.
 *
 * Each round everyone sees a fact with a blank and secretly writes a FAKE
 * answer (a lie). The real answer is then shuffled in with everyone's lies and
 * players hunt for the truth. You score for finding the truth, and for every
 * player your lie fools into picking it.
 *
 * Payload shapes on player:submit — deliberately the same primitives the other
 * modules use so the phone client needs no new input widgets:
 *   fib-bluff  : { text }    (like a Quiplash answer)
 *   fib-choose : { choice }  (index into the shuffled options, like a vote)
 *
 * Licensed under AGPLv3 — see LICENSE.
 */
'use strict';

const crypto = require('crypto');
const { QUESTIONS } = require('./data/fibbage-questions');

const BLUFF_MS = parseInt(process.env.RUMPUS_FIB_BLUFF_MS || '45000', 10);
const CHOOSE_MS = parseInt(process.env.RUMPUS_FIB_CHOOSE_MS || '30000', 10);
const REVEAL_MS = parseInt(process.env.RUMPUS_FIB_REVEAL_MS || '10000', 10);
const TOTAL_ROUNDS = parseInt(process.env.RUMPUS_FIB_ROUNDS || '5', 10);
const TRUTH_POINTS = 1000; // for finding the real answer
const FOOL_POINTS = 500;   // per player your lie fools

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Loose match so a lie that's really the truth (or two identical lies) collapse
// together regardless of casing / surrounding whitespace / trailing period.
function normalize(s) {
  return String(s).trim().toLowerCase().replace(/[.!?]+$/, '');
}

class FibbageGame {
  constructor(room, push) {
    this.room = room;
    this.push = push;
    this.phase = 'fib-bluff';
    this.round = 0;
    this.totalRounds = Math.min(TOTAL_ROUNDS, QUESTIONS.length);
    this.deck = shuffle(QUESTIONS.map((q, i) => i));
    this.prompt = null;
    this.answer = null;
    this.bluffs = new Map();   // playerId -> lie text
    this.collided = new Set(); // players whose last try accidentally was the truth
    this.picks = new Map();    // playerId -> option index
    this.options = null;       // [{ index, text, isTruth, authorIds:Set }]
    this.roundResult = null;
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
    const q = QUESTIONS[this.deck.pop()];
    this.prompt = q.q;
    this.answer = q.answer;
    this.bluffs = new Map();
    this.collided = new Set();
    this.picks = new Map();
    this.options = null;
    this.roundResult = null;
    this.phase = 'fib-bluff';
    this.setTimer(BLUFF_MS, () => this.finishBluffing());
    this.push();
  }

  handleSubmit(playerId, payload) {
    if (this.destroyed) return;
    if (!this.room.players.has(playerId)) return;
    if (this.phase === 'fib-bluff') {
      const text = typeof payload.text === 'string' ? payload.text.trim().slice(0, 120) : '';
      if (!text) return;
      if (this.bluffs.has(playerId)) return; // one lie each
      if (normalize(text) === normalize(this.answer)) {
        // They stumbled onto the real answer — reject it and nudge them.
        this.collided.add(playerId);
        this.push();
        return;
      }
      this.collided.delete(playerId);
      this.bluffs.set(playerId, text);
      if (this.bluffs.size >= this.room.players.size) {
        this.finishBluffing();
      } else {
        this.push();
      }
    } else if (this.phase === 'fib-choose') {
      const choice = payload.choice;
      if (!Number.isInteger(choice) || choice < 0 || choice >= this.options.length) return;
      if (this.options[choice].authorIds.has(playerId)) return; // can't pick your own lie
      if (this.picks.has(playerId)) return; // one pick each
      this.picks.set(playerId, choice);
      if (this.picks.size >= this.room.players.size) {
        this.finishChoosing();
      } else {
        this.push();
      }
    }
  }

  finishBluffing() {
    if (this.phase !== 'fib-bluff') return;
    // Collapse identical lies into one option credited to every author.
    const byText = new Map(); // normalized -> { text, authorIds:Set }
    for (const [playerId, text] of this.bluffs.entries()) {
      const key = normalize(text);
      if (!byText.has(key)) byText.set(key, { text, authorIds: new Set() });
      byText.get(key).authorIds.add(playerId);
    }
    const opts = [...byText.values()].map((o) => ({ ...o, isTruth: false }));
    opts.push({ text: this.answer, authorIds: new Set(), isTruth: true });
    shuffle(opts);
    this.options = opts.map((o, i) => ({ ...o, index: i }));
    this.picks = new Map();
    this.phase = 'fib-choose';
    this.setTimer(CHOOSE_MS, () => this.finishChoosing());
    this.push();
  }

  finishChoosing() {
    if (this.phase !== 'fib-choose') return;
    const gained = new Map(); // playerId -> points this round
    const add = (id, n) => gained.set(id, (gained.get(id) || 0) + n);
    const pickedBy = this.options.map(() => []); // option index -> [playerId]

    for (const [playerId, choice] of this.picks.entries()) {
      pickedBy[choice].push(playerId);
      const opt = this.options[choice];
      if (opt.isTruth) {
        add(playerId, TRUTH_POINTS);
      } else {
        for (const authorId of opt.authorIds) add(authorId, FOOL_POINTS);
      }
    }

    for (const [playerId, n] of gained.entries()) {
      const p = this.room.players.get(playerId);
      if (p) p.score += n;
    }

    const nick = (id) => {
      const p = this.room.players.get(id);
      return p ? p.nickname : '(left the game)';
    };
    this.roundResult = {
      options: this.options.map((o, i) => ({
        text: o.text,
        isTruth: o.isTruth,
        authors: [...o.authorIds].map(nick),
        pickedBy: pickedBy[i].map(nick),
      })),
      scored: [...gained.entries()]
        .map(([id, n]) => ({ nickname: nick(id), gained: n }))
        .sort((a, b) => b.gained - a.gained),
    };
    this.phase = 'fib-reveal';
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
    this.bluffs.delete(playerId);
    this.collided.delete(playerId);
    this.picks.delete(playerId);
    if (this.room.players.size === 0) return;
    if (this.phase === 'fib-bluff') {
      if (this.bluffs.size >= this.room.players.size) this.finishBluffing();
    } else if (this.phase === 'fib-choose') {
      // A departing author may have been the only thing blocking someone's
      // pick; recount against the remaining players.
      if (this.picks.size >= this.room.players.size) this.finishChoosing();
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
      gameId: 'fibbage',
      round: this.round,
      totalRounds: this.totalRounds,
      endsAt: this.endsAt,
    };
    switch (this.phase) {
      case 'fib-bluff':
        return {
          ...base,
          prompt: this.prompt,
          submittedCount: this.bluffs.size,
          totalPlayers: this.room.players.size,
        };
      case 'fib-choose':
        return {
          ...base,
          prompt: this.prompt,
          options: this.options.map((o) => ({ index: o.index, text: o.text })),
          pickedCount: this.picks.size,
          totalPlayers: this.room.players.size,
        };
      case 'fib-reveal':
        return { ...base, prompt: this.prompt, answer: this.answer, result: this.roundResult };
      case 'gameover':
        return { ...base, standings: this.standings() };
      default:
        return base;
    }
  }

  playerView(playerId) {
    const base = {
      gameId: 'fibbage',
      round: this.round,
      totalRounds: this.totalRounds,
      endsAt: this.endsAt,
    };
    switch (this.phase) {
      case 'fib-bluff':
        return {
          gameState: { ...base, prompt: this.prompt },
          you: {
            submitted: this.bluffs.has(playerId),
            collidedWithTruth: this.collided.has(playerId),
          },
        };
      case 'fib-choose':
        return {
          gameState: {
            ...base,
            prompt: this.prompt,
            // Hide the player's own lie so they can't vote for it; real indexes
            // are preserved so the choice maps back correctly server-side.
            options: this.options
              .filter((o) => !o.authorIds.has(playerId))
              .map((o) => ({ index: o.index, text: o.text })),
          },
          you: { picked: this.picks.has(playerId) },
        };
      case 'fib-reveal': {
        const myPick = this.picks.get(playerId);
        const foundTruth = Number.isInteger(myPick) && this.options[myPick].isTruth;
        return {
          gameState: { ...base, prompt: this.prompt, answer: this.answer, result: this.roundResult },
          you: { foundTruth },
        };
      }
      case 'gameover':
        return { gameState: { ...base, standings: this.standings() }, you: {} };
      default:
        return { gameState: base, you: {} };
    }
  }
}

FibbageGame.meta = {
  id: 'fibbage',
  name: 'Fibbage',
  blurb: 'Bluffing trivia — invent a fake answer, then spot the real one hidden among everyone\'s lies.',
  minPlayers: 2,
};

module.exports = FibbageGame;
