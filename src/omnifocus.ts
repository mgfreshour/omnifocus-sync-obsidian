/**
 * OmniFocus AppleScript integration.
 *
 * Uses `osascript` to communicate with OmniFocus 4 on macOS.
 * Requires OmniFocus 4 to be installed and running.
 */

import { execFile } from 'child_process';

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

/**
 * Fetch all project paths from OmniFocus (with folder hierarchy).
 *
 * Each path is the full path to a project, e.g. "Work/Projects/project-a" or
 * "Personal" for a root-level project. Paths are sanitized for filesystem use.
 *
 * @returns Array of path strings.
 * @throws If `osascript` fails.
 */
export function fetchProjectPaths(): Promise<string[]> {
  const script = `
tell application "OmniFocus"
  tell default document
    set rootFolders to every folder
    set rootProjects to every project
  end tell
  set lf to character id 10
  set out to ""
  repeat with f in rootFolders
    set fname to name of f
    set sub to my collectFromFolder(f, fname & "/")
    if (length of out > 0) and (length of sub > 0) then set out to out & lf
    set out to out & sub
  end repeat
  repeat with p in rootProjects
    set pname to name of p
    if length of out > 0 then set out to out & lf
    set out to out & pname
  end repeat
  return out
end tell

on collectFromFolder(theFolder, prefix)
  tell application "OmniFocus"
    tell theFolder
      set folderList to every folder
      set projectList to every project
    end tell
  end tell
  set lf to character id 10
  set out to ""
  repeat with f in folderList
    set fname to name of f
    set sub to my collectFromFolder(f, prefix & fname & "/")
    if (length of out > 0) and (length of sub > 0) then set out to out & lf
    set out to out & sub
  end repeat
  repeat with p in projectList
    set pname to name of p
    if length of out > 0 then set out to out & lf
    set out to out & (prefix & pname)
  end repeat
  return out
end collectFromFolder
`;
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], (error, stdout, stderr) => {
      if (error) {
        reject(
          new Error(
            `Failed to fetch OmniFocus project paths: ${stderr || error.message}`,
          ),
        );
        return;
      }

      const trimmed = stdout.trim();
      if (trimmed.length === 0) {
        resolve([]);
        return;
      }

      const rawPaths = trimmed.split('\n');
      const paths = rawPaths
        .map((p) => p.trim())
        .filter(Boolean)
        .map(sanitizeProjectPath);
      resolve(paths);
    });
  });
}

/** Project path (folder hierarchy) with note for sync to Obsidian. */
export interface ProjectPathWithNote {
  path: string;
  note: string;
}

/**
 * Fetch all project paths with notes from OmniFocus (with folder hierarchy).
 *
 * Each item has the full path to a project and the project's note (description).
 * Paths are sanitized for filesystem use.
 *
 * @returns Array of { path, note }.
 * @throws If `osascript` fails.
 */
