/*
 * Rumpus CAH-style sample deck — small, original starter cards so the game
 * runs out of the box. Swap in your own deck by adding games/data/cah-cards.js
 * with the same { WHITE, BLACK } shape (that file is gitignored).
 * Licensed under AGPLv3 — see LICENSE.
 */
'use strict';

const WHITE = [
  "A raccoon with a briefcase.",
  "Forgetting where you parked the spaceship.",
  "An unreasonably confident squirrel.",
  "The last slice of pizza, silently judging you.",
  "A committee meeting that could have been an email.",
  "Sentient tumbleweed.",
  "My browser's 47 open tabs.",
  "A very determined goose.",
  "The concept of Mondays.",
  "A malfunctioning vending machine.",
  "Three raccoons in a trench coat.",
  "An extremely passive-aggressive sticky note.",
  "The sound a printer makes at 2am.",
  "A wizard who only knows one spell.",
  "Existential dread, but make it cute.",
  "A parking ticket with a heartfelt apology attached.",
  "The last known location of my keys.",
  "A pigeon with a law degree.",
  "An overly dramatic houseplant.",
  "The world's most polite argument.",
  "A Roomba with a grudge.",
  "Unsolicited life advice from a stranger.",
  "A conspiracy theory about squirrels.",
  "The one sock that never comes back from the laundry.",
  "A very tired substitute teacher.",
];

const BLACK = [
  "What ruined the family reunion? ____",
  "The new office policy: ____ is now mandatory on Fridays.",
  "Scientists were shocked to discover ____ living in the walls.",
  "The captain's log for stardate 47831: today we encountered ____.",
  "Why did the away team abort the mission? ____",
  "The prophecy foretold ____ would bring about the end times.",
  "What's the secret ingredient? ____",
  "The therapist's notes simply read: ____",
  "Breaking news: local town terrorized by ____.",
  "The last thing recorded on the black box was ____.",
];

module.exports = { WHITE, BLACK };
