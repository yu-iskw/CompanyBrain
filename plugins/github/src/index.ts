import { PluginRequestError } from '@company-brain/plugin-sdk';

import type {
  AccessExplanation,
  KnowledgeObject,
  KnowledgeObjectType,
  SearchRequest,
} from '@company-brain/domain';
import type {
  KnowledgePlugin,
  PluginContext,
  PluginManifest,
  SearchPluginContext,
} from '@company-brain/plugin-sdk';

const GITHUB_API = 'https://api.github.com';

interface RepositorySummary {
  readonly full_name: string;
  readonly html_url: string;
}

interface CodeItem {
  readonly name: string;
  readonly path: string;
  readonly html_url: string;
  readonly repository: RepositorySummary;
  readonly text_matches?: readonly { readonly fragment?: string }[];
}

interface IssueItem {
  readonly number: number;
  readonly title: string;
  readonly body?: string | null;
  readonly html_url: string;
  readonly created_at?: string;
  readonly updated_at?: string;
  readonly user?: { readonly login?: string } | null;
  readonly pull_request?: object;
  readonly repository_url: string;
}

interface SearchResponse<T> {
  readonly items: readonly T[];
}

interface ContentResponse {
  readonly content?: string;
  readonly encoding?: string;
  readonly html_url?: string;
  readonly name?: string;
  readonly path?: string;
}

type GitHubObjectId =
  | {
      readonly kind: 'code';
      readonly owner: string;
      readonly repository: string;
      readonly path: string;
    }
  | {
      readonly kind: 'issue';
      readonly owner: string;
      readonly repository: string;
      readonly number: number;
    };

export class GitHubPlugin implements KnowledgePlugin {
  readonly manifest: PluginManifest = {
    id: 'github',
    displayName: 'GitHub',
    version: '0.1.0',
    credentialType: 'oauth-user-token',
    metadataStorage: 'non-sensitive-only',
  };

  constructor(private readonly request: typeof fetch = fetch) {}

  explainAccess(): AccessExplanation {
    return {
      sourceId: 'github',
      mode: 'delegated-user',
      summary: 'GitHub is queried live using the linked user token and its repository permissions.',
      requiredScopes: ['repo', 'read:org', 'read:user'],
    };
  }

  async search(
    search: SearchRequest,
    context: SearchPluginContext,
  ): Promise<readonly KnowledgeObject[]> {
    const limit = Math.max(1, Math.min(50, context.resultLimit));
    const perType = Math.max(1, Math.ceil(limit / 2));
    const [codeRaw, issuesRaw] = await Promise.all([
      this.call(`/search/code?q=${encodeURIComponent(search.query)}&per_page=${perType}`, context),
      this.call(
        `/search/issues?q=${encodeURIComponent(search.query)}&per_page=${perType}`,
        context,
      ),
    ]);
    const code = asSearchResponse<CodeItem>(codeRaw);
    const issues = asSearchResponse<IssueItem>(issuesRaw);
    return [
      ...code.items.map((item) => codeToKnowledgeObject(item)),
      ...issues.items.map((item) => issueToKnowledgeObject(item)),
    ].slice(0, limit);
  }

  async getObject(objectId: string, context: PluginContext): Promise<KnowledgeObject | undefined> {
    const id = parseObjectId(objectId);
    if (id.kind === 'code') {
      const raw = await this.call(
        `/repos/${encodeURIComponent(id.owner)}/${encodeURIComponent(id.repository)}/contents/${encodePath(id.path)}`,
        context,
      );
      if (raw === undefined) return undefined;
      return contentToKnowledgeObject(id, asContentResponse(raw));
    }
    const raw = await this.call(
      `/repos/${encodeURIComponent(id.owner)}/${encodeURIComponent(id.repository)}/issues/${id.number}`,
      context,
    );
    if (raw === undefined) return undefined;
    return issueToKnowledgeObject(asIssueItem(raw), id);
  }

  private async call(path: string, context: PluginContext): Promise<unknown> {
    const response = await this.request(`${GITHUB_API}${path}`, {
      headers: {
        accept: 'application/vnd.github.text-match+json, application/vnd.github+json',
        authorization: `Bearer ${context.accessToken}`,
        'user-agent': 'CompanyBrain/0.1',
        'x-github-api-version': '2026-03-10',
      },
    });
    if (response.status === 404) return undefined;
    if (!response.ok) {
      if (isGitHubRateLimited(response)) {
        throw new PluginRequestError(`GitHub HTTP ${response.status}`, 'rate-limited');
      }
      if (response.status === 401 || response.status === 403) {
        throw new PluginRequestError(`GitHub HTTP ${response.status}`, 'forbidden');
      }
      throw new PluginRequestError(`GitHub HTTP ${response.status}`, 'unavailable');
    }
    return response.json();
  }
}

function isGitHubRateLimited(response: Response): boolean {
  if (response.status === 429) return true;
  if (response.status !== 403) return false;
  return (
    response.headers.get('x-ratelimit-remaining') === '0' ||
    response.headers.get('retry-after') !== null
  );
}

function asSearchResponse<T>(value: unknown): SearchResponse<T> {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('items' in value) ||
    !Array.isArray(value.items)
  ) {
    throw new Error('GitHub search response is missing items');
  }
  return value as SearchResponse<T>;
}

