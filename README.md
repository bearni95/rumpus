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

The TV screen shows a QR code that phones can scan to join. It points at this
machine's LAN IP (detected automatically, even if the TV page was opened on
`localhost`). Inside Docker or WSL2 the server only sees its own virtual
network, so set the address phones should use yourself, e.g.
`-e PUBLIC_URL=http://192.168.1.20:8012`.

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

Rooms are in-memory only (a server restart wipes them), and there's no
spectator mode. The TV page remembers its room in localStorage and reclaims it
on reload; if the host stays away longer than 2 minutes
(`RUMPUS_HOST_GRACE_MS`) the room closes. Use the "New room" button in the top
bar to close the current room and start fresh.

Phones do the same: after joining, the player's seat is remembered in
localStorage and reclaimed on reload or reconnect, keeping nickname and score.
A dropped phone keeps its seat for 1 minute (`RUMPUS_PLAYER_GRACE_MS`) and is
shown dimmed on the TV meanwhile. The phone's top bar has "Rename" to change
nickname and "Leave" to give up the seat and forget the saved player.

## License

AGPLv3 — see `LICENSE`.
