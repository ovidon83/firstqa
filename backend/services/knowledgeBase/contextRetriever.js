/**
 * Context Retriever - Fetches product knowledge for PR/ticket analysis
 * Provides structured context (components, APIs, data models, related features, affected flows) for AI prompts
 */

const OpenAI = require('openai');
const { supabaseAdmin, isSupabaseConfigured } = require('../../lib/supabase');
const { deriveProductAreasFromPaths } = require('./codebaseAnalyzer');

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

async function createEmbedding(text) {
  if (!openai) return null;
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text.substring(0, 8000)
    });
    return response.data?.[0]?.embedding || null;
  } catch (err) {
    return null;
  }
}

/**
 * Get affected user flows for PR changed files (direct match, dependency expansion, same area)
 * @param {string} repoId - repo full name
 * @param {string[]} changedFiles - changed file paths
 * @returns {Promise<Array<{ flowName: string, confidence: number, reason: string }>>}
 */
async function getAffectedFlows(repoId, changedFiles) {
  const out = [];
  if (!changedFiles.length) return out;
  try {
    const { data: rc } = await supabaseAdmin
      .from('repo_context')
      .select('product_areas, user_flows, dependency_graph')
      .eq('repo_id', repoId)
      .maybeSingle();
    const productAreas = (rc && rc.product_areas) || {};
    const userFlows = (rc && rc.user_flows) || [];
    const dependencyGraph = (rc && rc.dependency_graph) || {};
    const changedSet = new Set(changedFiles);

    const fileToAreas = {};
    const areasFromHeuristic = deriveProductAreasFromPaths(changedFiles);
    for (const a of areasFromHeuristic) {
      for (const p of a.paths) {
        if (!fileToAreas[p]) fileToAreas[p] = [];
        fileToAreas[p].push(a.slug);
      }
    }
    for (const [areaSlug, areaData] of Object.entries(productAreas)) {
      const paths = (areaData && areaData.paths) || [];
      for (const p of paths) {
        if (changedSet.has(p)) {
          if (!fileToAreas[p]) fileToAreas[p] = [];
          if (!fileToAreas[p].includes(areaSlug)) fileToAreas[p].push(areaSlug);
        }
      }
    }

    const impactedFiles = new Set(changedFiles);
    for (const [file, deps] of Object.entries(dependencyGraph)) {
      const depList = Array.isArray(deps) ? deps : [];
      const matchesChanged = depList.some(d => {
        if (changedSet.has(d)) return true;
        if (d.endsWith('.js') || d.endsWith('.ts') || d.endsWith('.tsx') || d.endsWith('.jsx')) return changedSet.has(d);
        const asPath = d.replace(/^\.\//, '').replace(/^\@\//, '');
        return changedSet.has(asPath) || changedFiles.some(cf => cf.includes(d) || cf.endsWith(d)));
      });
      if (matchesChanged) impactedFiles.add(file);
    }

    const flowSeen = new Set();
    for (const flow of userFlows) {
      const name = flow.name || flow.entity_name;
      const paths = flow.file_paths || [];
      const directMatch = paths.some(p => changedSet.has(p));
      const depMatch = paths.some(p => impactedFiles.has(p)) && !directMatch;
      const areaSlug = flow.area || null;
      const changedAreas = new Set();
      for (const f of changedFiles) {
        (fileToAreas[f] || []).forEach(a => changedAreas.add(a));
      }
      const sameArea = areaSlug && changedAreas.has(areaSlug) && !directMatch && !depMatch;
      if (directMatch) {
        if (!flowSeen.has(name)) { flowSeen.add(name); out.push({ flowName: name, confidence: 1.0, reason: 'direct file change' }); }
      } else if (depMatch) {
        if (!flowSeen.has(name)) { flowSeen.add(name); out.push({ flowName: name, confidence: 0.7, reason: 'dependency impact' }); }
      } else if (sameArea) {
        if (!flowSeen.has(name)) { flowSeen.add(name); out.push({ flowName: name, confidence: 0.5, reason: 'same product area' }); }
      }
    }
    return out;
  } catch (err) {
    console.error('getAffectedFlows error:', err.message);
    return [];
  }
}

/**
 * Get product context for analysis
 * @param {string} repoFullName - owner/repo
 * @param {string[]} changedFiles - Array of changed file paths
 * @param {string} description - PR title + body or ticket description (for semantic search)
 * @returns {Promise<{components, apis, dataModels, relatedFeatures}>}
 */
