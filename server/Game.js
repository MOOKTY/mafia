/**
 * Game.js — Core game state manager
 * Separates all game logic from socket/transport layer.
 * The Game class is pure logic; sockets just call its methods.
 */

const { v4: uuidv4 } = require('uuid');

// ── Role constants ──────────────────────────────────────────────────────────
const ROLES = {
  MAFIA: 'mafia',
  CITIZEN: 'citizen',
  DOCTOR: 'doctor',
  POLICE: 'police',
};

// ── Phase constants ─────────────────────────────────────────────────────────
const PHASES = {
  LOBBY: 'lobby',
  NIGHT: 'night',
  DAY_ANNOUNCE: 'day_announce',
  DAY_DISCUSS: 'day_discuss',
  DAY_VOTE: 'day_vote',
  GAME_OVER: 'game_over',
};

// ── Timer durations (ms) ────────────────────────────────────────────────────
const TIMERS = {
  NIGHT: 45000,
  DAY_ANNOUNCE: 8000,
  DAY_DISCUSS: 60000,
  DAY_VOTE: 30000,
};

class Game {
  constructor(roomId, settings) {
    this.roomId = roomId;
    this.settings = settings; // { totalPlayers, mafiaCount, doctorEnabled, policeEnabled }
    this.players = new Map(); // socketId → PlayerObj
    this.phase = PHASES.LOBBY;
    this.round = 0;

    // Night action storage (reset each round)
    this.nightActions = {
      mafiaTarget: null,   // socketId
      doctorTarget: null,  // socketId
      policeTarget: null,  // socketId
      mafiaVotes: {},      // socketId → targetId (for consensus)
    };

    // Voting storage
    this.votes = {};       // voterId → targetId
    this.voteResult = null;

    // Game log (public-safe events only)
    this.log = [];

    // Active timer reference (for cleanup)
    this._timer = null;
    this._timerStart = null;
    this._timerDuration = null;

    // Callback set by room manager to broadcast events
    this.onEvent = null; // fn(eventName, data, filter?)
  }

  // ── Player management ─────────────────────────────────────────────────────

  addPlayer(socketId, name) {
    if (this.phase !== PHASES.LOBBY) return { error: 'Game already started' };
    if (this.players.size >= this.settings.totalPlayers) return { error: 'Room full' };
    if ([...this.players.values()].some(p => p.name === name)) {
      return { error: 'Name already taken' };
    }
    const player = {
      id: socketId,
      name,
      role: null,
      alive: true,
      isHost: this.players.size === 0, // first player is host
    };
    this.players.set(socketId, player);
    return { player };
  }

  removePlayer(socketId) {
    const player = this.players.get(socketId);
    if (!player) return;
    this.players.delete(socketId);
    // If host left and game is in lobby, transfer host
    if (player.isHost && this.phase === PHASES.LOBBY && this.players.size > 0) {
      const newHost = this.players.values().next().value;
      newHost.isHost = true;
    }
    return player;
  }

  getPublicPlayers() {
    // Safe player list — no role info leaked to wrong players
    return [...this.players.values()].map(p => ({
      id: p.id,
      name: p.name,
      alive: p.alive,
      isHost: p.isHost,
    }));
  }

  getPlayerById(socketId) {
    return this.players.get(socketId);
  }

  // ── Game start ────────────────────────────────────────────────────────────

  startGame() {
    const playerCount = this.players.size;
    if (playerCount < 3) return { error: 'Need at least 3 players' };
    if (playerCount !== this.settings.totalPlayers) {
      return { error: `Need exactly ${this.settings.totalPlayers} players` };
    }

    this._assignRoles();
    this.round = 1;
    this._addLog(`Game started with ${playerCount} players.`);
    this._startNightPhase();
    return { ok: true };
  }

