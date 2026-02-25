/**
 * Sync folder structure from OmniFocus to Obsidian vault.
 *
 * One-way sync: creates vault folders to match OmniFocus project hierarchy.
 * Each project folder gets a .md file with frontmatter (sticker, description).
 * When a project has no note, an LLM can suggest a description from its tasks;
 * that description is written to OmniFocus and to frontmatter.
 */

import { Notice } from 'obsidian';
import type { App } from 'obsidian';
import { getLLMModel } from './settings';
import type { PluginSettings } from './settings';
import {
  fetchProjectPaths,
  fetchProjectPathsWithNotes,
  fetchTasks,
  updateProjectNote,
} from './omnifocus';
import { deriveFolderPathsToCreate } from './sync-folders-paths';
import { buildNewFrontmatter, updateContentFrontmatter } from './sync-folders-frontmatter';
import { simpleChat, isLLMConfigured } from './llm';
import type { LLMPluginContext } from './llm';

export { deriveFolderPathsToCreate } from './sync-folders-paths';
export {
  buildNewFrontmatter,
  escapeDescriptionForYaml,
  updateContentFrontmatter,
} from './sync-folders-frontmatter';

/**
 * Normalize base path: trim, remove leading/trailing slashes, no double slashes.
 */
function normalizeBasePath(base: string): string {
  return base
    .trim()
    .replace(/\/+/g, '/')
    .replace(/^\//, '')
    .replace(/\/$/, '');
}

/** Basename of a path (last segment). */
function pathBasename(path: string): string {
  const segments = path.replace(/\/$/, '').split('/');
  return segments[segments.length - 1] ?? 'untitled';
}

const PROJECT_DESCRIPTION_SYSTEM = `You are a productivity assistant. Given a project name and its tasks (with optional notes), suggest a single short sentence that describes the project's purpose or outcome. Return only that sentence, no quotes, no prefix like "Description:".`;

/** Max task lines to send to the LLM to avoid token overflow. */
const MAX_TASKS_FOR_DESCRIPTION = 50;

/** Max characters of each task note to include. */
const MAX_NOTE_PREVIEW = 200;

/**
 * Use LLM to suggest a project description from project name and tasks.
 * Returns trimmed reply or null on failure/empty.
 */
async function suggestProjectDescription(
  ctx: LLMPluginContext,
  projectName: string,
  tasks: { name: string; note: string }[],
  model?: string,
): Promise<string | null> {
  const lines = tasks.slice(0, MAX_TASKS_FOR_DESCRIPTION).map((t) => {
    const notePreview =
      (t.note ?? '').trim().slice(0, MAX_NOTE_PREVIEW) ||
      '';
    return notePreview ? `- ${t.name}\n  ${notePreview}` : `- ${t.name}`;
  });
  const userMessage = `Project: ${projectName}\n\nTasks:\n${lines.join('\n')}`;
  const reply = await simpleChat(ctx, userMessage, {
    systemPrompt: PROJECT_DESCRIPTION_SYSTEM,
    model,
    max_tokens: 120,
    temperature: 0.3,
  });
  const trimmed = typeof reply === 'string' ? reply.trim() : '';
  if (trimmed.length === 0 && (reply !== undefined && reply !== '')) {
    console.log(
      '[omnifocus-sync] LLM raw reply (not a string or empty):',
      typeof reply,
      JSON.stringify(reply).slice(0, 200),
    );
  }
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Sync folder structure from OmniFocus to the Obsidian vault.
 *
 * Fetches project paths from OmniFocus, derives all folder paths (including
 * prefixes), optionally prepends the base path from settings, and creates
 * each folder. Then creates or updates a .md file in each project folder
 * with frontmatter (sticker, description from project note).
 * When a project has no note, if LLM context is provided and configured,
 * tasks for that project are fetched and the LLM suggests a description;
 * that description is written to OmniFocus and to frontmatter.
 * Idempotent: skips folders that already exist; never overwrites existing sticker.
 *
 * @param app - Obsidian app (for vault).
 * @param settings - Plugin settings (folderSyncBasePath, LLM model via getLLMModel(settings, 'syncFolders')).
 * @param llmContext - Optional LLM context for generating descriptions when note is empty.
 * @returns Counts of created and skipped folders.
 */
export async function syncFoldersFromOmniFocus(
  app: App,
  settings: PluginSettings,
  llmContext?: LLMPluginContext,
): Promise<{ created: number; skipped: number }> {
  const projectPaths = await fetchProjectPaths();
  const folderPaths = deriveFolderPathsToCreate(projectPaths);

  const base = normalizeBasePath(settings.folderSyncBasePath ?? '');
  const fullPaths = base
    ? folderPaths.map((p) => `${base}/${p}`)
    : folderPaths;

  let created = 0;
  let skipped = 0;

  for (const path of fullPaths) {
    try {
      await app.vault.createFolder(path);
      created++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('already exists') || msg.includes('Folder already exists')) {
        skipped++;
      } else {
        throw err;
      }
    }
  }

  const projectsWithNotes = await fetchProjectPathsWithNotes();
  const useLLMForEmptyNote =
    llmContext != null && isLLMConfigured(llmContext.getConfig());
  const llmReason =
    llmContext == null
      ? 'no LLM context passed'
      : !isLLMConfigured(llmContext.getConfig())
        ? 'LLM not configured (check API key / base URL)'
        : 'enabled';
  console.log('[omnifocus-sync] Sync folders: LLM for empty notes', llmReason);

  for (const { path: projectPath, note } of projectsWithNotes) {
    let description = (note ?? '').trim();
    if (description.length === 0 && useLLMForEmptyNote) {
      const projectName = pathBasename(projectPath);
      console.log('[omnifocus-sync] Project has no note, asking LLM:', projectPath);
      try {
        const tasks = await fetchTasks(
          { kind: 'project', name: projectName },
          { includeCompleted: true },
        );
        console.log('[omnifocus-sync] Fetched', tasks.length, 'tasks for', projectPath);
        const suggested = await suggestProjectDescription(
          llmContext,
          projectName,
          tasks.map((t) => ({ name: t.name, note: t.note ?? '' })),
          getLLMModel(settings, 'syncFolders') || undefined,
        );
        if (suggested) {
          await updateProjectNote(projectName, suggested);
          console.log(
            '[omnifocus-sync] Updated project description:',
            projectPath,
            '->',
            suggested,
          );
          description = suggested;
        } else {
          console.log(
            '[omnifocus-sync] LLM returned no description for',
            projectPath,
            ', using TODO',
          );
        }
      } catch (err) {
        console.warn(
          '[omnifocus-sync] LLM description for project failed:',
          projectPath,
          err,
        );
      }
    }
    if (description.length === 0) {
      description = 'TODO';
      if (!useLLMForEmptyNote) {
        console.log(
          '[omnifocus-sync] Using TODO for',
          projectPath,
          '(LLM disabled or not configured)',
        );
      }
    }

    const fullFolderPath = base ? `${base}/${projectPath}` : projectPath;
    const fileName = pathBasename(projectPath) + '.md';
    const filePath = `${fullFolderPath}/${fileName}`;

    try {
      const existingFile = app.vault.getFileByPath(filePath);
      if (!existingFile) {
        const content = buildNewFrontmatter(description) + '\n';
        await app.vault.create(filePath, content);
      } else {
        const content = await app.vault.read(existingFile);
        const updated = updateContentFrontmatter(content, description);
        await app.vault.modify(existingFile, updated);
      }
    } catch (err) {
      console.error('[omnifocus-sync] Failed to create/update project file:', filePath, err);
      throw err;
    }
  }

  return { created, skipped };
}

/**
 * Run sync and show a Notice with the result or error.
 *
 * @param llmContext - Optional. When provided and configured, projects with no note get an LLM-generated description (written to OmniFocus and frontmatter).
 */
export async function runSyncFoldersAndNotify(
  app: App,
  settings: PluginSettings,
  llmContext?: LLMPluginContext,
): Promise<void> {
  try {
    const { created, skipped } = await syncFoldersFromOmniFocus(
      app,
      settings,
      llmContext,
    );
    const parts: string[] = [];
    if (created > 0) parts.push(`${created} folder(s) created`);
    if (skipped > 0) parts.push(`${skipped} already existed`);
    if (parts.length > 0) {
      new Notice(`Sync folders: ${parts.join(', ')}.`);
    } else {
      new Notice('Sync folders: no folders to create.');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    new Notice(`OmniFocus sync error: ${message}`);
    console.error('[omnifocus-sync] sync folders failed:', err);
  }
}