export function fetchProjectPathsWithNotes(): Promise<ProjectPathWithNote[]> {
  const sep = '\x1f'; // ASCII Unit Separator
  const lf = '\n';
  const script = `
tell application "OmniFocus"
  tell default document
    set rootFolders to every folder
    set rootProjects to every project
  end tell
  set sep to character id 31
  set lf to character id 10
  set out to ""
  repeat with f in rootFolders
    set fname to name of f
    set sub to my collectFromFolderWithNotes(f, fname & "/")
    if (length of out > 0) and (length of sub > 0) then set out to out & lf
    set out to out & sub
  end repeat
  repeat with p in rootProjects
    tell application "OmniFocus"
      set pname to name of p
      set noteText to note of p
      if noteText is missing value then set noteText to ""
    end tell
    set oldTID to AppleScript's text item delimiters
    set AppleScript's text item delimiters to lf
    set noteParts to text items of noteText
    set AppleScript's text item delimiters to "\\\\n"
    set noteSafe to noteParts as text
    set AppleScript's text item delimiters to oldTID
    if length of out > 0 then set out to out & lf
    set out to out & pname & sep & noteSafe
  end repeat
  return out
end tell

on collectFromFolderWithNotes(theFolder, prefix)
  tell application "OmniFocus"
    tell theFolder
      set folderList to every folder
      set projectList to every project
    end tell
  end tell
  set sep to character id 31
  set lf to character id 10
  set out to ""
  repeat with f in folderList
    set fname to name of f
    set sub to my collectFromFolderWithNotes(f, prefix & fname & "/")
    if (length of out > 0) and (length of sub > 0) then set out to out & lf
    set out to out & sub
  end repeat
  repeat with p in projectList
    tell application "OmniFocus"
      set pname to name of p
      set noteText to note of p
      if noteText is missing value then set noteText to ""
    end tell
    set oldTID to AppleScript's text item delimiters
    set AppleScript's text item delimiters to lf
    set noteParts to text items of noteText
    set AppleScript's text item delimiters to "\\\\n"
    set noteSafe to noteParts as text
    set AppleScript's text item delimiters to oldTID
    if length of out > 0 then set out to out & lf
    set out to out & (prefix & pname) & sep & noteSafe
  end repeat
  return out
end collectFromFolderWithNotes
`;
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], (error, stdout, stderr) => {
      if (error) {
        reject(
          new Error(
            `Failed to fetch OmniFocus project paths with notes: ${stderr || error.message}`,
          ),
        );
        return;
      }

      const trimmed = stdout.trim();
      if (trimmed.length === 0) {
        resolve([]);
        return;
      }

      const lines = trimmed.split('\n');
      const result: ProjectPathWithNote[] = [];
      for (const line of lines) {
        const parts = line.split(sep);
        if (parts.length >= 1) {
          const path = sanitizeProjectPath((parts[0] ?? '').trim());
          const note = (parts[1] ?? '').replace(/\\n/g, lf);
          if (path) result.push({ path, note });
        }
      }
      resolve(result);
    });
  });
}

/**
 * Fetch all project names from OmniFocus.
 *
 * @returns Array of project name strings.
 * @throws If `osascript` fails.
 */
export function fetchProjectNames(): Promise<string[]> {
  const script = `
tell application "OmniFocus"
  tell default document
    set projectNames to name of every flattened project
  end tell
  set AppleScript's text item delimiters to linefeed
  return projectNames as text
end tell
`;
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], (error, stdout, stderr) => {
      if (error) {
        reject(
          new Error(
            `Failed to fetch OmniFocus project names: ${stderr || error.message}`,
          ),
        );
        return;
      }

      const trimmed = stdout.trim();
      if (trimmed.length === 0) {
        resolve([]);
        return;
      }

      resolve(trimmed.split('\n'));
    });
  });
}

/**
 * Fetch all projects with names and notes (descriptions) from OmniFocus.
 *
 * @returns Array of projects with name and note (empty string if no note).
 * @throws If `osascript` fails.
 */
export function fetchProjectsWithNotes(): Promise<OmniFocusProjectWithNote[]> {
  const sep = '\x1f'; // ASCII Unit Separator
  const lf = '\n';
  const script = `
tell application "OmniFocus"
  tell default document
    set projectList to every flattened project
    set output to ""
    set oldTID to AppleScript's text item delimiters
    repeat with i from 1 to count of projectList
      set proj to item i of projectList
      set projName to name of proj
      set noteText to note of proj
      if noteText is missing value then set noteText to ""
      set AppleScript's text item delimiters to linefeed
      set noteParts to text items of noteText
      set AppleScript's text item delimiters to "\\\\n"
      set noteSafe to noteParts as text
      set AppleScript's text item delimiters to oldTID
      if i > 1 then set output to output & character id 10
      set output to output & projName & character id 31 & noteSafe
    end repeat
    return output
  end tell
end tell
`;
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], (error, stdout, stderr) => {
      if (error) {
        reject(
          new Error(
            `Failed to fetch OmniFocus projects: ${stderr || error.message}`,
          ),
        );
        return;
      }

      const trimmed = stdout.trim();
      if (trimmed.length === 0) {
        resolve([]);
        return;
      }

      const lines = trimmed.split('\n');
      const projects: OmniFocusProjectWithNote[] = [];
      for (const line of lines) {
        const parts = line.split(sep);
        if (parts.length >= 1) {
          projects.push({
            name: parts[0] ?? '',
            note: (parts[1] ?? '').replace(/\\n/g, lf),
          });
        }
      }
      resolve(projects);
    });
  });
}

