/**
 * Risk Engine - Evaluates PR risk from product context, affected flows, and code signals
 * Feeds into summary.riskLevel; prefers high precision over recall.
 */

const SIGNALS = {
  CORE_SERVICE_CHANGE: 40,
  DEPENDENCY_IMPACT: 20,
  MISSING_TEST_COVERAGE: 20,
  LARGE_PR: 10,
  HISTORICAL_INCIDENTS: 10,
  PR_KEYWORDS: 10
};

const THRESHOLDS = { low: 40, medium: 75 };

const RISK_KEYWORDS = /\b(fix|security|migration|breaking|critical|urgent|patch)\b/i;

/**
 * Evaluate risk for a PR
 * @param {Object} opts
 * @param {string[]} opts.changedFiles
 * @param {string} opts.diff
 * @param {string} opts.prDescription
 * @param {Array<{ flowName: string, confidence: number, reason: string }>} opts.affectedFlows
 * @param {Object|null} opts.repoContext - repo_context row (product_areas, services, tests_by_area, dependency_graph)
 * @param {Object} opts.existingRisks - output of detectRiskPatterns (security, performance, etc.)
 * @returns {{ level: 'Low'|'Medium'|'High', score: number, signals: string[], reasoning: string }}
 */
function evaluate({ changedFiles = [], diff = '', prDescription = '', affectedFlows = [], repoContext = null, existingRisks = {} }) {
  const signals = [];
  let score = 0;

  const services = (repoContext && repoContext.services) ? Object.keys(repoContext.services) : [];
  const testsByArea = (repoContext && repoContext.tests_by_area) || {};
  const allTestFlows = new Set();
  for (const list of Object.values(testsByArea)) {
    if (Array.isArray(list)) list.forEach(f => allTestFlows.add(f));
  }

  const hasCoreServiceChange = changedFiles.some(f =>
    f.includes('services/') || (services.length && services.some(s => f.includes(s)))
  );
  const hasSchemaChange = changedFiles.some(f =>
    /\.(sql|migration|schema)/i.test(f) || f.includes('migrations/') || f.includes('schema')
  );
  if (hasCoreServiceChange) {
    score += SIGNALS.CORE_SERVICE_CHANGE;
    signals.push('Core service change');
  }
  if (hasSchemaChange) {
    score += SIGNALS.CORE_SERVICE_CHANGE;
    signals.push('Schema/data model change');
  }

  if (affectedFlows && affectedFlows.some(f => f.reason === 'dependency impact')) {
    score += SIGNALS.DEPENDENCY_IMPACT;
    signals.push('Dependency impact on flows');
  }

  const affectedFlowNames = (affectedFlows || []).map(f => f.flowName || f.name);
  const missingTest = affectedFlowNames.some(name => !allTestFlows.has(name));
  if (missingTest && affectedFlowNames.length) {
    score += SIGNALS.MISSING_TEST_COVERAGE;
    signals.push('Missing test coverage for affected flow(s)');
  }

  const diffLines = (diff || '').split('\n').filter(Boolean).length;
  if (diffLines > 500) {
    score += SIGNALS.LARGE_PR;
    signals.push(`Large PR (${diffLines} lines)`);
  }

  if (RISK_KEYWORDS.test(prDescription || '')) {
    score += SIGNALS.PR_KEYWORDS;
    signals.push('PR description risk keywords');
  }

  const hasStrongSignal = hasCoreServiceChange || hasSchemaChange;
  let level = 'Low';
  if (score >= THRESHOLDS.medium) {
    level = hasStrongSignal ? 'High' : 'Medium';
    if (level === 'High' && !hasStrongSignal) level = 'Medium';
  } else if (score >= THRESHOLDS.low) {
    level = 'Medium';
  }

  const reasoning = signals.length
    ? `Signals: ${signals.join('; ')}. Score ${score} → ${level}.`
    : `No strong signals. Score ${score} → ${level}.`;

  return {
    level,
    score,
    signals,
    reasoning
  };
}

module.exports = {
  evaluate,
  SIGNALS,
  THRESHOLDS
};
