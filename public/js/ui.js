/**
 * ui.js — All DOM manipulation and rendering helpers.
 * Pure functions that receive data and update the DOM.
 * No socket or game state here — just presentation logic.
 */

const UI = (() => {

  // ── Screen management ─────────────────────────────────────────────────────

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  }

  // ── Toast notifications ───────────────────────────────────────────────────

  function toast(message, type = 'info', duration = 3500) {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => el.remove(), duration);
  }

  // ── Phase badge / header ──────────────────────────────────────────────────

  const PHASE_META = {
    lobby:        { icon: '🎭', text: 'Lobby',      cls: '' },
    night:        { icon: '🌙', text: 'Night',      cls: 'night' },
    day_announce: { icon: '☀️', text: 'Dawn',       cls: 'day' },
    day_discuss:  { icon: '💬', text: 'Discussion', cls: 'day' },
    day_vote:     { icon: '🗳️', text: 'Voting',     cls: 'vote' },
    game_over:    { icon: '🏆', text: 'Game Over',  cls: '' },
  };

  function updatePhaseBadge(phase) {
    const meta = PHASE_META[phase] || PHASE_META.lobby;
    const badge = document.getElementById('phase-badge');
    badge.className = `phase-badge ${meta.cls}`;
    document.getElementById('phase-icon').textContent = meta.icon;
    document.getElementById('phase-text').textContent = meta.text;
  }

  function updateRound(round) {
    const el = document.getElementById('round-badge');
    el.textContent = round > 0 ? `Round ${round}` : '';
  }

  function updateMyRoleBadge(role) {
    const el = document.getElementById('my-role-badge');
    const roleLabels = {
      mafia: '🔴 Mafia',
      citizen: '🔵 Citizen',
      doctor: '🟢 Doctor',
      police: '🟡 Police',
    };
    el.className = `my-role-badge role-${role || 'unknown'}`;
    el.textContent = roleLabels[role] || '🎭 Waiting';
  }

  // ── Timer UI ──────────────────────────────────────────────────────────────

  function updateTimer(remainingMs, fraction) {
    const container = document.getElementById('timer-container');
    const fill = document.getElementById('timer-fill');
    const seconds = document.getElementById('timer-seconds');

    container.style.display = 'block';
    const secs = Math.ceil(remainingMs / 1000);
    seconds.textContent = `${secs}s`;
    fill.style.width = `${Math.round(fraction * 100)}%`;

    fill.className = 'timer-fill';
    if (fraction <= 0.15) fill.classList.add('urgent');
    else if (fraction <= 0.35) fill.classList.add('warning');
  }

  function hideTimer() {
    document.getElementById('timer-container').style.display = 'none';
  }

  // ── Players sidebar ───────────────────────────────────────────────────────

  function renderPlayers(players, myId, myRole) {
    const list = document.getElementById('players-list');
    list.innerHTML = '';

    players.forEach(p => {
      const div = document.createElement('div');
      div.className = `player-item${!p.alive ? ' dead' : ''}${p.id === myId ? ' me' : ''}`;
      div.dataset.id = p.id;

      const initial = (p.name[0] || '?').toUpperCase();
      div.innerHTML = `
        <div class="player-avatar">${p.alive ? initial : '☠'}</div>
        <div style="flex:1;overflow:hidden;">
          <div class="player-name">${escHtml(p.name)}${p.id === myId ? ' <span style="color:var(--text-muted);font-size:0.7rem;">(you)</span>' : ''}</div>
          ${p.isHost ? '<div class="player-host-badge">Host</div>' : ''}
          ${!p.alive ? '<div class="player-status">eliminated</div>' : ''}
        </div>
      `;
      list.appendChild(div);
    });
  }

  // ── Main content area ─────────────────────────────────────────────────────

  function setMainContent(html) {
    document.getElementById('game-main').innerHTML = html;
  }

  function renderLobby(roomId, playerCount, totalPlayers, isHost, settings) {
    const citizenCount = totalPlayers - settings.mafiaCount
      - (settings.doctorEnabled ? 1 : 0) - (settings.policeEnabled ? 1 : 0);
    const roleBreakdown = `${settings.mafiaCount} Mafia · ${citizenCount} Citizens`
      + (settings.doctorEnabled ? ' · 1 Doctor' : '')
      + (settings.policeEnabled ? ' · 1 Police' : '');

    setMainContent(`
      <div class="lobby-panel">
        <h2>Waiting for Players</h2>
        <p style="color:var(--text-secondary);font-size:0.9rem;">Share this code with your friends</p>
        <div class="room-code-display">${escHtml(roomId)}</div>
        <div class="player-count-info">
          ${playerCount} / ${totalPlayers} players joined
        </div>
        <div class="role-summary ok" style="text-align:center;margin-bottom:1rem;">${escHtml(roleBreakdown)}</div>
        ${isHost
          ? `<button class="btn btn-primary" id="btn-start-game" style="max-width:200px;margin:0 auto;"
              ${playerCount < totalPlayers ? 'disabled' : ''}>
              Start Game
             </button>
             ${playerCount < totalPlayers
               ? `<p style="color:var(--text-muted);font-size:0.8rem;margin-top:0.75rem;font-family:'Courier Prime',monospace;">
                   Waiting for ${totalPlayers - playerCount} more player${totalPlayers - playerCount !== 1 ? 's' : ''}...
                  </p>`
               : ''
             }`
          : `<p style="color:var(--text-secondary);font-family:'Courier Prime',monospace;font-size:0.85rem;">
               Waiting for host to start the game…
             </p>`
        }
      </div>
    `);
  }

  function renderNightPhase(myRole, mafiaTeam, nightPrompt, myId, actionSubmitted) {
    const isMafia = myRole === 'mafia';
    const isDoctor = myRole === 'doctor';
    const isPolice = myRole === 'police';

    let actionHtml = '';

    if (nightPrompt && !actionSubmitted) {
      const actionMap = {
        kill: { title: 'Choose your target', desc: 'Select a player to eliminate tonight.', btnClass: 'target-btn', color: 'var(--red-bright)' },
        protect: { title: 'Choose who to protect', desc: 'Select a player to heal tonight.', btnClass: 'target-btn', color: 'var(--green-bright)' },
        investigate: { title: 'Investigate a player', desc: 'Select a player to uncover their allegiance.', btnClass: 'target-btn', color: 'var(--gold)' },
      };
      const am = actionMap[nightPrompt.action] || {};
      const targets = nightPrompt.targets || [];

      actionHtml = `
        <div class="night-action-panel">
          <h3 style="color:${am.color || 'var(--text-gold)'};">${am.title || 'Your Action'}</h3>
          <p class="action-description">${am.desc || ''}</p>
          <div class="target-grid" id="target-grid">
            ${targets.map(t => `
              <button class="${am.btnClass}" data-target="${t.id}" onclick="GameClient.submitNightAction('${nightPrompt.action}', '${t.id}', this)">
                ${escHtml(t.name)}
              </button>
            `).join('')}
          </div>
        </div>
      `;
    } else if (actionSubmitted) {
      actionHtml = `
        <div class="night-action-panel">
          <div class="action-submitted">✓ Action submitted. Waiting for other players...</div>
        </div>
      `;
    } else if (myRole === 'citizen') {
      actionHtml = `
        <div class="night-action-panel">
          <h3 style="color:var(--text-secondary);">You are a Citizen</h3>
          <p class="action-description">Citizens have no night action. Wait for morning...</p>
        </div>
      `;
    }

    // Mafia team info
    let mafiaInfoHtml = '';
    if (isMafia && mafiaTeam && mafiaTeam.length > 1) {
      const allies = mafiaTeam.filter(m => m.id !== myId);
      if (allies.length > 0) {
        mafiaInfoHtml = `
          <div style="background:rgba(192,39,58,0.06);border:1px solid var(--red-dim);border-radius:var(--radius);padding:0.75rem 1rem;font-size:0.85rem;color:var(--red-bright);">
            🤝 Your mafia allies: <strong>${allies.map(a => escHtml(a.name)).join(', ')}</strong>
          </div>
        `;
      }
    }

    setMainContent(`
      <div class="phase-announcement night-theme">
        <h2>🌙 Night Falls</h2>
        <p style="color:var(--text-secondary);">The city sleeps. Shadows move...</p>
      </div>
      ${mafiaInfoHtml}
      ${actionHtml}
      <div class="game-log" id="game-log-panel"></div>
    `);
  }

  function renderDayAnnounce(killed, saved) {
    let deathHtml = '';
    if (killed) {
      deathHtml = `<div class="death-notice">☠ <strong>${escHtml(killed.name)}</strong> was found dead this morning.</div>`;
    } else if (saved) {
      deathHtml = `<div class="death-notice" style="border-color:var(--green);color:var(--green-bright);">🛡 Someone was targeted but survived — the Doctor saved them!</div>`;
    } else {
      deathHtml = `<div class="death-notice" style="border-color:var(--blue);color:var(--blue-bright);">😴 A quiet night — no one was eliminated.</div>`;
    }

    setMainContent(`
      <div class="phase-announcement day-theme">
        <h2>☀️ Morning</h2>
        <p style="color:var(--text-secondary);">The town gathers to share what happened...</p>
        ${deathHtml}
      </div>
      <div class="game-log" id="game-log-panel"></div>
    `);
  }

  function renderDiscussPhase() {
    setMainContent(`
      <div class="phase-announcement day-theme">
        <h2>💬 Discussion</h2>
        <p style="color:var(--text-secondary);">Talk it out. Who do you trust? Use the chat →</p>
      </div>
      <div class="game-log" id="game-log-panel"></div>
    `);
  }

  function renderVotingPhase(targets, myId, myAlive, voteCast) {
    const targetBtns = targets
      .filter(t => t.id !== myId)
      .map(t => `
        <button class="target-btn${voteCast === t.id ? ' selected' : ''}"
          data-target="${t.id}"
          onclick="GameClient.castVote('${t.id}', this)"
          ${!myAlive || voteCast ? 'disabled' : ''}>
          ${escHtml(t.name)}
        </button>
      `).join('');

    setMainContent(`
      <div class="voting-panel">
        <h3>🗳️ Vote to Eliminate</h3>
        <p class="vote-counter" id="vote-counter">Waiting for votes...</p>
        ${!myAlive
          ? '<p style="color:var(--text-muted);font-family:\'Courier Prime\',monospace;font-size:0.85rem;">Dead players cannot vote.</p>'
          : voteCast
            ? '<p class="action-submitted" style="text-align:left;">✓ Vote cast. Waiting for others...</p>'
            : ''
        }
        <div class="target-grid">${targetBtns}</div>
      </div>
      <div class="game-log" id="game-log-panel"></div>
    `);
  }

  function renderVoteResult(result) {
    let content = '';
    if (result.tie || !result.eliminated) {
      content = `
        <div class="vote-result-card">
          <h3 style="color:var(--gold);">The vote was a tie!</h3>
          <p style="color:var(--text-secondary);">No one was eliminated.</p>
          ${renderTally(result.tally)}
        </div>
      `;
    } else {
      const e = result.eliminated;
      content = `
        <div class="vote-result-card">
          <h3>⚖️ ${escHtml(e.name)} was eliminated</h3>
          <p style="color:var(--text-secondary);">They were a <strong style="color:${roleColor(e.role)}">${e.role}</strong>.</p>
          ${renderTally(result.tally)}
        </div>
      `;
    }
    setMainContent(content + '<div class="game-log" id="game-log-panel"></div>');
  }

  function renderTally(tally) {
    if (!tally || Object.keys(tally).length === 0) return '';
    const items = Object.entries(tally)
      .map(([name, count]) => `<div class="tally-item">${escHtml(name)}<span class="tally-count">${count}</span></div>`)
      .join('');
    return `<div style="margin-top:1rem;"><div style="font-family:'Courier Prime',monospace;font-size:0.75rem;color:var(--text-muted);margin-bottom:0.5rem;">VOTE TALLY</div><div class="tally-grid">${items}</div></div>`;
  }

  function renderGameOver(data) {
    const isMafiaWin = data.winner === 'mafia';
    const revealItems = (data.roleReveal || []).map(p => `
      <div class="role-reveal-item${!p.alive ? ' dead' : ''}">
        <div class="reveal-name">${escHtml(p.name)}${!p.alive ? ' ☠' : ''}</div>
        <div class="reveal-role ${p.role}">${p.role}</div>
      </div>
    `).join('');

    setMainContent(`
      <div class="game-over-panel ${isMafiaWin ? 'winner-mafia' : 'winner-citizens'}">
        <div class="game-over-title">${escHtml(data.winnerText || 'Game Over')}</div>
        <p style="color:var(--text-secondary);margin-bottom:1rem;">Final player roles revealed below</p>
        <div class="role-reveal-grid">${revealItems}</div>
        <div id="restart-btn-area"></div>
      </div>
      <div class="game-log" id="game-log-panel"></div>
    `);
  }

  function showRestartButton(isHost) {
    const area = document.getElementById('restart-btn-area');
    if (!area) return;
    if (isHost) {
      area.innerHTML = `<button class="btn btn-gold" style="margin-top:1rem;" onclick="GameClient.showRestartModal()">🔄 Restart Game</button>`;
    } else {
      area.innerHTML = `<p style="color:var(--text-muted);font-family:'Courier Prime',monospace;font-size:0.85rem;margin-top:1rem;">Waiting for host to restart...</p>`;
    }
  }

  // ── Game log ──────────────────────────────────────────────────────────────

  function appendLog(entries) {
    const panel = document.getElementById('game-log-panel');
    if (!panel) return;
    panel.innerHTML = `
      <h4>Game Log</h4>
      <div class="log-entries">
        ${entries.slice(-20).map(e => `
          <div class="log-entry">
            <span class="log-time">${formatTime(e.time)}</span>${escHtml(e.text)}
          </div>
        `).join('')}
      </div>
    `;
    // Scroll to bottom
    const logEntries = panel.querySelector('.log-entries');
    if (logEntries) logEntries.scrollTop = logEntries.scrollHeight;
  }

  // ── Chat ──────────────────────────────────────────────────────────────────

  function appendChatMessage(msg, myId) {
    const container = document.getElementById('chat-messages');
    if (!container) return;

    const el = document.createElement('div');
    if (msg.type === 'system') {
      el.className = 'chat-msg system';
      el.textContent = msg.message;
    } else {
      const isMine = msg.senderId === myId;
      const isMafia = msg.type === 'mafia';
      el.className = `chat-msg${isMine ? ' mine' : ''}${isMafia ? ' mafia-type' : ''}`;
      el.innerHTML = `
        <div class="chat-sender">${escHtml(msg.senderName)}${isMafia ? ' <span style="color:var(--red-bright);">[Mafia]</span>' : ''}</div>
        <div class="chat-text">${escHtml(msg.message)}</div>
      `;
    }
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
  }

  function setChatEnabled(enabled, placeholder = '') {
    const input = document.getElementById('chat-input');
    const btn = document.getElementById('chat-send');
    input.disabled = !enabled;
    btn.disabled = !enabled;
    if (placeholder) input.placeholder = placeholder;
  }

  function showMafiaChatTab(show) {
    document.getElementById('chat-tab-mafia').style.display = show ? '' : 'none';
  }

  // ── Role-based color helper ───────────────────────────────────────────────

  function roleColor(role) {
    const colors = {
      mafia: 'var(--red-bright)',
      citizen: 'var(--blue-bright)',
      doctor: 'var(--green-bright)',
      police: 'var(--gold)',
    };
    return colors[role] || 'var(--text-primary)';
  }

  // ── Role summary (home screen) ────────────────────────────────────────────

  function updateRoleSummary(total, mafia, doctor, police) {
    const el = document.getElementById('role-summary');
    const specialRoles = (doctor ? 1 : 0) + (police ? 1 : 0);
    const citizens = total - mafia - specialRoles;

    if (mafia < 1) {
      el.className = 'role-summary error';
      el.textContent = 'Need at least 1 mafia.';
      return false;
    }
    if (mafia >= total / 2) {
      el.className = 'role-summary error';
      el.textContent = 'Mafia must be less than half of total players.';
      return false;
    }
    if (citizens < 1) {
      el.className = 'role-summary error';
      el.textContent = `Not enough citizens — increase total players.`;
      return false;
    }
    if (total < 3) {
      el.className = 'role-summary error';
      el.textContent = 'Need at least 3 players.';
      return false;
    }

    el.className = 'role-summary ok';
    el.textContent = `${mafia} Mafia · ${citizens} Citizens${doctor ? ' · 1 Doctor' : ''}${police ? ' · 1 Police' : ''}`;
    return true;
  }

  // ── Restart modal ─────────────────────────────────────────────────────────

  function showRestartModal(settings) {
    const overlay = document.getElementById('restart-overlay');
    document.getElementById('restart-total').value = settings.totalPlayers;
    document.getElementById('restart-mafia').value = settings.mafiaCount;
    document.getElementById('restart-doctor').checked = settings.doctorEnabled;
    document.getElementById('restart-police').checked = settings.policeEnabled;
    updateRestartSummary();
    overlay.classList.remove('hidden');
  }

  function hideRestartModal() {
    document.getElementById('restart-overlay').classList.add('hidden');
  }

  function updateRestartSummary() {
    const total = parseInt(document.getElementById('restart-total').value) || 0;
    const mafia = parseInt(document.getElementById('restart-mafia').value) || 0;
    const doctor = document.getElementById('restart-doctor').checked;
    const police = document.getElementById('restart-police').checked;
    const el = document.getElementById('restart-summary');
    const specialRoles = (doctor ? 1 : 0) + (police ? 1 : 0);
    const citizens = total - mafia - specialRoles;
    if (citizens < 1 || mafia < 1 || mafia >= total / 2) {
      el.className = 'role-summary error';
      el.textContent = 'Invalid settings.';
    } else {
      el.className = 'role-summary ok';
      el.textContent = `${mafia} Mafia · ${citizens} Citizens${doctor ? ' · 1 Doctor' : ''}${police ? ' · 1 Police' : ''}`;
    }
  }

  function getRestartSettings() {
    return {
      totalPlayers: parseInt(document.getElementById('restart-total').value),
      mafiaCount:   parseInt(document.getElementById('restart-mafia').value),
      doctorEnabled: document.getElementById('restart-doctor').checked,
      policeEnabled: document.getElementById('restart-police').checked,
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatTime(ts) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }

  return {
    showScreen, toast,
    updatePhaseBadge, updateRound, updateMyRoleBadge,
    updateTimer, hideTimer,
    renderPlayers,
    renderLobby, renderNightPhase, renderDayAnnounce,
    renderDiscussPhase, renderVotingPhase, renderVoteResult,
    renderGameOver, showRestartButton,
    appendLog,
    appendChatMessage, setChatEnabled, showMafiaChatTab,
    updateRoleSummary,
    showRestartModal, hideRestartModal, updateRestartSummary, getRestartSettings,
    escHtml,
  };
})();
