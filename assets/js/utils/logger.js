'use strict';

// ════════════════════════════════════════════════════════════
// CENTRALIZED LOGGER
// Структурированное логирование с кольцевым буфером последних ошибок.
// Доступен глобально через window.AppLogger.
// ════════════════════════════════════════════════════════════

const AppLogger = (() => {
  const MAX_ERRORS = 50;
  const _errors = []; // кольцевой буфер последних ошибок

  function _store(level, module, msg, extra) {
    _errors.push({ ts: Date.now(), level, module, msg, extra });
    if (_errors.length > MAX_ERRORS) _errors.shift();
  }

  return {
    warn(module, msg, extra) {
      _store('warn', module, msg, extra);
      console.warn(`[${module}]`, msg, extra !== undefined ? extra : '');
    },

    error(module, msg, extra) {
      _store('error', module, msg, extra);
      console.error(`[${module}]`, msg, extra !== undefined ? extra : '');
    },

    info(module, msg) {
      console.info(`[${module}]`, msg);
    },

    /** Возвращает копию буфера ошибок для диагностики */
    getErrors() {
      return [..._errors];
    },

    /** Выводит последние N ошибок в консоль (удобно для отладки) */
    dump(n = 10) {
      console.table(_errors.slice(-n));
    },
  };
})();
