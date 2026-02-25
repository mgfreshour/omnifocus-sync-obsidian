/**
 * OmniFocus Obsidian integration.
 *
 * Registers the omnifocus code block processor, command, ribbon icon,
 * and auto-sync interval.
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
  parseBlockConfig,
  sourceLabel,
} from './omnifocus';
import type { OmniFocusTask, TaskSource } from './omnifocus';
import { AddTaskModal } from './add-task-modal';
import { smartSort } from './smart-sort';
import type { SmartSortItem } from './smart-sort';
import type { LLMPluginContext } from './llm';
import type { LLMProvider } from './llm';

/** Plugin context required for OmniFocus integration. */
export interface OmnifocusPluginContext {
  app: App;
  settings: PluginSettings;
  registerMarkdownCodeBlockProcessor(
    language: string,
    processor: (source: string, el: HTMLElement) => void | Promise<void>,
  ): void;
}

type OmnifocusBlockState = {
  status: 'loading' | 'ready';
  label: string;
  config: { source: TaskSource; showCompleted: boolean };
  syncing: boolean;
  smartSorting: boolean;
  tasks?: OmniFocusTask[];
  error?: string;
  /** Smart Sort suggestions; null = none; [] = cleared. */
  smartSortResults: SmartSortItem[] | null;
  /** Parse failure or LLM error message when Smart Sort fails. */
  smartSortError?: string;
};

/**
 * Register OmniFocus integration: code block processor for omnifocus blocks.
 */