/**
 * Fetch all tag names from OmniFocus.
 *
 * @returns Array of tag name strings.
 * @throws If `osascript` fails.
 */
export function fetchTagNames(): Promise<string[]> {
  const script = `
tell application "OmniFocus"
  tell default document
    set tagNames to name of every flattened tag
  end tell
  set AppleScript's text item delimiters to linefeed
  return tagNames as text
end tell
`;
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], (error, stdout, stderr) => {
      if (error) {
        reject(
          new Error(
            `Failed to fetch OmniFocus tag names: ${stderr || error.message}`,
          ),
        );
        return;
      }

      const trimmed = stdout.trim();
      if (trimmed.length === 0) {
        resolve([]);
        return;
      }

      resolve(trimmed.split('\n'));
    });
  });
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

  // 1. Exact match (case-insensitive)
  const exact = candidates.find((c) => c.toLowerCase() === lowerQuery);
  if (exact) {
    return exact;
  }

  // 2–3. Substring match (case-insensitive)
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

  // 4. No matches
  const list = candidates.map((c) => `  - ${c}`).join('\n');
  throw new Error(
    `No ${entityLabel} matching "${query}". Available ${entityLabel}s:\n${list}`,
  );
}

interface ScriptCommand {
  script: string;
  args: string[];
}

const FIELD_SEP = '\x1f'; // ASCII Unit Separator

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

/** Build the AppleScript and osascript arguments for a given task source. */
function buildScript(
  source: TaskSource,
  includeCompleted: boolean,
): ScriptCommand {
  const taskLoop = includeCompleted
    ? `
    set output to ""
    set sep to character id 31
    set lf to character id 10
    repeat with i from 1 to count of taskList
      set t to item i of taskList
      set taskName to name of t
      set taskId to id of t
      set noteText to note of t
      if noteText is missing value then set noteText to ""
      set taskCompleted to completed of t
      set oldTID to AppleScript's text item delimiters
      set AppleScript's text item delimiters to lf
      set noteParts to text items of noteText
      set AppleScript's text item delimiters to "\\\\n"
      set noteSafe to noteParts as text
      set AppleScript's text item delimiters to oldTID
      if i > 1 then set output to output & linefeed
      set output to output & taskName & sep & taskId & sep & noteSafe & sep & taskCompleted
    end repeat
    return output
`
    : `
    set output to ""
    set sep to character id 31
    set lf to character id 10
    repeat with i from 1 to count of taskList
      set t to item i of taskList
      set taskName to name of t
      set taskId to id of t
      set noteText to note of t
      if noteText is missing value then set noteText to ""
      set oldTID to AppleScript's text item delimiters
      set AppleScript's text item delimiters to lf
      set noteParts to text items of noteText
      set AppleScript's text item delimiters to "\\\\n"
      set noteSafe to noteParts as text
      set AppleScript's text item delimiters to oldTID
      if i > 1 then set output to output & linefeed
      set output to output & taskName & sep & taskId & sep & noteSafe
    end repeat
    return output
`;
  const inboxFilter = includeCompleted ? 'every inbox task' : 'every inbox task whose completed is false';
  const projectFilter = includeCompleted
    ? 'every flattened task of proj'
    : 'every flattened task of proj whose completed is false';
  const tagFilter = includeCompleted
    ? 'every flattened task whose (name of every tag contains tagName)'
    : 'every flattened task whose (name of every tag contains tagName) and completed is false';
  switch (source.kind) {
    case 'inbox':
      return {
        script: `
tell application "OmniFocus"
  tell default document
    set taskList to ` +
          inboxFilter +
          taskLoop +
          `
  end tell
end tell
`,
        args: [],
      };
    case 'project':
      return {
        script: `
on run argv
  set projectName to item 1 of argv
  tell application "OmniFocus"
    tell default document
      set proj to first flattened project whose name is projectName
      set taskList to ` +
          projectFilter +
          taskLoop +
          `
    end tell
  end tell
end run
`,
        args: [source.name],
      };
    case 'tag':
      return {
        script: `
on run argv
  set tagName to item 1 of argv
  tell application "OmniFocus"
    tell default document
      set taskList to ` +
          tagFilter +
          taskLoop +
          `
    end tell
  end tell
end run
`,
        args: [source.name],
      };
  }
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

/**
 * Fetch tasks from OmniFocus 4 for the given source.
 *
 * @param source - Where to fetch tasks from.
 * @param options - Optional. Set includeCompleted to true to fetch completed tasks too.
 * @returns Array of tasks with name, id, and note (empty if there are no tasks).
 * @throws If `osascript` fails (OmniFocus not installed, not running, etc.).
 */
export async function fetchTasks(
  source: TaskSource,
  options?: { includeCompleted?: boolean },
): Promise<OmniFocusTask[]> {
  if (source.kind === 'project') {
    const projects = await fetchProjectNames();
    const resolved = resolveName(source.name, projects, 'project');
    source = { kind: 'project', name: resolved };
  }

  if (source.kind === 'tag') {
    const tags = await fetchTagNames();
    const resolved = resolveName(source.name, tags, 'tag');
    source = { kind: 'tag', name: resolved };
  }

  const includeCompleted = options?.includeCompleted ?? false;
  const { script, args } = buildScript(source, includeCompleted);
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script, ...args], (error, stdout, stderr) => {
      if (error) {
        reject(
          new Error(
            `Failed to fetch OmniFocus ${sourceLabel(source)} tasks: ${stderr || error.message}`,
          ),
        );
        return;
      }
      resolve(parseTaskOutput(stdout));
    });
  });
}

