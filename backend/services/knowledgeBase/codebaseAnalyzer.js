/**
 * Codebase Analyzer - Initial repository analysis for product knowledge
 * Fetches files from repo, extracts knowledge via GPT-4o-mini, creates embeddings, stores in product_knowledge
 */

const OpenAI = require('openai');
const { supabaseAdmin, isSupabaseConfigured } = require('../../lib/supabase');
const { getOctokit } = require('../githubChecksService');

const EXCLUDED_PATTERNS = ['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'coverage', '__pycache__', '.venv', 'venv'];
const EXCLUDED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.map', '.min.js', '.min.css', '.lock'];
const BATCH_SIZE = parseInt(process.env.INITIAL_ANALYSIS_BATCH_SIZE || '50', 10);
const MAX_FILE_SIZE = 100000; // ~100KB per file
const ANALYSISABLE_EXTENSIONS = ['.js', '.ts', '.jsx', '.tsx', '.vue', '.py', '.java', '.go', '.rb', '.php', '.cs', '.rs', '.swift', '.kt'];
const TEST_FILE_PATTERNS = [
  /\.(test|spec)\.(js|ts|jsx|tsx)$/i,
  /__(tests|test)__\/.+\.(js|ts|jsx|tsx)$/i
];

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

const VALID_KNOWLEDGE_TYPES = ['component', 'function', 'api', 'data_model', 'feature', 'other', 'product_area', 'user_flow'];

const EXTRACTION_PROMPT = `Extract structured knowledge from this code file. Return a JSON object with "entries" array.
Each entry: { "knowledge_type": string, "entity_name": string, "description": string, "dependencies": string[], "file_paths": string[] (optional) }
knowledge_type must be one of: component, function, api, data_model, feature, other, product_area, user_flow
- component: React/Vue components, UI modules
- function: Key functions, handlers, utilities
- api: API endpoints, routes, contracts
- data_model: DB schemas, types, interfaces
- feature: Business logic, feature modules
- product_area: High-level product area (e.g. billing, auth, checkout). entity_name = slug (e.g. billing). description = short scope.
- user_flow: End-to-end user journey (e.g. "upgrade subscription"). entity_name = flow name. description = what user does. file_paths = array of files involved if known.
If the file has multiple entities, extract each. Be concise. Limit to 5 entries per file.`;

/**
 * Create embeddings for text using OpenAI
 */
async function createEmbedding(text) {
  if (!openai) return null;
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text.substring(0, 8000)
    });
    return response.data?.[0]?.embedding || null;
  } catch (err) {
    console.error('Embedding creation failed:', err.message);
    return null;
  }
}

/**
 * Extract knowledge from file content using GPT-4o-mini
 */
async function extractKnowledge(filePath, content) {
  if (!openai) return [];
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: EXTRACTION_PROMPT },
        { role: 'user', content: `File: ${filePath}\n\n\`\`\`\n${content.substring(0, 12000)}\n\`\`\`` }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2
    });
    const text = response.choices?.[0]?.message?.content;
    if (!text) return [];
    const parsed = JSON.parse(text);
    const entries = Array.isArray(parsed.entries) ? parsed.entries : (Array.isArray(parsed) ? parsed : [parsed]);
    return entries.slice(0, 5).map(e => {
      const kt = VALID_KNOWLEDGE_TYPES.includes(e.knowledge_type) ? e.knowledge_type : 'other';
      const filePaths = Array.isArray(e.file_paths) ? e.file_paths : [filePath];
      return {
        knowledge_type: kt,
        entity_name: (e.entity_name || 'Unknown').trim(),
        description: (e.description || '').trim(),
        dependencies: Array.isArray(e.dependencies) ? e.dependencies : [],
        file_paths: filePaths
      };
    });
  } catch (err) {
    console.error(`Extraction failed for ${filePath}:`, err.message);
    return [];
  }
}

/**
 * Filter file paths to exclude irrelevant files (source + test files)
 */
