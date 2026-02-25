/**
 * OmniFocus block UI: state, handlers, and lit-html rendering.
 * Used by the code block processor in omnifocus-integration.
 */

import { html, render } from 'lit';
import { Notice, requestUrl } from 'obsidian';
import type { App } from 'obsidian';
import { getLLMModel } from './settings';
import type { PluginSettings } from './settings';
import {
  completeTask,
  createTask,
  createProject,
  fetchProjectNames,
  fetchTasks,
  moveTaskToProject,
  sourceLabel,
} from './omnifocus';
import type { OmniFocusTask, TaskSource } from './omnifocus';
import { AddTaskModal } from './add-task-modal';
import { smartSort } from './smart-sort';
import type { SmartSortItem } from './smart-sort';
import type { LLMPluginContext, LLMRequestAdapter } from './llm';
import type { LLMProvider } from './llm';

/** Plugin context required for OmniFocus block (app, settings, processor registration). */
export interface OmnifocusPluginContext {
  app: App;
  settings: PluginSettings;
  registerMarkdownCodeBlockProcessor(
    language: string,
    processor: (source: string, el: HTMLElement) => void | Promise<void>,
  ): void;
}

export type OmnifocusBlockState = {
  status: 'loading' | 'ready';
  label: string;
  config: { source: TaskSource; showCompleted: boolean };
  syncing: boolean;
  smartSorting: boolean;
  tasks?: OmniFocusTask[];
  error?: string;
  smartSortResults: SmartSortItem[] | null;
  smartSortError?: string;
};

async function normalizeRequestUrlResponse(res: {
  status: number;
  text?: string | Promise<string>;
  json?: unknown;
}): Promise<{ status: number; json: unknown }> {
  const rawText = res.text;
  let text: string;
  if (
    rawText !== undefined &&
    rawText !== null &&
    typeof (rawText as Promise<string>).then === 'function'
  ) {
    text = await (rawText as Promise<string>);
  } else {
    text = typeof rawText === 'string' ? rawText : String(rawText ?? '');
  }
  let json: unknown;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  } else {
    const rawJson = res.json;
    if (typeof rawJson === 'function') {
      json = await (rawJson as () => Promise<unknown>)();
    } else if (
      rawJson &&
      typeof (rawJson as Promise<unknown>).then === 'function'
    ) {
      json = await (rawJson as Promise<unknown>);
    } else {
      json = rawJson;
    }
  }
  return { status: res.status, json: json ?? null };
}

/** Returns an LLMRequestAdapter that uses Obsidian's requestUrl. */
export function createObsidianRequestAdapter(): LLMRequestAdapter {
  return async (opts) => {
    const res = await requestUrl({
      url: opts.url,
      method: opts.method ?? 'GET',
      headers: opts.headers,
      body: opts.body,
      throw: opts.throw ?? false,
    });
    const out = await normalizeRequestUrlResponse(res as Parameters<typeof normalizeRequestUrlResponse>[0]);
    if (opts.url?.includes('/chat/completions') && out.json) {
      const obj = out.json as Record<string, unknown>;
      const choices = obj?.choices as Array<{ message?: { content?: unknown } }> | undefined;
      const content = choices?.[0]?.message?.content;
      console.log(
        '[omnifocus-sync] LLM response: status=',
        res.status,
        'choices=',
        choices?.length,
        'contentType=',
        typeof content,
        'contentLength=',
        typeof content === 'string' ? content.length : 0,
      );
    }
    return out;
  };
}

type BlockHandlers = {
  onNoteToggle: (e: Event) => void;
  onOmniFocusLinkClick: (taskId: string) => (e: Event) => void;
  onSyncClick: () => void;
  onSmartSortClick: () => Promise<void>;
  onAddClick: () => void;
  onCheckboxChange: (task: OmniFocusTask) => (e: Event) => Promise<void>;
  onAccept: (item: SmartSortItem) => () => Promise<void>;
  onDecline: (item: SmartSortItem) => () => void;
};

