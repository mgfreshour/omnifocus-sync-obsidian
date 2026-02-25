/**
 * URL metadata fetching via curl subprocess.
 * Bypasses CORS by using curl (CLI, not browser).
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

export interface UrlMetadata {
  title: string;
  description: string | null;
}

/**
 * Validates that the given text is a URL with a host.
 */
export function isValidURL(text: string): boolean {
  try {
    const url = new URL(text.trim());
    return !!url.host;
  } catch {
    return false;
  }
}

/**
 * Check if URL is YouTube (youtube.com or youtu.be).
 */
function isYouTubeURL(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return (
      u.host.includes('youtube.com') || u.host.includes('youtu.be')
    );
  } catch {
    return false;
  }
}

/**
 * Fetch metadata from noembed.com for YouTube URLs.
 * Returns JSON with title and description.
 */
async function fetchYouTubeMetadata(url: string): Promise<UrlMetadata | null> {
  const noembedUrl = `https://noembed.com/embed?url=${encodeURIComponent(url)}`;
  try {
    const { stdout } = await execFileAsync('curl', [
      '-sL',
      '--max-time',
      '5',
      '-A',
      USER_AGENT,
      noembedUrl,
    ]);
    const data = JSON.parse(stdout) as {
      title?: string;
      description?: string;
      error?: string;
    };
    if (data.error || !data.title) {
      return null;
    }
    return {
      title: data.title.replace(/\s*-\s*YouTube$/, ''),
      description: data.description ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Parse title and description from HTML.
 */
function parseHtmlMetadata(html: string): UrlMetadata | null {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';
  if (!title) {
    return null;
  }
  const descMatch =
    html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i) ||
    html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i);
  const description = descMatch ? descMatch[1].trim() || null : null;
  return { title, description };
}

/**
 * Fetch metadata for a URL using curl.
 * For YouTube URLs, uses noembed.com. For others, fetches HTML and parses title/meta.
 *
 * @returns Metadata or null on failure
 */
export async function fetchMetadata(url: string): Promise<UrlMetadata | null> {
  const trimmed = url.trim();
  if (!isValidURL(trimmed)) {
    return null;
  }

  if (isYouTubeURL(trimmed)) {
    return fetchYouTubeMetadata(trimmed);
  }

  try {
    const { stdout } = await execFileAsync('curl', [
      '-sL',
      '--max-time',
      '5',
      '-A',
      USER_AGENT,
      trimmed,
    ]);
    return parseHtmlMetadata(stdout);
  } catch {
    return null;
  }
}

/**
 * Extract a URL from task name or note.
 * Returns the first URL-like string found, or null.
 */
export function extractUrlFromTask(name: string, note: string): string | null {
  const text = `${name} ${note}`.trim();
  if (!text) return null;
  // Simple URL pattern - match http(s) URLs
  const urlMatch = text.match(/https?:\/\/[^\s<>"']+/i);
  if (urlMatch) {
    const candidate = urlMatch[0];
    if (isValidURL(candidate)) {
      return candidate;
    }
  }
  // Check if the whole name/note is a URL (e.g. task name is just a URL)
  if (isValidURL(text)) {
    return text;
  }
  return null;
}
