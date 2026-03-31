/**
 * Classifies PR changed files to determine the type of change
 * and whether browser-based test execution makes sense.
 */

const path = require('path');

const FRONTEND_EXTENSIONS = new Set([
  '.jsx', '.tsx', '.vue', '.svelte', '.css', '.scss', '.sass', '.less',
  '.html', '.ejs', '.hbs', '.pug', '.handlebars'
]);

const FRONTEND_DIR_PATTERNS = [
  /\bfrontend\b/i, /\bcomponents\b/i, /\bviews\b/i, /\bpages\b/i,
  /\bstyles\b/i, /\bpublic\b/i, /\btemplates\b/i, /\blayouts\b/i,
  /\bsrc\/app\b/i, /\bsrc\/ui\b/i
];

const BACKEND_DIR_PATTERNS = [
  /\broutes\b/i, /\bcontrollers\b/i, /\bapi\b/i, /\bservices\b/i,
  /\butils\b/i, /\bmiddleware\b/i, /\blib\b/i, /\bmodels\b/i,
  /\bbackend\b/i, /\bserver\b/i
];

const INFRA_PATTERNS = [
  /^Dockerfile$/i, /^docker-compose/i, /\.ya?ml$/i, /^\.github\//,
  /^terraform\b/i, /^\.env\.example$/i, /^Procfile$/i, /^render\.yaml$/i,
  /^Makefile$/i, /^\.dockerignore$/i, /^nginx/i
];

const DOC_EXTENSIONS = new Set(['.md', '.txt', '.rst', '.adoc']);
const DOC_NAMES = new Set(['changelog', 'license', 'readme', 'contributing']);

const CODE_EXTENSIONS = new Set(['.js', '.ts', '.mjs', '.cjs']);

function classifyFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  const base = path.basename(filename, ext).toLowerCase();
  const dir = filename.toLowerCase();

  if (DOC_EXTENSIONS.has(ext) || DOC_NAMES.has(base)) return 'documentation';

  if (INFRA_PATTERNS.some(p => p.test(filename))) return 'infrastructure';

  if (FRONTEND_EXTENSIONS.has(ext)) return 'frontend';

  if (CODE_EXTENSIONS.has(ext)) {
    if (FRONTEND_DIR_PATTERNS.some(p => p.test(dir))) return 'frontend';
    if (BACKEND_DIR_PATTERNS.some(p => p.test(dir))) return 'backend';
    return 'code';
  }

  if (ext === '.sql') return 'backend';
  if (ext === '.json' && base === 'package') return 'code';

  return 'other';
}

/**
 * Classify a list of changed file paths.
 * @param {string[]} changedFiles - array of file paths from the PR
 * @returns {{ type: string, shouldRunBrowserTests: boolean, breakdown: object }}
 */
function classifyPRChangeType(changedFiles) {
  const breakdown = { frontend: 0, backend: 0, infrastructure: 0, documentation: 0, code: 0, other: 0 };

  for (const file of changedFiles) {
    const cat = classifyFile(file);
    breakdown[cat] = (breakdown[cat] || 0) + 1;
  }

  const hasFrontend = breakdown.frontend > 0;
  const hasBackend = breakdown.backend > 0 || breakdown.code > 0;
  const hasInfra = breakdown.infrastructure > 0;
  const hasDocs = breakdown.documentation > 0;

  let type;
  if (hasFrontend && hasBackend) type = 'fullstack';
  else if (hasFrontend) type = 'frontend';
  else if (hasBackend) type = 'backend';
  else if (hasInfra) type = 'infrastructure';
  else if (hasDocs) type = 'documentation';
  else type = 'other';

  const shouldRunBrowserTests = hasFrontend || type === 'fullstack';

  return { type, shouldRunBrowserTests, breakdown };
}

module.exports = { classifyPRChangeType, classifyFile };
