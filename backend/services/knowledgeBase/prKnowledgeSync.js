/**
 * PR Knowledge Sync - Background sync of product knowledge when PRs are opened/updated/merged
 * Runs independently of /qa - triggered by pull_request webhooks
 */

const OpenAI = require('openai');
const { supabaseAdmin, isSupabaseConfigured } = require('../../lib/supabase');
const { getOctokit } = require('../githubChecksService');

const { parseImports, extractUserFlowFromTestFile, isTestFile, deriveProductAreasFromPaths } = require('./codebaseAnalyzer');

const EXTRACTION_PROMPT = `Extract structured knowledge from this code file. Return a JSON object with "entries" array.
Each entry: { "knowledge_type": "component"|"function"|"api"|"data_model"|"feature"|"other"|"product_area"|"user_flow", "entity_name": string, "description": string, "dependencies": string[] }
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
    const validTypes = ['component', 'function', 'api', 'data_model', 'feature', 'other', 'product_area', 'user_flow'];
    return entries.slice(0, 5).map(e => ({
      knowledge_type: validTypes.includes(e.knowledge_type) ? e.knowledge_type : 'other',
      entity_name: (e.entity_name || 'Unknown').trim(),
      description: (e.description || '').trim(),
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
      (/\.(js|ts|jsx|tsx|vue|py|java|go|rb|php|cs|rs|swift|kt)$/i.test(f.filename) || /\.(test|spec)\.(js|ts|jsx|tsx)$/i.test(f.filename)) &&
      !f.filename.includes('node_modules') && !f.filename.includes('.min.')
    );

    const dependencyGraphUpdates = {};
    let processed = 0;
    for (const file of relevant) {
      try {
        const contentRes = await octokit.repos.getContent({ owner, repo, path: file.filename, ref: headSHA });
        const content = contentRes.data.content
          ? Buffer.from(contentRes.data.content, 'base64').toString('utf8')
          : '';
        if (content.length > 100000 || content.length < 10) continue;

        const imports = parseImports(content, file.filename);
        if (imports.length) dependencyGraphUpdates[file.filename] = imports;

        if (isTestFile(file.filename)) {
          const flowName = extractUserFlowFromTestFile(file.filename, content);
          const areas = deriveProductAreasFromPaths([file.filename]);
          const areaSlug = areas.length ? areas[0].slug : 'other';
          const embedding = await createEmbedding(`${flowName}: test flow`);
          const { data: existingFlow } = await supabaseAdmin
            .from('product_knowledge')
            .select('id')
            .eq('repo_id', repoId)
            .eq('knowledge_type', 'user_flow')
            .eq('entity_name', flowName)
            .limit(1)
            .maybeSingle();
          const payload = {
            repo_id: repoId,
            knowledge_type: 'user_flow',
            entity_name: flowName,
            description: `User flow covered by test: ${file.filename}`,
            file_paths: [file.filename],
            dependencies: [],
            metadata: { area: areaSlug, from_test: true, last_synced_from_pr: prNumber },
            embedding: embedding || null,
            git_sha: headSHA,
            source_pr_number: prNumber,
            last_updated: new Date().toISOString()
          };
          if (existingFlow) {
            await supabaseAdmin.from('product_knowledge').update(payload).eq('id', existingFlow.id);
          } else {
            await supabaseAdmin.from('product_knowledge').insert(payload);
          }
          processed++;
          continue;
        }

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

    const { data: existingRc } = await supabaseAdmin
      .from('repo_context')
      .select('product_areas, user_flows, services, tests_by_area, dependency_graph')
      .eq('repo_id', repoId)
      .maybeSingle();
    const existingGraph = (existingRc && existingRc.dependency_graph) || {};
    const mergedGraph = { ...existingGraph, ...dependencyGraphUpdates };
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
    const testsByArea = (existingRc && existingRc.tests_by_area) || {};
    for (const f of userFlows) {
      const area = f.area || 'other';
      if (!testsByArea[area]) testsByArea[area] = [];
      if (!testsByArea[area].includes(f.name)) testsByArea[area].push(f.name);
    }
    const payload = {
      repo_id: repoId,
      dependency_graph: mergedGraph,
      user_flows: userFlows,
      tests_by_area: testsByArea,
      git_sha: headSHA,
      updated_at: new Date().toISOString()
    };
    if (existingRc) {
      await supabaseAdmin.from('repo_context').update({
        dependency_graph: payload.dependency_graph,
        user_flows: payload.user_flows,
        tests_by_area: payload.tests_by_area,
        git_sha: payload.git_sha,
        updated_at: payload.updated_at
      }).eq('repo_id', repoId);
    } else {
      await supabaseAdmin.from('repo_context').insert({
        ...payload,
        product_areas: {},
        services: {}
      });
    }

    const progress = relevant.length ? Math.round((processed / relevant.length) * 100) : 100;
    await supabaseAdmin
      .from('knowledge_sync_jobs')
      .update({
        status: 'completed',
        progress,
        completed_at: new Date().toISOString(),
        metadata: { pr_number: prNumber, files_processed: processed, incremental: true }
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
