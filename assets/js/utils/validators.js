'use strict';

// ════════════════════════════════════════════════════════════
// VALIDATORS — единый слой валидации входных данных.
// Все функции возвращают { ok: true } или { ok: false, message: '...' }.
// ════════════════════════════════════════════════════════════

const Validators = (() => {

  /**
   * Валидирует имя игрока.
   * @param {string} name
   * @returns {{ ok: boolean, message?: string }}
   */
  function playerName(name) {
    const v = (name || '').trim();
    if (!v) return { ok: false, message: '⚠️ Введите фамилию игрока' };
    if (v.length > 50) return { ok: false, message: '⚠️ Фамилия не должна превышать 50 символов' };
    if (/[<>&"']/.test(v)) return { ok: false, message: '⚠️ Фамилия содержит недопустимые символы' };
    return { ok: true };
  }

  /**
   * Валидирует название турнира.
   * @param {string} name
   * @returns {{ ok: boolean, message?: string }}
   */
  function tournamentName(name) {
    const v = (name || '').trim();
    if (!v) return { ok: false, message: '⚠️ Введите название турнира' };
    if (v.length > 100) return { ok: false, message: '⚠️ Название не должно превышать 100 символов' };
    return { ok: true };
  }

  /**
   * Валидирует дату турнира (YYYY-MM-DD).
   * @param {string} date
   * @returns {{ ok: boolean, message?: string }}
   */
  function tournamentDate(date) {
    const v = (date || '').trim();
    if (!v) return { ok: false, message: '⚠️ Введите дату турнира' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return { ok: false, message: '⚠️ Неверный формат даты (ожидается YYYY-MM-DD)' };
    const d = new Date(v + 'T12:00:00');
    if (isNaN(d.getTime())) return { ok: false, message: '⚠️ Невалидная дата' };
    return { ok: true };
  }

  /**
   * Валидирует код комнаты Supabase.
   * @param {string} code
   * @returns {{ ok: boolean, message?: string }}
   */
  function roomCode(code) {
    const v = (code || '').trim().toUpperCase();
    if (!v) return { ok: false, message: '⚠️ Введите код комнаты' };
    if (v.length < 3 || v.length > 32) return { ok: false, message: '⚠️ Код комнаты: от 3 до 32 символов' };
    if (!/^[A-Z0-9_\-]+$/.test(v)) return { ok: false, message: '⚠️ Код комнаты: только латинские буквы, цифры, _ и -' };
    return { ok: true };
  }

  /**
   * Валидирует секрет комнаты Supabase.
   * @param {string} secret
   * @returns {{ ok: boolean, message?: string }}
   */
  function roomSecret(secret) {
    const v = (secret || '').trim();
    if (!v) return { ok: false, message: '⚠️ Введите секрет комнаты' };
    if (v.length < 6) return { ok: false, message: '⚠️ Секрет комнаты: минимум 6 символов' };
    return { ok: true };
  }

  /**
   * Утилита: показывает toast и возвращает false если валидация провалилась.
   * Удобна для inline-использования: if (!Validators.guard(Validators.playerName(name))) return;
   *
   * @param {{ ok: boolean, message?: string }} result
   * @returns {boolean} true если валидация прошла
   */
  function guard(result) {
    if (!result.ok) {
      if (typeof showToast === 'function') showToast(result.message || '⚠️ Ошибка валидации');
      return false;
    }
    return true;
  }

  return { playerName, tournamentName, tournamentDate, roomCode, roomSecret, guard };
})();
