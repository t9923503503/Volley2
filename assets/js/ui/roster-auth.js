'use strict';

const ROSTER_PWD_HASH_KEY = 'kotc3_roster_pwd_hash';
const ROSTER_PWD_SALT_KEY = 'kotc3_roster_pwd_salt';
let rosterUnlocked = sessionStorage.getItem('rosterUnlocked') === '1';

function hasRosterPassword() {
  return !!localStorage.getItem(ROSTER_PWD_HASH_KEY) && !!localStorage.getItem(ROSTER_PWD_SALT_KEY);
}
function rosterRefreshScreen() {
  const roster = document.getElementById('screen-roster');
  if (roster && roster.classList.contains('active')) roster.innerHTML = renderRoster();
}
function rosterRandomSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
async function rosterDigestHex(value) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}
async function rosterHashPassword(password, salt) {
  return rosterDigestHex(`${salt}:${password}`);
}
async function rosterSavePassword(password) {
  const salt = rosterRandomSalt();
  const hash = await rosterHashPassword(password, salt);
  localStorage.setItem(ROSTER_PWD_SALT_KEY, salt);
  localStorage.setItem(ROSTER_PWD_HASH_KEY, hash);
  rosterUnlocked = true;
  sessionStorage.setItem('rosterUnlocked', '1');
}
async function rosterVerifyPassword(password) {
  const salt = localStorage.getItem(ROSTER_PWD_SALT_KEY);
  const hash = localStorage.getItem(ROSTER_PWD_HASH_KEY);
  if (!salt || !hash) return true;
  return (await rosterHashPassword(password, salt)) === hash;
}
function rosterLockNow(notify = true) {
  if (!hasRosterPassword()) return;
  rosterUnlocked = false;
  sessionStorage.removeItem('rosterUnlocked');
  if (activeTabId === 'roster') switchTab('svod');
  else rosterRefreshScreen();
  if (notify) showToast('🔒 Ростер заблокирован');
}
async function rosterRequestUnlock({
  title = '🔒 РОСТЕР',
  subtitle = 'Введите пароль для доступа',
  successMessage = '🔓 Ростер разблокирован',
} = {}) {
  if (!hasRosterPassword()) {
    rosterUnlocked = true;
    return true;
  }
  const ok = await showPasswordPrompt({
    title,
    subtitle,
    confirmLabel: 'Войти',
    note: 'Пароль проверяется только локально на этом устройстве.',
    handler: async password => {
      if (!password) throw new Error('Введите пароль');
      if (!(await rosterVerifyPassword(password))) throw new Error('❌ Неверный пароль');
      rosterUnlocked = true;
      sessionStorage.setItem('rosterUnlocked', '1');
      return true;
    }
  });
  if (ok) {
    rosterRefreshScreen();
    if (successMessage) showToast(successMessage);
  }
  return ok;
}
async function rosterUnlockNow() {
  return rosterRequestUnlock();
}
async function rosterConfigurePassword() {
  const change = hasRosterPassword();
  if (change) {
    const unlocked = await rosterRequestUnlock({
      title: '🔁 Смена пароля',
      subtitle: 'Сначала подтвердите текущий пароль',
      successMessage: ''
    });
    if (!unlocked) return false;
  }

  const ok = await showPasswordPrompt({
    title: change ? '🔁 Новый пароль' : '🔐 Пароль организатора',
    subtitle: 'Пароль хранится локально в этом браузере и не отправляется на сервер.',
    confirmLabel: change ? 'Сохранить' : 'Установить',
    secondaryVisible: true,
    secondaryPlaceholder: 'Повторите пароль',
    note: 'Минимум 4 символа.',
    handler: async (password, repeat) => {
      if ((password || '').length < 4) throw new Error('Минимум 4 символа');
      if (password !== repeat) throw new Error('Пароли не совпадают');
      await rosterSavePassword(password);
      return true;
    }
  });
  if (ok) {
    rosterRefreshScreen();
    showToast(change ? '🔐 Пароль обновлён' : '🔐 Пароль установлен');
  }
  return ok;
}
async function rosterRemovePassword() {
  if (!hasRosterPassword()) return false;
  const ok = await showPasswordPrompt({
    title: '🗑 Убрать пароль',
    subtitle: 'Введите текущий пароль, чтобы снять защиту на этом устройстве.',
    confirmLabel: 'Удалить пароль',
    handler: async password => {
      if (!password) throw new Error('Введите пароль');
      if (!(await rosterVerifyPassword(password))) throw new Error('❌ Неверный пароль');
      localStorage.removeItem(ROSTER_PWD_SALT_KEY);
      localStorage.removeItem(ROSTER_PWD_HASH_KEY);
      sessionStorage.removeItem('rosterUnlocked');
      rosterUnlocked = true;
      return true;
    }
  });
  if (ok) {
    rosterRefreshScreen();
    showToast('🔓 Пароль удалён');
  }
  return ok;
}
function showPasswordPrompt({
  title = '🔒 РОСТЕР',
  subtitle = 'Введите пароль для доступа',
  confirmLabel = 'Войти',
  note = '',
  secondaryVisible = false,
  secondaryPlaceholder = 'Повторите пароль',
  handler = async value => value,
} = {}) {
  return new Promise(resolve => {
    const ov = document.getElementById('pwd-overlay');
    const titleEl = document.getElementById('pwd-title');
    const subEl = document.getElementById('pwd-sub');
    const noteEl = document.getElementById('pwd-note');
    const inp = document.getElementById('pwd-input');
    const inp2 = document.getElementById('pwd-input-2');
    const err = document.getElementById('pwd-error');
    const okBtn = document.getElementById('pwd-ok');
    const cancelBtn = document.getElementById('pwd-cancel');

    titleEl.textContent = title;
    subEl.textContent = subtitle;
    noteEl.textContent = note;
    inp.value = '';
    inp.placeholder = 'Пароль';
    inp.autocomplete = secondaryVisible ? 'new-password' : 'current-password';
    inp2.value = '';
    inp2.placeholder = secondaryPlaceholder;
    inp2.autocomplete = 'new-password';
    inp2.style.display = secondaryVisible ? 'block' : 'none';
    err.textContent = '';
    okBtn.textContent = confirmLabel;
    okBtn.disabled = false;
    cancelBtn.disabled = false;
    ov.classList.add('open');
    setTimeout(() => inp.focus(), 100);

    function onEsc(e) { if (e.key === 'Escape') cleanup(false); }
    document.addEventListener('keydown', onEsc);

    function cleanup(result) {
      ov.classList.remove('open');
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      inp.onkeydown = null;
      inp2.onkeydown = null;
      document.removeEventListener('keydown', onEsc);
      resolve(result);
    }

    async function trySubmit() {
      err.textContent = '';
      okBtn.disabled = true;
      cancelBtn.disabled = true;
      try {
        const result = await handler(inp.value, secondaryVisible ? inp2.value : '');
        cleanup(result === undefined ? true : result);
      } catch (e) {
        err.textContent = e.message || 'Ошибка';
        okBtn.disabled = false;
        cancelBtn.disabled = false;
        inp.select();
        inp.focus();
      }
    }

    okBtn.onclick = trySubmit;
    cancelBtn.onclick = () => cleanup(false);
    inp.onkeydown = e => {
      if (e.key === 'Enter' && secondaryVisible) inp2.focus();
      else if (e.key === 'Enter') trySubmit();
    };
    inp2.onkeydown = e => { if (e.key === 'Enter') trySubmit(); };
  });
}
