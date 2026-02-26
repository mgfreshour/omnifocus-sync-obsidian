/**
 * Frontmatter helpers for project folder .md files (no Obsidian dependency).
 */

const DEFAULT_STICKER = 'emoji//1f4c1';

/**
 * Escape a string for use as a double-quoted YAML value (escape \ and ").
 */
export function escapeDescriptionForYaml(description: string): string {
  return description
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ');
}

/**
 * Build frontmatter string for a new file: sticker and description.
 */
export function buildNewFrontmatter(description: string): string {
  const desc = description.trim().length > 0 ? description.trim() : 'TODO';
  const escaped = escapeDescriptionForYaml(desc);
  return `---\nsticker: ${DEFAULT_STICKER}\ndescription: "${escaped}"\n---\n`;
}

/** Regex to detect an omnifocus fenced code block in body text. */
const OMNIFOCUS_BLOCK_RE = /```\s*omnifocus/i;

/**
 * Returns the omnifocus code block text for a project (single line; newlines in name become space).
 */
export function formatOmnifocusBlock(projectName: string): string {
  const line = (projectName ?? '').trim().replace(/\r?\n/g, ' ').trim() || 'Unnamed';
  return '```omnifocus\nproject: ' + line + '\n```';
}

/**
 * Returns true if the given body string contains an omnifocus fenced code block.
 */
export function bodyHasOmnifocusBlock(body: string): boolean {
  return OMNIFOCUS_BLOCK_RE.test(body);
}

/**
 * Build full content for a new project folder file: frontmatter + omnifocus block.
 */
export function buildNewFileContent(description: string, projectName: string): string {
  return buildNewFrontmatter(description) + '\n' + formatOmnifocusBlock(projectName) + '\n';
}

/**
 * Parse frontmatter block: extract key-value pairs (key: value per line).
 */
function parseFrontmatterBlock(block: string): {
  keys: Map<string, string>;
  otherLines: string[];
} {
  const keys = new Map<string, string>();
  const otherLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (match) {
      const key = match[1];
      const value = match[2].trim();
      keys.set(key, value);
      if (key !== 'description' && key !== 'sticker') {
        otherLines.push(line);
      }
    }
  }
  return { keys, otherLines };
}

/**
 * Update frontmatter in file content: set description, add sticker only if missing.
 * Preserves other keys and body. If no frontmatter, prepend new frontmatter and keep content as body.
 * When projectName is provided and the body has no ```omnifocus block, inserts that block after the frontmatter.
 */
export function updateContentFrontmatter(
  content: string,
  description: string,
  projectName?: string,
): string {
  const desc = description.trim().length > 0 ? description.trim() : 'TODO';
  const escaped = escapeDescriptionForYaml(desc);

  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fmMatch) {
    const body = content;
    if (projectName != null && projectName !== '' && !bodyHasOmnifocusBlock(body)) {
      return buildNewFrontmatter(description) + formatOmnifocusBlock(projectName) + '\n' + body;
    }
    return buildNewFrontmatter(description) + content;
  }

  const block = fmMatch[1];
  let body = fmMatch[2];
  const { keys, otherLines } = parseFrontmatterBlock(block);

  const stickerValue = keys.has('sticker') ? keys.get('sticker')! : DEFAULT_STICKER;
  const lines: string[] = [
    '---',
    `sticker: ${stickerValue}`,
    `description: "${escaped}"`,
    ...otherLines,
    '---',
  ];
  const fm = lines.join('\n') + '\n';
  if (projectName != null && projectName !== '' && !bodyHasOmnifocusBlock(body)) {
    body = formatOmnifocusBlock(projectName) + '\n' + body;
  }
  return fm + body;
}
