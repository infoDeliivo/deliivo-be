'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function fmtMs(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtDuration(startMs, endMs) {
  return fmtMs(endMs - startMs);
}

function shortPath(fullPath) {
  // Return just the filename without extension
  return path.basename(fullPath);
}

function statusIcon(status) {
  switch (status) {
    case 'passed':  return '<span class="icon pass">✓</span>';
    case 'failed':  return '<span class="icon fail">✗</span>';
    case 'pending': return '<span class="icon skip">○</span>';
    case 'todo':    return '<span class="icon todo">□</span>';
    default:        return '<span class="icon">?</span>';
  }
}

function statusClass(status) {
  switch (status) {
    case 'passed':  return 'pass';
    case 'failed':  return 'fail';
    case 'pending': return 'skip';
    default:        return 'todo';
  }
}

// ---------------------------------------------------------------------------
// HTML sections
// ---------------------------------------------------------------------------

function buildSuiteCards(testResults) {
  return testResults.map((suite, idx) => {
    const name = shortPath(suite.testFilePath);
    const passed = suite.numPassingTests;
    const failed = suite.numFailingTests;
    const skipped = suite.numPendingTests + (suite.numTodoTests ?? 0);
    const total = passed + failed + skipped;
    const duration = fmtDuration(suite.perfStats.start, suite.perfStats.end);
    const suiteClass = failed > 0 ? 'suite-fail' : (skipped === total && total > 0 ? 'suite-skip' : 'suite-pass');
    const defaultOpen = failed > 0;

    const tests = (suite.testResults ?? []).map((t) => {
      const ancestors = (t.ancestorTitles ?? []).join(' › ');
      const label = ancestors ? `${esc(ancestors)} › ${esc(t.title)}` : esc(t.title);
      const failBlock = t.failureMessages?.length
        ? `<pre class="fail-msg">${esc(t.failureMessages.join('\n\n'))}</pre>`
        : '';
      const dur = t.duration != null ? `<span class="test-dur">${fmtMs(t.duration)}</span>` : '';
      return `
        <li class="test-item ${statusClass(t.status)}">
          ${statusIcon(t.status)}
          <span class="test-label">${label}</span>
          ${dur}
          ${failBlock}
        </li>`;
    }).join('');

    return `
    <details class="suite-card ${suiteClass}" ${defaultOpen ? 'open' : ''}>
      <summary class="suite-summary">
        <span class="suite-name">${esc(name)}</span>
        <span class="suite-meta">
          <span class="badge pass">${passed} passed</span>
          ${failed > 0 ? `<span class="badge fail">${failed} failed</span>` : ''}
          ${skipped > 0 ? `<span class="badge skip">${skipped} skipped</span>` : ''}
          <span class="badge dur">${duration}</span>
        </span>
      </summary>
      <ul class="test-list">${tests}</ul>
    </details>`;
  }).join('\n');
}

function buildFailuresSection(testResults) {
  const failures = [];
  for (const suite of testResults) {
    for (const t of (suite.testResults ?? [])) {
      if (t.status === 'failed') {
        failures.push({ suite: shortPath(suite.testFilePath), test: t });
      }
    }
  }
  if (failures.length === 0) return '';

  const items = failures.map(({ suite, test }) => {
    const ancestors = (test.ancestorTitles ?? []).join(' › ');
    const label = ancestors ? `${esc(ancestors)} › ${esc(test.title)}` : esc(test.title);
    const msgs = (test.failureMessages ?? []).map(m => `<pre class="fail-msg">${esc(m)}</pre>`).join('');
    return `
      <div class="failure-item">
        <div class="failure-header">
          <span class="icon fail">✗</span>
          <span class="failure-suite">${esc(suite)}</span>
          <span class="failure-sep">›</span>
          <span class="failure-title">${label}</span>
        </div>
        ${msgs}
      </div>`;
  }).join('\n');

  return `
    <section class="failures-section">
      <h2 class="section-title fail-title">Failures <span class="fail-count">${failures.length}</span></h2>
      ${items}
    </section>`;
}

