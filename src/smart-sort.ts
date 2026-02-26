/**
 * Smart Sort: Uses an LLM to recommend which project each inbox task belongs in.
 * Two-phase flow: assign to existing first, then suggest new for no-fit tasks.
 */

/** A single Smart Sort suggestion for interactive Accept/Decline. */
export interface SmartSortItem {
  taskId: string;
  taskName: string;
  projectName: string;
  type: 'existing' | 'project' | 'area';
  reasoning?: string;
}

/** Result of smartSort for rendering in the block UI. */
export interface SmartSortResult {
  items: SmartSortItem[];
  processedCount: number;
  totalCount: number;
  /** When set, Phase 1 or Phase 2 parse failed; items may be empty. */
  error?: string;
}

import { fetchProjectsWithNotes, fetchTasks, updateTask } from './omnifocus';
import type { OmniFocusTask } from './omnifocus';
import { simpleChat } from './llm';
import type { LLMPluginContext } from './llm';
import { getLLMModel } from './settings';
import type { PluginSettings } from './settings';
import { isLLMConfigured } from './llm';
import {
  extractUrlFromTask,
  fetchMetadata,
} from './url-metadata';

const PHASE1_SYSTEM = `You are a task categorization assistant. Your job is to assign each task to the most appropriate project or area from the provided list.

Projects have a defined outcome and can be completed. Areas (Areas of Responsibility) are long-term spheres of activity that never truly "finish."

Instructions:
1. Tasks are listed in a fixed order (first bullet = task 0, second = task 1, etc.).
2. Return a JSON array with ONE number per task, in the SAME order as the tasks. Position 0 = assignment for the first task, position 1 = second task, and so on.
3. Each number is the project/area index (1-based) from the numbered list, or 0 if that task does not fit any listed project/area.
4. Consider both the task name and note when deciding.
5. Return ONLY the JSON array, no other text.

Return a JSON array of objects with two fields: "project" (number: 0 for no fit, or 1-based project index) and "reasoning" (short string explaining why that project fits, e.g. for debugging). One object per task in the same order as the task list.

Example: [{"project":1,"reasoning":"Task is about X which matches project A."},{"project":2,"reasoning":"..."},{"project":0,"reasoning":"No existing project fits."},{"project":3,"reasoning":"..."},{"project":1,"reasoning":"..."}]

Your response must be ONLY the JSON array, with no additional text or explanation.`;

const PHASE2_SYSTEM = `You are a task organization assistant. For each task below, suggest either a new project or area where it should belong.

Projects are short-term goals with specific outcomes, while areas are long-term responsibilities that don't have a specific end date.

Videos and articles should have a project related to the content. Examples: Topics about programming, cooking, or woodworking.

Return your response as a JSON array of objects with: task, suggestion, type ("project" or "area"), reasoning. One object per task.`;

const CONCURRENCY = 3;

async function runWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const chunkResults = await Promise.all(chunk.map(fn));
    results.push(...chunkResults);
  }
  return results;
}

async function preprocessTasks(tasks: OmniFocusTask[]): Promise<OmniFocusTask[]> {
  const enriched = await runWithConcurrency(
    tasks,
    async (task) => {
      const url = extractUrlFromTask(task.name, task.note ?? '');
      if (!url) return task;
      const meta = await fetchMetadata(url);
      if (!meta) return task;
      // Avoid duplicating the URL when it was found in the note
      const noteWithoutUrl = (task.note ?? '')
        .replace(url, '')
        .trim()
        .replace(/\s{2,}/g, ' ');
      const newNote = [meta.description, url, noteWithoutUrl].filter(Boolean).join(' ');
      try {
        await updateTask(task.id, meta.title, newNote);
      } catch (err) {
        console.error('[omnifocus-sync] Failed to persist URL rename to OmniFocus:', err);
      }
      return {
        ...task,
        name: meta.title,
        note: newNote,
      };
    },
    CONCURRENCY,
  );
  return enriched;
}

/** Phase 1 assignment: project index (0 = no fit) and optional reasoning. Exported for tests. */
export interface Phase1Assignment {
  project: number;
  reasoning?: string;
}

/** Remove trailing commas before ] or } so LLM output parses as JSON. Exported for tests. */
export function relaxJson(s: string): string {
  return s
    .replace(/,\s*\]/g, ']')
    .replace(/,\s*}/g, '}');
}

/** If content looks like a truncated JSON array (starts with [ but doesn't end with ]), close it. Exported for tests. */
export function closeTruncatedArray(s: string): string {
  const t = s.trim();
  if (t.startsWith('[') && !t.endsWith(']')) {
    return t.replace(/,\s*$/, '') + ']';
  }
  return s;
}

