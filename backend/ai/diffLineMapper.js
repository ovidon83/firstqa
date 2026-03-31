/**
 * Parses unified diff hunk headers to map diff content to actual file line numbers.
 * Enables accurate line references in AI analysis output.
 */

/**
 * Parse a unified diff and return a map of { filename -> [ { oldStart, oldCount, newStart, newCount, lines } ] }
 * Each hunk includes its lines with actual file line numbers annotated.
 * @param {string} diff - The full unified diff string
 * @returns {Map<string, Array<{newStart: number, newCount: number, lines: Array<{num: number|null, type: string, content: string}>}>>}
 */
function parseDiffHunks(diff) {
  const fileHunks = new Map();
  if (!diff) return fileHunks;

  const lines = diff.split('\n');
  let currentFile = null;
  let currentHunk = null;
  let newLineNum = 0;

  for (const line of lines) {
    const fileMatch = line.match(/^diff --git a\/(.+?) b\/(.+)/);
    if (fileMatch) {
      currentFile = fileMatch[2];
      if (!fileHunks.has(currentFile)) {
        fileHunks.set(currentFile, []);
      }
      currentHunk = null;
      continue;
    }

    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch && currentFile) {
      newLineNum = parseInt(hunkMatch[1], 10);
      currentHunk = { newStart: newLineNum, lines: [] };
      fileHunks.get(currentFile).push(currentHunk);
      continue;
    }

    if (!currentHunk) continue;

    if (line.startsWith('+') && !line.startsWith('+++')) {
      currentHunk.lines.push({ num: newLineNum, type: 'add', content: line.slice(1) });
      newLineNum++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      currentHunk.lines.push({ num: null, type: 'del', content: line.slice(1) });
    } else {
      currentHunk.lines.push({ num: newLineNum, type: 'ctx', content: line.startsWith(' ') ? line.slice(1) : line });
      newLineNum++;
    }
  }

  return fileHunks;
}

/**
 * Annotate a diff with actual file line numbers.
 * Replaces raw diff with line-numbered version so the AI cites real lines.
 * @param {string} diff - The raw unified diff
 * @returns {string} - Annotated diff with line numbers
 */
function annotateDiffWithLineNumbers(diff) {
  if (!diff) return diff;

  const fileHunks = parseDiffHunks(diff);
  if (fileHunks.size === 0) return diff;

  const parts = [];

  for (const [file, hunks] of fileHunks) {
    parts.push(`\n=== ${file} ===`);
    for (const hunk of hunks) {
      parts.push(`--- @@ starting at line ${hunk.newStart} @@`);
      for (const line of hunk.lines) {
        const prefix = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
        const lineLabel = line.num !== null ? String(line.num).padStart(4) : '    ';
        parts.push(`${lineLabel}|${prefix}${line.content}`);
      }
    }
  }

  return parts.join('\n');
}

/**
 * Estimate token count for a string (rough: 1 token ≈ 4 chars for code).
 * @param {string} text
 * @returns {number}
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Smart diff budgeting: given a total token budget and the size of other prompt parts,
 * return the diff (annotated if possible) that fits within budget.
 * Prioritizes code files over docs/config/tests.
 * @param {string} diff - Raw diff
 * @param {number} budgetTokens - Total tokens available for the diff
 * @returns {{ diff: string, truncated: boolean, fileCount: number }}
 */
function budgetDiff(diff, budgetTokens) {
  if (!diff) return { diff: '', truncated: false, fileCount: 0 };

  const annotated = annotateDiffWithLineNumbers(diff);
  const tokens = estimateTokens(annotated);

  if (tokens <= budgetTokens) {
    const fileHunks = parseDiffHunks(diff);
    return { diff: annotated, truncated: false, fileCount: fileHunks.size };
  }

  // Over budget — prioritize code files, drop low-value files
  const fileHunks = parseDiffHunks(diff);
  const LOW_PRIORITY_PATTERNS = [
    /\.md$/i, /\.txt$/i, /\.rst$/i, /\.lock$/i, /\.svg$/i, /\.png$/i,
    /\.jpg$/i, /package-lock\.json$/i, /yarn\.lock$/i, /\.gitignore$/i,
    /\.min\.(js|css)$/i, /dist\//i, /build\//i, /\.map$/i
  ];

  const files = [...fileHunks.entries()].map(([file, hunks]) => {
    const isLowPriority = LOW_PRIORITY_PATTERNS.some(p => p.test(file));
    let content = `\n=== ${file} ===\n`;
    for (const hunk of hunks) {
      content += `--- @@ starting at line ${hunk.newStart} @@\n`;
      for (const line of hunk.lines) {
        const prefix = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
        const lineLabel = line.num !== null ? String(line.num).padStart(4) : '    ';
        content += `${lineLabel}|${prefix}${line.content}\n`;
      }
    }
    return { file, content, tokens: estimateTokens(content), isLowPriority };
  });

  // Sort: high-priority files first, then by size ascending (include more files)
  files.sort((a, b) => {
    if (a.isLowPriority !== b.isLowPriority) return a.isLowPriority ? 1 : -1;
    return a.tokens - b.tokens;
  });

  let used = 0;
  const included = [];
  const skipped = [];

  for (const f of files) {
    if (used + f.tokens <= budgetTokens) {
      included.push(f.content);
      used += f.tokens;
    } else {
      skipped.push(f.file);
    }
  }

  let result = included.join('');
  if (skipped.length > 0) {
    result += `\n\n[${skipped.length} low-priority file(s) omitted to fit context: ${skipped.join(', ')}]`;
  }

  return { diff: result, truncated: true, fileCount: files.length };
}

module.exports = { parseDiffHunks, annotateDiffWithLineNumbers, estimateTokens, budgetDiff };
