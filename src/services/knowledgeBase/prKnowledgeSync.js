/**
 * PR Knowledge Sync - Background sync of product knowledge when PRs are opened/updated/merged
 * Runs independently of /qa - triggered by pull_request webhooks
 */

const OpenAI = require('openai');
const { supabaseAdmin, isSupabaseConfigured } = require('../../lib/supabase');
const { getOctokit } = require('../githubChecksService');

const EXTRACTION_PROMPT = `Extract structured knowledge from this code file. Return a JSON object with "entries" array.
Each entry: { "knowledge_type": "component"|"function"|"api"|"data_model"|"feature"|"other", "entity_name": string, "description": string, "dependencies": string[] }
Be concise. Limit to 5 entries per file.`;

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
    console.error('Embedding creation failed:', err.message);
    return null;
  }
}

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
 * Sync product knowledge for PR changed files
 * @param {number} prNumber - PR number
 * @param {string} repoFullName - owner/repo
 * @param {number} installationId - GitHub App installation ID
 * @param {string} headSHA - PR head commit SHA
 */
async function syncPRKnowledge(prNumber, repoFullName, installationId, headSHA) {
  const [owner, repo] = repoFullName.split('/');
  const repoId = repoFullName;

  if (process.env.ENABLE_KNOWLEDGE_SYNC !== 'true') {
    console.log('⏭️ Knowledge sync disabled (ENABLE_KNOWLEDGE_SYNC!=true)');
    return { skipped: true };
  }
  if (!isSupabaseConfigured() || !openai) {
    console.log('⏭️ Knowledge sync skipped - Supabase or OpenAI not configured');
    return { skipped: true };
  }

  let jobId;
  try {
    const { data: job, error: jobErr } = await supabaseAdmin
      .from('knowledge_sync_jobs')
      .insert({
        repo_id: repoId,
        job_type: 'pr_sync',
        status: 'running',
        progress: 0,
        started_at: new Date().toISOString(),
        metadata: { pr_number: prNumber, head_sha: headSHA }
      })
      .select('id')
      .single();
    if (jobErr) {
      console.error('Failed to create pr_sync job:', jobErr);
      return { error: jobErr.message };
    }
    jobId = job.id;
  } catch (err) {
    console.error('prKnowledgeSync: job creation failed', err);
    return { error: err.message };
  }

  try {
    const octokit = await getOctokit(installationId);
    if (!octokit) throw new Error('Could not get GitHub API client');

    const filesRes = await octokit.pulls.listFiles({ owner, repo, pull_number: prNumber });
    const changedFiles = (filesRes.data || []).filter(f => f.status !== 'removed');
    const relevant = changedFiles.filter(f =>
      /\.(js|ts|jsx|tsx|vue|py|java|go|rb|php|cs|rs|swift|kt)$/i.test(f.filename) &&
      !f.filename.includes('node_modules') && !f.filename.includes('.min.')
    );

    let processed = 0;
    for (const file of relevant) {
      try {
        const contentRes = await octokit.repos.getContent({ owner, repo, path: file.filename, ref: headSHA });
        const content = contentRes.data.content
          ? Buffer.from(contentRes.data.content, 'base64').toString('utf8')
          : '';
        if (content.length > 100000 || content.length < 10) continue;

        const entries = await extractKnowledge(file.filename, content);

        for (const entry of entries) {
          const { data: existingRows } = await supabaseAdmin
            .from('product_knowledge')
            .select('id')
            .eq('repo_id', repoId)
            .eq('entity_name', entry.entity_name)
            .limit(1);
          const existing = existingRows?.[0];

          const embedding = await createEmbedding(`${entry.entity_name}: ${entry.description}`);

          if (existing) {
            await supabaseAdmin
              .from('product_knowledge')
              .update({
                description: entry.description,
                dependencies: entry.dependencies || [],
                embedding: embedding || undefined,
                git_sha: headSHA,
                source_pr_number: prNumber,
                last_updated: new Date().toISOString(),
                metadata: { last_synced_from_pr: prNumber }
              })
              .eq('id', existing.id);
          } else {
            await supabaseAdmin.from('product_knowledge').insert({
              repo_id: repoId,
              knowledge_type: entry.knowledge_type,
              entity_name: entry.entity_name,
              description: entry.description,
              file_paths: [file.filename],
              dependencies: entry.dependencies || [],
              metadata: { source_pr: prNumber },
              embedding: embedding || null,
              git_sha: headSHA,
              source_pr_number: prNumber
            });
          }
        }
        processed++;
      } catch (fileErr) {
        console.warn(`prKnowledgeSync: skipped ${file.filename}:`, fileErr.message);
      }
    }

    const progress = relevant.length ? Math.round((processed / relevant.length) * 100) : 100;
    await supabaseAdmin
      .from('knowledge_sync_jobs')
      .update({
        status: 'completed',
        progress,
        completed_at: new Date().toISOString(),
        metadata: { pr_number: prNumber, files_processed: processed }
      })
      .eq('id', jobId);

    console.log(`✅ PR knowledge sync complete: PR #${prNumber}, ${processed} files`);
    return { jobId, filesProcessed: processed };
  } catch (err) {
    console.error('PR knowledge sync failed:', err);
    await supabaseAdmin
      .from('knowledge_sync_jobs')
      .update({
        status: 'failed',
        error_message: err.message,
        completed_at: new Date().toISOString()
      })
      .eq('id', jobId);
    return { error: err.message };
  }
}

module.exports = { syncPRKnowledge };