function parsePhase1Entry(x: unknown, projectsLen: number): Phase1Assignment | null {
  if (typeof x === 'number' && x >= 0 && x <= projectsLen) {
    return { project: x };
  }
  if (
    x &&
    typeof x === 'object' &&
    typeof (x as { project?: number }).project === 'number'
  ) {
    const obj = x as { project: number; reasoning?: string };
    if (obj.project >= 0 && obj.project <= projectsLen) {
      const reasoning =
        typeof obj.reasoning === 'string' && obj.reasoning.trim()
          ? obj.reasoning.trim()
          : undefined;
      return { project: obj.project, reasoning };
    }
  }
  return null;
}

/** Parse Phase 1 LLM response into assignments. Exported for tests. */
export function parsePhase1Response(
  content: string,
  tasksLen: number,
  projectsLen: number,
): Phase1Assignment[] | null {
  const cleaned = closeTruncatedArray(
    relaxJson(content.replace(/```json\s*|\s*```/g, '').trim()),
  );
  try {
    const arr = JSON.parse(cleaned);
    if (!Array.isArray(arr) || arr.length !== tasksLen) return null;
    const result = arr.map((x: unknown) => parsePhase1Entry(x, projectsLen));
    if (result.some((r) => r === null)) return null;
    return result as Phase1Assignment[];
  } catch {
    return null;
  }
}

interface Phase2Suggestion {
  task: string;
  suggestion: string;
  type: string;
  reasoning?: string;
}

/** Parse Phase 2 LLM response into suggestions. Exported for tests. */
export function parsePhase2Response(content: string): Phase2Suggestion[] | null {
  const cleaned = relaxJson(content.replace(/```json\s*|\s*```/g, '').trim());
  try {
    const arr = JSON.parse(cleaned);
    if (!Array.isArray(arr)) return null;
    const valid = arr.every(
      (x) =>
        x &&
        typeof x === 'object' &&
        typeof x.task === 'string' &&
        typeof x.suggestion === 'string',
    );
    if (!valid) return null;
    return arr as Phase2Suggestion[];
  } catch {
    return null;
  }
}

interface Phase1Result {
  assignments: Phase1Assignment[] | null;
  phase1Content: string;
}

async function runPhase1(
  ctx: LLMPluginContext,
  effectiveModel: string,
  tasks: OmniFocusTask[],
  projects: { name: string; note: string }[],
  settings: PluginSettings,
): Promise<Phase1Result> {
  const additionalContext = settings.smartSortAdditionalContext?.trim();
  const contextBlock = additionalContext
    ? `\nAdditional Context:\n${additionalContext}\n`
    : '';
  const projectsList =
    projects.length === 0
      ? 'No existing projects or areas.'
      : projects
          .map((p, i) => `${i + 1}. ${p.name}${p.note ? ` - ${p.note}` : ''}`)
          .join('\n');
  const tasksList = tasks
    .map((t, i) => `${i + 1}. "${t.name}"${t.note ? ` (${t.note})` : ''}`)
    .join('\n');
  const phase1User = `Available projects/areas (with descriptions):${contextBlock}
${projectsList}

Tasks to categorize (order matters; your array index i must be the assignment for task i+1 below):
${tasksList}

Return ONLY a JSON array of ${tasks.length} objects: [{"project": <0 or 1-based index>, "reasoning": "<short explanation>"}, ...]. One object per task in the same order. Use "project": 0 for "no fit".`;

  const phase1Content = await simpleChat(ctx, phase1User, {
    systemPrompt: PHASE1_SYSTEM,
    model: effectiveModel,
    temperature: 0.1,
    max_tokens: 1000,
  });
  let assignments = parsePhase1Response(phase1Content, tasks.length, projects.length);
  if (!assignments) {
    const retryUser =
      phase1User +
      '\n\nIMPORTANT: Your previous response was invalid. Reply with ONLY a JSON array of objects, e.g. [{"project":1,"reasoning":"..."},{"project":2,"reasoning":"..."},{"project":0,"reasoning":"No fit."}]. No markdown, no explanation.';
    const retryContent = await simpleChat(ctx, retryUser, {
      systemPrompt: PHASE1_SYSTEM,
      model: effectiveModel,
      temperature: 0.1,
      max_tokens: 1000,
    });
    assignments = parsePhase1Response(retryContent, tasks.length, projects.length);
  }
  return { assignments, phase1Content };
}