function createNoteAndLinkHandlers(): Pick<BlockHandlers, 'onNoteToggle' | 'onOmniFocusLinkClick'> {
  return {
    onNoteToggle: (e: Event) => {
      e.stopPropagation();
      const target = e.target as HTMLElement;
      const noteEl = target.closest('.omnifocus-task-item')?.querySelector<HTMLElement>('.omnifocus-task-note');
      if (noteEl) {
        const isOpen = noteEl.style.display === 'none';
        noteEl.style.display = isOpen ? 'block' : 'none';
        target.textContent = isOpen ? '[-]' : '[+]';
      }
    },
    onOmniFocusLinkClick: (taskId: string) => (e: Event) => {
      e.preventDefault();
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires -- electron at runtime
        require('electron').shell.openExternal(`omnifocus:///task/${taskId}`);
      } catch {
        window.open(`omnifocus:///task/${taskId}`);
      }
    },
  };
}

function createSyncHandlers(
  plugin: OmnifocusPluginContext,
  taskSource: TaskSource,
  getState: () => OmnifocusBlockState,
  setState: (s: OmnifocusBlockState) => void,
  triggerRender: () => void,
  triggerFetch: () => void,
): Pick<BlockHandlers, 'onSyncClick' | 'onSmartSortClick' | 'onAddClick'> {
  const buildLLMContext = (): LLMPluginContext => ({
    getConfig: () => ({
      provider: (plugin.settings.llmProvider ?? 'openrouter') as LLMProvider,
      apiKey: plugin.settings.llmApiKey ?? '',
      baseUrl: plugin.settings.llmBaseUrl?.trim() || undefined,
      model: getLLMModel(plugin.settings, 'smartSort') || undefined,
    }),
    requestUrl: createObsidianRequestAdapter(),
  });
  return {
    onSyncClick: triggerFetch,
    onSmartSortClick: async () => {
      setState({ ...getState(), smartSorting: true, smartSortError: undefined });
      triggerRender();
      try {
        const result = await smartSort(buildLLMContext(), plugin.settings);
        setState({ ...getState(), smartSorting: false, smartSortResults: result.items, smartSortError: result.error });
        if (result.items.length > 0) new Notice(`Smart sort: ${result.items.length} suggestion(s).`);
        else if (result.error) new Notice(result.error);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        new Notice(`Smart sort error: ${message}`);
        setState({ ...getState(), smartSorting: false, smartSortResults: null, smartSortError: message });
      }
      triggerRender();
    },
    onAddClick: () => {
      new AddTaskModal(plugin.app, taskSource, async (title, note) => {
        await createTask(taskSource, title, note);
        new Notice(`Created task in ${getState().label}.`);
        triggerFetch();
      }).open();
    },
  };
}