function buildProgressBar(passed, total) {
  const pct = total === 0 ? 0 : Math.round((passed / total) * 100);
  return `
    <div class="progress-wrap">
      <div class="progress-bar">
        <div class="progress-fill" style="width:${pct}%"></div>
      </div>
      <span class="progress-label">${pct}% passed</span>
    </div>`;
}

// ---------------------------------------------------------------------------
// Full HTML page
// ---------------------------------------------------------------------------

function generateHtml(results) {
  const total    = results.numTotalTests;
  const passed   = results.numPassedTests;
  const failed   = results.numFailedTests;
  const skipped  = results.numPendingTests + (results.numTodoTests ?? 0);
  const suites   = results.numTotalTestSuites ?? results.testResults.length;
  const duration = fmtDuration(results.startTime, Date.now());
  const timestamp = new Date(results.startTime).toLocaleString();
  const overallClass = failed > 0 ? 'status-fail' : 'status-pass';
  const overallLabel = failed > 0 ? 'FAILED' : 'PASSED';

  const suiteCards = buildSuiteCards(results.testResults);
  const failuresSection = buildFailuresSection(results.testResults);
  const progressBar = buildProgressBar(passed, total);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>E2E Test Report</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:       #0f1117;
    --surface:  #1a1d27;
    --border:   #2a2d3e;
    --text:     #e2e8f0;
    --muted:    #64748b;
    --pass:     #22c55e;
    --fail:     #ef4444;
    --skip:     #f59e0b;
    --todo:     #6366f1;
    --dur:      #38bdf8;
    --radius:   8px;
    --font:     -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    --mono:     'SF Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace;
  }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--font);
    font-size: 14px;
    line-height: 1.6;
    min-height: 100vh;
    padding: 0 0 60px;
  }

  /* ── Header ── */
  .header {
    background: linear-gradient(135deg, #1e2235 0%, #141722 100%);
    border-bottom: 1px solid var(--border);
    padding: 28px 40px 24px;
  }
  .header-top {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 20px;
  }
  .header-title {
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.3px;
  }
  .header-title span { color: var(--muted); font-weight: 400; font-size: 14px; margin-left: 8px; }
  .status-pill {
    padding: 4px 14px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  .status-pass { background: rgba(34,197,94,.15); color: var(--pass); border: 1px solid rgba(34,197,94,.3); }
  .status-fail { background: rgba(239,68,68,.15); color: var(--fail); border: 1px solid rgba(239,68,68,.3); }

  /* ── Stat cards ── */
  .stats-row {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 18px;
  }
  .stat-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 12px 20px;
    min-width: 120px;
    text-align: center;
  }
  .stat-card .stat-num {
    font-size: 28px;
    font-weight: 700;
    line-height: 1;
    margin-bottom: 4px;
  }
  .stat-card .stat-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; color: var(--muted); }
  .stat-card.pass .stat-num { color: var(--pass); }
  .stat-card.fail .stat-num { color: var(--fail); }
  .stat-card.skip .stat-num { color: var(--skip); }
  .stat-card.info .stat-num { color: var(--dur); }

  /* ── Progress bar ── */
  .progress-wrap { display: flex; align-items: center; gap: 12px; }
  .progress-bar {
    flex: 1;
    max-width: 400px;
    height: 8px;
    background: var(--border);
    border-radius: 999px;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #16a34a, #22c55e);
    border-radius: 999px;
    transition: width 0.6s ease;
  }
  .progress-label { font-size: 13px; color: var(--muted); font-weight: 600; }

  /* ── Main content ── */
  .main { max-width: 1100px; margin: 32px auto; padding: 0 40px; }

  /* ── Section title ── */
  .section-title {
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--muted);
    margin: 28px 0 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .section-title.fail-title { color: var(--fail); border-color: rgba(239,68,68,.25); }
  .fail-count {
    background: rgba(239,68,68,.15);
    color: var(--fail);
    border: 1px solid rgba(239,68,68,.3);
    border-radius: 999px;
    padding: 0 8px;
    font-size: 11px;
  }

  /* ── Failures ── */
  .failures-section { margin-bottom: 32px; }
  .failure-item {
    background: rgba(239,68,68,.05);
    border: 1px solid rgba(239,68,68,.2);
    border-left: 3px solid var(--fail);
    border-radius: var(--radius);
    padding: 14px 16px;
    margin-bottom: 10px;
  }
  .failure-header { display: flex; align-items: baseline; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
  .failure-suite { font-weight: 600; color: var(--fail); font-size: 12px; }
  .failure-sep { color: var(--muted); }
  .failure-title { color: var(--text); }

  /* ── Suite cards ── */
  .suite-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    margin-bottom: 8px;
    overflow: hidden;
  }
  .suite-card.suite-fail { border-left: 3px solid var(--fail); }
  .suite-card.suite-pass { border-left: 3px solid var(--pass); }
  .suite-card.suite-skip { border-left: 3px solid var(--skip); }

  .suite-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    cursor: pointer;
    user-select: none;
    gap: 12px;
    list-style: none;
  }
  .suite-summary::-webkit-details-marker { display: none; }
  .suite-summary::before {
    content: '▶';
    font-size: 10px;
    color: var(--muted);
    flex-shrink: 0;
    transition: transform 0.2s;
  }
  details[open] > .suite-summary::before { transform: rotate(90deg); }
  .suite-summary:hover { background: rgba(255,255,255,.02); }

  .suite-name { font-weight: 600; font-size: 13px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .suite-meta { display: flex; gap: 6px; align-items: center; flex-shrink: 0; }

  /* ── Badges ── */
  .badge {
    font-size: 11px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 999px;
    white-space: nowrap;
  }
  .badge.pass { background: rgba(34,197,94,.12); color: var(--pass); }
  .badge.fail { background: rgba(239,68,68,.12); color: var(--fail); }
  .badge.skip { background: rgba(245,158,11,.12); color: var(--skip); }
  .badge.dur  { background: rgba(56,189,248,.08); color: var(--dur); }

  /* ── Test list ── */
  .test-list {
    list-style: none;
    border-top: 1px solid var(--border);
    padding: 4px 0;
  }
  .test-item {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 6px 16px 6px 32px;
    font-size: 13px;
    flex-wrap: wrap;
  }
  .test-item.fail { background: rgba(239,68,68,.04); }
  .test-item.skip { opacity: 0.55; }

  .test-label { flex: 1; min-width: 0; }
  .test-dur { font-size: 11px; color: var(--muted); flex-shrink: 0; }

  /* ── Icons ── */
  .icon { font-weight: 700; flex-shrink: 0; }
  .icon.pass { color: var(--pass); }
  .icon.fail { color: var(--fail); }
  .icon.skip { color: var(--skip); }
  .icon.todo { color: var(--todo); }

  /* ── Failure message ── */
  .fail-msg {
    width: 100%;
    margin-top: 8px;
    padding: 10px 12px;
    background: rgba(0,0,0,.35);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-family: var(--mono);
    font-size: 11.5px;
    line-height: 1.5;
    color: #fca5a5;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-x: auto;
  }

  /* ── Filter bar ── */
  .filter-bar {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
    flex-wrap: wrap;
    align-items: center;
  }
  .filter-bar label { font-size: 12px; color: var(--muted); }
  .filter-btn {
    padding: 5px 14px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--muted);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }
  .filter-btn:hover, .filter-btn.active { border-color: var(--dur); color: var(--dur); background: rgba(56,189,248,.08); }
  .filter-btn.active-fail { border-color: var(--fail); color: var(--fail); background: rgba(239,68,68,.08); }

  /* ── Expand/collapse all ── */
  .ctrl-row { display: flex; gap: 8px; margin-bottom: 12px; }
  .ctrl-btn {
    padding: 4px 12px;
    font-size: 11px;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    transition: all 0.15s;
  }
  .ctrl-btn:hover { color: var(--text); border-color: var(--muted); }

  /* ── Responsive ── */
  @media (max-width: 600px) {
    .header { padding: 20px; }
    .main { padding: 0 16px; }
    .stats-row { gap: 8px; }
    .stat-card { min-width: 80px; padding: 10px 12px; }
    .stat-card .stat-num { font-size: 22px; }
  }
