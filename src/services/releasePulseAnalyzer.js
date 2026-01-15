/**
 * Release Pulse Analyzer
 * Implements intelligent Go/No-Go decision logic based on multiple factors
 */

/**
 * Analyzes PR and determines smart Go/No-Go release decision
 * @param {Object} aiInsights - The AI analysis results
 * @param {Object} prData - The PR metadata (files changed, additions, deletions)
 * @returns {Object} { decision: 'Go'|'No-Go', confidence: 'High'|'Medium'|'Low', reasoning: string, score: number }
 */
function analyzeReleasePulse(aiInsights, prData = {}) {
  const factors = {
    riskLevel: 0,        // 0-100: Higher = more risky
    impactLevel: 0,      // 0-100: Higher = more impact
    bugsFound: 0,        // 0-100: Higher = more bugs
    criticalAreas: 0,    // 0-100: Higher = more critical
    confidence: 100      // 0-100: Higher = more confident
  };

  const weights = {
    riskLevel: 0.25,
    impactLevel: 0.20,
    bugsFound: 0.30,
    criticalAreas: 0.15,
    confidence: 0.10
  };

  // 1. ANALYZE RISKS from Questions/Risks/Bugs section
  if (aiInsights.questionsRisks) {
    const riskKeywords = ['security', 'vulnerability', 'data loss', 'corruption', 'crash', 'memory leak', 'deadlock', 'race condition'];
    const criticalKeywords = ['authentication', 'authorization', 'payment', 'database', 'data integrity', 'user data'];
    
    let riskCount = 0;
    let criticalCount = 0;
    
    aiInsights.questionsRisks.forEach(item => {
      const text = (item.risk || item.bug || item.question || '').toLowerCase();
      
      // Check for high-risk keywords
      if (riskKeywords.some(keyword => text.includes(keyword))) {
        riskCount++;
      }
      
      // Check for critical area keywords
      if (criticalKeywords.some(keyword => text.includes(keyword))) {
        criticalCount++;
      }
    });
    
    factors.riskLevel = Math.min(100, riskCount * 33); // Max 3 risks = 100
    factors.criticalAreas = Math.min(100, criticalCount * 33);
  }

  // 2. ANALYZE BUGS specifically
  if (aiInsights.questionsRisks) {
    const bugs = aiInsights.questionsRisks.filter(item => item.bug);
    const severeBugKeywords = ['missing error handling', 'no validation', 'unhandled', 'undefined', 'null pointer', 'memory', 'leak'];
    
    let severeBugCount = 0;
    bugs.forEach(bug => {
      const text = bug.bug.toLowerCase();
      if (severeBugKeywords.some(keyword => text.includes(keyword))) {
        severeBugCount++;
      }
    });
    
    factors.bugsFound = Math.min(100, bugs.length * 25 + severeBugCount * 25);
  }

  // 3. ANALYZE IMPACT from product areas and change scope
  if (aiInsights.productAreas) {
    const productAreas = Array.isArray(aiInsights.productAreas) 
      ? aiInsights.productAreas 
      : [aiInsights.productAreas];
    
    const criticalProductAreas = ['authentication', 'payment', 'checkout', 'user management', 'database', 'api', 'security'];
    
    let criticalAreasAffected = 0;
    productAreas.forEach(area => {
      const areaText = (area.area || area).toLowerCase();
      if (criticalProductAreas.some(critical => areaText.includes(critical))) {
        criticalAreasAffected++;
      }
    });
    
    // Impact based on number of areas + criticality
    const areaCount = productAreas.length;
    factors.impactLevel = Math.min(100, (areaCount * 15) + (criticalAreasAffected * 20));
  }

  // 4. ANALYZE CODE CHANGE SCOPE
  if (prData.filesChanged || prData.additions || prData.deletions) {
    const filesChanged = prData.filesChanged || 0;
    const linesChanged = (prData.additions || 0) + (prData.deletions || 0);
    
    // More files + more lines = higher impact
    const scopeScore = Math.min(100, (filesChanged * 5) + (linesChanged / 50));
    factors.impactLevel = Math.max(factors.impactLevel, scopeScore);
  }

  // 5. ANALYZE CONFIDENCE from test coverage hints
  const testFiles = prData.files?.filter(f => 
    f.includes('test') || f.includes('spec') || f.includes('.test.') || f.includes('.spec.')
  ) || [];
  
  if (testFiles.length > 0) {
    factors.confidence = Math.min(100, factors.confidence + 10); // Boost confidence
  }
  
  // If AI mentioned "no tests" or "missing tests" in risks/bugs, reduce confidence
  if (aiInsights.questionsRisks) {
    const hasTestConcerns = aiInsights.questionsRisks.some(item => {
      const text = (item.risk || item.bug || item.question || '').toLowerCase();
      return text.includes('test') && (text.includes('missing') || text.includes('no '));
    });
    if (hasTestConcerns) {
      factors.confidence -= 20;
    }
  }

  // 6. CALCULATE WEIGHTED RISK SCORE (0-100)
  let riskScore = 0;
  riskScore += factors.riskLevel * weights.riskLevel;
  riskScore += factors.impactLevel * weights.impactLevel;
  riskScore += factors.bugsFound * weights.bugsFound;
  riskScore += factors.criticalAreas * weights.criticalAreas;
  riskScore += (100 - factors.confidence) * weights.confidence; // Invert confidence

  // 7. MAKE GO/NO-GO DECISION
  let decision = 'Go';
  let confidenceLevel = 'High';
  let reasoning = [];

  // CRITICAL BLOCKERS (Automatic No-Go)
  const hasCriticalSecurity = factors.riskLevel >= 66 || factors.criticalAreas >= 66;
  const hasSevereBugs = factors.bugsFound >= 75;
  const hasHighImpactNoTests = factors.impactLevel >= 75 && factors.confidence < 50;

  if (hasCriticalSecurity) {
    decision = 'No-Go';
    confidenceLevel = 'Low';
    reasoning.push('Critical security or data integrity risks detected');
  }

  if (hasSevereBugs) {
    decision = 'No-Go';
    confidenceLevel = 'Low';
    reasoning.push('Severe bugs found that could impact users');
  }

  if (hasHighImpactNoTests) {
    decision = 'No-Go';
    confidenceLevel = 'Low';
    reasoning.push('High-impact changes without adequate test coverage');
  }

  // MODERATE CONCERNS (Threshold-based decision)
  if (decision === 'Go') {
    if (riskScore >= 70) {
      decision = 'No-Go';
      confidenceLevel = 'Low';
      reasoning.push('Overall risk score too high for safe release');
    } else if (riskScore >= 50) {
      decision = 'Go';
      confidenceLevel = 'Medium';
      reasoning.push('Proceed with caution - elevated risk levels');
    } else if (riskScore >= 30) {
      decision = 'Go';
      confidenceLevel = 'Medium-High';
      reasoning.push('Minor concerns identified - review recommended');
    } else {
      decision = 'Go';
      confidenceLevel = 'High';
      reasoning.push('Low risk - safe to release after testing');
    }
  }

  return {
    decision,
    confidence: confidenceLevel,
    reasoning: reasoning.join('. '),
    score: Math.round(riskScore),
    factors: {
      risk: Math.round(factors.riskLevel),
      impact: Math.round(factors.impactLevel),
      bugs: Math.round(factors.bugsFound),
      criticalAreas: Math.round(factors.criticalAreas),
      testConfidence: Math.round(factors.confidence)
    }
  };
}

