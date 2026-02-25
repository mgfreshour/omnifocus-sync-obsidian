/**
 * Frontmatter helpers for project folder .md files (no Obsidian dependency).
 */

const DEFAULT_STICKER = 'emoji//1f40d';

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
 */
export function updateContentFrontmatter(
  content: string,
  description: string,
): string {
  const desc = description.trim().length > 0 ? description.trim() : 'TODO';
  const escaped = escapeDescriptionForYaml(desc);

  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fmMatch) {
    return buildNewFrontmatter(description) + content;
  }

  const block = fmMatch[1];
  const body = fmMatch[2];
  const { keys, otherLines } = parseFrontmatterBlock(block);

  const stickerValue = keys.has('sticker') ? keys.get('sticker')! : DEFAULT_STICKER;
  const lines: string[] = [
    '---',
    `sticker: ${stickerValue}`,
    `description: "${escaped}"`,
    ...otherLines,
    '---',
  ];
  return lines.join('\n') + '\n' + body;
}
