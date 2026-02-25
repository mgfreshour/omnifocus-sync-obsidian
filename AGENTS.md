# Obsidian Plugin - Codebase Context

## Project Overview

An Obsidian community plugin that integrates with OmniFocus 4 on macOS. It fetches
tasks from OmniFocus via AppleScript and displays them inline in markdown code blocks.
Supports inbox, project, and tag sources with fuzzy substring matching.

See `manifest.json` and `package.json` for ID, version, and scripts.

## Before completing work

**For every feature or code change, run `pnpm test` and `pnpm lint` (or `pnpm lint:fix`); fix any failures before considering the work complete.** Both must pass before marking a task done.

## Repository

Entry: `main.ts`. Feature code in `src/`. Config in repo root; use the file explorer or `package.json` when needed.

## OmniFocus Integration (`src/omnifocus.ts`)

Communicates with OmniFocus 4 via `osascript` (AppleScript). See
[docs/omnifocus-applescript.md](docs/omnifocus-applescript.md) for the full
AppleScript reference, gotchas, and performance notes.

Key exports:
- **`TaskSource`** — discriminated union: `inbox`, `project: <name>`, `tag: <name>`
- **`parseSource(input)`** — parses code-block body into a `TaskSource`
- **`resolveName(query, candidates, entityLabel)`** — fuzzy substring matching
  with exact → single substring → ambiguous → no match error flow
- **`fetchTasks(source)`** — resolves name, builds AppleScript, runs osascript
- **`fetchProjectNames()` / `fetchTagNames()`** — list all projects/tags
- **`sourceLabel(source)`** — human-readable label for display

## Entry Point: main.ts

Exports a default class extending `Plugin`. Key functionality:
- **Settings** — sync interval, persisted via `loadData`/`saveData`
- **Command palette** — "Fetch OmniFocus Inbox" command
- **Ribbon icon** — "Sync OmniFocus Inbox" button
- **Auto-sync interval** — configurable periodic inbox sync
- **Code block processor** — `omnifocus` fenced code blocks render inline task
  lists with sync buttons. Parses source, fetches tasks, displays errors.
- **`syncInbox()`** — fetches inbox and writes to a markdown file

Key Obsidian lifecycle hooks:
- **`onload()`** — called when the plugin is enabled. Register commands, views,
  settings tabs, ribbon icons, and event listeners here.
- **`onunload()`** — called when the plugin is disabled. Clean up all resources
  (intervals, event listeners, DOM mutations, registered views).

## Build, tests, lint

- **Build**: `pnpm build` (typecheck + bundle). Config: `esbuild.config.mjs`, `tsconfig.json`.
- **Testing**: Jest; tests co-located (`*.test.ts`). Run `pnpm test`. See `jest.config.js` if needed.
- **Linting**: ESLint + @typescript-eslint. Run `pnpm lint` / `pnpm lint:fix`. Config: `.eslintrc.json`.
- **Manual QA**: `scripts/generate-test-vault.mjs` (run after build).
- See `package.json` scripts for the full list.

## Obsidian API

Use Obsidian plugin API docs; common hooks: `addCommand`, `addSettingTab`, `app.vault`, `app.metadataCache`, `app.workspace`, `loadData`/`saveData`.

## Common Patterns for New Features

### Adding settings

1. Define a settings interface and defaults
2. Create a class extending `PluginSettingTab`
3. Call `this.addSettingTab(new MySettingTab(this.app, this))` in `onload()`
4. Use `this.loadData()` / `this.saveData()` for persistence

### Adding commands

```typescript
this.addCommand({
  id: 'my-command',
  name: 'Do something',
  callback: () => { /* ... */ },
});
```

### Adding views

1. Create a class extending `ItemView`
2. Call `this.registerView(VIEW_TYPE, (leaf) => new MyView(leaf))` in `onload()`
3. Activate with `this.app.workspace.getLeaf().setViewState({ type: VIEW_TYPE })`

---

# Obsidian Plugin Development Rules

## TypeScript Best Practices

- Use TypeScript strict mode features
- Prefer explicit types over `any`
- Use interfaces for object shapes
- Use enums for fixed sets of constants
- Leverage type inference where appropriate
- Use `readonly` for immutable properties
- Prefer `const` assertions for literal types

## Obsidian API Usage

- Always extend the `Plugin` class from `obsidian`
- Use `this.app` to access Obsidian's app instance
- Use `this.addCommand()` for commands
- Use `this.addSettingTab()` for settings UI
- Use `this.addRibbonIcon()` for ribbon icons
- Use `this.registerView()` for custom views
- Clean up resources in `onunload()`
- Use `this.app.vault` for file operations
- Use `this.app.metadataCache` for metadata operations
- Use `this.app.workspace` for UI operations

## Code Style

- Use 2 spaces for indentation
- Use single quotes for strings (unless double quotes are needed)
- Use semicolons
- Use trailing commas in multi-line objects/arrays
- Use meaningful variable and function names
- Keep functions focused and small
- Add JSDoc comments for public APIs

## File Organization

- `main.ts` is the entry point only; feature modules (settings, commands, views, etc.) belong in `src/`
- Organize related functionality into modules in `src/`
- Use `__tests__/` directories for test files
- Name test files with `.spec.ts` or `.test.ts` extensions
- Keep styles in `styles.css` or separate CSS files

## Testing Requirements

- **Run `pnpm test` and `pnpm lint` for every change** (see Before completing work above).
- Write unit tests for utility functions
- Mock Obsidian API objects in tests
- Test error handling paths
- Aim for meaningful test coverage
- Use descriptive test names

## Error Handling

- Use try-catch blocks for async operations
- Provide meaningful error messages
- Log errors appropriately
- Handle edge cases gracefully

## Performance

- Avoid unnecessary re-renders
- Use debouncing for frequent operations
- Cache expensive computations
- Clean up event listeners and timers

## Documentation

- Document public APIs with JSDoc
- Keep README.md up to date
- Document complex algorithms
- Include usage examples in comments

## UI Rendering

- **Use lit-html for all UI**. Use `html` and `render` from `lit` for templating custom UI (modals, code block content, views, etc.).
- Prefer `html` template literals with `render(template, container)` over imperative DOM APIs or Obsidian's `Setting` component for custom layouts.
- Use `@click`, `@input`, `@change` for event handlers; `?disabled`, `?checked`, `?selected` for boolean attributes; `.value`, `.checked` for property binding.
- Examples: `omnifocus-integration.ts`, `add-task-modal.ts`.

## Obsidian Plugin Development Guidelines

- Follow Obsidian's plugin development best practices
- Test plugins in both desktop and mobile (if applicable)
- Handle vault state changes gracefully
- Respect user settings and preferences
- Use Obsidian's built-in UI components when possible
- Follow Obsidian's design patterns and conventions

## References

- [Obsidian Plugin API Documentation](https://docs.obsidian.md/Plugins)
- [Obsidian Plugin Development Guide](https://docs.obsidian.md/Plugins/Getting+started)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [OmniFocus AppleScript + Node.js Reference](docs/omnifocus-applescript.md) — gotchas, working queries, performance notes
