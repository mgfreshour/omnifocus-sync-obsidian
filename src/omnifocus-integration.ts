/**
 * OmniFocus Obsidian integration.
 *
 * Registers the omnifocus code block processor, command, ribbon icon,
 * and auto-sync interval.
 */

import { html, render } from 'lit';
import { parseBlockConfig } from './omnifocus';
import { createOmnifocusBlock } from './omnifocus-block';
import type { OmnifocusPluginContext } from './omnifocus-block';

export type { OmnifocusPluginContext } from './omnifocus-block';

/**
 * Register OmniFocus integration: code block processor for omnifocus blocks.
 */
export function registerOmniFocusIntegration(plugin: OmnifocusPluginContext): void {
  plugin.registerMarkdownCodeBlockProcessor('omnifocus', (source, el) => {
    const container = el.createDiv({ cls: 'omnifocus-container' });

    let config: { source: import('./omnifocus').TaskSource; showCompleted: boolean } | null;
    try {
      config = parseBlockConfig(source);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      render(html`<p class="omnifocus-error">${message}</p>`, container);
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

    const block = createOmnifocusBlock(container, config, plugin);
    block.doFetch();
  });
}