function createTaskHandlers(
  getState: () => OmnifocusBlockState,
  setState: (s: OmnifocusBlockState) => void,
  triggerRender: () => void,
  triggerFetch: () => void,
): Pick<BlockHandlers, 'onCheckboxChange' | 'onAccept' | 'onDecline'> {
  return {
    onCheckboxChange: (task: OmniFocusTask) => async (e: Event) => {
      const checkbox = e.target as HTMLInputElement;
      checkbox.disabled = true;
      try {
        await completeTask(task.id);
        new Notice('Task completed.');
        triggerFetch();
      } catch (err) {
        new Notice(`OmniFocus error: ${err instanceof Error ? err.message : String(err)}`);
        checkbox.checked = false;
        checkbox.disabled = false;
      }
    },
    onAccept: (item: SmartSortItem) => async () => {
      try {
        if (item.type !== 'existing') {
          try {
            await moveTaskToProject(item.taskId, item.projectName);
          } catch {
            const projects = await fetchProjectNames();
            if (!projects.some((p) => p.toLowerCase() === item.projectName.toLowerCase())) await createProject(item.projectName);
            await moveTaskToProject(item.taskId, item.projectName);
          }
        } else {
          await moveTaskToProject(item.taskId, item.projectName);
        }
        new Notice('Task moved to project.');
        const s = getState();
        setState({ ...s, smartSortResults: (s.smartSortResults ?? []).filter((x) => x.taskId !== item.taskId) });
        if ((getState().smartSortResults?.length ?? 0) === 0) setState({ ...getState(), smartSortResults: null });
        triggerFetch();
      } catch (err) {
        new Notice(`Failed to move task: ${err instanceof Error ? err.message : String(err)}`);
      }
      triggerRender();
    },
    onDecline: (item: SmartSortItem) => () => {
      const s = getState();
      setState({ ...s, smartSortResults: (s.smartSortResults ?? []).filter((x) => x.taskId !== item.taskId) });
      if ((getState().smartSortResults?.length ?? 0) === 0) setState({ ...getState(), smartSortResults: null });
      triggerRender();
    },
  };
}

function createBlockHandlers(
  plugin: OmnifocusPluginContext,
  taskSource: TaskSource,
  getState: () => OmnifocusBlockState,
  setState: (s: OmnifocusBlockState) => void,
  triggerRender: () => void,
  triggerFetch: () => void,
): BlockHandlers {
  return {
    ...createNoteAndLinkHandlers(),
    ...createSyncHandlers(plugin, taskSource, getState, setState, triggerRender, triggerFetch),
    ...createTaskHandlers(getState, setState, triggerRender, triggerFetch),
  };
}

function renderTaskListTemplate(s: OmnifocusBlockState, handlers: BlockHandlers): ReturnType<typeof html> {
  if (s.error) {
    return html`<ul class="omnifocus-task-list"><li class="omnifocus-error">${s.error}</li></ul>`;
  }
  const tasks = s.tasks ?? [];
  const sorted =
    tasks.length > 0 ? [...tasks].sort((a, b) => (a.completed ? 1 : 0) - (b.completed ? 1 : 0)) : [];
  if (sorted.length === 0) {
    return html`<p class="omnifocus-empty">No tasks in ${s.label}.</p>`;
  }
  return html`<ul class="omnifocus-task-list">
    ${sorted.map((task) =>
      html`<li class=${task.completed ? 'omnifocus-task-item omnifocus-task-item--completed' : 'omnifocus-task-item'}>
        ${task.completed ? html`<span class="omnifocus-task-completed-marker" title="Completed">☑</span>` : html`<input type="checkbox" class="omnifocus-task-checkbox" title="Mark complete" @change=${handlers.onCheckboxChange(task)} />`}
        <span class="omnifocus-task-name">${task.name}</span>
        <a class="omnifocus-task-link" href="omnifocus:///task/${task.id}" title="Open in OmniFocus" @click=${handlers.onOmniFocusLinkClick(task.id)}>↗</a>
        ${task.note ? html`<span class="omnifocus-task-note-toggle" @click=${handlers.onNoteToggle}>[+]</span><div class="omnifocus-task-note" style="display:none">${task.note}</div>` : ''}
      </li>`,
    )}
  </ul>`;
}