/**
 * Create a task in OmniFocus for the given source.
 *
 * - Inbox: creates an inbox task
 * - Project: creates a task at end of the project
 * - Tag: creates an inbox task with the tag as primary tag
 *
 * @param source - Where to create the task.
 * @param taskName - The task title.
 * @param taskNote - Optional task notes.
 * @throws If `osascript` fails or project/tag not found.
 */
export async function createTask(
  source: TaskSource,
  taskName: string,
  taskNote = '',
): Promise<void> {
  let resolvedSource = source;
  if (source.kind === 'project') {
    const projects = await fetchProjectNames();
    const resolved = resolveName(source.name, projects, 'project');
    resolvedSource = { kind: 'project', name: resolved };
  }

  if (source.kind === 'tag') {
    const tags = await fetchTagNames();
    const resolved = resolveName(source.name, tags, 'tag');
    resolvedSource = { kind: 'tag', name: resolved };
  }

  const script =
    resolvedSource.kind === 'inbox'
      ? `
on run argv
  set taskName to item 1 of argv
  set taskNote to item 2 of argv
  tell application "OmniFocus"
    tell default document
      make new inbox task with properties {name: taskName, note: taskNote}
    end tell
  end tell
end run
`
      : resolvedSource.kind === 'project'
        ? `
on run argv
  set projectName to item 1 of argv
  set taskName to item 2 of argv
  set taskNote to item 3 of argv
  tell application "OmniFocus"
    tell default document
      set proj to first flattened project whose name is projectName
      make new task at end of tasks of proj with properties {name: taskName, note: taskNote}
    end tell
  end tell
end run
`
        : `
on run argv
  set tagName to item 1 of argv
  set taskName to item 2 of argv
  set taskNote to item 3 of argv
  tell application "OmniFocus"
    tell default document
      set theTag to first flattened tag whose name is tagName
      set t to make new inbox task with properties {name: taskName, note: taskNote}
      set primary tag of t to theTag
    end tell
  end tell
end run
`;

  const args =
    resolvedSource.kind === 'inbox'
      ? [taskName, taskNote]
      : [resolvedSource.name, taskName, taskNote];

  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script, ...args], (error, _stdout, stderr) => {
      if (error) {
        reject(
          new Error(
            `Failed to create OmniFocus ${sourceLabel(resolvedSource)} task: ${stderr || error.message}`,
          ),
        );
        return;
      }
      resolve();
    });
  });
}