  _assignRoles() {
    const playerIds = [...this.players.keys()];
    // Shuffle
    for (let i = playerIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [playerIds[i], playerIds[j]] = [playerIds[j], playerIds[i]];
    }

    let idx = 0;
    // Assign mafia
    for (let i = 0; i < this.settings.mafiaCount; i++) {
      this.players.get(playerIds[idx++]).role = ROLES.MAFIA;
    }
    // Assign doctor if enabled
    if (this.settings.doctorEnabled) {
      this.players.get(playerIds[idx++]).role = ROLES.DOCTOR;
    }
    // Assign police if enabled
    if (this.settings.policeEnabled) {
      this.players.get(playerIds[idx++]).role = ROLES.POLICE;
    }
    // Rest are citizens
    while (idx < playerIds.length) {
      this.players.get(playerIds[idx++]).role = ROLES.CITIZEN;
    }
  }

  // ── Phase transitions ─────────────────────────────────────────────────────

  _startNightPhase() {
    this.phase = PHASES.NIGHT;
    this._resetNightActions();
    this._addLog(`🌙 Night ${this.round} begins.`);
    this._emit('phaseChange', {
      phase: PHASES.NIGHT,
      round: this.round,
      duration: TIMERS.NIGHT,
    });
    // Send role-specific night prompts
    this._emitNightPrompts();
    this._startTimer(TIMERS.NIGHT, () => this._resolveNight());
  }

  _emitNightPrompts() {
    for (const [sid, player] of this.players) {
      if (!player.alive) continue;
      if (player.role === ROLES.MAFIA) {
        const targets = this._getAlivePlayers().filter(p => p.role !== ROLES.MAFIA);
        this._emitTo(sid, 'nightPrompt', {
          action: 'kill',
          targets: targets.map(p => ({ id: p.id, name: p.name })),
        });
      } else if (player.role === ROLES.DOCTOR && this.settings.doctorEnabled) {
        const targets = this._getAlivePlayers();
        this._emitTo(sid, 'nightPrompt', {
          action: 'protect',
          targets: targets.map(p => ({ id: p.id, name: p.name })),
        });
      } else if (player.role === ROLES.POLICE && this.settings.policeEnabled) {
        const targets = this._getAlivePlayers().filter(p => p.id !== sid);
        this._emitTo(sid, 'nightPrompt', {
          action: 'investigate',
          targets: targets.map(p => ({ id: p.id, name: p.name })),
        });
      }
    }
  }

  submitNightAction(socketId, action, targetId) {
    const player = this.players.get(socketId);
    if (!player || !player.alive) return { error: 'Invalid player' };
    if (this.phase !== PHASES.NIGHT) return { error: 'Not night phase' };
    const target = this.players.get(targetId);
    if (!target || !target.alive) return { error: 'Invalid target' };

    if (player.role === ROLES.MAFIA && action === 'kill') {
      // Majority vote — track per-mafia vote, last vote wins for simplicity
      this.nightActions.mafiaVotes[socketId] = targetId;
      // Use the most-voted target (or last if tie)
      this.nightActions.mafiaTarget = this._getMafiaConsensus();
      return { ok: true };
    }
    if (player.role === ROLES.DOCTOR && action === 'protect') {
      this.nightActions.doctorTarget = targetId;
      return { ok: true };
    }
    if (player.role === ROLES.POLICE && action === 'investigate') {
      this.nightActions.policeTarget = targetId;
      const result = target.role === ROLES.MAFIA ? 'Mafia' : 'Not Mafia';
      // Send result only to police player
      this._emitTo(socketId, 'policeResult', { targetName: target.name, result });
      this._addLog(`🔍 Police investigated a player.`); // public log hides result
      return { ok: true, result };
    }
    return { error: 'Invalid action' };
  }

  _getMafiaConsensus() {
    const votes = Object.values(this.nightActions.mafiaVotes);
    if (votes.length === 0) return null;
    const freq = {};
    let maxV = 0, winner = null;
    for (const v of votes) {
      freq[v] = (freq[v] || 0) + 1;
      if (freq[v] > maxV) { maxV = freq[v]; winner = v; }
    }
    return winner;
  }