function filterRelevantFiles(paths) {
  return paths.filter(p => {
    if (EXCLUDED_PATTERNS.some(pat => p.includes(pat))) return false;
    if (EXCLUDED_EXTENSIONS.some(ext => p.endsWith(ext))) return false;
    if (ANALYSISABLE_EXTENSIONS.some(ext => p.endsWith(ext))) return true;
    if (TEST_FILE_PATTERNS.some(re => re.test(p))) return true;
    return false;
  });
}

function isTestFile(filePath) {
  return TEST_FILE_PATTERNS.some(re => re.test(filePath));
}

/**
 * Derive product areas from folder structure heuristics
 * @param {string[]} filePaths - Repo file paths
 * @returns {Array<{ slug: string, name: string, paths: string[] }>}
 */
function deriveProductAreasFromPaths(filePaths) {
  const areaBySlug = new Map();
  const pathToArea = [
    { pattern: /^src\/components\/analytics\/?/i, slug: 'analytics', name: 'Analytics' },
    { pattern: /^src\/components\/onboarding\/?/i, slug: 'onboarding', name: 'Onboarding' },
    { pattern: /^src\/components\/settings\/?/i, slug: 'settings', name: 'Settings' },
    { pattern: /^src\/components\/([^/]+)/i, slug: null, name: null },
    { pattern: /^src\/routes\/?/i, slug: 'ui_flows', name: 'UI flows' },
    { pattern: /^src\/pages\/?/i, slug: 'ui_flows', name: 'UI flows' },
    { pattern: /^services\/billing\/?/i, slug: 'billing', name: 'Billing' },
    { pattern: /^services\/auth\/?/i, slug: 'auth', name: 'Authentication' },
    { pattern: /^services\/checkout\/?/i, slug: 'checkout', name: 'Checkout' },
    { pattern: /^webhooks\/?/i, slug: 'webhooks', name: 'External integrations' },
    { pattern: /^(frontend\/)?pages\/?/i, slug: 'ui_flows', name: 'UI flows' },
    { pattern: /^pages\/?/i, slug: 'ui_flows', name: 'UI flows' },
    { pattern: /^api\/?/i, slug: 'api', name: 'API layer' },
    { pattern: /^routes\/?/i, slug: 'api', name: 'API layer' },
    { pattern: /^services\/([^/]+)/i, slug: null, name: null },
    { pattern: /^controllers?\//i, slug: 'controllers', name: 'Controllers' },
    { pattern: /^lib\/?/i, slug: 'lib', name: 'Shared lib' }
  ];
  for (const p of filePaths) {
    for (const { pattern, slug, name } of pathToArea) {
      const m = p.match(pattern);
      if (!m) continue;
      let s = slug;
      let n = name;
      if (s === null && m[1]) {
        s = m[1].toLowerCase().replace(/\W/g, '_');
        n = m[1].charAt(0).toUpperCase() + m[1].slice(1);
      }
      if (!s) continue;
      if (!areaBySlug.has(s)) areaBySlug.set(s, { slug: s, name: n || s, paths: [] });
      areaBySlug.get(s).paths.push(p);
      break;
    }
  }
  return Array.from(areaBySlug.values());
}

/**
 * Extract user flow name from test file path/name
 * e.g. subscriptionUpgrade.test.ts -> "upgrade subscription", loginFlow.test.js -> "login flow"
 */
function extractUserFlowFromTestFile(filePath, content) {
  const base = filePath.split('/').pop().replace(/\.(test|spec)\.(js|ts|jsx|tsx)$/i, '');
  const flowName = base
    .replace(/([A-Z])/g, ' $1')
    .replace(/[-_]/g, ' ')
    .trim()
    .toLowerCase();
  const describeMatch = typeof content === 'string' && content.match(/describe\s*\(\s*['"`]([^'"`]{2,80})['"`]/);
  const name = (describeMatch ? describeMatch[1] : flowName || base).trim();
  return name || base;
}

/**
 * Parse import/require statements to get dependency module names (repo-relative or service name)
 */
function parseImports(content, filePath) {
  const deps = new Set();
  if (!content || typeof content !== 'string') return Array.from(deps);
  const reRequire = /require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  const reImport = /import\s+(?:[\w{}\s,*]+\s+from\s+)?['"`]([^'"`]+)['"`]/g;
  let m;
  while ((m = reRequire.exec(content)) !== null) deps.add(m[1].trim());
  while ((m = reImport.exec(content)) !== null) deps.add(m[1].trim());
  return Array.from(deps).filter(Boolean);
}

/**
 * Analyze repository and populate product_knowledge
 * @param {string} repoFullName - owner/repo
 * @param {number} installationId - GitHub App installation ID
 * @param {string} defaultBranch - Default branch (default 'main')
 * @param {Object} [onComplete] - Optional: { postComment: async (body) => {} } to post completion message
 * @returns {Promise<{jobId: string, filesAnalyzed: number, entriesCreated: number}>}
 */
async function analyzeRepository(repoFullName, installationId, defaultBranch = 'main', onComplete = null) {
  const [owner, repo] = repoFullName.split('/');
  const repoId = repoFullName;

  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured - cannot run codebase analysis');
  }
  if (!openai) {
    throw new Error('OpenAI not configured - cannot run codebase analysis');
  }

  let jobId;
  try {
    const { data: job, error: jobErr } = await supabaseAdmin
      .from('knowledge_sync_jobs')
      .insert({
        repo_id: repoId,
        job_type: 'initial_analysis',
        status: 'running',
        progress: 0,
        started_at: new Date().toISOString(),
        metadata: { default_branch: defaultBranch }
      })
      .select('id')
      .single();
    if (jobErr) throw new Error(`Failed to create job: ${jobErr.message}`);
    jobId = job.id;
    console.log(`📚 Knowledge sync job created: ${jobId} for ${repoFullName}`);
  } catch (err) {
    console.error('Failed to create knowledge_sync_job:', err);
    throw err;
  }

  let filesAnalyzed = 0;
  let entriesCreated = 0;

  try {
    const octokit = await getOctokit(installationId);
    if (!octokit) throw new Error('Could not get GitHub API client');

    const refRes = await octokit.git.getRef({ owner, repo, ref: `heads/${defaultBranch}` });
    const treeSha = refRes.data.object.sha;

    const treeRes = await octokit.git.getTree({ owner, repo, tree_sha: treeSha, recursive: '1' });
    const allPaths = (treeRes.data.tree || [])
      .filter(t => t.type === 'blob')
      .map(t => t.path);

    const filePaths = filterRelevantFiles(allPaths);
    const totalFiles = filePaths.length;
    console.log(`📂 Found ${totalFiles} analyzable files in ${repoFullName}`);

    // Handle empty repos or repos with no analyzable files
    if (totalFiles === 0) {
      console.log(`ℹ️  No analyzable files in ${repoFullName}, marking job as completed`);
      await supabaseAdmin
        .from('knowledge_sync_jobs')
        .update({
          status: 'completed',
          progress: 100,
          completed_at: new Date().toISOString(),
          metadata: { files_analyzed: 0, entries_created: 0, note: 'No analyzable files found' }
        })
        .eq('id', jobId);
      return { filesAnalyzed: 0, entriesCreated: 0 };
    }

    const batches = [];
    for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
      batches.push(filePaths.slice(i, i + BATCH_SIZE));
    }

    const dependencyGraph = {};
    const testFlowsByArea = {};
    const sectionTitlesAccum = [];
    const routesAccum = [];
    const uiElementsAccum = [];
    const apiEndpointsAccum = [];
    const messagesAccum = [];
    const { extractSectionTitles, extractRoutes, extractUIElements, extractAPIEndpoints, extractMessages } = require('../../ai/flowDiscovery');

    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      const progress = Math.round(((b + 1) / batches.length) * 100);
      let batchErrors = 0;

      for (const filePath of batch) {
        try {
          const contentRes = await octokit.repos.getContent({ owner, repo, path: filePath, ref: defaultBranch });
          const content = contentRes.data.content ? Buffer.from(contentRes.data.content, 'base64').toString('utf8') : '';
          if (content.length > MAX_FILE_SIZE || content.length < 10) continue;

          const imports = parseImports(content, filePath);
          if (imports.length) dependencyGraph[filePath] = imports;

          const titles = extractSectionTitles(filePath, content);
          if (titles.length) sectionTitlesAccum.push(...titles);

          routesAccum.push(...extractRoutes(filePath, content));
          uiElementsAccum.push(...extractUIElements(filePath, content));
          apiEndpointsAccum.push(...extractAPIEndpoints(filePath, content));
          messagesAccum.push(...extractMessages(filePath, content));

          if (isTestFile(filePath)) {
            const flowName = extractUserFlowFromTestFile(filePath, content);
            const areas = deriveProductAreasFromPaths([filePath]);
            const areaSlug = areas.length ? areas[0].slug : 'other';
            if (!testFlowsByArea[areaSlug]) testFlowsByArea[areaSlug] = [];
            if (!testFlowsByArea[areaSlug].includes(flowName)) testFlowsByArea[areaSlug].push(flowName);
            const embedding = await createEmbedding(`${flowName}: test flow`);
            await supabaseAdmin.from('product_knowledge').insert({
              repo_id: repoId,
              knowledge_type: 'user_flow',
              entity_name: flowName,
              description: `User flow covered by test: ${filePath}`,
              file_paths: [filePath],
              dependencies: [],
              metadata: { area: areaSlug, from_test: true },
              embedding: embedding || null,
              git_sha: treeSha,
              source_pr_number: null
            });
            entriesCreated++;
          } else {
            const entries = await extractKnowledge(filePath, content);
            for (const entry of entries) {
              const paths = (entry.file_paths && entry.file_paths.length) ? entry.file_paths : [filePath];
              const embedding = await createEmbedding(`${entry.entity_name}: ${entry.description}`);
              await supabaseAdmin.from('product_knowledge').insert({
                repo_id: repoId,
                knowledge_type: entry.knowledge_type,
                entity_name: entry.entity_name,
                description: entry.description,
                file_paths: paths,
                dependencies: entry.dependencies || [],
                metadata: {},
                embedding: embedding || null,
                git_sha: treeSha,
                source_pr_number: null
              });
              entriesCreated++;
            }
          }
          filesAnalyzed++;
        } catch (fileErr) {
          batchErrors++;
          console.warn(`Skipped ${filePath}: ${fileErr.message}`);
        }
      }

      if (batch.length > 0 && batchErrors / batch.length > 0.5) {
        console.error(`❌ Batch ${b + 1}/${batches.length} had ${batchErrors}/${batch.length} failures (>50%), marking job as failed`);
        await supabaseAdmin
          .from('knowledge_sync_jobs')
          .update({
            status: 'failed',
            error_message: `Too many file failures in batch ${b + 1}: ${batchErrors}/${batch.length} files failed`,
            completed_at: new Date().toISOString(),
            metadata: { files_analyzed: filesAnalyzed, entries_created: entriesCreated, failed_batch: b + 1 }
          })
          .eq('id', jobId);
        throw new Error(`Batch ${b + 1} had >50% failures (${batchErrors}/${batch.length})`);
      }

      await supabaseAdmin
        .from('knowledge_sync_jobs')
        .update({ progress, metadata: { files_analyzed: filesAnalyzed, entries_created: entriesCreated, total_files: totalFiles } })
        .eq('id', jobId);
    }

    const productAreasHeuristic = deriveProductAreasFromPaths(filePaths);
    for (const area of productAreasHeuristic) {
      const slug = area.slug;
      const { data: existing } = await supabaseAdmin
        .from('product_knowledge')
        .select('id')
        .eq('repo_id', repoId)
        .eq('knowledge_type', 'product_area')
        .eq('entity_name', slug)
        .limit(1)
        .maybeSingle();
      const embedding = await createEmbedding(`${area.name}: ${area.paths.slice(0, 5).join(', ')}`);
      const payload = {
        repo_id: repoId,
        knowledge_type: 'product_area',
        entity_name: slug,
        description: area.name,
        file_paths: area.paths.slice(0, 200),
        dependencies: [],
        metadata: {},
        embedding,
        git_sha: treeSha,
        source_pr_number: null
      };
      if (existing) {
        await supabaseAdmin.from('product_knowledge').update({
          description: payload.description,
          file_paths: payload.file_paths,
          embedding: payload.embedding,
          last_updated: new Date().toISOString()
        }).eq('id', existing.id);
      } else {
        await supabaseAdmin.from('product_knowledge').insert(payload);
        entriesCreated++;
      }
    }

    const { data: userFlowRows } = await supabaseAdmin
      .from('product_knowledge')
      .select('entity_name, description, file_paths, metadata')
      .eq('repo_id', repoId)
      .eq('knowledge_type', 'user_flow');
    const userFlows = (userFlowRows || []).map(r => ({
      name: r.entity_name,
      description: r.description,
      file_paths: r.file_paths || [],
      area: (r.metadata && r.metadata.area) || null
    }));

    const { data: serviceRows } = await supabaseAdmin
      .from('product_knowledge')
      .select('entity_name, description, file_paths, dependencies')
      .eq('repo_id', repoId)
      .in('knowledge_type', ['api', 'feature']);
    const services = {};
    for (const r of serviceRows || []) {
      services[r.entity_name] = { path: (r.file_paths && r.file_paths[0]) || '', dependencies: r.dependencies || [] };
    }

    const productAreasMap = {};
    for (const a of productAreasHeuristic) {
      productAreasMap[a.slug] = { name: a.name, paths: a.paths };
    }

    const sectionTitles = [...new Map(sectionTitlesAccum.map(s => [s.title.toLowerCase(), s])).values()].slice(0, 30);
    const uniqueRoutes = [...new Map(routesAccum.map(r => [r.path, r])).values()].slice(0, 50);
    const uniqueUIElements = [...new Map(uiElementsAccum.map(u => [`${u.type}:${u.text}`, u])).values()].slice(0, 60);
    const uniqueAPIEndpoints = [...new Map(apiEndpointsAccum.map(e => [e.endpoint, e])).values()].slice(0, 40);
    const uniqueMessages = [...new Map(messagesAccum.map(m => [m.message, m])).values()].slice(0, 30);

    await supabaseAdmin.from('repo_context').upsert({
      repo_id: repoId,
      product_areas: productAreasMap,
      user_flows: userFlows,
      services: services,
      tests_by_area: testFlowsByArea,
      dependency_graph: dependencyGraph,
      section_titles: sectionTitles,
      routes: uniqueRoutes,
      ui_elements: uniqueUIElements,
      api_endpoints: uniqueAPIEndpoints,
      messages: uniqueMessages,
      git_sha: treeSha,
      updated_at: new Date().toISOString()
    }, { onConflict: 'repo_id' });

    await supabaseAdmin
      .from('knowledge_sync_jobs')
      .update({
        status: 'completed',
        progress: 100,
        completed_at: new Date().toISOString(),
        metadata: { files_analyzed: filesAnalyzed, entries_created: entriesCreated }
      })
      .eq('id', jobId);

    console.log(`✅ Codebase analysis complete: ${filesAnalyzed} files, ${entriesCreated} entries`);
    if (onComplete?.postComment) {
      try {
        await onComplete.postComment(`✅ **Codebase analysis complete!** Analyzed ${filesAnalyzed} files, extracted ${entriesCreated} knowledge entries. Your next analyses will have full product context.`);
      } catch (e) {
        console.warn('Could not post completion comment:', e.message);
      }
    }
    return { jobId, filesAnalyzed, entriesCreated };
  } catch (err) {
    console.error('Codebase analysis failed:', err);
    await supabaseAdmin
      .from('knowledge_sync_jobs')
      .update({
        status: 'failed',
        error_message: err.message,
        completed_at: new Date().toISOString()
      })
      .eq('id', jobId);

    if (onComplete?.postComment) {
      try {
        await onComplete.postComment(`❌ **Codebase analysis failed:** ${err.message}\n\nRetry with \`/qa -index\` when ready.`);
      } catch (e) {
        console.warn('Could not post error comment:', e.message);
      }
    }
    throw err;
  }
}

module.exports = {
  analyzeRepository,
  filterRelevantFiles,
  deriveProductAreasFromPaths,
  extractUserFlowFromTestFile,
  parseImports,
  isTestFile
};
