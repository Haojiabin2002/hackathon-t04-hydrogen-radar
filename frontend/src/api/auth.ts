import { resolveUrl } from './client';
import { readAdminToken } from './adminToken';

/**
 * 口令状态探测
 *
 * 后端没有 /api/login，也没有任何「只验证不干活」的接口。所以这里借
 * `PUT /api/preferences` 做零副作用探针：
 *
 *   harness.set_preference() 的第一件事是查白名单键，不在白名单直接抛
 *   ValueError → 400，**在写任何东西之前就返回了**。而口令中间件
 *   protect_public_mutations 站在整条链路最外层，口令不对根本到不了这里。
 *
 * 于是状态可以只靠 HTTP 码判定，不需要后端配合改代码：
 *
 *   401  → 口令不对（或没带）
 *   其他 → 已经越过鉴权中间件，口令有效
 *
 * 403 是 _guard_local 的跨站拦截，同样意味着已越过鉴权层，不能当成口令错。
 */

/** 探针键必须不在 harness.PREF_SCHEMA 白名单里，否则会真的写入偏好。 */
const PROBE_KEY = '__auth_probe__';

export type AuthState =
  /** 后端没配 RADAR_ADMIN_TOKEN，写操作直接放行——本地开发就是这个状态 */
  | 'open'
  /** 后端要口令，当前会话没有有效口令 */
  | 'locked'
  /** 后端要口令，当前会话已授权 */
  | 'authorized'
  /** 探测本身失败（服务没起、断网），状态未知，界面不要假装知道 */
  | 'unknown';

async function probe(token: string): Promise<number> {
  const response = await fetch(resolveUrl('/api/preferences'), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Radar-Local': '1',
      ...(token ? { 'X-Radar-Admin-Token': token } : {}),
    },
    body: JSON.stringify({ key: PROBE_KEY, value: null }),
  });
  return response.status;
}

/** 口令是否有效。只有 401 判否，其余都说明越过了鉴权中间件。 */
export async function verifyAdminToken(token: string): Promise<boolean> {
  return (await probe(token)) !== 401;
}

/**
 * 当前会话处于哪种状态。
 *
 * 先不带口令探一次：不是 401 就说明后端压根没开口令保护，此时要求用户登录
 * 是在骗人——界面应当如实说「当前实例未启用口令」。
 */
export async function probeAuthState(): Promise<AuthState> {
  try {
    if ((await probe('')) !== 401) return 'open';
  } catch {
    return 'unknown';
  }

  const token = readAdminToken();
  if (!token) return 'locked';

  try {
    return (await verifyAdminToken(token)) ? 'authorized' : 'locked';
  } catch {
    return 'unknown';
  }
}
