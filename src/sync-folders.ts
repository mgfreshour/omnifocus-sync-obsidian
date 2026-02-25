/**
 * Sync folder structure from OmniFocus to Obsidian vault.
 *
 * One-way sync: creates vault folders to match OmniFocus project hierarchy.
 * Each project folder gets a .md file with frontmatter (sticker, description).
 */

import { Notice } from 'obsidian';
import type { App } from 'obsidian';
import type { PluginSettings } from './settings';
import { fetchProjectPaths, fetchProjectPathsWithNotes } from './omnifocus';
import { deriveFolderPathsToCreate } from './sync-folders-paths';
import { buildNewFrontmatter, updateContentFrontmatter } from './sync-folders-frontmatter';

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

/**
 * Sync folder structure from OmniFocus to the Obsidian vault.
 *
 * Fetches project paths from OmniFocus, derives all folder paths (including
 * prefixes), optionally prepends the base path from settings, and creates
 * each folder. Then creates or updates a .md file in each project folder
 * with frontmatter (sticker, description from project note).
 * Idempotent: skips folders that already exist; never overwrites existing sticker.
 *
 * @param app - Obsidian app (for vault).
 * @param settings - Plugin settings (folderSyncBasePath).
 * @returns Counts of created and skipped folders.
 */
export async function syncFoldersFromOmniFocus(
  app: App,
  settings: PluginSettings,
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
  for (const { path: projectPath, note } of projectsWithNotes) {
    const fullFolderPath = base ? `${base}/${projectPath}` : projectPath;
    const fileName = pathBasename(projectPath) + '.md';
    const filePath = `${fullFolderPath}/${fileName}`;

    try {
      const existingFile = app.vault.getFileByPath(filePath);
      if (!existingFile) {
        const content = buildNewFrontmatter(note) + '\n';
        await app.vault.create(filePath, content);
      } else {
        const content = await app.vault.read(existingFile);
        const updated = updateContentFrontmatter(content, note);
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
 */
export async function runSyncFoldersAndNotify(
  app: App,
  settings: PluginSettings,
): Promise<void> {
  try {
    const { created, skipped } = await syncFoldersFromOmniFocus(app, settings);
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
