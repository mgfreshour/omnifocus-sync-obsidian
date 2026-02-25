/**
 * OmniFocus AppleScript execution and script building.
 * Script strings live in omnifocus-script-constants.ts; types/parsing in omnifocus.ts.
 */

import { execFile } from 'child_process';
import type {
  TaskSource,
  OmniFocusTask,
  OmniFocusProjectWithNote,
  ProjectPathWithNote,
} from './omnifocus';
import {
  sanitizeProjectPath,
  resolveName,
  sourceLabel,
  parseTaskOutput,
} from './omnifocus';
import {
  SCRIPT_FETCH_PROJECT_PATHS,
  SCRIPT_FETCH_PROJECT_PATHS_WITH_NOTES,
  SCRIPT_FETCH_PROJECT_NAMES,
  SCRIPT_FETCH_PROJECTS_WITH_NOTES,
  SCRIPT_FETCH_TAG_NAMES,
  TASK_LOOP_WITH_COMPLETED,
  TASK_LOOP_WITHOUT_COMPLETED,
  SCRIPT_COMPLETE_TASK,
  SCRIPT_UPDATE_TASK,
  SCRIPT_CREATE_PROJECT,
  SCRIPT_UPDATE_PROJECT_NOTE,
  SCRIPT_MOVE_TASK,
  SCRIPT_CREATE_INBOX_TASK,
  SCRIPT_CREATE_PROJECT_TASK,
  SCRIPT_CREATE_TAG_TASK,
} from './omnifocus-script-constants';

const SEP = '\x1f';
const LF = '\n';

interface ScriptCommand {
  script: string;
  args: string[];
}

function buildFetchTasksScript(
  source: TaskSource,
  includeCompleted: boolean,
): ScriptCommand {
  const taskLoop = includeCompleted ? TASK_LOOP_WITH_COMPLETED : TASK_LOOP_WITHOUT_COMPLETED;
  const inboxFilter = includeCompleted ? 'every inbox task' : 'every inbox task whose completed is false';
  const projectFilter = includeCompleted
    ? 'every flattened task of proj'
    : 'every flattened task of proj whose completed is false';
  const tagFilter = includeCompleted
    ? 'every flattened task whose (name of every tag contains tagName)'
    : 'every flattened task whose (name of every tag contains tagName) and completed is false';

  if (source.kind === 'inbox') {
    return {
      script: `tell application "OmniFocus"\n  tell default document\n    set taskList to ${inboxFilter}${taskLoop}\n  end tell\nend tell\n`,
      args: [],
    };
  }
  if (source.kind === 'project') {
    return {
      script: `on run argv\n  set projectName to item 1 of argv\n  tell application "OmniFocus"\n    tell default document\n      set proj to first flattened project whose name is projectName\n      set taskList to ${projectFilter}${taskLoop}\n    end tell\n  end tell\nend run\n`,
      args: [source.name],
    };
  }
  return {
    script: `on run argv\n  set tagName to item 1 of argv\n  tell application "OmniFocus"\n    tell default document\n      set taskList to ${tagFilter}${taskLoop}\n    end tell\n  end tell\nend run\n`,
    args: [source.name],
  };
}

function runScript(
  script: string,
  args: string[] = [],
  errorPrefix = '',
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script, ...args], (error, stdout, stderr) => {
      if (error) {
        const msg = stderr || error.message;
        reject(new Error(errorPrefix ? `${errorPrefix}${msg}` : msg));
        return;
      }
      resolve(stdout);
    });
  });
}

export function fetchProjectPaths(): Promise<string[]> {
  return runScript(
    SCRIPT_FETCH_PROJECT_PATHS,
    [],
    'Failed to fetch OmniFocus project paths: ',
  ).then((stdout) => {
    const trimmed = stdout.trim();
    if (trimmed.length === 0) return [];
    return trimmed
      .split('\n')
      .map((p) => p.trim())
      .filter(Boolean)
      .map(sanitizeProjectPath);
  });
}

export function fetchProjectPathsWithNotes(): Promise<ProjectPathWithNote[]> {
  return runScript(
    SCRIPT_FETCH_PROJECT_PATHS_WITH_NOTES,
    [],
    'Failed to fetch OmniFocus project paths with notes: ',
  ).then((stdout) => {
    const trimmed = stdout.trim();
    if (trimmed.length === 0) return [];
    const result: ProjectPathWithNote[] = [];
    for (const line of trimmed.split('\n')) {
      const parts = line.split(SEP);
      if (parts.length >= 1) {
        const path = sanitizeProjectPath((parts[0] ?? '').trim());
        const note = (parts[1] ?? '').replace(/\\n/g, LF);
        if (path) result.push({ path, note });
      }
    }
    return result;
  });
}