function renderSmartSortSection(s: OmnifocusBlockState, handlers: BlockHandlers): ReturnType<typeof html> | string {
  const hasError = s.smartSortError && (s.smartSortResults?.length ?? 0) === 0;
  if (hasError) {
    return html`<div class="omnifocus-smartsort-results omnifocus-smartsort-error"><h4 class="omnifocus-smartsort-heading">Smart Sort</h4><p class="omnifocus-smartsort-error-text">${s.smartSortError}</p></div>`;
  }
  const hasResults = s.smartSortResults && s.smartSortResults.length > 0;
  if (!hasResults) return '';
  return html`<div class="omnifocus-smartsort-results"><h4 class="omnifocus-smartsort-heading">Smart Sort suggestions</h4>${s.smartSortError ? html`<p class="omnifocus-smartsort-info">${s.smartSortError}</p>` : ''}<ul class="omnifocus-smartsort-list">${s.smartSortResults!.map((item) => html`<li class="omnifocus-smartsort-item"><span class="omnifocus-smartsort-task">${item.taskName}</span><span class="omnifocus-smartsort-arrow">→</span><span class="omnifocus-smartsort-dest">${item.projectName}</span>${item.reasoning ? html`<span class="omnifocus-smartsort-reason">(${item.reasoning})</span>` : ''}<button class="omnifocus-smartsort-accept-btn" @click=${handlers.onAccept(item)}>Accept</button><button class="omnifocus-smartsort-decline-btn" @click=${handlers.onDecline(item)}>Decline</button></li>`)}</ul></div>`;
}

function buildBlockTemplate(
  s: OmnifocusBlockState,
  taskSource: TaskSource,
  handlers: BlockHandlers,
): ReturnType<typeof html> {
  const syncing = s.syncing;
  const smartSorting = s.smartSorting;
  const btnLabel = syncing ? 'Syncing...' : `Sync OmniFocus ${s.label}`;
  const smartSortLabel = smartSorting ? 'Smart sorting...' : 'Smart sort';
  const isInbox = taskSource.kind === 'inbox';
  const buttonsDisabled = syncing || smartSorting;
  const taskListTemplate = renderTaskListTemplate(s, handlers);
  const smartSortSection = renderSmartSortSection(s, handlers);
  return html`
    <div class="omnifocus-btn-row">
      <button class="omnifocus-add-btn" ?disabled=${buttonsDisabled} @click=${handlers.onAddClick}>Add task</button>
      <button class="omnifocus-sync-btn" ?disabled=${buttonsDisabled} @click=${handlers.onSyncClick}>${btnLabel}</button>
      ${isInbox ? html`<button class="omnifocus-smartsort-btn" ?disabled=${buttonsDisabled} @click=${handlers.onSmartSortClick}>${smartSortLabel}</button>` : ''}
    </div>
    <div class="omnifocus-list-wrapper">${taskListTemplate}</div>
    ${smartSortSection}
  `;
}

/** Create and run an OmniFocus block: state, render, doFetch. Returns { doFetch }. */
export function createOmnifocusBlock(
  container: HTMLElement,
  config: { source: TaskSource; showCompleted: boolean },
  plugin: OmnifocusPluginContext,
): { doFetch: () => void } {
  const taskSource = config.source;
  const label = sourceLabel(taskSource);
  let state: OmnifocusBlockState = {
    status: 'loading',
    label,
    config,
    syncing: false,
    smartSorting: false,
    smartSortResults: null,
  };
  const setState = (s: OmnifocusBlockState) => {
    state = s;
  };
  const getState = () => state;

  let renderBlock: () => void = () => {};
  let doFetch: () => void = () => {};

  const handlers = createBlockHandlers(
    plugin,
    taskSource,
    getState,
    setState,
    () => renderBlock(),
    () => doFetch(),
  );

  doFetch = () => {
    setState({ ...getState(), status: 'loading', label, config, syncing: true, smartSorting: false });
    renderBlock();
    fetchTasks(taskSource, { includeCompleted: config.showCompleted })
      .then((tasks) => {
        setState({ ...getState(), status: 'ready', label, config, syncing: false, smartSorting: false, tasks });
        renderBlock();
      })
      .catch((err) => {
        setState({ ...getState(), status: 'ready', label, config, syncing: false, smartSorting: false, error: err instanceof Error ? err.message : String(err) });
        renderBlock();
      });
  };

  renderBlock = () => {
    render(buildBlockTemplate(getState(), taskSource, handlers), container);
  };

  return { doFetch };
}