/**
 * Updates the Release Pulse section in AI insights with smart decision
 * @param {Object} aiInsights - The AI analysis results
 * @param {Object} prData - The PR metadata
 * @returns {Object} Updated aiInsights with enhanced Release Pulse
 */
function enhanceReleasePulse(aiInsights, prData = {}) {
  const analysis = analyzeReleasePulse(aiInsights, prData);
  
  // Update the Release Pulse in the AI insights
  if (!aiInsights.releasePulse) {
    aiInsights.releasePulse = {};
  }

  // Override the AI's decision with our smart analysis
  aiInsights.releasePulse.decision = analysis.decision;
  aiInsights.releasePulse.confidence = analysis.confidence;
  aiInsights.releasePulse.smartReasoning = analysis.reasoning;
  aiInsights.releasePulse.riskScore = analysis.score;
  aiInsights.releasePulse.factors = analysis.factors;

  return aiInsights;
}

/**
 * Parse markdown analysis and enhance Release Pulse decision
 * @param {Object} aiInsights - AI insights with markdown data
 * @param {Object} prData - PR metadata
 * @returns {Object} Updated aiInsights with enhanced Release Pulse
 */
function enhanceReleasePulseInMarkdown(aiInsights, prData = {}) {
  if (!aiInsights || !aiInsights.success || typeof aiInsights.data !== 'string') {
    return aiInsights;
  }

  const markdown = aiInsights.data;
  
  // Extract data from markdown for analysis
  const parsedData = {
    questionsRisks: [],
    productAreas: []
  };

  // 1. Extract Questions/Risks/Bugs section
  const risksMatch = markdown.match(/##\s*⚠️\s*Key Questions, Risks & Bugs\s*([\s\S]*?)(?=##|$)/i);
  if (risksMatch) {
    const risksText = risksMatch[1];
    
    // Parse items (look for bullet points or numbered lists)
    const riskItems = risksText.match(/[-*•]\s*\*\*(Risk|Bug|Question)\*\*:([^\n]+)/gi) || [];
    
    riskItems.forEach(item => {
      const typeMatch = item.match(/\*\*(Risk|Bug|Question)\*\*:/i);
      const textMatch = item.match(/\*\*(?:Risk|Bug|Question)\*\*:(.+)/i);
      
      if (typeMatch && textMatch) {
        const type = typeMatch[1].toLowerCase();
        const text = textMatch[1].trim();
        parsedData.questionsRisks.push({ [type]: text });
      }
    });
  }

  // 2. Extract Product Areas section
  const areasMatch = markdown.match(/##\s*📦\s*Product Areas Affected\s*([\s\S]*?)(?=##|$)/i);
  if (areasMatch) {
    const areasText = areasMatch[1];
    
    // Parse bullet points
    const areaItems = areasText.match(/[-*•]\s*\*\*([^*]+)\*\*/g) || [];
    
    areaItems.forEach(item => {
      const areaMatch = item.match(/\*\*([^*]+)\*\*/);
      if (areaMatch) {
        parsedData.productAreas.push({ area: areaMatch[1].trim() });
      }
    });
  }

  // 3. Run the smart analyzer
  const analysis = analyzeReleasePulse(parsedData, prData);

  console.log('🧠 Smart Release Pulse Analysis:');
  console.log(`   Decision: ${analysis.decision} (${analysis.confidence})`);
  console.log(`   Risk Score: ${analysis.score}/100`);
  console.log(`   Reasoning: ${analysis.reasoning}`);
  console.log(`   Factors:`, analysis.factors);

  // 4. Replace Release Pulse section in markdown
  const releasePulseRegex = /(<tr><td[^>]*>🚦 Release Decision<\/td><td[^>]*>)([^<]+)(<\/td><td[^>]*>)([^<]+)(<\/td><\/tr>)/i;
  
  const newDecision = analysis.decision === 'Go' ? '🟢 Go' : '🔴 No-Go';
  const newSummary = `${analysis.reasoning} (Risk Score: ${analysis.score}/100)`;
  
  let enhancedMarkdown = markdown.replace(
    releasePulseRegex,
    `$1${newDecision}$3${newSummary}$5`
  );

  // Also update confidence if it exists
  const confidenceRegex = /(<tr><td[^>]*>✅ Release Confidence<\/td><td[^>]*>)([^<]+)(<\/td>)/i;
  const confidenceEmoji = analysis.confidence === 'High' ? '🟢' : 
                          analysis.confidence === 'Medium-High' ? '🟡' :
                          analysis.confidence === 'Medium' ? '🟡' : '🔴';
  
  enhancedMarkdown = enhancedMarkdown.replace(
    confidenceRegex,
    `$1${confidenceEmoji} ${analysis.confidence}$3`
  );

  // Add a debug section at the end (visible in markdown)
  const debugSection = `\n\n<!-- Smart Release Pulse: Score=${analysis.score}, Risk=${analysis.factors.risk}, Impact=${analysis.factors.impact}, Bugs=${analysis.factors.bugs} -->`;
  enhancedMarkdown += debugSection;

  aiInsights.data = enhancedMarkdown;
  return aiInsights;
}

module.exports = {
  analyzeReleasePulse,
  enhanceReleasePulse,
  enhanceReleasePulseInMarkdown
};
