/**
 * Shared ticket analysis formatter for Linear and Jira
 * Pulse, Recommendations, Test Recipe (Name | Steps | Priority | Automation Level)
 */

function asString(val) {
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') {
    try {
      return JSON.stringify(val);
    } catch {
      return '';
    }
  }
  return '';
}

function asStringArray(val) {
  if (Array.isArray(val)) return val.map(asString).filter(Boolean);
  if (typeof val === 'string') return val.split('\n').map(s => s.trim()).filter(Boolean);
  return [];
}

function asSteps(val) {
  if (Array.isArray(val)) return val.map(asString).filter(Boolean).map(cleanStepNumber);
  if (typeof val === 'string') {
    const lines = val.split('\n').map(s => s.trim()).filter(Boolean);
    if (lines.length > 1) return lines.map(cleanStepNumber).filter(Boolean);
    const numbered = val.split(/(?=\d+[\).\s]+)/).map(s => s.trim()).filter(Boolean);
    if (numbered.length > 1) return numbered.map(cleanStepNumber).filter(Boolean);
    const sentences = val.split(/\.\s+(?=[A-Z])/).map(s => s.trim()).filter(Boolean);
    return sentences.length > 1 ? sentences.map(cleanStepNumber).filter(Boolean) : [val].filter(Boolean);
  }
  if (val && typeof val === 'object' && val.steps) return asSteps(val.steps);
  const str = asString(val);
  return str ? [str] : [];
}

function cleanStepNumber(step) {
  if (typeof step !== 'string') return asString(step);
  return step.replace(/^[\d]+[\).\s]+|^[-•]\s+/, '').trim();
}

function truncate(str, n = 800) {
  str = asString(str);
  return str.length > n ? str.slice(0, n) + '…' : str;
}

const PRIORITY_ORDER = { Smoke: 0, 'Critical Path': 1, Regression: 2 };

function normalizeAnalysis(analysis) {
  const recs = asStringArray(analysis.recommendations || analysis.improvementsNeeded || []);
  const normalized = {
    readinessScore: typeof analysis.readinessScore === 'number' ? Math.min(5, Math.max(1, analysis.readinessScore)) : null,
    affectedAreas: asStringArray(analysis.affectedAreas || []),
    highestRisk: analysis.highestRisk ? asString(analysis.highestRisk).trim() : null,
    recommendations: recs.slice(0, 5),
    testRecipe: []
  };

  if (normalized.recommendations.length === 0) {
    const sources = [
      ...(analysis.toAdd || []).map(x => asString(x.title || x.name || x.description || x)),
      ...(analysis.toClarify || []).map(c => typeof c === 'object' ? asString(c.question) : asString(c)),
      ...(analysis.criticalClarifications || []).map(c => typeof c === 'object' ? asString(c.question) : asString(c)),
      ...(analysis.qaQuestions || []),
      ...(analysis.keyRisks || [])
    ];
    normalized.recommendations = sources.filter(Boolean).slice(0, 5);
  }

  let rawRecipe = analysis.testRecipe || [];
  if (!Array.isArray(rawRecipe)) rawRecipe = [rawRecipe].filter(Boolean);
  const allowedTypes = ['UI', 'API', 'Unit/Component', 'Manual'];
  const mapAutomationLevel = (val) => {
    const v = String(val || '').trim();
    if (allowedTypes.includes(v)) return v;
    const l = v.toLowerCase();
    if (l.includes('e2e') || l.includes('ui') || l.includes('visual')) return 'UI';
    if (l.includes('api') || l.includes('integration')) return 'API';
    if (l.includes('unit') || l.includes('component')) return 'Unit/Component';
    if (l.includes('manual')) return 'Manual';
    return 'UI';
  };
  const mapPriority = (val) => {
    const v = String(val || '').trim().toLowerCase();
    if (v.includes('smoke') || v === 'high') return 'Smoke';
    if (v.includes('critical') || v.includes('medium')) return 'Critical Path';
    if (v.includes('regression') || v === 'low') return 'Regression';
    return 'Critical Path';
  };
  let recipe = rawRecipe.map((test) => {
    const scenarioRaw = test.scenario || test.name || test.title || '';
    const steps = asSteps(scenarioRaw);
    const scenarioFormatted = steps.length > 1 ? steps.map((s, i) => `${i + 1}. ${s}`).join('\n') : asString(scenarioRaw);
    const name = asString(test.name || test.title || '').trim() || (steps[0] ? truncate(steps[0], 50) : 'Test');
    return {
      name: truncate(name, 60),
      scenario: scenarioFormatted,
      priority: mapPriority(test.priority),
      automationLevel: mapAutomationLevel(test.automationLevel || test.testType || test.automation)
    };
  });
  recipe.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1));
  normalized.testRecipe = recipe;

  if (normalized.testRecipe.length === 0) {
    normalized.testRecipe = [
      { name: 'Happy path', scenario: '1. Complete main flow. 2. Verify success.', priority: 'Smoke', automationLevel: 'UI' },
      { name: 'Invalid input', scenario: '1. Submit invalid input. 2. Verify error response.', priority: 'Critical Path', automationLevel: 'API' },
      { name: 'UI feedback', scenario: '1. Verify UI state and feedback.', priority: 'Critical Path', automationLevel: 'UI' }
    ];
  }

  return normalized;
}

function formatAnalysisComment(analysis) {
  try {
    const a = normalizeAnalysis(analysis);

    let comment = '### 🫀 Pulse\n\n';
    if (a.readinessScore != null) comment += `**Readiness score:** ${a.readinessScore}/5\n\n`;
    if (a.affectedAreas.length > 0) comment += `**Affected Areas:** ${a.affectedAreas.map(x => `\`${x}\``).join(' · ')}\n\n`;
    if (a.highestRisk) comment += `**Highest risk:** ${truncate(a.highestRisk, 200)}\n\n`;
    comment += '---\n\n';

    if (a.recommendations.length > 0) {
      comment += '### 📋 Recommendations\n\n';
      a.recommendations.forEach(r => { comment += `${truncate(r, 500)}\n\n`; });
      comment += '---\n\n';
    }

    if (a.testRecipe.length > 0) {
      comment += '### 🧪 Test Recipe\n\n';
      comment += '| Name | Steps | Priority | Automation Level |\n';
      comment += '|------|-------|----------|------------------|\n';
      const priorityEmoji = { Smoke: '🔴', 'Critical Path': '🟡', Regression: '🟢' };
      a.testRecipe.forEach(t => {
        const scenarioDisplay = truncate(t.scenario, 350).replace(/\n/g, ' → ');
        const prio = priorityEmoji[t.priority] || '🟡';
        comment += `| **${t.name}** | ${scenarioDisplay} | ${prio} ${t.priority} | ${t.automationLevel} |\n`;
      });
      comment += '\n';
    }

    comment += '---\n\n🤖 QA Analysis by **Ovi (the AI QA)**';

    return comment;
  } catch (error) {
    console.error('❌ Error formatting analysis comment:', error);
    const keys = analysis ? Object.keys(analysis).join(', ') : 'none';
    return `🤖 FirstQA Analysis\n\n(Formatting failed. Raw keys: ${keys})\n\n---\n🤖 QA Analysis by **Ovi (the AI QA)**`;
  }
}

module.exports = { normalizeAnalysis, formatAnalysisComment };
