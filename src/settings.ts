/**
 * Settings module for the Obsidian Plugin.
 *
 * - `PluginSettings` defines the shape of persisted settings.
 * - `DEFAULT_SETTINGS` provides fallback values for missing or new fields.
 * - `SettingsTab` renders the settings UI and writes changes back via
 *   `plugin.saveSettings()`.
 *
 * Settings are persisted to `data.json` in the plugin directory via
 * Obsidian's `loadData()` / `saveData()`.
 */

import { App, Notice, PluginSettingTab, requestUrl, Setting } from 'obsidian';
import type ObsidianPlugin from '../main';
import {
  fetchModels,
  isLLMConfigured,
  type LLMConfig,
  type LLMProvider,
} from './llm';

export interface PluginSettings {
  textValue: string;
  folderSyncBasePath: string;
  llmProvider: LLMProvider;
  llmApiKey: string;
  llmBaseUrl: string;
  llmModel: string;
  llmModelUserStory: string;
  llmModelSmartSort: string;
  smartSortAdditionalContext: string;
  smartSortMaxTasksPerBatch: number;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  textValue: '',
  folderSyncBasePath: '',
  llmProvider: 'openrouter',
  llmApiKey: '',
  llmBaseUrl: '',
  llmModel: '',
  llmModelUserStory: '',
  llmModelSmartSort: '',
  smartSortAdditionalContext: '',
  smartSortMaxTasksPerBatch: 10,
};

export class SettingsTab extends PluginSettingTab {
  plugin: ObsidianPlugin;