</style>
</head>
<body>

<!-- ── Header ── -->
<header class="header">
  <div class="header-top">
    <h1 class="header-title">E2E Test Report <span>${esc(timestamp)}</span></h1>
    <span class="status-pill ${overallClass}">${overallLabel}</span>
  </div>

  <div class="stats-row">
    <div class="stat-card info">
      <div class="stat-num">${total}</div>
      <div class="stat-label">Total tests</div>
    </div>
    <div class="stat-card pass">
      <div class="stat-num">${passed}</div>
      <div class="stat-label">Passed</div>
    </div>
    <div class="stat-card fail">
      <div class="stat-num">${failed}</div>
      <div class="stat-label">Failed</div>
    </div>
    <div class="stat-card skip">
      <div class="stat-num">${skipped}</div>
      <div class="stat-label">Skipped</div>
    </div>
    <div class="stat-card info">
      <div class="stat-num">${suites}</div>
      <div class="stat-label">Suites</div>
    </div>
    <div class="stat-card info">
      <div class="stat-num">${duration}</div>
      <div class="stat-label">Duration</div>
    </div>
  </div>

  ${progressBar}
</header>

<!-- ── Main ── -->
<main class="main">
  ${failuresSection}

  <h2 class="section-title">Test Suites</h2>

  <div class="ctrl-row">
    <button class="ctrl-btn" onclick="setAll(true)">Expand all</button>
    <button class="ctrl-btn" onclick="setAll(false)">Collapse all</button>
  </div>

  <div class="filter-bar" id="filterBar">
    <label>Filter:</label>
    <button class="filter-btn active" data-filter="all" onclick="filter('all', this)">All</button>
    <button class="filter-btn" data-filter="fail" onclick="filter('fail', this)">Failed only</button>
    <button class="filter-btn" data-filter="pass" onclick="filter('pass', this)">Passed only</button>
  </div>

  <div id="suites">
    ${suiteCards}
  </div>
