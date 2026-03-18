import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

function getVmContext() {
  if (globalThis.__volleyVmContext) return globalThis.__volleyVmContext;
  // Create a VM context backed by the current jsdom global.
  // This makes function declarations land on the same `globalThis`
  // that tests interact with (window-like).
  globalThis.__volleyVmContext = vm.createContext(globalThis);
  return globalThis.__volleyVmContext;
}

function runScript(absPath, append = '') {
  const code = readFileSync(absPath, 'utf8');
  vm.runInContext(code + '\n' + append + '\n', getVmContext(), { filename: absPath });
}

/**
 * Loads legacy browser scripts into current (jsdom) global scope.
 * Adds explicit bridges to internal `let` states in `assets/js/core.js`.
 */
export function loadVolleyCoreWithBridges(repoRootAbsPath) {
  if (globalThis.__volleyLoaded) return;
  const abs = (...p) => path.join(repoRootAbsPath, ...p);

  // Base globals used by core.js blocks under test
  if (!globalThis.showToast) globalThis.showToast = () => {};
  if (!globalThis.showConfirm) globalThis.showConfirm = async () => true;
  if (!globalThis.esc) globalThis.esc = (s) => String(s ?? '');
  if (!globalThis.escAttr) globalThis.escAttr = (s) => String(s ?? '');

  // Core dependencies for functions under test
  runScript(
    abs('assets', 'js', 'state', 'app-state.js'),
    `
    // Export for tests
    globalThis.calculateRanking = calculateRanking;
    globalThis.divisionToType = divisionToType;
    `
  ); // calculateRanking, divisionToType, POINTS_TABLE

  // UI modules (post-split)
  runScript(
    abs('assets', 'js', 'ui', 'stats-recalc.js'),
    `
    globalThis.recalcAllPlayerStats = recalcAllPlayerStats;
    globalThis.__coreBridge = globalThis.__coreBridge || {};
    `
  );

  runScript(
    abs('assets', 'js', 'ui', 'tournament-form.js'),
    `
    globalThis.submitTournamentForm = submitTournamentForm;
    globalThis.cloneTrn = cloneTrn;
    globalThis.__coreBridge = globalThis.__coreBridge || {};
    globalThis.__coreBridge.setRosterTrnEditId = (v) => { rosterTrnEditId = v; };
    `
  );

  runScript(
    abs('assets', 'js', 'ui', 'participants-modal.js'),
    `
    globalThis.ptAddPlayer = ptAddPlayer;
    globalThis.ptExportCSV = ptExportCSV;
    globalThis.ptImportCSV = ptImportCSV;
    globalThis.__coreBridge = globalThis.__coreBridge || {};
    globalThis.__coreBridge.setPtTrnId = (v) => { _ptTrnId = v; };
    globalThis.__coreBridge.getPtTrnId = () => _ptTrnId;
    `
  );

  runScript(
    abs('assets', 'js', 'ui', 'results-form.js'),
    `
    globalThis.resAddPlayer = resAddPlayer;
    globalThis.saveResults = saveResults;
    globalThis.__coreBridge = globalThis.__coreBridge || {};
    globalThis.__coreBridge.setResState = (v) => { _resState = v; };
    globalThis.__coreBridge.getResState = () => _resState;
    `
  );

  globalThis.__volleyLoaded = true;

  // IPT format (standalone helpers)
  runScript(
    abs('assets', 'js', 'ui', 'ipt-format.js'),
    `
    globalThis.iptMatchFinished = iptMatchFinished;
    globalThis.generateIPTRounds = generateIPTRounds;
    globalThis.calcIPTStandings = calcIPTStandings;
    globalThis.iptApplyScore = iptApplyScore;
    globalThis.finishIPTRound = finishIPTRound;
    globalThis.finishIPT = finishIPT;
    globalThis.buildIPTMatchHistory = buildIPTMatchHistory;
    // tryGenerateIPTRoundsDynamic is defined in screens/ipt.js (not loaded here)
    if (typeof tryGenerateIPTRoundsDynamic !== 'undefined')
      globalThis.tryGenerateIPTRoundsDynamic = tryGenerateIPTRoundsDynamic;
    `
  );
}

