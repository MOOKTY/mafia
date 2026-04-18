/**
 * socketHandlers.js — Wires socket.io events to game/room logic.
 * This file ONLY handles transport concerns; game logic lives in Game.js.
 */

const { PHASES, ROLES } = require('./Game');

module.exports = function registerSocketHandlers(io, roomManager) {

  io.on('connection', (socket) => {
    console.log(`[+] Connected: ${socket.id}`);

    // ── Create a new room ────────────────────────────────────────────────────
    socket.on('createRoom', ({ settings, playerName }, ack) => {
      if (!playerName?.trim()) return ack({ error: 'Player name required' });

      const result = roomManager.createRoom(settings);
      if (result.error) return ack({ error: result.error });

      const { roomId, game } = result;
      const addResult = game.addPlayer(socket.id, playerName.trim());
      if (addResult.error) return ack({ error: addResult.error });

      socket.join(roomId);
      ack({
        ok: true,
        roomId,
        player: { ...addResult.player, role: null },
        players: game.getPublicPlayers(),
        settings: game.settings,
      });
      console.log(`[Room] ${roomId} created by ${playerName}`);
    });

    // ── Join an existing room ────────────────────────────────────────────────
    socket.on('joinRoom', ({ roomId, playerName }, ack) => {
      if (!playerName?.trim()) return ack({ error: 'Player name required' });
      const game = roomManager.getRoom(roomId?.toUpperCase());
      if (!game) return ack({ error: 'Room not found' });
      if (game.phase !== PHASES.LOBBY) return ack({ error: 'Game already in progress' });

      const result = game.addPlayer(socket.id, playerName.trim());
      if (result.error) return ack({ error: result.error });

      socket.join(roomId.toUpperCase());

      // Notify others in the room
      socket.to(roomId.toUpperCase()).emit('playerJoined', {
        players: game.getPublicPlayers(),
      });

      ack({
        ok: true,
        roomId: roomId.toUpperCase(),
        player: { ...result.player, role: null },
        players: game.getPublicPlayers(),
        settings: game.settings,
      });
      console.log(`[Room] ${playerName} joined ${roomId}`);
    });

    // ── Host starts the game ─────────────────────────────────────────────────
    socket.on('startGame', (_, ack) => {
      const entry = roomManager.getPlayerRoom(socket.id);
      if (!entry) return ack?.({ error: 'Not in a room' });
      const { game } = entry;
      const player = game.getPlayerById(socket.id);
      if (!player?.isHost) return ack?.({ error: 'Only the host can start the game' });

      const result = game.startGame();
      if (result.error) return ack?.({ error: result.error });

      // Send each player their private role
      for (const [sid, p] of game.players) {
        const mafiaTeam = [...game.players.values()]
          .filter(mp => mp.role === ROLES.MAFIA)
          .map(mp => ({ id: mp.id, name: mp.name }));

        io.to(sid).emit('roleAssigned', {
          role: p.role,
          // Mafia players know who their teammates are
          mafiaTeam: p.role === ROLES.MAFIA ? mafiaTeam : null,
        });
      }

      ack?.({ ok: true });
    });

    // ── Night action (kill / protect / investigate) ──────────────────────────
    socket.on('nightAction', ({ action, targetId }, ack) => {
      const entry = roomManager.getPlayerRoom(socket.id);
      if (!entry) return ack?.({ error: 'Not in a room' });

      const result = entry.game.submitNightAction(socket.id, action, targetId);
      ack?.(result);
    });

    // ── Day vote ─────────────────────────────────────────────────────────────
    socket.on('castVote', ({ targetId }, ack) => {
      const entry = roomManager.getPlayerRoom(socket.id);
      if (!entry) return ack?.({ error: 'Not in a room' });

      const result = entry.game.submitVote(socket.id, targetId);
      ack?.(result);
    });

    // ── Public chat ──────────────────────────────────────────────────────────
    socket.on('chatMessage', ({ message }) => {
      if (!message?.trim() || message.trim().length > 300) return;
      const entry = roomManager.getPlayerRoom(socket.id);
      if (!entry) return;
      const { roomId, game } = entry;

      const result = game.sendChat(socket.id, message.trim());
      if (result.error) {
        socket.emit('chatError', { error: result.error });
        return;
      }
      io.to(roomId).emit('chatMessage', {
        senderId: socket.id,
        senderName: result.player.name,
        message: message.trim(),
        type: 'public',
        time: Date.now(),
      });
    });

    // ── Mafia-only chat (night) ───────────────────────────────────────────────
    socket.on('mafiaChat', ({ message }) => {
      if (!message?.trim() || message.trim().length > 300) return;
      const entry = roomManager.getPlayerRoom(socket.id);
      if (!entry) return;
      const { game } = entry;

      const result = game.sendMafiaChat(socket.id, message.trim());
      if (result.error) {
        socket.emit('chatError', { error: result.error });
        return;
      }
      // Send only to mafia members
      for (const [sid, p] of game.players) {
        if (p.role === ROLES.MAFIA) {
          io.to(sid).emit('chatMessage', {
            senderId: socket.id,
            senderName: result.player.name,
            message: message.trim(),
            type: 'mafia',
            time: Date.now(),
          });
        }
      }
    });

    // ── Restart game ─────────────────────────────────────────────────────────
    socket.on('restartGame', ({ newSettings }, ack) => {
      const entry = roomManager.getPlayerRoom(socket.id);
      if (!entry) return ack?.({ error: 'Not in a room' });
      const { game } = entry;
      const player = game.getPlayerById(socket.id);
      if (!player?.isHost) return ack?.({ error: 'Only host can restart' });

      const result = game.restart(newSettings);
      ack?.(result);
    });

    // ── Timer sync (client request) ──────────────────────────────────────────
    socket.on('requestTimerSync', (_, ack) => {
      const entry = roomManager.getPlayerRoom(socket.id);
      if (!entry) return ack?.(null);
      ack?.(entry.game.getTimerInfo());
    });

    // ── Disconnect ───────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`[-] Disconnected: ${socket.id}`);
      const result = roomManager.handleDisconnect(socket.id);
      if (!result) return;
      const { roomId, player, game, roomDeleted } = result;
      if (roomDeleted || !player) return;

      io.to(roomId).emit('playerLeft', {
        players: game.getPublicPlayers(),
        playerName: player.name,
      });
    });
  });
};
