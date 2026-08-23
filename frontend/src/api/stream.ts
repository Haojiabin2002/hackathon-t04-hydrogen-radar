import { ApiError } from './client';

/**
 * SSE 消费器。
 *
 * 为什么不用 EventSource：它只能发 GET、不能设置自定义请求头，
 * 而 /api/agent/stream 是 POST 且必须带 X-Radar-Local（防跨站）。
 * 所以用 fetch + ReadableStream 自己解析 SSE 帧。
 */

export interface SseHandlers<T = unknown> {
  /** 收到一个具名事件 */
  onEvent: (event: string, data: T) => void;
  /** 可选：连接建立（首字节到达）时调用一次 */
  onOpen?: () => void;
}

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');
const adminTokenKey = 'hydrogen-radar-admin-token';

function savedAdminToken(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.sessionStorage.getItem(adminTokenKey)?.trim() ?? '';
  } catch {
    return '';
  }
}

/**
 * 向一个 SSE 端点 POST 并逐事件回调。
 * signal 用于中止（用户离开页面或点"停止"）。
 */
export async function postSse<T = unknown>(
  path: string,
  body: unknown,
  handlers: SseHandlers<T>,
  signal?: AbortSignal,
): Promise<void> {
  const token = savedAdminToken();
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'X-Radar-Local': '1',
        ...(token ? { 'X-Radar-Admin-Token': token } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') return;
    throw new ApiError(0, `无法连接雷达服务：${(error as Error)?.message ?? '网络错误'}`, error);
  }

  if (!response.ok) {
    // 错误响应是普通 JSON，不是 SSE
    let detail: unknown;
    try {
      detail = (await response.json())?.detail;
    } catch {
      detail = undefined;
    }
    throw new ApiError(
      response.status,
      typeof detail === 'string' && detail ? detail : `请求失败（HTTP ${response.status}）`,
      detail,
    );
  }

  if (!response.body) {
    throw new ApiError(0, '服务未返回流式响应体');
  }

  handlers.onOpen?.();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE 帧以空行分隔；\r\n 与 \n 都要兼容。
      // 用 exec 拿到分隔符的**实际长度**，否则 \r\n\r\n 会残留字符到下一帧。
      const boundary = /\r?\n\r?\n/;
      for (;;) {
        const match = boundary.exec(buffer);
        if (!match) break;
        const frame = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        dispatch(frame, handlers);
      }
    }
    if (buffer.trim()) dispatch(buffer, handlers);
  } finally {
    reader.releaseLock();
  }
}

function dispatch<T>(frame: string, handlers: SseHandlers<T>) {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return;
  try {
    handlers.onEvent(event, JSON.parse(dataLines.join('\n')) as T);
  } catch {
    // 半帧或非 JSON：跳过，不要让一帧坏数据打断整条流
  }
}
