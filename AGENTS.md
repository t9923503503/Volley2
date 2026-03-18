# AGENTS.md

## Cursor Cloud specific instructions

This is a static PWA (vanilla HTML/CSS/JS, no build step, no bundler). All application logic runs client-side with `localStorage` persistence.

### Running the app

Serve files via HTTP (required for service worker): `npx http-server . -p 9011 -c-1`. The app is then available at `http://localhost:9011/`.

### Lint / Validate

- `npm run validate:static` — checks file integrity, manifest, JS syntax.

### Tests

- `npm run test:smoke` — Playwright browser smoke tests (auto-starts http-server via `webServer` config on port 9011).
- Playwright needs Chromium installed: `npx playwright install chromium --with-deps`.

### Known issues

- Smoke test #1 may fail due to a Supabase CDN SRI integrity hash mismatch (`integrity` attribute in `index.html` vs actual CDN content). This is a pre-existing issue unrelated to local environment setup.

### Optional integrations

- **Supabase**: cloud sync/registration features. Default config in `assets/js/integrations/config.js`. Migration SQL: `supabase_migration.sql`. Not needed for core local functionality.
- **Google Sheets**: export feature. Requires a Google OAuth Client ID in config. Not needed for core functionality.