</main>

<script>
  function setAll(open) {
    document.querySelectorAll('#suites details').forEach(d => d.open = open);
  }

  function filter(type, btn) {
    document.querySelectorAll('#filterBar .filter-btn').forEach(b => b.classList.remove('active', 'active-fail'));
    btn.classList.add(type === 'fail' ? 'active-fail' : 'active');
    document.querySelectorAll('#suites details').forEach(d => {
      if (type === 'all') { d.style.display = ''; return; }
      const hasFail = d.classList.contains('suite-fail');
      const hasPass = d.classList.contains('suite-pass');
      if (type === 'fail') d.style.display = hasFail ? '' : 'none';
      if (type === 'pass') d.style.display = hasPass ? '' : 'none';
    });
  }
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Jest Reporter class
// ---------------------------------------------------------------------------

class E2EHtmlReporter {
  constructor(globalConfig, options) {
    this._globalConfig = globalConfig;
    this._options = options || {};
    this._outputFile =
      (options && options.outputFile) ||
      path.join(process.cwd(), 'tests', 'e2e', 'report.html');
  }

  onRunComplete(_testContexts, results) {
    try {
      const html = generateHtml(results);
      fs.mkdirSync(path.dirname(this._outputFile), { recursive: true });
      fs.writeFileSync(this._outputFile, html, 'utf8');
      // Use plain console.log — no chalk required
      console.log('\n  E2E report written: ' + this._outputFile + '\n');
    } catch (err) {
      console.error('E2EHtmlReporter: failed to write report —', err.message);
    }
  }
}

module.exports = E2EHtmlReporter;