async function getProductContext(repoFullName, changedFiles = [], description = '') {
  const repoId = repoFullName;
  const result = {
    components: [],
    apis: [],
    dataModels: [],
    relatedFeatures: [],
    productAreas: [],
    userFlows: [],
    affectedFlows: [],
    repoContext: null,
    sectionTitles: []
  };

  if (!isSupabaseConfigured()) return result;

  try {
    const seen = new Set();
    const addUnique = (arr, item, key) => {
      const k = key || JSON.stringify(item);
      if (seen.has(k)) return;
      seen.add(k);
      arr.push(item);
    };

    if (changedFiles.length && process.env.ENABLE_KNOWLEDGE_SYNC === 'true') {
      result.affectedFlows = await getAffectedFlows(repoId, changedFiles);
      const { data: rc } = await supabaseAdmin
        .from('repo_context')
        .select('product_areas, user_flows, services, tests_by_area, dependency_graph, section_titles, routes, ui_elements, api_endpoints, messages')
        .eq('repo_id', repoId)
        .maybeSingle();
      result.repoContext = rc || null;
      if (rc && Array.isArray(rc.section_titles) && rc.section_titles.length) {
        result.sectionTitles = rc.section_titles;
      }
      if (rc) {
        result.productAreas = Object.entries(rc.product_areas || {}).map(([slug, data]) => ({
          slug,
          name: (data && data.name) || slug,
          paths: (data && data.paths) || []
        }));
        result.userFlows = (rc.user_flows || []).map(f => ({
          name: f.name,
          description: f.description,
          file_paths: f.file_paths || [],
          area: f.area
        }));
      }
    }

    for (const filePath of changedFiles) {
      const { data: exactMatches } = await supabaseAdmin
        .from('product_knowledge')
        .select('knowledge_type, entity_name, description, dependencies, metadata')
        .eq('repo_id', repoId)
        .contains('file_paths', [filePath]);

      for (const row of exactMatches || []) {
        const entry = {
          name: row.entity_name,
          purpose: row.description,
          dependencies: row.dependencies || [],
          file: filePath
        };
        if (row.knowledge_type === 'component') addUnique(result.components, entry, `comp:${row.entity_name}`);
        else if (row.knowledge_type === 'api') {
          const apiEntry = {
            endpoint: row.metadata?.endpoint || row.entity_name,
            method: row.metadata?.method || 'GET',
            schema: row.metadata?.schema || row.description
          };
          addUnique(result.apis, apiEntry, `api:${row.entity_name}`);
        } else if (row.knowledge_type === 'data_model') {
          const dmEntry = {
            table: row.entity_name,
            columns: row.metadata?.columns || row.dependencies || []
          };
          addUnique(result.dataModels, dmEntry, `dm:${row.entity_name}`);
        } else if (row.knowledge_type === 'product_area' || row.knowledge_type === 'user_flow') {
          addUnique(result.relatedFeatures, { name: row.entity_name, description: row.description }, `feat:${row.entity_name}`);
        } else {
          addUnique(result.relatedFeatures, { name: row.entity_name, description: row.description }, `feat:${row.entity_name}`);
        }
      }
    }

    if (description && description.trim().length > 20) {
      const embedding = await createEmbedding(description);
      if (embedding) {
        const { data: similar } = await supabaseAdmin.rpc('match_product_knowledge', {
          query_embedding: embedding,
          match_repo_id: repoId,
          match_threshold: 0.5,
          match_count: 5
        });

        for (const row of similar || []) {
          const entry = {
            name: row.entity_name,
            purpose: row.description,
            dependencies: row.dependencies || []
          };
          if (row.knowledge_type === 'component') addUnique(result.components, entry, `comp:${row.entity_name}`);
          else if (row.knowledge_type === 'api') addUnique(result.apis, { endpoint: row.entity_name, method: 'GET', schema: row.description }, `api:${row.entity_name}`);
          else if (row.knowledge_type === 'data_model') addUnique(result.dataModels, { table: row.entity_name, columns: row.dependencies || [] }, `dm:${row.entity_name}`);
          else if (row.knowledge_type === 'product_area' || row.knowledge_type === 'user_flow') addUnique(result.relatedFeatures, { name: row.entity_name, description: row.description }, `feat:${row.entity_name}`);
          else addUnique(result.relatedFeatures, { name: row.entity_name, description: row.description }, `feat:${row.entity_name}`);
        }
      }
    }

    for (const comp of result.components) {
      for (const dep of comp.dependencies || []) {
        const { data: depRows } = await supabaseAdmin
          .from('product_knowledge')
          .select('entity_name, description, knowledge_type')
          .eq('repo_id', repoId)
          .eq('entity_name', dep)
          .limit(1);
        if (depRows?.[0]) {
          const d = depRows[0];
          addUnique(result.relatedFeatures, { name: d.entity_name, description: d.description }, `dep:${d.entity_name}`);
        }
      }
    }

    return result;
  } catch (err) {
    console.error('getProductContext error:', err.message);
    return result;
  }
}