function buildPhase1Items(
  assignments: Phase1Assignment[] | null,
  tasks: OmniFocusTask[],
  projects: { name: string; note: string }[],
): { items: SmartSortItem[]; noFitTasks: OmniFocusTask[] } {
  const items: SmartSortItem[] = [];
  const noFitTasks: OmniFocusTask[] = [];
  if (!assignments) return { items, noFitTasks };
  for (let i = 0; i < tasks.length; i++) {
    const a = assignments[i];
    const idx = a?.project ?? 0;
    const task = tasks[i];
    if (idx > 0 && idx <= projects.length) {
      const proj = projects[idx - 1];
      items.push({
        taskId: task.id,
        taskName: task.name,
        projectName: proj?.name ?? `Project ${idx}`,
        type: 'existing',
        reasoning: a?.reasoning,
      });
    } else {
      noFitTasks.push(task);
    }
  }
  return { items, noFitTasks };
}

async function runPhase2(
  ctx: LLMPluginContext,
  effectiveModel: string,
  noFitTasks: OmniFocusTask[],
  items: SmartSortItem[],
  tasksLen: number,
  totalCount: number,
): Promise<SmartSortResult> {
  const phase2TasksList = noFitTasks
    .map((t) => `- "${t.name}"${t.note ? ` (${t.note})` : ''}`)
    .join('\n');
  const phase2User = `Tasks to analyze (suggest new project or area for each):
${phase2TasksList}

Return a JSON array of objects: [{ "task": "...", "suggestion": "...", "type": "project" or "area", "reasoning": "..." }]`;

  let phase2Content: string;
  try {
    phase2Content = await simpleChat(ctx, phase2User, {
      systemPrompt: PHASE2_SYSTEM,
      model: effectiveModel,
      temperature: 0.3,
    });
  } catch (err) {
    return {
      items,
      processedCount: tasksLen,
      totalCount,
      error: 'Phase 2 failed: ' + (err instanceof Error ? err.message : String(err)),
    };
  }

  const suggestions = parsePhase2Response(phase2Content);
  if (!suggestions) {
    return {
      items,
      processedCount: tasksLen,
      totalCount,
      error:
        'Parse failed; raw Phase 2 output: ' +
        (phase2Content?.trim() ? phase2Content : '(empty response from LLM)'),
    };
  }

  for (const s of suggestions) {
    const matchedTask = noFitTasks.find(
      (t) => t.name.trim().toLowerCase() === s.task.trim().toLowerCase(),
    );
    if (matchedTask) {
      const type = s.type === 'area' ? 'area' : 'project';
      items.push({
        taskId: matchedTask.id,
        taskName: matchedTask.name,
        projectName: s.suggestion,
        type,
        reasoning: s.reasoning,
      });
    }
  }
  return { items, processedCount: tasksLen, totalCount };
}

/**
 * Runs Smart Sort: fetches projects and inbox tasks, runs two-phase LLM flow,
 * and returns structured suggestions for the interactive block UI.
 */
export async function smartSort(
  ctx: LLMPluginContext,
  settings: PluginSettings,
): Promise<SmartSortResult> {
  const effectiveModel = getLLMModel(settings, 'smartSort');
  const config = { ...ctx.getConfig(), model: effectiveModel };

  if (!isLLMConfigured(config)) {
    throw new Error('LLM is not configured. Set API key or base URL in plugin settings.');
  }
  if (!effectiveModel) {
    throw new Error(
      'No model selected for Smart Sort. Set Default model or Smart sort override in plugin settings.',
    );
  }

  const [projects, rawTasks] = await Promise.all([
    fetchProjectsWithNotes(),
    fetchTasks({ kind: 'inbox' }),
  ]);
  const maxBatch = settings.smartSortMaxTasksPerBatch ?? 10;
  const tasks = (await preprocessTasks(rawTasks)).slice(0, maxBatch);

  if (tasks.length === 0) {
    return { items: [], processedCount: 0, totalCount: rawTasks.length, error: 'No inbox tasks to sort.' };
  }

  const { assignments, phase1Content } = await runPhase1(
    ctx,
    effectiveModel,
    tasks,
    projects,
    settings,
  );

  const { items, noFitTasks } = buildPhase1Items(assignments, tasks, projects);

  if (!assignments) {
    const errorMsg =
      'Parse failed; raw Phase 1 output: ' +
      (phase1Content?.trim() ? phase1Content : '(empty response from LLM)');
    return {
      items: [],
      processedCount: tasks.length,
      totalCount: rawTasks.length,
      error: errorMsg,
    };
  }

  if (noFitTasks.length > 0) {
    return runPhase2(
      ctx,
      effectiveModel,
      noFitTasks,
      items,
      tasks.length,
      rawTasks.length,
    );
  }

  return {
    items,
    processedCount: tasks.length,
    totalCount: rawTasks.length,
  };
}