  _resolveNight() {
    this._clearTimer();
    const { mafiaTarget, doctorTarget } = this.nightActions;
    let killed = null;
    let saved = false;

    if (mafiaTarget) {
      if (mafiaTarget === doctorTarget) {
        saved = true;
        this._addLog(`🛡️ Someone was targeted but saved by the Doctor.`);
      } else {
        const victim = this.players.get(mafiaTarget);
        if (victim && victim.alive) {
          victim.alive = false;
          killed = { id: victim.id, name: victim.name };
          this._addLog(`💀 ${victim.name} was eliminated during the night.`);
        }
      }
    } else {
      this._addLog(`😴 A quiet night — no one was eliminated.`);
    }

    const winner = this._checkWinCondition();
    if (winner) {
      this._endGame(winner);
      return;
    }

    // Transition to day announcement
    this.phase = PHASES.DAY_ANNOUNCE;
    this._emit('nightResolution', {
      phase: PHASES.DAY_ANNOUNCE,
      killed,
      saved: saved && !killed,
      round: this.round,
      duration: TIMERS.DAY_ANNOUNCE,
      players: this.getPublicPlayers(),
    });
    this._addLog(`☀️ Day ${this.round} begins.`);
    this._startTimer(TIMERS.DAY_ANNOUNCE, () => this._startDiscussPhase());
  }

  _startDiscussPhase() {
    this.phase = PHASES.DAY_DISCUSS;
    this._emit('phaseChange', {
      phase: PHASES.DAY_DISCUSS,
      round: this.round,
      duration: TIMERS.DAY_DISCUSS,
    });
    this._startTimer(TIMERS.DAY_DISCUSS, () => this._startVotingPhase());
  }

  _startVotingPhase() {
    this.phase = PHASES.DAY_VOTE;
    this.votes = {};
    const targets = this._getAlivePlayers();
    this._emit('phaseChange', {
      phase: PHASES.DAY_VOTE,
      round: this.round,
      duration: TIMERS.DAY_VOTE,
      targets: targets.map(p => ({ id: p.id, name: p.name })),
    });
    this._addLog(`🗳️ Voting phase started.`);
    this._startTimer(TIMERS.DAY_VOTE, () => this._resolveVote());
  }

  submitVote(socketId, targetId) {
    const voter = this.players.get(socketId);
    if (!voter || !voter.alive) return { error: 'Dead players cannot vote' };
    if (this.phase !== PHASES.DAY_VOTE) return { error: 'Not voting phase' };
    const target = this.players.get(targetId);
    if (!target || !target.alive) return { error: 'Invalid target' };
    if (socketId === targetId) return { error: 'Cannot vote for yourself' };

    this.votes[socketId] = targetId;

    // Broadcast updated vote counts (without showing who voted for whom)
    this._emit('voteUpdate', { voteCount: Object.keys(this.votes).length });

    // Auto-resolve if everyone alive has voted
    const aliveCount = this._getAlivePlayers().length;
    if (Object.keys(this.votes).length >= aliveCount) {
      this._clearTimer();
      this._resolveVote();
    }
    return { ok: true };
  }

  _resolveVote() {
    this._clearTimer();
    // Tally votes
    const tally = {};
    for (const targetId of Object.values(this.votes)) {
      tally[targetId] = (tally[targetId] || 0) + 1;
    }

    let maxVotes = 0;
    let eliminated = null;
    let tie = false;

    for (const [pid, count] of Object.entries(tally)) {
      if (count > maxVotes) {
        maxVotes = count;
        eliminated = pid;
        tie = false;
      } else if (count === maxVotes) {
        tie = true;
      }
    }

    if (tie || !eliminated) {
      this._addLog(`🤷 The vote ended in a tie — no one was eliminated.`);
      this._emit('voteResult', { eliminated: null, tie: true, tally: this._safeTally(tally) });
    } else {
      const victim = this.players.get(eliminated);
      if (victim) {
        victim.alive = false;
        this._addLog(`⚖️ ${victim.name} was voted out. They were a ${victim.role}.`);
        this._emit('voteResult', {
          eliminated: { id: victim.id, name: victim.name, role: victim.role },
          tie: false,
          tally: this._safeTally(tally),
          players: this.getPublicPlayers(),
        });
      }
    }

    const winner = this._checkWinCondition();
    if (winner) {
      setTimeout(() => this._endGame(winner), 3000);
      return;
    }

    this.round++;
    setTimeout(() => this._startNightPhase(), 4000);
  }

