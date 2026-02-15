/**
 * Video Recording and Processing Service
 * Handles video uploads and clip extraction for test results
 */

const fs = require('fs').promises;
const path = require('path');

/**
 * Upload video to GitHub as a release asset or external storage
 * For now, we'll store videos locally and provide file paths
 * In production, you'd upload to S3/CloudFlare R2 and return URLs
 */
async function uploadVideo(videoPath, destinationName) {
  try {
    // Check if video exists
    const stats = await fs.stat(videoPath);
    if (!stats.isFile()) {
      throw new Error('Video file not found');
    }

    // For now, return local file path
    // In production, upload to cloud storage and return URL
    console.log(`📹 Video ready: ${videoPath} (${Math.round(stats.size / 1024 / 1024)}MB)`);
    
    return {
      path: videoPath,
      size: stats.size,
      url: null // Would be cloud URL in production
    };
  } catch (error) {
    console.error('Error uploading video:', error);
    throw error;
  }
}

/**
 * Generate video timeline with timestamps for each test scenario
 */
function generateVideoTimeline(results) {
  let currentTimestamp = 0;
  const timeline = [];

  for (let i = 0; i < results.scenarios.length; i++) {
    const scenario = results.scenarios[i];
    const duration = scenario.duration / 1000; // Convert to seconds

    timeline.push({
      scenarioIndex: i,
      scenario: scenario.scenario,
      status: scenario.status,
      startTime: currentTimestamp,
      endTime: currentTimestamp + duration,
      formattedStartTime: formatTimestamp(currentTimestamp),
      formattedEndTime: formatTimestamp(currentTimestamp + duration)
    });

    currentTimestamp += duration + 1; // +1 second delay between tests
  }

  return timeline;
}

/**
 * Format timestamp in MM:SS format
 */
function formatTimestamp(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Generate markdown for video embedding with timestamps
 */
function generateVideoMarkdown(videoUrl, timeline, includeFailedOnly = false) {
  if (!videoUrl) {
    return '_Video recording not available_';
  }

  let markdown = `### 🎥 Test Execution Video\n\n`;
  markdown += `[📹 Watch Full Test Run](${videoUrl})\n\n`;
  
  const scenarios = includeFailedOnly 
    ? timeline.filter(t => t.status === 'FAIL' || t.status === 'ERROR')
    : timeline;

  if (scenarios.length > 0) {
    markdown += `**Jump to specific tests:**\n`;
    for (const item of scenarios) {
      const emoji = item.status === 'PASS' ? '✅' : '❌';
      markdown += `- [${emoji} ${item.scenario}](${videoUrl}#t=${Math.floor(item.startTime)}) (${item.formattedStartTime} - ${item.formattedEndTime})\n`;
    }
  }

  return markdown;
}

/**
 * Calculate total video duration from results
 */
function calculateVideoDuration(results) {
  const totalMs = results.scenarios.reduce((sum, s) => sum + s.duration, 0);
  const totalSeconds = Math.floor(totalMs / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}m ${secs}s`;
}

module.exports = {
  uploadVideo,
  generateVideoTimeline,
  generateVideoMarkdown,
  formatTimestamp,
  calculateVideoDuration
};