export function fetchProjectNames(): Promise<string[]> {
  return runScript(
    SCRIPT_FETCH_PROJECT_NAMES,
    [],
    'Failed to fetch OmniFocus project names: ',
  ).then((stdout) => {
    const trimmed = stdout.trim();
    return trimmed.length === 0 ? [] : trimmed.split('\n');
  });
}

export function fetchProjectsWithNotes(): Promise<OmniFocusProjectWithNote[]> {
  return runScript(
    SCRIPT_FETCH_PROJECTS_WITH_NOTES,
    [],
    'Failed to fetch OmniFocus projects: ',
  ).then((stdout) => {
    const trimmed = stdout.trim();
    if (trimmed.length === 0) return [];
    const projects: OmniFocusProjectWithNote[] = [];
    for (const line of trimmed.split('\n')) {
      const parts = line.split(SEP);
      if (parts.length >= 1) {
        projects.push({
          name: parts[0] ?? '',
          note: (parts[1] ?? '').replace(/\\n/g, LF),
        });
      }
    }
    return projects;
  });
}

export function fetchTagNames(): Promise<string[]> {
  return runScript(
    SCRIPT_FETCH_TAG_NAMES,
    [],
    'Failed to fetch OmniFocus tag names: ',
  ).then((stdout) => {
    const trimmed = stdout.trim();
    return trimmed.length === 0 ? [] : trimmed.split('\n');
  });
}

export async function fetchTasks(
  source: TaskSource,
  options?: { includeCompleted?: boolean },
): Promise<OmniFocusTask[]> {
  let resolvedSource = source;
  if (source.kind === 'project') {
    const projects = await fetchProjectNames();
    resolvedSource = { kind: 'project', name: resolveName(source.name, projects, 'project') };
  } else if (source.kind === 'tag') {
    const tags = await fetchTagNames();
    resolvedSource = { kind: 'tag', name: resolveName(source.name, tags, 'tag') };
  }
  const includeCompleted = options?.includeCompleted ?? false;
  const { script, args } = buildFetchTasksScript(resolvedSource, includeCompleted);
  const prefix = `Failed to fetch OmniFocus ${sourceLabel(resolvedSource)} tasks: `;
  const stdout = await runScript(script, args, prefix);
  return parseTaskOutput(stdout);
}

export async function createTask(
  source: TaskSource,
  taskName: string,
  taskNote = '',
): Promise<void> {
  let resolvedSource = source;
  if (source.kind === 'project') {
    const projects = await fetchProjectNames();
    resolvedSource = { kind: 'project', name: resolveName(source.name, projects, 'project') };
  } else if (source.kind === 'tag') {
    const tags = await fetchTagNames();
    resolvedSource = { kind: 'tag', name: resolveName(source.name, tags, 'tag') };
  }
  const script =
    resolvedSource.kind === 'inbox'
      ? SCRIPT_CREATE_INBOX_TASK
      : resolvedSource.kind === 'project'
        ? SCRIPT_CREATE_PROJECT_TASK
        : SCRIPT_CREATE_TAG_TASK;
  const args =
    resolvedSource.kind === 'inbox'
      ? [taskName, taskNote]
      : [resolvedSource.name, taskName, taskNote];
  const prefix = `Failed to create OmniFocus ${sourceLabel(resolvedSource)} task: `;
  await runScript(script, args, prefix);
}

export function completeTask(taskId: string): Promise<void> {
  return runScript(
    SCRIPT_COMPLETE_TASK,
    [taskId],
    'Failed to complete OmniFocus task: ',
  ).then(() => undefined);
}

export function updateTask(
  taskId: string,
  name: string,
  note: string,
): Promise<void> {
  return runScript(
    SCRIPT_UPDATE_TASK,
    [taskId, name, note],
    'Failed to update OmniFocus task: ',
  ).then(() => undefined);
}

export function createProject(projectName: string): Promise<void> {
  return runScript(
    SCRIPT_CREATE_PROJECT,
    [projectName],
    'Failed to create OmniFocus project: ',
  ).then(() => undefined);
}

export async function updateProjectNote(
  projectName: string,
  note: string,
): Promise<void> {
  const projects = await fetchProjectNames();
  const resolved = resolveName(projectName, projects, 'project');
  await runScript(
    SCRIPT_UPDATE_PROJECT_NOTE,
    [resolved, note],
    'Failed to update OmniFocus project note: ',
  );
}

export async function moveTaskToProject(
  taskId: string,
  projectName: string,
): Promise<void> {
  const projects = await fetchProjectNames();
  const resolved = resolveName(projectName, projects, 'project');
  await runScript(
    SCRIPT_MOVE_TASK,
    [taskId, resolved],
    'Failed to move OmniFocus task: ',
  );
}
