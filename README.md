# Apnea Dry Training

A minimal local-first web app for apnea dry training.

## Features

- **CO₂**, **O₂**, **Wonka**, and **Custom** training tables
- Guided session runner with countdown timer and voice announcements
- Session history stored in browser localStorage

## Usage

Open `index.html` directly in a browser, or serve locally:

```bash
python3 -m http.server
```

No build step. No dependencies.

## Table types

| Type | Description |
|------|-------------|
| CO₂  | Fixed hold, decreasing rest — builds CO₂ tolerance |
| O₂   | Increasing hold, fixed rest — builds O₂ efficiency |
| Wonka | Hold until first contraction, then countdown — variation of CO₂ |
| Custom | Set hold and rest per round manually |

## Tips

- Tap a table to start a session. Long-press to edit.
- During a Wonka session, tap **First Contraction** when you feel the first diaphragm spasm.
- Voice announcements use the Audio API — allow audio in your browser.

## Credits

Ambient relaxation sounds are sourced from the [Moodist](https://github.com/remvze/moodist) project (MIT-licensed); the original audio is from Pixabay / CC0. See [`audio/sounds/CREDITS.md`](audio/sounds/CREDITS.md) for the full license text and per-file attribution.