export function registerOmniFocusIntegration(plugin: OmnifocusPluginContext): void {
  plugin.registerMarkdownCodeBlockProcessor('omnifocus', (source, el) => {
    const container = el.createDiv({ cls: 'omnifocus-container' });

    let config: { source: TaskSource; showCompleted: boolean } | null;
    try {
      config = parseBlockConfig(source);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      render(
        html`<p class="omnifocus-error">${message}</p>`,
        container,
      );
      return;
    }

    if (config === null) {
      render(
        html`
          <div class="omnifocus-usage">
            <p>OmniFocus — specify a source:</p>
            <ul>
              <li>inbox</li>
              <li>project: &lt;name&gt;</li>
              <li>tag: &lt;name&gt;</li>
            </ul>
            <p>Add "showCompleted" on a second line to include completed tasks.</p>
          </div>
        `,
        container,
      );
      return;
    }

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

    const onNoteToggle = (e: Event) => {
      e.stopPropagation();
      const target = e.target as HTMLElement;
      const li = target.closest('.omnifocus-task-item');
      const noteEl = li?.querySelector<HTMLElement>('.omnifocus-task-note');
      if (noteEl) {
        const isOpen = noteEl.style.display === 'none';
        noteEl.style.display = isOpen ? 'block' : 'none';
        target.textContent = isOpen ? '[-]' : '[+]';
      }
    };

    const onOmniFocusLinkClick = (taskId: string) => (e: Event) => {
      e.preventDefault();
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires -- electron is provided at runtime by Obsidian
        require('electron').shell.openExternal(`omnifocus:///task/${taskId}`);
      } catch {
        window.open(`omnifocus:///task/${taskId}`);
      }
    };

    const buildLLMContext = (): LLMPluginContext => ({
      getConfig: () => ({
        provider: (plugin.settings.llmProvider ?? 'openrouter') as LLMProvider,
        apiKey: plugin.settings.llmApiKey ?? '',
        baseUrl: plugin.settings.llmBaseUrl?.trim() || undefined,
        model: getLLMModel(plugin.settings, 'smartSort') || undefined,
      }),
      requestUrl: async (opts) => {
        const res = await requestUrl({
          url: opts.url,
          method: opts.method ?? 'GET',
          headers: opts.headers,
          body: opts.body,
          throw: opts.throw ?? false,
        });
        const resAny = res as {
          json: unknown;
          text: string | Promise<string>;
          status: number;
        };
        let json: unknown;
        const rawText = resAny.text;
        let text: string;
        if (
          rawText !== undefined &&
          rawText !== null &&
          typeof (rawText as { then?: unknown }).then === 'function'
        ) {
          text = await (rawText as Promise<string>);
        } else {
          text = typeof rawText === 'string' ? rawText : String(rawText ?? '');
        }
        if (text) {
          try {
            json = JSON.parse(text);
          } catch {
            json = null;
          }
        } else {
          const rawJson = resAny.json;
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
        if (opts.url?.includes('/chat/completions') && json) {
          const obj = json as Record<string, unknown>;
          const choices = obj?.choices as
            | Array<{ message?: { content?: unknown } }>
            | undefined;
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
        return { status: res.status, json: json ?? null };
      },
    });

    const renderBlock = () => {
      const s = state;
      const syncing = s.syncing;
      const smartSorting = s.smartSorting;
      const btnLabel = syncing ? 'Syncing...' : `Sync OmniFocus ${s.label}`;
      const smartSortLabel = smartSorting ? 'Smart sorting...' : 'Smart sort';
      const isInbox = taskSource.kind === 'inbox';
      const buttonsDisabled = syncing || smartSorting;

      const onSyncClick = () => {
        doFetch();
      };

      const onSmartSortClick = async () => {
        state = { ...state, smartSorting: true, smartSortError: undefined };
        renderBlock();
        try {
          const result = await smartSort(buildLLMContext(), plugin.settings);
          state = {
            ...state,
            smartSorting: false,
            smartSortResults: result.items,
            smartSortError: result.error,
          };
          if (result.items.length > 0) {
            new Notice(`Smart sort: ${result.items.length} suggestion(s).`);
          } else if (result.error) {
            new Notice(result.error);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          new Notice(`Smart sort error: ${message}`);
          console.error('Smart sort failed:', err);
          state = {
            ...state,
            smartSorting: false,
            smartSortResults: null,
            smartSortError: message,
          };
        }
        renderBlock();
      };

      const onAddClick = () => {
        new AddTaskModal(plugin.app, taskSource, async (title, note) => {
          await createTask(taskSource, title, note);
          new Notice(`Created task in ${s.label}.`);
          doFetch();
        }).open();
      };

      const onCheckboxChange = (task: OmniFocusTask) => async (e: Event) => {
        const checkbox = e.target as HTMLInputElement;
        checkbox.disabled = true;
        try {
          await completeTask(task.id);
          new Notice('Task completed.');
          doFetch();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('OmniFocus complete task failed:', err);
          new Notice(`OmniFocus error: ${message}`);
          checkbox.checked = false;
          checkbox.disabled = false;
        }
      };

      const onAccept = (item: SmartSortItem) => async () => {
        try {
          if (item.type === 'existing') {
            await moveTaskToProject(item.taskId, item.projectName);
          } else {
            try {
              await moveTaskToProject(item.taskId, item.projectName);
            } catch {
              const projects = await fetchProjectNames();
              const exists = projects.some(
                (p) => p.toLowerCase() === item.projectName.toLowerCase(),
              );
              if (!exists) {
                await createProject(item.projectName);
              }
              await moveTaskToProject(item.taskId, item.projectName);
            }
          }
          new Notice('Task moved to project.');
          state = {
            ...state,
            smartSortResults: (s.smartSortResults ?? []).filter(
              (x) => x.taskId !== item.taskId,
            ),
          };
          if ((state.smartSortResults?.length ?? 0) === 0) {
            state = { ...state, smartSortResults: null };
          }
          doFetch();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          new Notice(`Failed to move task: ${message}`);
          console.error('OmniFocus move task failed:', err);
        }
        renderBlock();
      };

      const onDecline = (item: SmartSortItem) => () => {
        state = {
          ...state,
          smartSortResults: (s.smartSortResults ?? []).filter(
            (x) => x.taskId !== item.taskId,
          ),
        };
        if ((state.smartSortResults?.length ?? 0) === 0) {
          state = { ...state, smartSortResults: null };
        }
        renderBlock();
      };

      const tasks = s.tasks ?? [];
      const sorted =
        tasks.length > 0
          ? [...tasks].sort(
              (a, b) => (a.completed ? 1 : 0) - (b.completed ? 1 : 0),
            )
          : [];

      render(
        html`
          <div class="omnifocus-btn-row">
            <button class="omnifocus-add-btn" ?disabled=${buttonsDisabled} @click=${onAddClick}>
              Add task
            </button>
            <button
              class="omnifocus-sync-btn"
              ?disabled=${buttonsDisabled}
              @click=${onSyncClick}
            >
              ${btnLabel}
            </button>
            ${isInbox
              ? html`
                  <button
                    class="omnifocus-smartsort-btn"
                    ?disabled=${buttonsDisabled}
                    @click=${onSmartSortClick}
                  >
                    ${smartSortLabel}
                  </button>
                `
              : ''}
          </div>
          <div class="omnifocus-list-wrapper">
            ${s.error
              ? html`<ul class="omnifocus-task-list">
                  <li class="omnifocus-error">${s.error}</li>
                </ul>`
              : sorted.length === 0
                ? html`<p class="omnifocus-empty">No tasks in ${s.label}.</p>`
                : html`<ul class="omnifocus-task-list">
                    ${sorted.map(
                      (task) => html`
                        <li
                          class=${task.completed
                            ? 'omnifocus-task-item omnifocus-task-item--completed'
                            : 'omnifocus-task-item'}
                        >
                          ${task.completed
                            ? html`<span
                                class="omnifocus-task-completed-marker"
                                title="Completed"
                                >☑</span
                              >`
                            : html`<input
                                type="checkbox"
                                class="omnifocus-task-checkbox"
                                title="Mark complete"
                                @change=${onCheckboxChange(task)}
                              />`}
                          <span class="omnifocus-task-name">${task.name}</span>
                          <a
                            class="omnifocus-task-link"
                            href="omnifocus:///task/${task.id}"
                            title="Open in OmniFocus"
                            @click=${onOmniFocusLinkClick(task.id)}
                            >↗</a>
                          ${task.note
                            ? html`
                                <span
                                  class="omnifocus-task-note-toggle"
                                  @click=${onNoteToggle}
                                  >[+]</span
                                >
                                <div
                                  class="omnifocus-task-note"
                                  style="display:none"
                                  >${task.note}</div
                                >
                              `
                            : ''}
                        </li>
                      `,
                    )}
                  </ul>`}
          </div>
          ${s.smartSortError && (s.smartSortResults?.length ?? 0) === 0
            ? html`
                <div class="omnifocus-smartsort-results omnifocus-smartsort-error">
                  <h4 class="omnifocus-smartsort-heading">Smart Sort</h4>
                  <p class="omnifocus-smartsort-error-text">${s.smartSortError}</p>
                </div>
              `
            : s.smartSortResults && s.smartSortResults.length > 0
              ? html`
                  <div class="omnifocus-smartsort-results">
                    <h4 class="omnifocus-smartsort-heading">Smart Sort suggestions</h4>
                    ${s.smartSortError
                      ? html`<p class="omnifocus-smartsort-info">${s.smartSortError}</p>`
                      : ''}
                    <ul class="omnifocus-smartsort-list">
                      ${s.smartSortResults.map(
                        (item) => html`
                          <li class="omnifocus-smartsort-item">
                            <span class="omnifocus-smartsort-task">${item.taskName}</span>
                            <span class="omnifocus-smartsort-arrow">→</span>
                            <span class="omnifocus-smartsort-dest">${item.projectName}</span>
                            ${item.reasoning
                              ? html`
                                  <span class="omnifocus-smartsort-reason"
                                    >(${item.reasoning})</span
                                  >
                                `
                              : ''}
                            <button
                              class="omnifocus-smartsort-accept-btn"
                              @click=${onAccept(item)}
                            >
                              Accept
                            </button>
                            <button
                              class="omnifocus-smartsort-decline-btn"
                              @click=${onDecline(item)}
                            >
                              Decline
                            </button>
                          </li>
                        `,
                      )}
                    </ul>
                  </div>
                `
              : ''}
        `,
        container,
      );
    };

    const doFetch = async () => {
      state = {
        ...state,
        status: 'loading',
        label,
        config,
        syncing: true,
        smartSorting: false,
      };
      renderBlock();

      try {
        const tasks = await fetchTasks(taskSource, {
          includeCompleted: config.showCompleted,
        });
        state = {
          ...state,
          status: 'ready',
          label,
          config,
          syncing: false,
          smartSorting: false,
          tasks,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        state = {
          ...state,
          status: 'ready',
          label,
          config,
          syncing: false,
          smartSorting: false,
          error: message,
        };
      }
      renderBlock();
    };

    doFetch();
  });
}
