import {
  DEFAULT_SETTINGS,
  getLLMModel,
  LLM_OVERRIDE_FEATURES,
} from './settings';
import type { PluginSettings } from './settings';

describe('getLLMModel', () => {
  const baseSettings: PluginSettings = {
    ...DEFAULT_SETTINGS,
    llmModel: 'gpt-4o',
    llmModelOverrides: {
      userStory: '',
      smartSort: 'llama3.2',
      syncFolders: '',
    },
  };

  it('returns default model for feature "default"', () => {
    expect(getLLMModel(baseSettings, 'default')).toBe('gpt-4o');
  });

  it('returns override when feature override is set', () => {
    expect(getLLMModel(baseSettings, 'smartSort')).toBe('llama3.2');
  });

  it('returns default model when feature override is empty string', () => {
    expect(getLLMModel(baseSettings, 'userStory')).toBe('gpt-4o');
  });

  it('returns default model when feature override is whitespace-only', () => {
    const s = {
      ...baseSettings,
      llmModelOverrides: { ...baseSettings.llmModelOverrides, userStory: '   ' },
    };
    expect(getLLMModel(s, 'userStory')).toBe('gpt-4o');
  });

  it('trims default model', () => {
    const s = { ...baseSettings, llmModel: '  gpt-4o  ' };
    expect(getLLMModel(s, 'default')).toBe('gpt-4o');
  });

  it('returns empty string when default model is empty and no override', () => {
    const s = { ...baseSettings, llmModel: '' };
    expect(getLLMModel(s, 'syncFolders')).toBe('');
  });
});

describe('DEFAULT_SETTINGS', () => {
  it('has llmModelOverrides with all keys from LLM_OVERRIDE_FEATURES', () => {
    const ids = LLM_OVERRIDE_FEATURES.map((f) => f.id);
    for (const id of ids) {
      expect(DEFAULT_SETTINGS.llmModelOverrides).toHaveProperty(id);
      expect(DEFAULT_SETTINGS.llmModelOverrides[id]).toBe('');
    }
  });

  it('has expected default values for key fields', () => {
    expect(DEFAULT_SETTINGS.llmProvider).toBe('openrouter');
    expect(DEFAULT_SETTINGS.llmApiKey).toBe('');
    expect(DEFAULT_SETTINGS.llmModel).toBe('');
    expect(DEFAULT_SETTINGS.folderSyncBasePath).toBe('');
    expect(DEFAULT_SETTINGS.smartSortMaxTasksPerBatch).toBe(10);
  });
});
