import { Plugin, requestUrl } from 'obsidian';
import { DEFAULT_SETTINGS, getLLMModel, SettingsTab } from './src/settings';
import type { PluginSettings } from './src/settings';
import { registerOmniFocusIntegration } from './src/omnifocus-integration';
import { runSyncFoldersAndNotify } from './src/sync-folders';
import type { LLMPluginContext } from './src/llm';
import type { LLMProvider } from './src/llm';

export default class ObsidianPlugin extends Plugin {
  settings!: PluginSettings;

  async onload() {
    console.log('Loading Obsidian Plugin');

    await this.loadSettings();
    this.addSettingTab(new SettingsTab(this.app, this));

    registerOmniFocusIntegration(this);

    this.addCommand({
      id: 'sync-folders',
      name: 'Sync folders from OmniFocus',
      callback: () => {
        const llmContext: LLMPluginContext = {
          getConfig: () => ({
            provider: (this.settings.llmProvider ?? 'openrouter') as LLMProvider,
            apiKey: this.settings.llmApiKey ?? '',
            baseUrl: this.settings.llmBaseUrl?.trim() || undefined,
            model: getLLMModel(this.settings, 'syncFolders') || undefined,
          }),
          requestUrl: async (opts) => {
            const res = await requestUrl({
              url: opts.url,
              method: opts.method ?? 'GET',
              headers: opts.headers,
              body: opts.body,
              throw: opts.throw ?? false,
            });
            const resAny = res as { json: unknown };
            const rawJson = resAny.json;
            const json =
              typeof rawJson === 'object' && rawJson !== null && typeof (rawJson as Promise<unknown>).then === 'function'
                ? await (rawJson as Promise<unknown>)
                : rawJson;
            return { status: res.status, json: json ?? null };
          },
        };
        runSyncFoldersAndNotify(this.app, this.settings, llmContext);
      },
    });
  }

  onunload() {
    console.log('Unloading Obsidian Plugin');
  }

  async loadSettings() {
    const raw = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, raw ?? {});
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
