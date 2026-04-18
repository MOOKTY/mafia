/**
 * game.js — Main game client module.
 * Manages local game state, socket events, and bridges UI ↔ Server.
 *
 * Architecture:
 *   game.js   → orchestrates state + socket events
 *   ui.js     → all DOM rendering
 *   timer.js  → countdown timer logic
 */

const GameClient = (() => {

  // ── Local state ──────────────────────────────────────────────────────────

  let socket = null;
  let state = {
    roomId: null,
    myId: null,
    myRole: null,
    myName: null,
    isHost: false,
    phase: 'lobby',
    round: 0,
    players: [],
    settings: {},
    mafiaTeam: null,       // only populated for mafia players
    nightPrompt: null,     // { action, targets }
    nightActionDone: false,
    voteCast: null,        // targetId or null
    gameLog: [],
    chatMode: 'public',    // 'public' | 'mafia'
  };

  // ── Init ──────────────────────────────────────────────────────────────────

  function init() {
    socket = io();
    _bindSocketEvents();
    _bindUIEvents();
    _bindHomeEvents();
    console.log('[GameClient] Initialized');
  }

  // ── Home screen events ────────────────────────────────────────────────────

  function _bindHomeEvents() {
    // Live role summary preview
    const updateSummary = () => {
      const total  = parseInt(document.getElementById('setting-total').value) || 0;
      const mafia  = parseInt(document.getElementById('setting-mafia').value) || 0;
      const doctor = document.getElementById('setting-doctor').checked;
      const police = document.getElementById('setting-police').checked;
      UI.updateRoleSummary(total, mafia, doctor, police);
    };
    ['setting-total','setting-mafia','setting-doctor','setting-police'].forEach(id => {
      document.getElementById(id).addEventListener('change', updateSummary);
      document.getElementById(id).addEventListener('input', updateSummary);
    });
    updateSummary();

    // Create room
    document.getElementById('btn-create').addEventListener('click', () => {
      const name = document.getElementById('create-name').value.trim();
      const settings = {
        totalPlayers:  parseInt(document.getElementById('setting-total').value),
        mafiaCount:    parseInt(document.getElementById('setting-mafia').value),
        doctorEnabled: document.getElementById('setting-doctor').checked,
        policeEnabled: document.getElementById('setting-police').checked,
      };
      if (!name) {
        document.getElementById('create-error').textContent = 'Enter your name.';
        return;
      }
      document.getElementById('create-error').textContent = '';
      socket.emit('createRoom', { settings, playerName: name }, (res) => {
        if (res.error) {
          document.getElementById('create-error').textContent = res.error;
          return;
        }
        _onJoinedRoom(res);
      });
    });

    // Join room
    document.getElementById('btn-join').addEventListener('click', () => {
      const name = document.getElementById('join-name').value.trim();
      const code = document.getElementById('join-code').value.trim().toUpperCase();
      if (!name) { document.getElementById('join-error').textContent = 'Enter your name.'; return; }
      if (code.length !== 6) { document.getElementById('join-error').textContent = 'Enter a valid 6-character room code.'; return; }
      document.getElementById('join-error').textContent = '';
      socket.emit('joinRoom', { roomId: code, playerName: name }, (res) => {
        if (res.error) {
          document.getElementById('join-error').textContent = res.error;
          return;
        }
        _onJoinedRoom(res);
      });
    });

    // Enter key shortcuts
    document.getElementById('join-code').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('btn-join').click(); });
    document.getElementById('create-name').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('btn-create').click(); });
    document.getElementById('join-name').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('btn-join').click(); });
  }

  function _onJoinedRoom(res) {
    state.roomId  = res.roomId;
    state.myId    = res.player.id;
    state.myName  = res.player.name;
    state.isHost  = res.player.isHost;
    state.players = res.players;
    state.settings = res.settings;

    UI.showScreen('screen-game');
    UI.updatePhaseBadge('lobby');
    UI.updateMyRoleBadge(null);
    UI.renderPlayers(state.players, state.myId, null);
    _renderCurrentPhase();
  }

  // ── Socket event bindings ─────────────────────────────────────────────────

  function _bindSocketEvents() {

    // Another player joined
    socket.on('playerJoined', ({ players }) => {
      state.players = players;
      UI.renderPlayers(state.players, state.myId, state.myRole);
      _renderCurrentPhase();
      UI.appendChatMessage({ type: 'system', message: `${players[players.length - 1]?.name || 'Someone'} joined the room.` }, state.myId);
    });

    // A player left
    socket.on('playerLeft', ({ players, playerName }) => {
      state.players = players;
      UI.renderPlayers(state.players, state.myId, state.myRole);
      UI.appendChatMessage({ type: 'system', message: `${playerName} left the room.` }, state.myId);
      if (state.phase === 'lobby') _renderCurrentPhase();
    });

    // Role assigned (private)
    socket.on('roleAssigned', ({ role, mafiaTeam }) => {
      state.myRole = role;
      state.mafiaTeam = mafiaTeam;
      UI.updateMyRoleBadge(role);
      if (role === 'mafia') UI.showMafiaChatTab(true);
      // Show a private toast
      const roleMessages = {
        mafia:   '🔴 You are MAFIA. Eliminate the citizens.',
        citizen: '🔵 You are a CITIZEN. Find the mafia!',
        doctor:  '🟢 You are the DOCTOR. Save lives each night.',
        police:  '🟡 You are the POLICE. Investigate suspects.',
      };
      UI.toast(roleMessages[role] || 'Role assigned', role === 'mafia' ? 'error' : 'success', 5000);
    });

    // Generic phase change
    socket.on('phaseChange', (data) => {
      state.phase  = data.phase;
      state.round  = data.round || state.round;
      UI.updatePhaseBadge(state.phase);
      UI.updateRound(state.round);

      if (data.duration) {
        Timer.start(data.duration, UI.updateTimer, UI.hideTimer);
      }

      if (data.phase === 'night') {
        state.nightActionDone = false;
        state.nightPrompt = null;
        UI.renderNightPhase(state.myRole, state.mafiaTeam, null, state.myId, false);
        _updateChatState();
      } else if (data.phase === 'day_discuss') {
        UI.renderDiscussPhase();
        _updateChatState();
        UI.appendLog(state.gameLog);
      } else if (data.phase === 'day_vote') {
        state.voteCast = null;
        const myPlayer = state.players.find(p => p.id === state.myId);
        UI.renderVotingPhase(data.targets || [], state.myId, myPlayer?.alive, null);
        _updateChatState();
        UI.appendLog(state.gameLog);
      }
    });

    // Night prompts for roles
    socket.on('nightPrompt', (prompt) => {
      state.nightPrompt = prompt;
      UI.renderNightPhase(state.myRole, state.mafiaTeam, prompt, state.myId, state.nightActionDone);
      UI.appendLog(state.gameLog);
    });

    // Police investigation result (private)
    socket.on('policeResult', ({ targetName, result }) => {
      UI.toast(`🔍 Investigation: ${targetName} is ${result}`, result === 'Mafia' ? 'error' : 'success', 6000);
      state.nightActionDone = true;
      UI.renderNightPhase(state.myRole, state.mafiaTeam, null, state.myId, true);
    });

    // Night resolved → day announce
    socket.on('nightResolution', (data) => {
      state.phase = data.phase; // day_announce
      state.round = data.round;
      if (data.players) {
        state.players = data.players;
        UI.renderPlayers(state.players, state.myId, state.myRole);
      }
      UI.updatePhaseBadge('day_announce');
      UI.updateRound(state.round);
      if (data.duration) {
        Timer.start(data.duration, UI.updateTimer, UI.hideTimer);
      }
      UI.renderDayAnnounce(data.killed, data.saved);
      UI.appendLog(state.gameLog);
      _updateChatState();
    });

    // Vote progress update
    socket.on('voteUpdate', ({ voteCount }) => {
      const total = state.players.filter(p => p.alive).length;
      const el = document.getElementById('vote-counter');
      if (el) el.textContent = `${voteCount} / ${total} votes cast`;
    });

    // Vote resolved
    socket.on('voteResult', (data) => {
      if (data.players) {
        state.players = data.players;
        UI.renderPlayers(state.players, state.myId, state.myRole);
      }
      UI.renderVoteResult(data);
      UI.appendLog(state.gameLog);
    });

    // Game over
    socket.on('gameOver', (data) => {
      state.phase = 'game_over';
      Timer.stop();
      UI.hideTimer();
      UI.updatePhaseBadge('game_over');
      state.gameLog = data.log || state.gameLog;
      UI.renderGameOver(data);
      UI.appendLog(state.gameLog);
      UI.showRestartButton(state.isHost);
      UI.setChatEnabled(false, 'Game over');

      const winMsg = data.winner === 'mafia' ? '🔴 Mafia wins!' : '🟢 Citizens win!';
      UI.toast(winMsg, data.winner === 'mafia' ? 'error' : 'success', 8000);
    });

    // Game restarted
    socket.on('gameRestarted', ({ players, settings }) => {
      state.phase = 'lobby';
      state.round = 0;
      state.myRole = null;
      state.mafiaTeam = null;
      state.nightPrompt = null;
      state.nightActionDone = false;
      state.voteCast = null;
      state.gameLog = [];
      state.settings = settings;
      state.players = players;

      // Reset host status from player list
      const me = players.find(p => p.id === state.myId);
      if (me) state.isHost = me.isHost;

      Timer.stop();
      UI.hideTimer();
      UI.updatePhaseBadge('lobby');
      UI.updateRound(0);
      UI.updateMyRoleBadge(null);
      UI.showMafiaChatTab(false);
      UI.renderPlayers(state.players, state.myId, null);
      _renderCurrentPhase();
      UI.appendChatMessage({ type: 'system', message: '🔄 Game restarted. Waiting for host to start...' }, state.myId);
      _updateChatState();
    });

    // Chat messages
    socket.on('chatMessage', (msg) => {
      UI.appendChatMessage(msg, state.myId);
    });

    socket.on('chatError', ({ error }) => {
      UI.toast(error, 'error');
    });

    socket.on('disconnect', () => {
      UI.toast('Disconnected from server. Refresh to reconnect.', 'error', 8000);
    });

    socket.on('reconnect', () => {
      UI.toast('Reconnected!', 'success');
    });
  }

  // ── UI event bindings (game screen) ──────────────────────────────────────

  function _bindUIEvents() {
    // Start game button (delegated — rendered dynamically)
    document.getElementById('game-main').addEventListener('click', (e) => {
      if (e.target.id === 'btn-start-game') {
        socket.emit('startGame', {}, (res) => {
          if (res?.error) UI.toast(res.error, 'error');
        });
      }
    });

    // Chat send
    document.getElementById('chat-send').addEventListener('click', sendChat);
    document.getElementById('chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendChat();
    });

    // Chat tab toggle
    document.getElementById('chat-tab-public').addEventListener('click', () => {
      state.chatMode = 'public';
      document.getElementById('chat-tab-public').classList.add('active');
      document.getElementById('chat-tab-mafia').classList.remove('active');
      _updateChatState();
    });
    document.getElementById('chat-tab-mafia').addEventListener('click', () => {
      state.chatMode = 'mafia';
      document.getElementById('chat-tab-mafia').classList.add('active');
      document.getElementById('chat-tab-public').classList.remove('active');
      _updateChatState();
    });

    // Restart modal
    document.getElementById('btn-cancel-restart').addEventListener('click', UI.hideRestartModal);
    document.getElementById('btn-confirm-restart').addEventListener('click', () => {
      const newSettings = UI.getRestartSettings();
      socket.emit('restartGame', { newSettings }, (res) => {
        if (res?.error) { UI.toast(res.error, 'error'); return; }
        UI.hideRestartModal();
      });
    });
    ['restart-total','restart-mafia','restart-doctor','restart-police'].forEach(id => {
      document.getElementById(id).addEventListener('change', UI.updateRestartSummary);
      document.getElementById(id).addEventListener('input', UI.updateRestartSummary);
    });
  }

  // ── Night action ──────────────────────────────────────────────────────────

  function submitNightAction(action, targetId, btn) {
    if (state.nightActionDone) return;
    socket.emit('nightAction', { action, targetId }, (res) => {
      if (res?.error) { UI.toast(res.error, 'error'); return; }
      state.nightActionDone = true;
      // Visual feedback on button
      document.querySelectorAll('.target-btn').forEach(b => b.disabled = true);
      if (btn) btn.classList.add('selected');
      // Show submitted state
      const grid = document.getElementById('target-grid');
      if (grid) {
        grid.insertAdjacentHTML('afterend', '<div class="action-submitted">✓ Action submitted. Waiting for other players...</div>');
      }
    });
  }

  // ── Vote ──────────────────────────────────────────────────────────────────

  function castVote(targetId, btn) {
    if (state.voteCast) return;
    socket.emit('castVote', { targetId }, (res) => {
      if (res?.error) { UI.toast(res.error, 'error'); return; }
      state.voteCast = targetId;
      document.querySelectorAll('.target-btn').forEach(b => b.disabled = true);
      if (btn) btn.classList.add('selected');
    });
  }

  // ── Chat ──────────────────────────────────────────────────────────────────

  function sendChat() {
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if (!msg) return;
    input.value = '';

    if (state.chatMode === 'mafia') {
      socket.emit('mafiaChat', { message: msg });
    } else {
      socket.emit('chatMessage', { message: msg });
    }
  }

  function _updateChatState() {
    const phase = state.phase;
    const myPlayer = state.players.find(p => p.id === state.myId);
    const alive = myPlayer?.alive !== false;

    if (!alive) {
      UI.setChatEnabled(false, 'Dead players cannot chat');
      return;
    }
    if (state.chatMode === 'mafia') {
      const isNight = phase === 'night';
      UI.setChatEnabled(isNight, isNight ? 'Mafia channel...' : 'Mafia chat only at night');
      return;
    }
    const canChat = phase === 'day_discuss' || phase === 'day_vote' || phase === 'day_announce';
    UI.setChatEnabled(canChat, canChat ? 'Type a message...' : 'Chat during day phases');
  }

  // ── Render current phase ──────────────────────────────────────────────────

  function _renderCurrentPhase() {
    const myPlayer = state.players.find(p => p.id === state.myId);
    if (myPlayer) state.isHost = myPlayer.isHost;

    UI.renderPlayers(state.players, state.myId, state.myRole);

    switch (state.phase) {
      case 'lobby':
        UI.renderLobby(state.roomId, state.players.length, state.settings.totalPlayers, state.isHost, state.settings);
        UI.setChatEnabled(false, 'Chat during gameplay');
        break;
      // other phases are handled by socket events
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function showRestartModal() {
    UI.showRestartModal(state.settings);
  }

  // ── Expose public methods ─────────────────────────────────────────────────

  return {
    init,
    submitNightAction,
    castVote,
    showRestartModal,
  };

})();

// ── Bootstrap ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  GameClient.init();
});
