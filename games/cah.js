/*
 * Rumpus Cards-Against-Humanity-style game module (pick-1 prompts only, MVP).
 *
 * Card deck: games/data/cah-cards.js if present (gitignored — bring your own
 * deck; the actual CAH cards are CC BY-NC-SA and not shipped here), otherwise
 * falls back to the small original sample deck in cah-cards.sample.js.
 * Licensed under AGPLv3 — see LICENSE.
 */
'use strict';

const crypto = require('crypto');
let WHITE, BLACK;
try {
  ({ WHITE, BLACK } = require('./data/cah-cards'));
} catch (e) {
  ({ WHITE, BLACK } = require('./data/cah-cards.sample'));
}

const REVEAL_MS = parseInt(process.env.RUMPUS_CAH_REVEAL_MS || '10000', 10);
const TOTAL_ROUNDS = parseInt(process.env.RUMPUS_CAH_ROUNDS || '8', 10);
const HAND_SIZE = 7;
const POINTS_PER_WIN = 500;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

class CAHGame {
  constructor(room, push) {
    this.room = room;
    this.push = push;
    this.phase = 'cah-submit';
    this.round = 0;
    this.totalRounds = TOTAL_ROUNDS;
    this.whiteDeck = shuffle(WHITE.slice());
    this.blackDeck = shuffle(BLACK.slice());
    this.hands = new Map(); // playerId -> [cardText]
    this.blackCard = null;
    this.czarCursor = 0;
    this.czarId = null;
    this.submissions = new Map(); // playerId -> cardText
    this.revealList = null; // shuffled [{ playerId, text }] built at czar phase
    this.winner = null;
    this.timer = null;
    this.endsAt = null;
    this.destroyed = false;

    for (const p of room.players.values()) {
      this.hands.set(p.id, this.drawWhite(HAND_SIZE));
    }
  }

  drawWhite(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      if (this.whiteDeck.length === 0) this.whiteDeck = shuffle(WHITE.slice());
      out.push(this.whiteDeck.pop());
    }
    return out;
  }

  drawBlack() {
    if (this.blackDeck.length === 0) this.blackDeck = shuffle(BLACK.slice());
    return this.blackDeck.pop();
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

  currentCzar() {
    const ids = [...this.room.players.keys()];
    if (ids.length === 0) return null;
    return ids[this.czarCursor % ids.length];
  }

  nextRound() {
    if (this.round >= this.totalRounds) {
      this.gameOver();
      return;
    }
    if (this.room.players.size < 2) {
      this.gameOver();
      return;
    }
    this.round += 1;
    this.czarId = this.currentCzar();
    this.czarCursor += 1;
    this.blackCard = this.drawBlack();
    this.submissions = new Map();
    this.revealList = null;
    this.winner = null;
    this.phase = 'cah-submit';
    this.timer = null;
    this.endsAt = null;
    this.push();
  }

  neededSubmissions() {
    return Math.max(0, this.room.players.size - 1); // everyone except the czar
  }

  handleSubmit(playerId, payload) {
    if (this.destroyed) return;
    if (this.phase === 'cah-submit') {
      if (playerId === this.czarId) return; // czar doesn't play a card
      if (this.submissions.has(playerId)) return;
      const hand = this.hands.get(playerId);
      if (!hand) return;
      const idx = payload.cardIndex;
      if (!Number.isInteger(idx) || idx < 0 || idx >= hand.length) return;
      const text = hand.splice(idx, 1)[0];
      this.submissions.set(playerId, text);
      if (this.submissions.size >= this.neededSubmissions()) {
        this.finishSubmitting();
      } else {
        this.push();
      }
    } else if (this.phase === 'cah-czar') {
      if (playerId !== this.czarId) return;
      const choice = payload.choice;
      if (!Number.isInteger(choice) || choice < 0 || choice >= this.revealList.length) return;
      this.pickWinner(choice);
    }
  }

  finishSubmitting() {
    if (this.phase !== 'cah-submit') return;
    this.revealList = shuffle(
      [...this.submissions.entries()].map(([playerId, text]) => ({ playerId, text }))
    );
    this.phase = 'cah-czar';
    this.push();
  }

  pickWinner(choiceIndex) {
    if (this.phase !== 'cah-czar') return;
    const pick = this.revealList[choiceIndex];
    const p = this.room.players.get(pick.playerId);
    if (p) p.score += POINTS_PER_WIN;
    this.winner = { playerId: pick.playerId, nickname: p ? p.nickname : '(left the game)', text: pick.text };
    // Replenish everyone who played a card back up to HAND_SIZE.
    for (const playerId of this.submissions.keys()) {
      const hand = this.hands.get(playerId);
      if (hand) hand.push(...this.drawWhite(HAND_SIZE - hand.length));
    }
    this.phase = 'cah-reveal';
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
    this.hands.delete(playerId);
    this.submissions.delete(playerId);
    if (this.room.players.size === 0) return;
    if (playerId === this.czarId) {
      // Czar vanished mid-round — no one left to judge, just move on.
      this.nextRound();
      return;
    }
    if (this.phase === 'cah-submit' && this.submissions.size >= this.neededSubmissions()) {
      this.finishSubmitting();
    }
  }

  standings() {
    return [...this.room.players.values()]
      .map((p) => ({ nickname: p.nickname, score: p.score }))
      .sort((a, b) => b.score - a.score);
  }

  czarNickname() {
    const p = this.room.players.get(this.czarId);
    return p ? p.nickname : '???';
  }

  // --- views ---------------------------------------------------------------

  hostGameState() {
    const base = {
      gameId: 'cah',
      round: this.round,
      totalRounds: this.totalRounds,
      czarNickname: this.czarNickname(),
      blackCard: this.blackCard,
    };
    switch (this.phase) {
      case 'cah-submit':
        return {
          ...base,
          submittedCount: this.submissions.size,
          neededCount: this.neededSubmissions(),
        };
      case 'cah-czar':
        return {
          ...base,
          submissions: this.revealList.map((s, i) => ({ index: i, text: s.text })),
        };
      case 'cah-reveal':
        return { ...base, winner: this.winner };
      case 'gameover':
        return { gameId: 'cah', standings: this.standings() };
      default:
        return base;
    }
  }

  playerView(playerId) {
    const base = {
      gameId: 'cah',
      round: this.round,
      totalRounds: this.totalRounds,
      czarNickname: this.czarNickname(),
      blackCard: this.blackCard,
      isCzar: playerId === this.czarId,
    };
    switch (this.phase) {
      case 'cah-submit':
        return {
          gameState: base,
          you: {
            isCzar: playerId === this.czarId,
            hand: this.hands.get(playerId) || [],
            submitted: this.submissions.has(playerId),
          },
        };
      case 'cah-czar':
        return {
          gameState: {
            ...base,
            submissions: playerId === this.czarId
              ? this.revealList.map((s, i) => ({ index: i, text: s.text }))
              : [],
          },
          you: { isCzar: playerId === this.czarId },
        };
      case 'cah-reveal':
        return { gameState: { ...base, winner: this.winner }, you: {} };
      case 'gameover':
        return { gameState: { gameId: 'cah', standings: this.standings() }, you: {} };
      default:
        return { gameState: base, you: {} };
    }
  }
}

CAHGame.meta = {
  id: 'cah',
  name: 'Cards Against Humanity',
  blurb: 'Fill in the blank. Whoever the Card Czar picks wins the round.',
  minPlayers: 3,
};

module.exports = CAHGame;