  _safeTally(tally) {
    // Map IDs to names for display
    const out = {};
    for (const [pid, count] of Object.entries(tally)) {
      const p = this.players.get(pid);
      if (p) out[p.name] = count;
    }
    return out;
  }

  // ── Win condition ─────────────────────────────────────────────────────────

  _checkWinCondition() {
    const alive = this._getAlivePlayers();
    const aliveMafia = alive.filter(p => p.role === ROLES.MAFIA).length;
    const aliveOthers = alive.filter(p => p.role !== ROLES.MAFIA).length;

    if (aliveMafia === 0) return 'citizens';
    if (aliveMafia >= aliveOthers) return 'mafia';
    return null;
  }

  _endGame(winner) {
    this._clearTimer();
    this.phase = PHASES.GAME_OVER;
    const winnerText = winner === 'mafia' ? '🔴 Mafia wins!' : '🟢 Citizens win!';
    this._addLog(`🏆 Game over — ${winnerText}`);

    // Reveal all roles
    const roleReveal = [...this.players.values()].map(p => ({
      id: p.id,
      name: p.name,
      role: p.role,
      alive: p.alive,
    }));

    this._emit('gameOver', { winner, winnerText, roleReveal, log: this.log });
  }

  // ── Restart ───────────────────────────────────────────────────────────────

  restart(newSettings) {
    this._clearTimer();
    if (newSettings) this.settings = newSettings;
    this.phase = PHASES.LOBBY;
    this.round = 0;
    this.votes = {};
    this.log = [];
    this._resetNightActions();
    // Reset player states but keep them in the room
    for (const p of this.players.values()) {
      p.role = null;
      p.alive = true;
    }
    this._emit('gameRestarted', {
      players: this.getPublicPlayers(),
      settings: this.settings,
    });
    return { ok: true };
  }

  // ── Chat ──────────────────────────────────────────────────────────────────

  sendChat(socketId, message) {
    const player = this.players.get(socketId);
    if (!player) return { error: 'Unknown player' };
    if (!player.alive) return { error: 'Dead players cannot chat publicly' };
    if (this.phase === PHASES.NIGHT || this.phase === PHASES.LOBBY) {
      return { error: 'Public chat only during day phases' };
    }
    return { ok: true, player };
  }

  sendMafiaChat(socketId, message) {
    const player = this.players.get(socketId);
    if (!player || player.role !== ROLES.MAFIA) return { error: 'Not mafia' };
    if (this.phase !== PHASES.NIGHT) return { error: 'Mafia chat only at night' };
    return { ok: true, player };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _getAlivePlayers() {
    return [...this.players.values()].filter(p => p.alive);
  }

  _resetNightActions() {
    this.nightActions = {
      mafiaTarget: null,
      doctorTarget: null,
      policeTarget: null,
      mafiaVotes: {},
    };
  }

  _addLog(entry) {
    this.log.push({ time: Date.now(), text: entry });
  }

  _emit(event, data) {
    if (this.onEvent) this.onEvent(event, data);
  }

  _emitTo(socketId, event, data) {
    if (this.onEvent) this.onEvent(event, data, socketId);
  }

  _startTimer(duration, callback) {
    this._clearTimer();
    this._timerStart = Date.now();
    this._timerDuration = duration;
    this._timer = setTimeout(callback, duration);
  }

  _clearTimer() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  getTimerInfo() {
    if (!this._timerStart) return null;
    const elapsed = Date.now() - this._timerStart;
    const remaining = Math.max(0, this._timerDuration - elapsed);
    return { remaining, total: this._timerDuration };
  }
}

module.exports = { Game, PHASES, ROLES, TIMERS };
