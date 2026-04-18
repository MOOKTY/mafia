# 🎭 Mafia — Real-Time Multiplayer Social Deduction Game

A production-quality online Mafia game built with Node.js + Socket.io + Vanilla JS.

---

## 🏗️ Architecture

```
mafia-game/
├── server/
│   ├── index.js          — Express + Socket.io server entry point
│   ├── Game.js           — Pure game logic (state, phases, win conditions)
│   ├── RoomManager.js    — Multi-room lifecycle management
│   └── socketHandlers.js — Socket.io transport layer (wires events to Game)
│
└── public/
    ├── index.html        — Single-page app shell
    ├── css/style.css     — Complete dark noir UI styles
    └── js/
        ├── timer.js      — Client-side countdown timer utility
        ├── ui.js         — All DOM rendering (pure presentation)
        └── game.js       — Client state machine + socket event handling
```

### Design Principles

- **Separation of concerns**: `Game.js` has zero socket awareness. It emits events via a callback.
- **RoomManager** bridges Socket.io rooms and Game instances.
- **Frontend** follows MVC-ish split: `game.js` = controller, `ui.js` = view, `timer.js` = utility.
- **No hidden info leaks**: Role data only sent to the specific player. Mafia teammates only told to mafia.
- **Race condition safety**: Game phase guards check `this.phase` before accepting actions.

---

## 🚀 Quick Start

### Prerequisites
- Node.js 16+ installed

### Steps

```bash
# 1. Navigate to project directory
cd mafia-game

# 2. Install dependencies
npm install

# 3. Start the server
npm start

# 4. Open browser
# Go to: http://localhost:3000
```

For development with auto-restart:
```bash
npm run dev
```

---

## 🎮 How to Play

1. **Create a Room**: Player 1 sets game settings and creates a room.
2. **Share Code**: Share the 6-character room code with friends.
3. **Join**: Other players enter the code to join.
4. **Start**: Host clicks "Start Game" once all players have joined.
5. **Roles**: Each player privately receives their role.

### Night Phase (45s)
- Mafia → choose someone to kill
- Doctor → choose someone to protect
- Police → investigate a player (see "Mafia" or "Not Mafia")
- Citizens → wait

### Day Phase
- **Announcement (8s)**: Learn who died (if anyone)
- **Discussion (60s)**: Chat publicly, argue, accuse
- **Voting (30s)**: Vote to eliminate a suspect

### Win Conditions
- 🟢 **Citizens win** when all mafia are eliminated
- 🔴 **Mafia wins** when mafia count ≥ remaining players

---

## ⚙️ Configuration

Game settings are set by the host before each game:
- **Total players**: 3–20
- **Mafia count**: At least 1, must be < half of total
- **Doctor**: Optional special role (protects one player per night)
- **Police**: Optional special role (investigates one player per night)

---

## 🔌 Socket Event Reference

| Client → Server     | Description                          |
|---------------------|--------------------------------------|
| `createRoom`        | Create new room with settings        |
| `joinRoom`          | Join existing room by code           |
| `startGame`         | Host starts the game                 |
| `nightAction`       | Submit kill/protect/investigate      |
| `castVote`          | Vote to eliminate a player           |
| `chatMessage`       | Send public chat                     |
| `mafiaChat`         | Send mafia-only night chat           |
| `restartGame`       | Host restarts with optional new settings |

| Server → Client     | Description                          |
|---------------------|--------------------------------------|
| `roleAssigned`      | Private role notification            |
| `phaseChange`       | New game phase started               |
| `nightPrompt`       | Role-specific night action prompt    |
| `policeResult`      | Private investigation result         |
| `nightResolution`   | Night outcomes revealed              |
| `voteUpdate`        | Vote count update                    |
| `voteResult`        | Voting concluded                     |
| `gameOver`          | Game ended with winner + role reveal |
| `gameRestarted`     | Game reset to lobby                  |
| `chatMessage`       | Incoming chat message                |
