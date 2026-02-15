// Formatters for Linear and Jira content

function getScoreLabel(score) {
  if (score <= 2) return 'Needs Work';
  if (score === 3) return 'Decent';
  if (score === 4) return 'Good';
  if (score === 5) return 'Excellent';
  return 'Unknown';
}

function formatLinearAnalysis(insights) {
  let html = `<h2>🤖 QA Analysis</h2>`;
  
  // Handle minimal mode
  if (insights.minimalMode) {
    html += `<div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px; margin: 16px 0; border-radius: 4px;">`;
    html += `<p><strong>⚠️ Insufficient Information for Full Analysis</strong></p>`;
    html += `<p><strong>📊 Ready for Development Score: ${insights.readyForDevelopmentScore}/5</strong></p>`;
    
    if (insights.scoreImpactFactors && insights.scoreImpactFactors.length > 0) {
      html += `<p>What's Missing:</p><ul>`;
      insights.scoreImpactFactors.slice(0, 5).forEach(factor => {
        html += `<li>${factor}</li>`;
      });
      html += `</ul>`;
    }
    
    if (insights.message) {
      html += `<p><em>${insights.message}</em></p>`;
    }
    html += `</div>`;
    return html;
  }

  // Readiness Assessment
  html += `<h3>📊 READINESS ASSESSMENT</h3>`;
  html += `<p><strong>Current State:</strong> ${insights.initialReadinessScore}/5 (${getScoreLabel(insights.initialReadinessScore)})</p>`;
  html += `<p><strong>After Ovi Enhancement:</strong> ${insights.readyForDevelopmentScore}/5 (${getScoreLabel(insights.readyForDevelopmentScore)})</p>`;
  
  // Improvements Needed
  if (insights.improvementsNeeded && insights.improvementsNeeded.length > 0) {
    html += `<h3>🔧 IMPROVEMENTS NEEDED</h3>`;
    html += `<ol>`;
    insights.improvementsNeeded.forEach(improvement => {
      html += `<li><strong>${improvement}</strong></li>`;
    });
    html += `</ol>`;
  }

  // Skip detailed sections for minimal mode
  if (!insights.minimalMode) {
    // QA Questions
    const questions = insights.qaQuestions || insights.topQuestions || [];
    html += `<h3>🧠 QA Questions</h3>`;
    if (questions.length > 0) {
      html += `<ol>`;
      questions.slice(0, 5).forEach((q, i) => {
        const cleanQuestion = q.replace(/^🧠\s*/, '');
        html += `<li>${cleanQuestion}</li>`;
      });
      html += `</ol>`;
    }

    // Key Risks
    html += `<h3>⚠️ Key Risks</h3>`;
    if (insights.keyRisks && insights.keyRisks.length > 0) {
      html += `<ol>`;
      insights.keyRisks.slice(0, 5).forEach((r, i) => {
        const cleanRisk = r.replace(/^⚠️\s*/, '');
        html += `<li>${cleanRisk}</li>`;
      });
      html += `</ol>`;
    }

    // Test Recipe
    html += `<h3>🧪 Test Recipe</h3>`;
    if (insights.testRecipe && insights.testRecipe.length > 0) {
      // Sort test scenarios by priority
      const sortedTestRecipe = insights.testRecipe.sort((a, b) => {
        const priorityOrder = { 'Happy Path': 1, 'Critical Path': 2, 'Edge Case': 3 };
        return (priorityOrder[a.priority] || 4) - (priorityOrder[b.priority] || 4);
      });
      
      html += `<table style="border-collapse: collapse; width: 100%; margin: 10px 0;">`;
      html += `<thead><tr style="background-color: #f5f5f5;">`;
      html += `<th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Scenario</th>`;
      html += `<th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Steps</th>`;
      html += `<th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Expected</th>`;
      html += `<th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Type</th>`;
      html += `</tr></thead><tbody>`;

      sortedTestRecipe.forEach(tr => {
        html += `<tr>`;
        html += `<td style="border: 1px solid #ddd; padding: 8px;">${tr.scenario}</td>`;
        html += `<td style="border: 1px solid #ddd; padding: 8px;">${tr.steps}</td>`;
        html += `<td style="border: 1px solid #ddd; padding: 8px;">${tr.expected}</td>`;
        html += `<td style="border: 1px solid #ddd; padding: 8px;">${tr.priority}</td>`;
        html += `</tr>`;
      });
      html += `</tbody></table>`;
    }
  }

  return html;
}