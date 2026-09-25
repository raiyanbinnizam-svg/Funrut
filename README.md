# FaceSmash

A head-to-head voting game: two faces, pick one, and the Elo rankings update live.

## Run it

```bash
npm start        # http://localhost:3000
npm test         # Elo unit tests
```

It needs Node 18 or later and has no dependencies. Data is saved to `data/` (set `DATA_DIR` or `PORT` to change where it's saved and which port it uses).
The first run adds 8 placeholder avatars so there's something to vote on.

## 67 · Truth or Dare

Open `http://localhost:3000/67.html` (or just open `public/67.html` in a browser, no server needed).

- Tap **67** in the middle of the wheel (or press Space) to spin. It lands on Truth or Dare and shows a random prompt.
- **Players** take turns. Completing a truth gets +1, a dare +2, and chickening out costs 1. Esc closes a prompt without scoring.
- **Mild / Spicy / Mixed** picks which prompts are used. **Add your own** puts custom truths and dares into the mix.
- **Just Truth / Just Dare** skip the wheel. Players, scores, custom prompts and history are saved in the browser.

## How it works

- **Vote**: the server hands out a matchup with a single-use token. A vote counts only for a matchup the server actually served, so replayed or made-up votes are rejected.
- **Matchmaking**: entries with fewer games are shown more often, and each is paired with someone of a similar rating.
- **Rankings**: standard Elo (K = 32, start at 1200).
- **Join**: anyone can upload *their own* photo (PNG/JPEG/WebP/GIF, max 2 MB). They must tick a consent box. Uploads are checked by their file bytes, not just the extension.

## Files

| File | What it does |
|------|--------------|
| `server.js` | HTTP server, JSON API, and file storage |
| `elo.js` | Elo rating math |
| `public/` | Frontend (plain HTML/CSS/JS) |
| `public/67.html` | The 67 Truth or Dare wheel (single self-contained page) |