/**
 * Format product context for prompt inclusion (includes product areas, user flows, affected flows)
 */
function formatProductContextForPrompt(context) {
  const rc = context.repoContext || {};
  const hasProductMap = rc.routes?.length || rc.ui_elements?.length || rc.api_endpoints?.length || rc.messages?.length;
  const hasBasic = context && (
    (context.components && context.components.length) ||
    (context.apis && context.apis.length) ||
    (context.dataModels && context.dataModels.length) ||
    (context.relatedFeatures && context.relatedFeatures.length)
  );
  const hasExtended = context && (
    (context.affectedFlows && context.affectedFlows.length) ||
    (context.productAreas && context.productAreas.length) ||
    (context.userFlows && context.userFlows.length)
  );
  if (!context || (!hasBasic && !hasExtended && !hasProductMap)) {
    return 'No product knowledge context available for this repository.';
  }
  const parts = [];
  if (context.affectedFlows && context.affectedFlows.length) {
    parts.push('### Affected User Flows\n' + context.affectedFlows.map(f =>
      `- **${f.flowName}** (${(f.confidence * 100).toFixed(0)}% – ${f.reason}`
    ).join('\n'));
  }
  if (context.productAreas && context.productAreas.length) {
    parts.push('### Product Areas\n' + context.productAreas.map(a =>
      `- **${a.name}** (${a.slug}): ${(a.paths && a.paths.length) ? a.paths.slice(0, 5).join(', ') + (a.paths.length > 5 ? '…' : '') : '—'}`
    ).join('\n'));
  }
  if (context.userFlows && context.userFlows.length) {
    parts.push('### User Flows\n' + context.userFlows.slice(0, 15).map(f =>
      `- **${f.name}**: ${f.description || '—'}${(f.file_paths && f.file_paths.length) ? ` [${f.file_paths.slice(0, 2).join(', ')}]` : ''}`
    ).join('\n'));
  }
  if (context.components && context.components.length) {
    parts.push('### Components\n' + context.components.map(c =>
      `- **${c.name}** (${c.file || 'unknown'}): ${c.purpose || 'No description'}${c.dependencies?.length ? `\n  Dependencies: ${c.dependencies.join(', ')}` : ''}`
    ).join('\n'));
  }
  if (context.apis && context.apis.length) {
    parts.push('### APIs\n' + context.apis.map(a =>
      `- **${a.endpoint}** (${a.method}): ${a.schema || 'No schema'}`
    ).join('\n'));
  }
  if (context.dataModels && context.dataModels.length) {
    parts.push('### Data Models\n' + context.dataModels.map(d =>
      `- **${d.table}**: ${Array.isArray(d.columns) ? d.columns.join(', ') : d.columns || 'N/A'}`
    ).join('\n'));
  }
  if (context.relatedFeatures && context.relatedFeatures.length) {
    parts.push('### Related Features\n' + context.relatedFeatures.map(f =>
      `- **${f.name}**: ${f.description || 'No description'}`
    ).join('\n'));
  }
  if (hasProductMap) {
    const mapParts = [];
    if (rc.routes?.length) {
      mapParts.push('**Routes**: ' + rc.routes.slice(0, 25).map(r => `\`${r.path}\``).join(', '));
    }
    if (rc.ui_elements?.length) {
      const byType = {};
      for (const el of rc.ui_elements.slice(0, 40)) {
        if (!byType[el.type]) byType[el.type] = [];
        byType[el.type].push(el.text);
      }
      mapParts.push('**UI Elements**: ' + Object.entries(byType).map(([type, texts]) =>
        `${type}: ${[...new Set(texts)].slice(0, 10).map(t => `"${t}"`).join(', ')}`
      ).join('; '));
    }
    if (rc.api_endpoints?.length) {
      mapParts.push('**API Endpoints**: ' + rc.api_endpoints.slice(0, 20).map(e => `\`${e.endpoint}\``).join(', '));
    }
    if (rc.messages?.length) {
      mapParts.push('**Messages**: ' + rc.messages.slice(0, 15).map(m => `"${m.message}"`).join(', '));
    }
    parts.push('### Product Map (from codebase indexing)\n' + mapParts.join('\n'));
  }
  return parts.join('\n\n');
}

module.exports = {
  getProductContext,
  formatProductContextForPrompt,
  getAffectedFlows
};
