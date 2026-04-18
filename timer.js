/**
 * timer.js — Client-side countdown timer with visual updates.
 * Decoupled from game logic; just manages UI timer display.
 */

const Timer = (() => {
  let _interval = null;
  let _endTime = null;
  let _totalDuration = null;

  function start(durationMs, onTick, onEnd) {
    stop();
    _totalDuration = durationMs;
    _endTime = Date.now() + durationMs;

    function tick() {
      const remaining = Math.max(0, _endTime - Date.now());
      const fraction = remaining / _totalDuration;

      onTick(remaining, fraction);

      if (remaining <= 0) {
        stop();
        onEnd?.();
      }
    }

    tick(); // immediate first call
    _interval = setInterval(tick, 500);
  }

  function stop() {
    if (_interval) {
      clearInterval(_interval);
      _interval = null;
    }
    _endTime = null;
  }

  function syncTo(remainingMs, totalMs) {
    // Sync from server — adjust our local end time
    _totalDuration = totalMs;
    _endTime = Date.now() + remainingMs;
  }

  return { start, stop, syncTo };
})();