/**
 * Mark a task as complete in OmniFocus by its persistent id.
 *
 * @param taskId - The task's persistent id (from OmniFocusTask.id).
 * @throws If `osascript` fails or task not found.
 */
export async function completeTask(taskId: string): Promise<void> {
  const script = `
on run argv
  set taskId to item 1 of argv
  tell application "OmniFocus"
    tell default document
      set theTask to first flattened task whose id is taskId
      mark complete theTask
    end tell
  end tell
end run
`;
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script, taskId], (error, _stdout, stderr) => {
      if (error) {
        reject(
          new Error(
            `Failed to complete OmniFocus task: ${stderr || error.message}`,
          ),
        );
        return;
      }
      resolve();
    });
  });
}

/**
 * Update a task's name and note in OmniFocus by id.
 * Pass current values for any field that should not change.
 *
 * @param taskId - The task's persistent id.
 * @param name - The new task name.
 * @param note - The new task note.
 * @throws If `osascript` fails or task not found.
 */
export async function updateTask(
  taskId: string,
  name: string,
  note: string,
): Promise<void> {
  const script = `
on run argv
  set taskId to item 1 of argv
  set taskName to item 2 of argv
  set taskNote to item 3 of argv
  tell application "OmniFocus"
    tell default document
      set theTask to first flattened task whose id is taskId
      set name of theTask to taskName
      set note of theTask to taskNote
    end tell
  end tell
end run
`;
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script, taskId, name, note], (error, _stdout, stderr) => {
      if (error) {
        reject(
          new Error(
            `Failed to update OmniFocus task: ${stderr || error.message}`,
          ),
        );
        return;
      }
      resolve();
    });
  });
}

/**
 * Create a new project in OmniFocus.
 *
 * @param projectName - The project name.
 * @throws If `osascript` fails.
 */
export async function createProject(projectName: string): Promise<void> {
  const script = `
on run argv
  set projectName to item 1 of argv
  tell application "OmniFocus"
    tell default document
      make new project with properties {name: projectName}
    end tell
  end tell
end run
`;
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script, projectName], (error, _stdout, stderr) => {
      if (error) {
        reject(
          new Error(
            `Failed to create OmniFocus project: ${stderr || error.message}`,
          ),
        );
        return;
      }
      resolve();
    });
  });
}

/**
 * Update the note (description) of a project in OmniFocus.
 *
 * @param projectName - The exact project name (resolved via resolveName).
 * @param note - The new note text.
 * @throws If `osascript` fails or project not found.
 */
export async function updateProjectNote(
  projectName: string,
  note: string,
): Promise<void> {
  const projects = await fetchProjectNames();
  const resolved = resolveName(projectName, projects, 'project');

  const script = `
on run argv
  set projectName to item 1 of argv
  set noteText to item 2 of argv
  tell application "OmniFocus"
    tell default document
      set proj to first flattened project whose name is projectName
      set note of proj to noteText
    end tell
  end tell
end run
`;
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script, resolved, note], (error, _stdout, stderr) => {
      if (error) {
        reject(
          new Error(
            `Failed to update OmniFocus project note: ${stderr || error.message}`,
          ),
        );
        return;
      }
      resolve();
    });
  });
}

/**
 * Move a task to a project in OmniFocus by task id and project name.
 *
 * @param taskId - The task's persistent id.
 * @param projectName - The exact project name (resolved via resolveName).
 * @throws If `osascript` fails or task/project not found.
 */
export async function moveTaskToProject(
  taskId: string,
  projectName: string,
): Promise<void> {
  const projects = await fetchProjectNames();
  const resolved = resolveName(projectName, projects, 'project');

  const script = `
on run argv
  set taskId to item 1 of argv
  set projectName to item 2 of argv
  tell application "OmniFocus"
    tell default document
      set theTask to first flattened task whose id is taskId
      set proj to first flattened project whose name is projectName
      move theTask to end of tasks of proj
    end tell
  end tell
end run
`;
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script, taskId, resolved], (error, _stdout, stderr) => {
      if (error) {
        reject(
          new Error(
            `Failed to move OmniFocus task: ${stderr || error.message}`,
          ),
        );
        return;
      }
      resolve();
    });
  });
}
