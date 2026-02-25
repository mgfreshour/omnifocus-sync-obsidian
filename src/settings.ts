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

/** Features that can have an optional LLM model override. Single source of truth for UI and map keys. */
export const LLM_OVERRIDE_FEATURES = [
  { id: 'userStory' as const, label: 'User story' },
  { id: 'smartSort' as const, label: 'Smart sort' },
  { id: 'syncFolders' as const, label: 'Sync folders' },
] as const;

export type LLMFeatureOverride = (typeof LLM_OVERRIDE_FEATURES)[number]['id'];
export type LLMFeature = 'default' | LLMFeatureOverride;

function defaultLlmModelOverrides(): Record<LLMFeatureOverride, string> {
  const out = {} as Record<LLMFeatureOverride, string>;
  for (const { id } of LLM_OVERRIDE_FEATURES) {
    out[id] = '';
  }
  return out;
}

export interface PluginSettings {
  textValue: string;
  folderSyncBasePath: string;
  llmProvider: LLMProvider;
  llmApiKey: string;
  llmBaseUrl: string;
  llmModel: string;
  llmModelOverrides: Record<LLMFeatureOverride, string>;
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
  llmModelOverrides: defaultLlmModelOverrides(),
  smartSortAdditionalContext: '',
  smartSortMaxTasksPerBatch: 10,
};

/**
 * Returns the effective LLM model for a feature: default model or the feature's override.
 */
export function getLLMModel(settings: PluginSettings, feature: LLMFeature): string {
  const defaultModel = settings.llmModel?.trim() ?? '';
  if (feature === 'default') {
    return defaultModel;
  }
  const override = settings.llmModelOverrides[feature]?.trim();
  return override || defaultModel;
}

export class SettingsTab extends PluginSettingTab {
  plugin: ObsidianPlugin;
  private apiKeySetting!: Setting;
  private baseUrlSetting!: Setting;
  private datalistId = 'llm-models-default';
  private datalistEl!: HTMLElement;

  constructor(app: App, plugin: ObsidianPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    this.containerEl.empty();
    this.renderHeader();
    this.renderGeneralSettings();
    this.renderLLMProviderAndCreds();
    this.renderLLMModelAndOverrides();
    this.renderSmartSortSettings();
    this.updateLLMVisibility();
  }

  private renderHeader(): void {
    this.containerEl.createEl('h2', { text: 'OmniFocus Sync' });
  }

  private renderGeneralSettings(): void {
    new Setting(this.containerEl)
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

    new Setting(this.containerEl)
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
  }

  private renderLLMProviderAndCreds(): void {
    this.containerEl.createEl('h2', { text: 'LLM (AI)' });

    const providerOptions: Record<LLMProvider, string> = {
      openrouter: 'OpenRouter',
      openai: 'OpenAI',
      ollama: 'Ollama',
      custom: 'Custom',
    };

    new Setting(this.containerEl)
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
          this.updateLLMVisibility();
        });
      });

    this.apiKeySetting = new Setting(this.containerEl)
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

    this.baseUrlSetting = new Setting(this.containerEl)
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

    this.datalistEl = this.containerEl.createEl('datalist', { attr: { id: this.datalistId } });
  }

  private async loadModels(): Promise<void> {
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
    this.datalistEl.replaceChildren();
    for (const id of models) {
      const opt = this.datalistEl.createEl('option', { attr: { value: id } });
      opt.textContent = id;
    }
    new Notice(`Loaded ${models.length} models.`);
  }

  private renderLLMModelAndOverrides(): void {
    new Setting(this.containerEl)
      .setName('Default model')
      .setDesc('Model used for all AI features unless overridden below.')
      .addText((text) => {
        text
          .setPlaceholder('e.g. gpt-4o, llama3.2')
          .setValue(this.plugin.settings.llmModel)
          .onChange(async (value) => {
            this.plugin.settings.llmModel = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.setAttribute('list', this.datalistId);
      })
      .addButton((btn) =>
        btn.setButtonText('Load models').onClick(async () => {
          btn.setDisabled(true);
          btn.setButtonText('Loading...');
          await this.loadModels();
          btn.setDisabled(false);
          btn.setButtonText('Load models');
        }),
      );

    const details = this.containerEl.createEl('details');
    details.createEl('summary', { text: 'Override model per feature' });
    const overridesWrap = details.createDiv();
    for (const { id, label } of LLM_OVERRIDE_FEATURES) {
      new Setting(overridesWrap)
        .setName(label)
        .setDesc(`Optional. Override the default model for ${label}.`)
        .addText((text) => {
          text
            .setPlaceholder('Leave empty to use default')
            .setValue(this.plugin.settings.llmModelOverrides[id] ?? '')
            .onChange(async (value) => {
              this.plugin.settings.llmModelOverrides = {
                ...this.plugin.settings.llmModelOverrides,
                [id]: value,
              };
              await this.plugin.saveSettings();
            });
          text.inputEl.setAttribute('list', this.datalistId);
        });
    }
  }

  private renderSmartSortSettings(): void {
    new Setting(this.containerEl)
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

    new Setting(this.containerEl)
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
  }

  private updateLLMVisibility(): void {
    const p = this.plugin.settings.llmProvider;
    const needsApiKey = p === 'openrouter' || p === 'openai' || p === 'custom';
    const needsBaseUrl = p === 'ollama' || p === 'custom';
    this.apiKeySetting.settingEl.style.display = needsApiKey ? '' : 'none';
    this.baseUrlSetting.settingEl.style.display = needsBaseUrl ? '' : 'none';
    if (p === 'custom') {
      this.apiKeySetting.setDesc('Optional for some endpoints.');
      this.baseUrlSetting.setDesc('Required. Base URL including /v1 (e.g. https://api.example.com/v1).');
    } else if (p === 'ollama') {
      this.baseUrlSetting.setDesc('Leave default or set custom (e.g. http://localhost:11434/v1).');
    } else {
      this.apiKeySetting.setDesc(p === 'openrouter' ? 'From openrouter.ai' : 'From platform.openai.com');
    }
  }
}
