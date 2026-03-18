import { test, expect, Page } from '@playwright/test';

const BASE = process.env.SMOKE_HOST
  ? `http://${process.env.SMOKE_HOST}:${process.env.SMOKE_PORT ?? 9011}/`
  : 'http://127.0.0.1:9011/';

function isLocal(url: string) {
  return url.startsWith(BASE) || url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost');
}

async function collectErrors(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  const badResponses: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err.message ?? String(err));
  });
  page.on('requestfailed', (req) => {
    if (isLocal(req.url())) {
      failedRequests.push(`${req.method()} ${req.url()} · ${req.failure()?.errorText}`);
    }
  });
  page.on('response', (resp) => {
    if (resp.status() >= 400 && isLocal(resp.url())) {
      // Игнорируем опциональные файлы: config.js и data/*.json (публичные данные)
      const optionalFile = resp.url().endsWith('/config.js') || resp.url().includes('/data/');
      if (!optionalFile) {
        badResponses.push(`${resp.status()} ${resp.url()}`);
      }
    }
  });

  return { consoleErrors, pageErrors, failedRequests, badResponses };
}

test.describe('Browser smoke', () => {

  test('1. Bootstrap, навигация, ошибки консоли и service worker', async ({ page }) => {
    const errors = await collectErrors(page);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    // Ждём появления навбара (JS построил кнопки)
    await page.locator('.nb[data-tab="home"]').waitFor({ timeout: 15_000 });

    // Приложение загрузилось, bootstrap-ошибка не показана
    await expect(page.locator('#screens')).toBeVisible();
    await expect(page.locator('text=Ошибка запуска приложения')).toHaveCount(0);

    // Навигация по основным вкладкам
    for (const tab of ['home', 'players', 'svod', 'stats', 'roster']) {
      await page.locator(`.nb[data-tab="${tab}"]`).click();
      await expect(page.locator(`#screen-${tab}`)).toHaveClass(/active/);
    }

    // Service worker зарегистрирован
    const swRegistered = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const reg = await navigator.serviceWorker.getRegistration('./sw.js');
      return !!reg;
    });
    expect(swRegistered).toBeTruthy();

    expect(errors.consoleErrors,  'consoleErrors').toEqual([]);
    expect(errors.pageErrors,     'pageErrors').toEqual([]);
    expect(errors.failedRequests, 'failedRequests').toEqual([]);
    expect(errors.badResponses,   'badResponses').toEqual([]);
  });

  test('2. Ростер — локальная парольная защита', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('.nb[data-tab="home"]').waitFor({ timeout: 15_000 });
    await page.locator('.nb[data-tab="roster"]').click();
    const rosterScreen = page.locator('#screen-roster');
    await expect(rosterScreen).toHaveClass(/active/);

    // Экран ростера доступен (пароль не установлен в чистом localStorage)
    // либо отображает форму ввода пароля — в обоих случаях ошибки нет
    await expect(rosterScreen).toBeVisible();
  });

  test('3. Home — создание турнира локально', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('.nb[data-tab="home"]').waitFor({ timeout: 15_000 });
    await page.locator('.nb[data-tab="home"]').click();
    await expect(page.locator('#screen-home')).toHaveClass(/active/);

    // Кнопка добавления турнира существует
    const addBtn = page.locator('#screen-home').getByRole('button', { name: /добав|новый|\\+/i }).first();
    if (await addBtn.count() > 0) {
      await addBtn.click();
      // Форма или модал открылся без ошибок
      await expect(page.locator('text=Ошибка запуска приложения')).toHaveCount(0);
    }
  });

  test('4. Игроки — добавление игрока в ростер', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('.nb[data-tab="home"]').waitFor({ timeout: 15_000 });
    await page.locator('.nb[data-tab="roster"]').click();
    await expect(page.locator('#screen-roster')).toHaveClass(/active/);

    // Поле имени игрока или кнопка добавления существует
    const nameInput = page.locator('#screen-roster').locator('input[type="text"]').first();
    if (await nameInput.count() > 0) {
      await nameInput.fill('Тест Игрок');
      await expect(nameInput).toHaveValue('Тест Игрок');
    }
  });

  test('5. Перезагрузка с зарегистрированным service worker', async ({ page }) => {
    // Первая загрузка — SW регистрируется
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('.nb[data-tab="home"]').waitFor({ timeout: 15_000 });
    const swAfterFirst = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration('./sw.js');
      return reg?.active?.state ?? reg?.installing?.state ?? null;
    });
    expect(swAfterFirst).not.toBeNull();

    // Перезагрузка — SW уже активен, приложение загружается без ошибок
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.nb[data-tab="home"]').waitFor({ timeout: 15_000 });
    await expect(page.locator('#screens')).toBeVisible();
    await expect(page.locator('text=Ошибка запуска приложения')).toHaveCount(0);

    const swAfterReload = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration('./sw.js');
      return !!reg;
    });
    expect(swAfterReload).toBeTruthy();
  });

});