  constructor(app: App, plugin: ObsidianPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'OmniFocus Sync' });

    new Setting(containerEl)
      .setName('Text value')
      .setDesc('Enter a value to store.')
      .addText((text) =>
        text
          .setPlaceholder('Type something...')
          .setValue(this.plugin.settings.textValue)
          .onChange(async (value) => {
            this.plugin.settings.textValue = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Folder sync base path')
      .setDesc(
        'Optional. Subfolder under which to create synced folders from OmniFocus (e.g. "OmniFocus"). Leave empty to use vault root.',
      )
      .addText((text) =>
        text
          .setPlaceholder('')
          .setValue(this.plugin.settings.folderSyncBasePath ?? '')
          .onChange(async (value) => {
            this.plugin.settings.folderSyncBasePath = value;
            await this.plugin.saveSettings();
          }),
      );

    containerEl.createEl('h2', { text: 'LLM (AI)' });

    const providerOptions: Record<LLMProvider, string> = {
      openrouter: 'OpenRouter',
      openai: 'OpenAI',
      ollama: 'Ollama',
      custom: 'Custom',
    };

    new Setting(containerEl)
      .setName('Provider')
      .setDesc('LLM provider for AI features.')
      .addDropdown((d) => {
        for (const [k, v] of Object.entries(providerOptions)) {
          d.addOption(k, v);
        }
        d.setValue(this.plugin.settings.llmProvider);
        d.onChange(async (value) => {
          this.plugin.settings.llmProvider = value as LLMProvider;
          await this.plugin.saveSettings();
          updateLLMVisibility();
        });
      });

    const apiKeySetting = new Setting(containerEl)
      .setName('API key')
      .setDesc('Required for OpenRouter and OpenAI. Not needed for Ollama.')
      .addText((text) => {
        text
          .setPlaceholder('sk-...')
          .setValue(this.plugin.settings.llmApiKey)
          .onChange(async (value) => {
            this.plugin.settings.llmApiKey = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.type = 'password';
      });

    const baseUrlSetting = new Setting(containerEl)
      .setName('Base URL')
      .setDesc('For Ollama: leave default or set custom (e.g. http://localhost:11434/v1). For Custom: required.')
      .addText((text) =>
        text
          .setPlaceholder('http://localhost:11434/v1')
          .setValue(this.plugin.settings.llmBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.llmBaseUrl = value;
            await this.plugin.saveSettings();
          }),
      );

    containerEl.createEl('h3', { text: 'Model' });

    const datalistId = 'llm-models-userstory';
    const datalistEl = containerEl.createEl('datalist', { attr: { id: datalistId } });
    const datalistSmartSortId = 'llm-models-smartsort';
    const datalistSmartSortEl = containerEl.createEl('datalist', {
      attr: { id: datalistSmartSortId },
    });

    const loadModels = async (targetDatalist: HTMLElement): Promise<void> => {
      const config: LLMConfig = {
        provider: (this.plugin.settings.llmProvider ?? 'openrouter') as LLMProvider,
        apiKey: this.plugin.settings.llmApiKey ?? '',
        baseUrl: this.plugin.settings.llmBaseUrl?.trim() || undefined,
      };
      if (!isLLMConfigured(config)) {
        new Notice('LLM is not configured. Set API key or base URL first.');
        return;
      }
      const requestAdapter = async (opts: {
        url: string;
        method?: string;
        headers?: Record<string, string>;
        throw?: boolean;
      }) => {
        const res = await requestUrl({
          url: opts.url,
          method: opts.method ?? 'GET',
          headers: opts.headers,
          throw: opts.throw ?? false,
        });
        return { status: res.status, json: res.json };
      };
      const models = await fetchModels(requestAdapter, config);
      if (models.length === 0) {
        new Notice('Could not load models. Check provider and credentials.');
        return;
      }
      targetDatalist.replaceChildren();
      for (const id of models) {
        const opt = targetDatalist.createEl('option', { attr: { value: id } });
        opt.textContent = id;
      }
      new Notice(`Loaded ${models.length} models.`);
    };

    new Setting(containerEl)
      .setName('Model')
      .setDesc('Model for AI features. Click Load models to fetch from provider.')
      .addText((text) => {
        text
          .setPlaceholder('e.g. gpt-4o, llama3.2')
          .setValue(this.plugin.settings.llmModelUserStory)
          .onChange(async (value) => {
            this.plugin.settings.llmModelUserStory = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.setAttribute('list', datalistId);
      })
      .addButton((btn) =>
        btn.setButtonText('Load models').onClick(async () => {
          btn.setDisabled(true);
          btn.setButtonText('Loading...');
          await loadModels(datalistEl);
          btn.setDisabled(false);
          btn.setButtonText('Load models');
        }),
      );

    new Setting(containerEl)
      .setName('Model (Smart sort)')
      .setDesc('Model for Smart Sort inbox suggestions.')
      .addText((text) => {
        text
          .setPlaceholder('e.g. gpt-4o, llama3.2')
          .setValue(this.plugin.settings.llmModelSmartSort)
          .onChange(async (value) => {
            this.plugin.settings.llmModelSmartSort = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.setAttribute('list', datalistSmartSortId);
      })
      .addButton((btn) =>
        btn.setButtonText('Load models').onClick(async () => {
          btn.setDisabled(true);
          btn.setButtonText('Loading...');
          await loadModels(datalistSmartSortEl);
          btn.setDisabled(false);
          btn.setButtonText('Load models');
        }),
      );

    new Setting(containerEl)
      .setName('Smart Sort: Additional context')
      .setDesc('Optional context for the LLM (e.g. "Focus on work projects", "Ignore personal items").')
      .addTextArea((text) =>
        text
          .setPlaceholder('')
          .setValue(this.plugin.settings.smartSortAdditionalContext ?? '')
          .onChange(async (value) => {
            this.plugin.settings.smartSortAdditionalContext = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Smart Sort: Max tasks per batch')
      .setDesc('Maximum tasks to process in one Smart Sort run (default 10).')
      .addText((text) =>
        text
          .setPlaceholder('10')
          .setValue(String(this.plugin.settings.smartSortMaxTasksPerBatch ?? 10))
          .onChange(async (value) => {
            const parsed = parseInt(value, 10);
            this.plugin.settings.smartSortMaxTasksPerBatch = isNaN(parsed) ? 10 : Math.max(1, parsed);
            await this.plugin.saveSettings();
          }),
      );

    const updateLLMVisibility = (): void => {
      const p = this.plugin.settings.llmProvider;
      const needsApiKey = p === 'openrouter' || p === 'openai' || p === 'custom';
      const needsBaseUrl = p === 'ollama' || p === 'custom';
      apiKeySetting.settingEl.style.display = needsApiKey ? '' : 'none';
      baseUrlSetting.settingEl.style.display = needsBaseUrl ? '' : 'none';
      if (p === 'custom') {
        apiKeySetting.setDesc('Optional for some endpoints.');
        baseUrlSetting.setDesc('Required. Base URL including /v1 (e.g. https://api.example.com/v1).');
      } else if (p === 'ollama') {
        baseUrlSetting.setDesc('Leave default or set custom (e.g. http://localhost:11434/v1).');
      } else {
        apiKeySetting.setDesc(p === 'openrouter' ? 'From openrouter.ai' : 'From platform.openai.com');
      }
    };
    updateLLMVisibility();
  }
}
