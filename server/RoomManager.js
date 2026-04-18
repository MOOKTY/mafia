/**
 * RoomManager.js — Manages all active game rooms.
 * Decouples room lifecycle from socket handling.
 */

const { v4: uuidv4 } = require('uuid');
const { Game, PHASES } = require('./Game');

class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map(); // roomId → Game
  }

  // ── Room lifecycle ─────────────────────────────────────────────────────────

  createRoom(settings) {
    const errors = this._validateSettings(settings);
    if (errors) return { error: errors };

    const roomId = this._generateRoomId();
    const game = new Game(roomId, settings);

    // Wire up the game's event emitter to socket.io
    game.onEvent = (event, data, targetSocketId) => {
      if (targetSocketId) {
        // Private message to one player
        this.io.to(targetSocketId).emit(event, data);
      } else {
        // Broadcast to whole room
        this.io.to(roomId).emit(event, data);
      }
    };

    this.rooms.set(roomId, game);
    return { roomId, game };
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  deleteRoom(roomId) {
    this.rooms.delete(roomId);
  }

  // ── Settings validation ────────────────────────────────────────────────────

  _validateSettings(s) {
    const { totalPlayers, mafiaCount, doctorEnabled, policeEnabled } = s;
    if (!totalPlayers || totalPlayers < 3 || totalPlayers > 20) {
      return 'Total players must be between 3 and 20';
    }
    if (!mafiaCount || mafiaCount < 1) {
      return 'At least 1 mafia required';
    }
    const specialRoles = (doctorEnabled ? 1 : 0) + (policeEnabled ? 1 : 0);
    const citizenCount = totalPlayers - mafiaCount - specialRoles;
    if (citizenCount < 1) {
      return `Not enough citizens. With ${mafiaCount} mafia and ${specialRoles} special roles, need ${mafiaCount + specialRoles + 1} total players minimum.`;
    }
    if (mafiaCount >= totalPlayers / 2) {
      return 'Mafia count must be less than half of total players for a fair game';
    }
    return null;
  }

  _generateRoomId() {
    // 6-character uppercase room code
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id;
    do {
      id = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    } while (this.rooms.has(id));
    return id;
  }

  // ── Player ↔ Room tracking ─────────────────────────────────────────────────

  getPlayerRoom(socketId) {
    for (const [roomId, game] of this.rooms) {
      if (game.players.has(socketId)) return { roomId, game };
    }
    return null;
  }

  handleDisconnect(socketId) {
    const entry = this.getPlayerRoom(socketId);
    if (!entry) return null;
    const { roomId, game } = entry;
    const player = game.removePlayer(socketId);

    // Clean up empty rooms
    if (game.players.size === 0) {
      game._clearTimer();
      this.deleteRoom(roomId);
      return { roomId, player, roomDeleted: true };
    }
    return { roomId, player, game, roomDeleted: false };
  }
}

module.exports = RoomManager;
