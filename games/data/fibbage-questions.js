/*
 * Fibbage-style question bank. Each entry is a weird-but-true fact with a
 * blank; players invent fake fill-ins to bluff each other, then hunt for the
 * real answer hidden in the pile of lies.
 *
 * Keep `answer` short (a word or a few words) so a real answer sits naturally
 * alongside the players' fakes and isn't obvious by length alone.
 * Licensed under AGPLv3 — see LICENSE.
 */
'use strict';

const QUESTIONS = [
  { q: 'A group of flamingos is officially called a ____.', answer: 'flamboyance' },
  { q: 'The dot over a lowercase "i" or "j" is called a ____.', answer: 'tittle' },
  { q: 'In Bhutan, the national sport is ____.', answer: 'archery' },
  { q: 'The fear of long words is ironically named hippopotomonstrosesqui-____-phobia.', answer: 'pedalio' },
  { q: 'Scotland\'s official national animal is the ____.', answer: 'unicorn' },
  { q: 'A "murmuration" is the word for a large group of ____.', answer: 'starlings' },
  { q: 'The world record for most ____ eaten in one minute is held by a man who did 25.', answer: 'grapes' },
  { q: 'Honey found in ancient Egyptian tombs was still ____ after 3,000 years.', answer: 'edible' },
  { q: 'The inventor of the frisbee was turned into one after death by being ____.', answer: 'cremated and molded into discs' },
  { q: 'A single strand of ____ can hold about 100 grams before it snaps.', answer: 'spaghetti' },
  { q: 'The longest recorded flight of a chicken lasted ____ seconds.', answer: '13' },
  { q: 'In Switzerland, it is illegal to own just one ____ because they get lonely.', answer: 'guinea pig' },
  { q: 'Octopuses have three of these: ____.', answer: 'hearts' },
  { q: 'The unicorn beats the ____ on Scotland\'s coat of arms because they are natural enemies.', answer: 'lion' },
  { q: 'Bananas are berries, but ____ are not.', answer: 'strawberries' },
  { q: 'The tiny pocket inside your jeans pocket was originally designed to hold a ____.', answer: 'pocket watch' },
  { q: 'A "baker\'s dozen" is 13 because bakers once added a spare to avoid being ____.', answer: 'fined for short loaves' },
  { q: 'Wombat droppings are famously shaped like ____.', answer: 'cubes' },
  { q: 'The plastic tips on the ends of shoelaces are called ____.', answer: 'aglets' },
  { q: 'Cows have best friends and get stressed when they are ____.', answer: 'separated' },
  { q: 'The Eiffel Tower can grow about 15 cm taller in summer because of ____.', answer: 'heat expansion' },
  { q: 'A group of pugs is called a ____.', answer: 'grumble' },
  { q: 'Sea otters hold ____ while they sleep so they don\'t drift apart.', answer: 'hands' },
  { q: 'The hashtag symbol # is technically called an ____.', answer: 'octothorpe' },
  { q: 'Sloths can hold their breath longer than ____ can.', answer: 'dolphins' },
  { q: 'The Great Wall of China is held together in places with sticky ____.', answer: 'rice' },
  { q: 'Napoleon was once attacked by a horde of ____.', answer: 'rabbits' },
  { q: 'A jiffy is an actual unit of time equal to about ____.', answer: 'one hundredth of a second' },
  { q: 'Nintendo was founded in 1889 and originally made ____.', answer: 'playing cards' },
  { q: 'The average cloud weighs roughly the same as ____.', answer: '100 elephants' },
  { q: 'In ancient Rome, ____ was used as a mouthwash.', answer: 'urine' },
  { q: 'A shrimp\'s heart is located in its ____.', answer: 'head' },
  { q: 'The "M" in M&M\'s stands for Mars and ____.', answer: 'Murrie' },
  { q: 'Venus is the only planet that spins ____.', answer: 'clockwise' },
  { q: 'The world\'s largest desert by area is actually ____.', answer: 'Antarctica' },
  { q: 'A crocodile cannot stick out its ____.', answer: 'tongue' },
];

module.exports = { QUESTIONS };
