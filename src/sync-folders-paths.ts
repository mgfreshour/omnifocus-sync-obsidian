/**
 * Pure path derivation for folder sync (no Obsidian dependency).
 */

/**
 * Derive all folder paths to create from a list of project paths.
 *
 * For each project path (e.g. "Work/Projects/project-a"), adds every prefix
 * and the full path. Returns unique paths sorted by depth (shallowest first).
 *
 * @param projectPaths - Full paths to projects from OmniFocus.
 * @returns Sorted, unique folder paths to create.
 */
export function deriveFolderPathsToCreate(projectPaths: string[]): string[] {
  const set = new Set<string>();
  for (const p of projectPaths) {
    const trimmed = p.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('/').filter(Boolean);
    for (let i = 1; i <= parts.length; i++) {
      set.add(parts.slice(0, i).join('/'));
    }
  }
  const list = [...set];
  list.sort((a, b) => {
    const depthA = (a.match(/\//g) ?? []).length;
    const depthB = (b.match(/\//g) ?? []).length;
    return depthA - depthB;
  });
  return list;
}
