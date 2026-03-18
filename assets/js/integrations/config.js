'use strict';

// window.APP_CONFIG может быть задан в config.js (не попадает в репозиторий).
// Если файл отсутствует — используются значения ниже.
const _cfg = window.APP_CONFIG || {};

const DEFAULT_SB_CONFIG = Object.freeze({
  url:        _cfg.supabaseUrl     || 'https://rscctyllkqcpxkxrveoz.supabase.co',
  anonKey:    _cfg.supabaseAnonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJzY2N0eWxsa3FjcHhreHJ2ZW96Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2NzkxNDEsImV4cCI6MjA4ODI1NTE0MX0.s7vrHQTb688zeIKtLZzxqsOwwRY6TCrRPeHdfA96RqA',
  roomCode:   '',
  roomSecret: '',
});

const DEFAULT_GSH_CONFIG = Object.freeze({
  clientId:      _cfg.googleClientId || '',
  spreadsheetId: '',
});
