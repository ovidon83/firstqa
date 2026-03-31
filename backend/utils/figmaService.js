/**
 * Figma Service - Fetches design context from Figma files linked in Linear tickets
 * Extracts component names, text content, frame hierarchy for AI analysis context
 */

const FIGMA_URL_PATTERNS = [
  /figma\.com\/design\/([a-zA-Z0-9]+)(?:\/[^?]*)?(?:\?.*node-id=([^&]+))?/,
  /figma\.com\/file\/([a-zA-Z0-9]+)(?:\/[^?]*)?(?:\?.*node-id=([^&]+))?/,
  /figma\.com\/proto\/([a-zA-Z0-9]+)(?:\/[^?]*)?(?:\?.*node-id=([^&]+))?/
];

/**
 * Extract Figma file keys and optional node IDs from URLs
 */
function extractFigmaFileKeys(urls) {
  const results = [];
  for (const url of urls) {
    for (const pattern of FIGMA_URL_PATTERNS) {
      const match = url.match(pattern);
      if (match) {
        const fileKey = match[1];
        const nodeId = match[2] ? match[2].replace(/-/g, ':') : null;
        results.push({ fileKey, nodeId, url });
        break;
      }
    }
  }
  return results;
}

/**
 * Recursively extract text content and component names from Figma node tree
 */
function extractContentFromNodes(node, depth = 0, maxDepth = 6) {
  const result = { components: [], texts: [], frameNames: [] };
  if (!node || depth > maxDepth) return result;

  if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
    result.components.push(node.name);
  }
  if (node.type === 'FRAME' || node.type === 'GROUP') {
    result.frameNames.push(node.name);
  }
  if (node.type === 'TEXT' && node.characters) {
    const text = node.characters.trim();
    if (text.length > 0 && text.length < 200) {
      result.texts.push(text);
    }
  }

  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      const childResult = extractContentFromNodes(child, depth + 1, maxDepth);
      result.components.push(...childResult.components);
      result.texts.push(...childResult.texts);
      result.frameNames.push(...childResult.frameNames);
    }
  }

  return result;
}

/**
 * Fetch design context from Figma API
 */
async function fetchFigmaContext(fileKey, nodeId, token) {
  if (!token) return null;

  try {
    let apiUrl = `https://api.figma.com/v1/files/${fileKey}`;
    if (nodeId) {
      apiUrl += `?ids=${nodeId}&depth=4`;
    } else {
      apiUrl += '?depth=3';
    }

    const response = await fetch(apiUrl, {
      headers: { 'X-Figma-Token': token }
    });

    if (!response.ok) {
      console.warn(`Figma API error (${response.status}) for file ${fileKey}`);
      return null;
    }

    const data = await response.json();
    const fileName = data.name || fileKey;
    const pages = [];

    if (nodeId && data.nodes) {
      for (const [id, nodeData] of Object.entries(data.nodes)) {
        if (nodeData.document) {
          const extracted = extractContentFromNodes(nodeData.document);
          pages.push({
            name: nodeData.document.name || id,
            ...extracted
          });
        }
      }
    } else if (data.document?.children) {
      for (const page of data.document.children.slice(0, 5)) {
        const extracted = extractContentFromNodes(page);
        pages.push({
          name: page.name,
          ...extracted
        });
      }
    }

    return { fileName, pages };
  } catch (err) {
    console.error(`Figma fetch failed for ${fileKey}:`, err.message);
    return null;
  }
}

/**
 * Format Figma data as prompt context
 */
function formatFigmaContextForPrompt(figmaDataArray) {
  if (!figmaDataArray || figmaDataArray.length === 0) return null;

  const parts = ['## DESIGN CONTEXT (from Figma)\n'];
  for (const figma of figmaDataArray) {
    if (!figma) continue;
    parts.push(`### ${figma.fileName}`);
    for (const page of figma.pages.slice(0, 5)) {
      parts.push(`**Page: ${page.name}**`);
      if (page.components.length) {
        parts.push('Components: ' + [...new Set(page.components)].slice(0, 20).join(', '));
      }
      if (page.frameNames.length) {
        parts.push('Frames: ' + [...new Set(page.frameNames)].slice(0, 15).join(', '));
      }
      if (page.texts.length) {
        parts.push('UI Text: ' + [...new Set(page.texts)].slice(0, 25).map(t => `"${t}"`).join(', '));
      }
    }
    parts.push('');
  }
  return parts.join('\n');
}

/**
 * Check if a URL is a Figma URL
 */
function isFigmaUrl(url) {
  return FIGMA_URL_PATTERNS.some(p => p.test(url));
}

module.exports = {
  extractFigmaFileKeys,
  fetchFigmaContext,
  formatFigmaContextForPrompt,
  isFigmaUrl
};
