import type { LLMConfig } from './llm';
import {
  fetchModels,
  isLLMConfigured,
  resolveChatCompletionsBaseUrl,
} from './llm';

describe('isLLMConfigured', () => {
  it('returns true for openrouter with apiKey', () => {
    expect(isLLMConfigured({ provider: 'openrouter', apiKey: 'sk-x' })).toBe(true);
  });

  it('returns false for openrouter without apiKey', () => {
    expect(isLLMConfigured({ provider: 'openrouter', apiKey: '' })).toBe(false);
  });

  it('returns false for openrouter with whitespace-only apiKey', () => {
    expect(isLLMConfigured({ provider: 'openrouter', apiKey: '   ' })).toBe(false);
  });

  it('returns true for openai with apiKey', () => {
    expect(isLLMConfigured({ provider: 'openai', apiKey: 'sk-x' })).toBe(true);
  });

  it('returns false for openai without apiKey', () => {
    expect(isLLMConfigured({ provider: 'openai', apiKey: '' })).toBe(false);
  });

  it('returns true for ollama regardless of apiKey', () => {
    expect(isLLMConfigured({ provider: 'ollama', apiKey: '' })).toBe(true);
    expect(isLLMConfigured({ provider: 'ollama', apiKey: 'x' })).toBe(true);
  });

  it('returns true for custom with baseUrl', () => {
    expect(
      isLLMConfigured({ provider: 'custom', apiKey: '', baseUrl: 'https://api.example.com' }),
    ).toBe(true);
  });

  it('returns false for custom without baseUrl', () => {
    expect(isLLMConfigured({ provider: 'custom', apiKey: '', baseUrl: '' })).toBe(false);
  });

  it('returns false for custom with whitespace-only baseUrl', () => {
    expect(
      isLLMConfigured({ provider: 'custom', apiKey: '', baseUrl: '   ' }),
    ).toBe(false);
  });

  it('returns false for unknown provider', () => {
    expect(
      isLLMConfigured({ provider: 'unknown' as LLMConfig['provider'], apiKey: 'x' }),
    ).toBe(false);
  });
});

describe('resolveChatCompletionsBaseUrl', () => {
  it('returns openrouter URL for openrouter provider', () => {
    expect(
      resolveChatCompletionsBaseUrl({ provider: 'openrouter', apiKey: 'x' }),
    ).toBe('https://openrouter.ai/api/v1');
  });

  it('returns openai URL for openai provider', () => {
    expect(
      resolveChatCompletionsBaseUrl({ provider: 'openai', apiKey: 'x' }),
    ).toBe('https://api.openai.com/v1');
  });

  it('returns default ollama URL when baseUrl empty', () => {
    expect(
      resolveChatCompletionsBaseUrl({ provider: 'ollama', apiKey: '' }),
    ).toBe('http://localhost:11434/v1');
  });

  it('returns custom ollama baseUrl with trailing slash removed', () => {
    expect(
      resolveChatCompletionsBaseUrl({
        provider: 'ollama',
        apiKey: '',
        baseUrl: 'http://host:11434/v1/',
      }),
    ).toBe('http://host:11434/v1');
  });

  it('returns custom provider baseUrl with trailing slash removed', () => {
    expect(
      resolveChatCompletionsBaseUrl({
        provider: 'custom',
        apiKey: '',
        baseUrl: 'https://api.example.com/v1/',
      }),
    ).toBe('https://api.example.com/v1');
  });

  it('throws for custom provider with empty baseUrl', () => {
    expect(() =>
      resolveChatCompletionsBaseUrl({ provider: 'custom', apiKey: '', baseUrl: '' }),
    ).toThrow('Custom provider requires a base URL');
  });

  it('throws for custom provider with whitespace-only baseUrl', () => {
    expect(() =>
      resolveChatCompletionsBaseUrl({ provider: 'custom', apiKey: '', baseUrl: '   ' }),
    ).toThrow('Custom provider requires a base URL');
  });

  it('throws for unknown provider', () => {
    expect(() =>
      resolveChatCompletionsBaseUrl({
        provider: 'unknown' as LLMConfig['provider'],
        apiKey: 'x',
      }),
    ).toThrow('Unknown LLM provider');
  });
});

describe('fetchModels', () => {
  it('returns empty array when config has no apiKey for openrouter', async () => {
    const adapter = jest.fn();
    const result = await fetchModels(adapter, { provider: 'openrouter', apiKey: '' });
    expect(result).toEqual([]);
    expect(adapter).not.toHaveBeenCalled();
  });

  it('returns parsed model IDs for openrouter with fake adapter', async () => {
    const adapter = jest.fn().mockResolvedValue({
      status: 200,
      json: { data: [{ id: 'model-a' }, { id: 'model-b' }] },
    });
    const result = await fetchModels(adapter, { provider: 'openrouter', apiKey: 'sk-x' });
    expect(result).toEqual(['model-a', 'model-b']);
    expect(adapter).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://openrouter.ai/api/v1/models',
        method: 'GET',
      }),
    );
  });

  it('returns empty array when adapter returns 400', async () => {
    const adapter = jest.fn().mockResolvedValue({ status: 400, json: {} });
    const result = await fetchModels(adapter, { provider: 'openrouter', apiKey: 'sk-x' });
    expect(result).toEqual([]);
  });

  it('returns parsed model names for ollama with fake adapter', async () => {
    const adapter = jest.fn().mockResolvedValue({
      status: 200,
      json: { models: [{ name: 'llama3.2' }, { name: 'mistral' }] },
    });
    const result = await fetchModels(adapter, { provider: 'ollama', apiKey: '' });
    expect(result).toEqual(['llama3.2', 'mistral']);
  });

  it('returns empty array when config is custom with no baseUrl', async () => {
    const adapter = jest.fn();
    const result = await fetchModels(adapter, { provider: 'custom', apiKey: '', baseUrl: '' });
    expect(result).toEqual([]);
    expect(adapter).not.toHaveBeenCalled();
  });
});
