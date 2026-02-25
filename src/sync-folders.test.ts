import {
  buildNewFrontmatter,
  escapeDescriptionForYaml,
  updateContentFrontmatter,
} from './sync-folders-frontmatter';
import { deriveFolderPathsToCreate } from './sync-folders-paths';

describe('escapeDescriptionForYaml', () => {
  it('escapes backslash and double quote', () => {
    expect(escapeDescriptionForYaml('say "hello"')).toBe('say \\"hello\\"');
    expect(escapeDescriptionForYaml('path\\to\\file')).toBe(
      'path\\\\to\\\\file',
    );
  });

  it('replaces newlines with space', () => {
    expect(escapeDescriptionForYaml('line1\nline2')).toBe('line1 line2');
  });
});

describe('buildNewFrontmatter', () => {
  it('uses TODO when description is empty', () => {
    const out = buildNewFrontmatter('');
    expect(out).toContain('description: "TODO"');
    expect(out).toContain('sticker: emoji//1f40d');
    expect(out).toMatch(/^---\n[\s\S]*\n---\n$/);
  });

  it('uses TODO when description is whitespace only', () => {
    expect(buildNewFrontmatter('   ')).toContain('description: "TODO"');
  });

  it('escapes description and includes sticker', () => {
    const out = buildNewFrontmatter('Project "alpha"');
    expect(out).toContain('description: "Project \\"alpha\\""');
    expect(out).toContain('sticker: emoji//1f40d');
  });
});

describe('updateContentFrontmatter', () => {
  it('prepends frontmatter when content has no frontmatter', () => {
    const content = 'Some body text';
    const out = updateContentFrontmatter(content, 'New desc');
    expect(out).toContain('---');
    expect(out).toContain('description: "New desc"');
    expect(out).toContain('sticker: emoji//1f40d');
    expect(out.endsWith('\nSome body text')).toBe(true);
  });

  it('updates description and keeps existing sticker', () => {
    const content = `---
sticker: emoji//1f4a1
description: old
---

body`;
    const out = updateContentFrontmatter(content, 'Updated note');
    expect(out).toContain('sticker: emoji//1f4a1');
    expect(out).toContain('description: "Updated note"');
    expect(out).toContain('\n\nbody');
  });

  it('adds sticker when missing and updates description', () => {
    const content = `---
description: old
---

body`;
    const out = updateContentFrontmatter(content, 'New');
    expect(out).toContain('sticker: emoji//1f40d');
    expect(out).toContain('description: "New"');
  });
});

describe('deriveFolderPathsToCreate', () => {
  it('returns empty array for empty input', () => {
    expect(deriveFolderPathsToCreate([])).toEqual([]);
  });

  it('returns single segment for root-level project', () => {
    expect(deriveFolderPathsToCreate(['Personal'])).toEqual(['Personal']);
  });

  it('returns all prefixes and full path for nested project', () => {
    expect(deriveFolderPathsToCreate(['Work/Projects/project-a'])).toEqual([
      'Work',
      'Work/Projects',
      'Work/Projects/project-a',
    ]);
  });

  it('deduplicates and sorts by depth for multiple projects', () => {
    const result = deriveFolderPathsToCreate([
      'Work/Projects/project-a',
      'Work/Projects/project-b',
      'Personal',
    ]);
    expect(result).toHaveLength(5);
    expect(new Set(result)).toEqual(
      new Set([
        'Personal',
        'Work',
        'Work/Projects',
        'Work/Projects/project-a',
        'Work/Projects/project-b',
      ]),
    );
    const depths = result.map((p) => (p.match(/\//g) ?? []).length);
    for (let i = 1; i < depths.length; i++) {
      expect(depths[i]).toBeGreaterThanOrEqual(depths[i - 1]);
    }
  });

  it('ignores empty strings and trims', () => {
    expect(
      deriveFolderPathsToCreate(['  Work/Projects/p1  ', '', '  Work  ']),
    ).toEqual(['Work', 'Work/Projects', 'Work/Projects/p1']);
  });

  it('sorts shallowest first when depths differ', () => {
    expect(
      deriveFolderPathsToCreate(['A/B/C', 'A', 'A/B']),
    ).toEqual(['A', 'A/B', 'A/B/C']);
  });
});
