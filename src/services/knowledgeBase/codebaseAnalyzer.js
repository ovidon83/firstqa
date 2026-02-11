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

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

const EXTRACTION_PROMPT = `Extract structured knowledge from this code file. Return a JSON array of knowledge entries.
Each entry: { "knowledge_type": "component"|"function"|"api"|"data_model"|"feature"|"other", "entity_name": string, "description": string, "dependencies": string[] }
- component: React/Vue components, UI modules
- function: Key functions, handlers, utilities
- api: API endpoints, routes, contracts
- data_model: DB schemas, types, interfaces
- feature: Business logic, feature modules
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
    return entries.slice(0, 5).map(e => ({
      knowledge_type: e.knowledge_type || 'other',
      entity_name: e.entity_name || 'Unknown',
      description: e.description || '',
      dependencies: Array.isArray(e.dependencies) ? e.dependencies : []
    }));
  } catch (err) {
    console.error(`Extraction failed for ${filePath}:`, err.message);
    return [];
  }
}

/**
 * Filter file paths to exclude irrelevant files
 */
function filterRelevantFiles(paths) {
  return paths.filter(p => {
    if (EXCLUDED_PATTERNS.some(pat => p.includes(pat))) return false;
    if (EXCLUDED_EXTENSIONS.some(ext => p.endsWith(ext))) return false;
    return ANALYSISABLE_EXTENSIONS.some(ext => p.endsWith(ext));
  });
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

    const batches = [];
    for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
      batches.push(filePaths.slice(i, i + BATCH_SIZE));
    }

    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      const progress = Math.round(((b + 1) / batches.length) * 100);

      for (const filePath of batch) {
        try {
          const contentRes = await octokit.repos.getContent({ owner, repo, path: filePath, ref: defaultBranch });
          const content = contentRes.data.content ? Buffer.from(contentRes.data.content, 'base64').toString('utf8') : '';
          if (content.length > MAX_FILE_SIZE || content.length < 10) continue;

          const entries = await extractKnowledge(filePath, content);
          for (const entry of entries) {
            const embedding = await createEmbedding(`${entry.entity_name}: ${entry.description}`);
            await supabaseAdmin.from('product_knowledge').insert({
              repo_id: repoId,
              knowledge_type: entry.knowledge_type,
              entity_name: entry.entity_name,
              description: entry.description,
              file_paths: [filePath],
              dependencies: entry.dependencies || [],
              metadata: {},
              embedding: embedding || null,
              git_sha: treeSha,
              source_pr_number: null
            });
            entriesCreated++;
          }
          filesAnalyzed++;
        } catch (fileErr) {
          console.warn(`Skipped ${filePath}: ${fileErr.message}`);
        }
      }

      await supabaseAdmin
        .from('knowledge_sync_jobs')
        .update({ progress, metadata: { files_analyzed: filesAnalyzed, entries_created: entriesCreated } })
        .eq('id', jobId);
    }

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
  filterRelevantFiles
};
