import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { clearAdminToken, onAdminTokenChange, registerAdminTokenPrompter, writeAdminToken } from '../api/adminToken';
import { probeAuthState, verifyAdminToken } from '../api/auth';
import type { AuthState } from '../api/auth';

/**
 * 口令状态 · 全站单例
 *
 * 管的是一把共享钥匙，不是账号体系——后端只有一个 RADAR_ADMIN_TOKEN。
 * 见 api/adminToken.ts 顶部说明。
 *
 * 顺带接管 401：任何一次写请求撞上 401，api 层会调 requestAdminToken()，
 * 这里把它变成一个应用内的口令浮层，而不是浏览器原生 prompt。
 * 用浮层而不是跳转登录页，是为了不丢掉用户当前填了一半的表单。
 */

interface AdminAuthValue {
  state: AuthState;
  /** 重新探测一次后端口令状态 */
  refresh: () => void;
  /** 校验并保存口令。返回是否通过。 */
  signIn: (token: string) => Promise<boolean>;
  /** 丢弃当前会话口令 */
  signOut: () => void;
  /** 401 触发的口令浮层是否打开 */
  challengeOpen: boolean;
  /** 浮层提交/取消的出口（传 null 表示用户放弃） */
  answerChallenge: (token: string | null) => void;
}

const AdminAuthContext = createContext<AdminAuthValue | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>('unknown');
  const [challengeOpen, setChallengeOpen] = useState(false);
  // 401 挂起时的 resolver：浮层拿到输入后由它把值交回给 api 层。
  const pending = useRef<((token: string | null) => void) | null>(null);

  const refresh = useCallback(() => {
    void probeAuthState().then(setState);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // sessionStorage 被别处改动（登出、另一处登录）时同步状态
  useEffect(() => onAdminTokenChange(refresh), [refresh]);

  // 把「怎么问用户要口令」注册给 api 层
  useEffect(() => registerAdminTokenPrompter(() => {
    setChallengeOpen(true);
    return new Promise<string | null>((resolve) => { pending.current = resolve; });
  }), []);

  const answerChallenge = useCallback((token: string | null) => {
    setChallengeOpen(false);
    const resolve = pending.current;
    pending.current = null;
    resolve?.(token);
    // api 层拿到口令后会自己 writeAdminToken 并重发请求，
    // 这里只需要在稍后同步一次状态。
    if (token) setState('authorized');
  }, []);

  const signIn = useCallback(async (token: string) => {
    const clean = token.trim();
    if (!clean) return false;
    const ok = await verifyAdminToken(clean);
    if (ok) {
      writeAdminToken(clean);
      setState('authorized');
    }
    return ok;
  }, []);

  const signOut = useCallback(() => {
    clearAdminToken();
    setState('locked');
    refresh();
  }, [refresh]);

  const value = useMemo<AdminAuthValue>(
    () => ({ state, refresh, signIn, signOut, challengeOpen, answerChallenge }),
    [state, refresh, signIn, signOut, challengeOpen, answerChallenge],
  );

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth(): AdminAuthValue {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error('useAdminAuth 必须在 AdminAuthProvider 内使用');
  return ctx;
}
