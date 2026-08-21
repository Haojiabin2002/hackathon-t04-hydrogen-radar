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
const adminTokenKey = 'hydrogen-radar-admin-token';

function resolveUrl(path: string): string {
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
    if (!mutation || typeof window === 'undefined') return '';
    try {
      return window.sessionStorage.getItem(adminTokenKey)?.trim() ?? '';
    } catch {
      return '';
    }
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

  if (response.status === 401 && mutation && typeof window !== 'undefined') {
    const token = window.prompt('该操作需要管理员口令。口令只保存在当前浏览器会话中。')?.trim();
    if (token) {
      try {
        window.sessionStorage.setItem(adminTokenKey, token);
      } catch {
        // 浏览器禁用会话存储时仍可完成当前一次请求。
      }
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