function asContentResponse(value: unknown): ContentResponse {
  if (typeof value !== 'object' || value === null) {
    throw new Error('GitHub content response is invalid');
  }
  return value;
}

function asIssueItem(value: unknown): IssueItem {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('number' in value) ||
    typeof value.number !== 'number' ||
    !('title' in value) ||
    typeof value.title !== 'string' ||
    !('html_url' in value) ||
    typeof value.html_url !== 'string' ||
    !('repository_url' in value) ||
    typeof value.repository_url !== 'string'
  ) {
    throw new Error('GitHub issue response is invalid');
  }
  return value as IssueItem;
}

function codeToKnowledgeObject(item: CodeItem): KnowledgeObject {
  const [owner, repository] = splitRepository(item.repository.full_name);
  const id: GitHubObjectId = { kind: 'code', owner, repository, path: item.path };
  return makeObject({
    id,
    type: 'file',
    title: `${item.repository.full_name}/${item.path}`,
    excerpt: item.text_matches?.[0]?.fragment ?? item.path,
    url: item.html_url,
    metadata: { repository: item.repository.full_name, path: item.path },
  });
}

function issueToKnowledgeObject(item: IssueItem, knownId?: GitHubObjectId): KnowledgeObject {
  const [owner, repository] =
    knownId?.kind === 'issue'
      ? [knownId.owner, knownId.repository]
      : splitRepositoryUrl(item.repository_url);
  const id: GitHubObjectId = { kind: 'issue', owner, repository, number: item.number };
  return makeObject({
    id,
    type: item.pull_request ? 'pull-request' : 'issue',
    title: `${owner}/${repository}#${item.number}: ${item.title}`,
    excerpt: truncate(item.body ?? ''),
    url: item.html_url,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    author: item.user?.login,
    metadata: { repository: `${owner}/${repository}`, number: item.number },
  });
}

function contentToKnowledgeObject(
  id: Extract<GitHubObjectId, { kind: 'code' }>,
  item: ContentResponse,
): KnowledgeObject {
  const content = item.encoding === 'base64' && item.content ? decodeContent(item.content) : '';
  const path = item.path ?? id.path;
  return makeObject({
    id,
    type: 'file',
    title: `${id.owner}/${id.repository}/${path}`,
    excerpt: truncate(content),
    url: item.html_url ?? `https://github.com/${id.owner}/${id.repository}/blob/HEAD/${path}`,
    metadata: { repository: `${id.owner}/${id.repository}`, path },
  });
}

function makeObject(value: {
  readonly id: GitHubObjectId;
  readonly type: KnowledgeObjectType;
  readonly title: string;
  readonly excerpt: string;
  readonly url: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly author?: string;
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
}): KnowledgeObject {
  const objectId = Buffer.from(JSON.stringify(value.id), 'utf8').toString('base64url');
  return {
    id: `github:${objectId}`,
    sourceId: 'github',
    type: value.type,
    title: value.title,
    excerpt: value.excerpt,
    url: value.url,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    author: value.author,
    metadata: value.metadata,
    citation: {
      sourceId: 'github',
      objectId,
      url: value.url,
      title: value.title,
      retrievedAt: new Date().toISOString(),
    },
  };
}

function parseObjectId(objectId: string): GitHubObjectId {
  try {
    const value: unknown = JSON.parse(Buffer.from(objectId, 'base64url').toString('utf8'));
    if (isCodeId(value) || isIssueId(value)) return value;
  } catch {
    // Converted to a stable connector error below.
  }
  throw new PluginRequestError('Invalid GitHub object ID', 'invalid-request');
}

function isCodeId(value: unknown): value is Extract<GitHubObjectId, { kind: 'code' }> {
  return isBaseId(value, 'code') && 'path' in value && typeof value.path === 'string';
}

function isIssueId(value: unknown): value is Extract<GitHubObjectId, { kind: 'issue' }> {
  return isBaseId(value, 'issue') && 'number' in value && Number.isInteger(value.number);
}

function isBaseId(value: unknown, kind: string): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === kind &&
    'owner' in value &&
    typeof value.owner === 'string' &&
    'repository' in value &&
    typeof value.repository === 'string'
  );
}

function splitRepository(fullName: string): [string, string] {
  const parts = fullName.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1])
    throw new Error('GitHub returned an invalid repository name');
  return [parts[0], parts[1]];
}

function splitRepositoryUrl(url: string): [string, string] {
  const match = /\/repos\/([^/]+)\/([^/]+)$/.exec(url);
  if (!match?.[1] || !match[2]) throw new Error('GitHub returned an invalid repository URL');
  return [match[1], match[2]];
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function decodeContent(content: string): string {
  const compact = content.replace(/\s/g, '');
  // Decode only enough base64 for a ~2k character UTF-8 excerpt (worst-case 4 bytes/char).
  const maxBase64Chars = Math.ceil((2_000 * 4 * 4) / 3) + 4;
  const sliced = compact.length <= maxBase64Chars ? compact : compact.slice(0, maxBase64Chars);
  return truncate(Buffer.from(sliced, 'base64').toString('utf8'));
}

function truncate(value: string): string {
  return value.length <= 2_000 ? value : `${value.slice(0, 1_997)}…`;
}
