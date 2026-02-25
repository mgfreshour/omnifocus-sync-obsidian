/**
 * OmniFocus AppleScript integration.
 *
 * Uses `osascript` to communicate with OmniFocus 4 on macOS.
 * Requires OmniFocus 4 to be installed and running.
 */

/** A task from OmniFocus with name, persistent id, and notes. */
export interface OmniFocusTask {
  name: string;
  id: string;
  note: string;
  /** True when task is completed; only present when includeCompleted was used. */
  completed?: boolean;
}

/** Parsed block configuration (source + options). */
export interface BlockConfig {
  source: TaskSource;
  showCompleted: boolean;
}

/** Discriminated union describing where to fetch tasks from. */
export type TaskSource =
  | { kind: 'inbox' }
  | { kind: 'project'; name: string }
  | { kind: 'tag'; name: string };

/**
 * Parse a code-block body into a {@link TaskSource}.
 *
 * Accepted formats:
 * - empty string or `inbox` → inbox
 * - `project: <name>` → named project
 * - `tag: <name>` → named tag
 *
 * @returns A `TaskSource`, or `null` if the input is empty.
 * @throws If the input doesn't match any known format.
 */
export function parseSource(input: string): TaskSource | null {
  const trimmed = input.trim();

  if (trimmed === '') {
    return null;
  }

  if (trimmed.toLowerCase() === 'inbox') {
    return { kind: 'inbox' };
  }

  const projectMatch = trimmed.match(/^project:\s*(.+)$/i);
  if (projectMatch) {
    const name = projectMatch[1].trim();
    if (name.length === 0) {
      throw new Error('Project name cannot be empty. Use: project: My Project');
    }
    return { kind: 'project', name };
  }

  const tagMatch = trimmed.match(/^tag:\s*(.+)$/i);
  if (tagMatch) {
    const name = tagMatch[1].trim();
    if (name.length === 0) {
      throw new Error('Tag name cannot be empty. Use: tag: @Work');
    }
    return { kind: 'tag', name };
  }

  throw new Error(
    `Unknown source: "${trimmed}". Valid formats:\n` +
    '  (empty) or inbox — fetch inbox tasks\n' +
    '  project: <name>  — fetch tasks from a project\n' +
    '  tag: <name>      — fetch tasks with a tag',
  );
}

/**
 * Parse a code-block body into a {@link BlockConfig}.
 *
 * First line is the source (inbox, project: X, tag: X). Subsequent lines may
 * include "showCompleted" or "show-completed" (case-insensitive) to include
 * completed tasks.
 *
 * @returns A `BlockConfig`, or `null` if the input is empty.
 * @throws If the first line doesn't match any known source format.
 */
export function parseBlockConfig(input: string): BlockConfig | null {
  const lines = input
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) {
    return null;
  }
  const source = parseSource(lines[0]);
  if (source === null) {
    return null;
  }
  const showCompleted = lines.slice(1).some((l) => /^show-?completed$/i.test(l));
  return { source, showCompleted };
}

/** Project with name and note (description). */
export interface OmniFocusProjectWithNote {
  name: string;
  note: string;
}

/**
 * Sanitize a path segment for use in a file path (remove or replace / \\ :).
 *
 * @param segment - A single folder or project name.
 * @returns Safe segment for filesystem use.
 */
export function sanitizePathSegment(segment: string): string {
  return segment.replace(/[/\\:]/g, '-').trim() || 'untitled';
}

/**
 * Sanitize a full path: each segment is sanitized, then joined by /.
 *
 * @param path - Path string (e.g. "Work/Projects/project-a").
 * @returns Sanitized path safe for vault.createFolder.
 */
export function sanitizeProjectPath(path: string): string {
  return path
    .split('/')
    .map((s) => sanitizePathSegment(s.trim()))
    .filter(Boolean)
    .join('/');
}

/** Project path (folder hierarchy) with note for sync to Obsidian. */
export interface ProjectPathWithNote {
  path: string;
  note: string;
}

/**
 * Resolve a user-provided query to an exact name from a list of candidates.
 *
 * Matching rules (case-insensitive):
 * 1. Exact match → use it
 * 2. Single substring match → use it
 * 3. Multiple substring matches → throw listing the ambiguous matches
 * 4. No matches → throw listing all available candidates
 *
 * @param query The user-provided name query.
 * @param candidates The list of all available names.
 * @param entityLabel Label for error messages (e.g. "project", "tag").
 * @returns The resolved name.
 * @throws If the query is ambiguous or has no matches.
 */
export function resolveName(
  query: string,
  candidates: string[],
  entityLabel: string,
): string {
  const lowerQuery = query.toLowerCase();

  const exact = candidates.find((c) => c.toLowerCase() === lowerQuery);
  if (exact) {
    return exact;
  }

  const matches = candidates.filter((c) =>
    c.toLowerCase().includes(lowerQuery),
  );

  if (matches.length === 1) {
    return matches[0];
  }

  if (matches.length > 1) {
    const list = matches.map((m) => `  - ${m}`).join('\n');
    throw new Error(
      `Ambiguous ${entityLabel} "${query}". Multiple ${entityLabel}s match:\n${list}`,
    );
  }

  const list = candidates.map((c) => `  - ${c}`).join('\n');
  throw new Error(
    `No ${entityLabel} matching "${query}". Available ${entityLabel}s:\n${list}`,
  );
}

const FIELD_SEP = '\x1f';

/** Parse delimited task output (name<sep>id<sep>note[<sep>completed] per line). */
export function parseTaskOutput(stdout: string): OmniFocusTask[] {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return [];
  }
  const lines = trimmed.split('\n');
  const tasks: OmniFocusTask[] = [];
  for (const line of lines) {
    const parts = line.split(FIELD_SEP);
    if (parts.length >= 3) {
      tasks.push({
        name: parts[0] ?? '',
        id: parts[1] ?? '',
        note: (parts[2] ?? '').replace(/\\n/g, '\n'),
        completed: parts.length >= 4 ? parts[3] === 'true' : false,
      });
    }
  }
  return tasks;
}

/** Human-readable label for a task source. */
export function sourceLabel(source: TaskSource): string {
  switch (source.kind) {
    case 'inbox':
      return 'inbox';
    case 'project':
      return `project "${source.name}"`;
    case 'tag':
      return `tag "${source.name}"`;
  }
}

export {
  fetchProjectPaths,
  fetchProjectPathsWithNotes,
  fetchProjectNames,
  fetchProjectsWithNotes,
  fetchTagNames,
  fetchTasks,
  createTask,
  completeTask,
  updateTask,
  createProject,
  updateProjectNote,
  moveTaskToProject,
} from './omnifocus-applescript';
