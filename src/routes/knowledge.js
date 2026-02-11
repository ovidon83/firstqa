/**
 * Knowledge API routes - job status and repo knowledge status
 */

const express = require('express');
const router = express.Router();
const { supabaseAdmin, isSupabaseConfigured } = require('../lib/supabase');

/**
 * GET /api/knowledge/jobs/:jobId/status
 * Return knowledge_sync_job status, progress, metadata
 */
router.get('/jobs/:jobId/status', async (req, res) => {
  try {
    if (!isSupabaseConfigured()) {
      return res.status(503).json({ error: 'Knowledge system not configured' });
    }
    const { jobId } = req.params;
    const { data, error } = await supabaseAdmin
      .from('knowledge_sync_jobs')
      .select('id, repo_id, job_type, status, progress, started_at, completed_at, error_message, metadata')
      .eq('id', jobId)
      .single();
    if (error || !data) {
      return res.status(404).json({ error: 'Job not found' });
    }
    res.json({
      jobId: data.id,
      repoId: data.repo_id,
      jobType: data.job_type,
      status: data.status,
      progress: data.progress,
      startedAt: data.started_at,
      completedAt: data.completed_at,
      errorMessage: data.error_message,
      filesAnalyzed: data.metadata?.files_analyzed,
      entriesCreated: data.metadata?.entries_created,
      currentFile: data.metadata?.current_file
    });
  } catch (err) {
    console.error('Knowledge job status error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/knowledge/repos/:owner/:repo/status
 * Return: has_knowledge, last_indexed, total_entries, job_status (if running)
 */
router.get('/repos/:owner/:repo/status', async (req, res) => {
  try {
    if (!isSupabaseConfigured()) {
      return res.status(503).json({ error: 'Knowledge system not configured' });
    }
    const { owner, repo } = req.params;
    const repoId = `${owner}/${repo}`;

    const { count } = await supabaseAdmin
      .from('product_knowledge')
      .select('*', { count: 'exact', head: true })
      .eq('repo_id', repoId);

    const { data: latestJob } = await supabaseAdmin
      .from('knowledge_sync_jobs')
      .select('id, status, progress, completed_at, metadata')
      .eq('repo_id', repoId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: lastEntry } = await supabaseAdmin
      .from('product_knowledge')
      .select('last_updated')
      .eq('repo_id', repoId)
      .order('last_updated', { ascending: false })
      .limit(1)
      .maybeSingle();

    res.json({
      hasKnowledge: (count || 0) > 0,
      totalEntries: count || 0,
      lastIndexed: lastEntry?.last_updated || null,
      jobStatus: latestJob?.status === 'running' ? {
        jobId: latestJob.id,
        progress: latestJob.progress,
        metadata: latestJob.metadata
      } : null
    });
  } catch (err) {
    console.error('Knowledge repo status error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
