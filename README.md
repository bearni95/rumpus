# Rumpus

Self-hosted Jackbox-style party game platform: one shared TV screen and
everyone else plays from their phone. Runs entirely on your own LAN — no
account, no cloud service, no per-player app install.

- **`/host`** — put this on the TV. Shows the room code and drives the shared screen.
- **`/play`** — everyone else opens this on their phone, enters the room code, and plays.

Built with Node, Express, and Socket.IO. No client build step — the browser
gets plain JS/HTML/CSS, nothing to compile. Rooms are in-memory and ephemeral
(a server restart clears them).

## Running it

```
npm install
npm start
```

Then open `http://<this-machine's-LAN-IP>:3000/host` on the TV and
`http://<this-machine's-LAN-IP>:3000/play` on phones.

Or with Docker:

```
docker build -t rumpus:local .
docker run -d --name rumpus --restart unless-stopped -p 8012:3000 rumpus:local
```

## Games

- **Quiplash** — everyone answers a prompt, then votes for their favorite (self-votes blocked). 2+ players.
- **Trivia Blast** — multiple-choice, speed-scored. 2+ players.
- **Cards Against Humanity** — fill-in-the-blank, pick-1 prompts only. Needs a Card Czar plus at least 2 others (3+ players). Ships with a small original sample deck — see below to use a real CAH deck.
- **Fibbage** — you get a fact with a blank; write a fake answer, then hunt for the real one hidden among everyone's lies. Score for finding the truth, and for every player your lie fools. 2+ players.

New games are pluggable: drop a module in `games/` exporting a `.meta = { id, name, blurb, minPlayers }` plus the lifecycle methods (`start`, `destroy`, `handleSubmit`, `onPlayerLeft`, `hostGameState`, `playerView`), and register it in the `GAMES` map in `server.js`. The host's game picker and min-player gating pick it up automatically.

## Bring your own CAH deck

The actual Cards Against Humanity card text is CC BY-NC-SA (non-commercial) and
isn't shipped in this repo — just a small original sample deck so the game
works out of the box. To use a full deck, drop a file at
`games/data/cah-cards.js` exporting:

```js
module.exports = { WHITE: [...strings], BLACK: [...strings] };
```

That path is gitignored, so your deck stays local.

## Testing

```
npm run test:e2e
```

Boots the server in-process and plays all four games back-to-back with
simulated players, asserting each reaches its terminal state. No browser
required.

## Known limitations

No reconnect-on-refresh (a phone reload drops you from the room), rooms are
in-memory only (a server restart wipes them), the host disconnecting closes
the room, and there's no spectator mode.

## License

AGPLv3 — see `LICENSE`.
