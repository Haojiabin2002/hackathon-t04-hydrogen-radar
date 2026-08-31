import { readAdminToken, requestAdminToken, writeAdminToken } from './adminToken';

export type MutationMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface FastApiValidationIssue {
  loc?: Array<string | number>;
  msg?: string;
  type?: string;
}

interface FastApiErrorPayload {
  detail?: unknown;
}

function describeDetail(detail: unknown): string {
  if (typeof detail === 'string' && detail.trim()) {
    return detail;
  }

  if (Array.isArray(detail)) {
    const messages = detail
      .map((issue: FastApiValidationIssue | unknown) => {
        if (!issue || typeof issue !== 'object') return String(issue);
        const typed = issue as FastApiValidationIssue;
        const location = typed.loc?.filter((part) => part !== 'body').join('.');
        return [location, typed.msg].filter(Boolean).join('：');
      })
      .filter(Boolean);
    if (messages.length) return messages.join('；');
  }

  if (detail && typeof detail === 'object') {
    const message = (detail as { message?: unknown; msg?: unknown }).message
      ?? (detail as { msg?: unknown }).msg;
    if (typeof message === 'string' && message.trim()) return message;
    try {
      return JSON.stringify(detail);
    } catch {
      return '请求未能完成';
    }
  }

  return '请求未能完成';
}

export class ApiError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

/** 口令读写与 401 补救都在 api/adminToken.ts，这里不再自己碰 sessionStorage。 */

export function resolveUrl(path: string): string {
  if (!path.startsWith('/')) {
    throw new Error(`API 路径必须以 / 开头：${path}`);
  }
  return `${apiBaseUrl}${path}`;
}

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json();
  }

  const text = await response.text();
  return text || undefined;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const mutation = Boolean(init?.method && !['GET', 'HEAD', 'OPTIONS'].includes(init.method.toUpperCase()));

  function savedAdminToken(): string {
    return mutation ? readAdminToken() : '';
  }

  async function perform(adminToken = savedAdminToken()): Promise<Response> {
    return fetch(resolveUrl(path), {
      ...init,
      headers: {
        Accept: 'application/json, text/plain;q=0.9',
        ...(adminToken ? { 'X-Radar-Admin-Token': adminToken } : {}),
        ...init?.headers,
      },
    });
  }

  let response: Response;
  try {
    response = await perform();
  } catch (error) {
    const message = error instanceof Error ? error.message : '网络连接失败';
    throw new ApiError(0, `无法连接雷达服务：${message}`, error);
  }

  // 401 补救：向界面要一次口令再重发。挂了登录浮层时走浮层，
  // 没挂时 requestAdminToken 会退回浏览器原生 prompt——行为不退化。
  if (response.status === 401 && mutation && typeof window !== 'undefined') {
    const token = (await requestAdminToken())?.trim();
    if (token) {
      writeAdminToken(token);
      response = await perform(token);
    }
  }

  const payload = await parseBody(response);
  if (!response.ok) {
    const detail = (payload as FastApiErrorPayload | undefined)?.detail ?? payload;
    throw new ApiError(
      response.status,
      describeDetail(detail) || `请求失败（HTTP ${response.status}）`,
      detail,
    );
  }

  return payload as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'GET' });
}

/**
 * 取 text/plain 端点的原文（目前只有 GET /api/knowledge/raw —— knowledge.md 本体）。
 *
 * parseBody 对非 JSON 响应已经返回字符串，所以这里只是把类型钉死，
 * 顺便把「后端返回空文件」和「后端没返回内容」都归成空串，调用方不用判 undefined。
 */
export async function apiGetText(path: string): Promise<string> {
  const body = await request<unknown>(path, { method: 'GET' });
  return typeof body === 'string' ? body : '';
}

export function apiMutation<T>(
  path: string,
  method: MutationMethod,
  body?: unknown,
): Promise<T> {
  return request<T>(path, {
    method,
    headers: {
      'X-Radar-Local': '1',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
