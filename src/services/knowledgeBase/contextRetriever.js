/**
 * Context Retriever - Fetches product knowledge for PR/ticket analysis
 * Provides structured context (components, APIs, data models, related features) for AI prompts
 */

const OpenAI = require('openai');
const { supabaseAdmin, isSupabaseConfigured } = require('../../lib/supabase');

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
    relatedFeatures: []
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
 * Format product context for prompt inclusion
 */
function formatProductContextForPrompt(context) {
  if (!context || (!context.components?.length && !context.apis?.length && !context.dataModels?.length && !context.relatedFeatures?.length)) {
    return 'No product knowledge context available for this repository.';
  }
  const parts = [];
  if (context.components?.length) {
    parts.push('### Components\n' + context.components.map(c =>
      `- **${c.name}** (${c.file || 'unknown'}): ${c.purpose || 'No description'}${c.dependencies?.length ? `\n  Dependencies: ${c.dependencies.join(', ')}` : ''}`
    ).join('\n'));
  }
  if (context.apis?.length) {
    parts.push('### APIs\n' + context.apis.map(a =>
      `- **${a.endpoint}** (${a.method}): ${a.schema || 'No schema'}`
    ).join('\n'));
  }
  if (context.dataModels?.length) {
    parts.push('### Data Models\n' + context.dataModels.map(d =>
      `- **${d.table}**: ${Array.isArray(d.columns) ? d.columns.join(', ') : d.columns || 'N/A'}`
    ).join('\n'));
  }
  if (context.relatedFeatures?.length) {
    parts.push('### Related Features\n' + context.relatedFeatures.map(f =>
      `- **${f.name}**: ${f.description || 'No description'}`
    ).join('\n'));
  }
  return parts.join('\n\n');
}

module.exports = {
  getProductContext,
  formatProductContextForPrompt
};
