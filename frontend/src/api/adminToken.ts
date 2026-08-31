/**
 * 管理员口令 · 全站唯一来源
 *
 * 后端没有用户系统：api.py 的 protect_public_mutations 中间件用**一个共享口令**
 * （环境变量 RADAR_ADMIN_TOKEN）保护所有 /api/ 写请求，读请求完全公开。
 * 所以这里管的是「一把钥匙」，不是「一个账号」——界面上不要出现用户名、头像、
 * 角色这类暗示多用户的东西，那会是假的。
 *
 * 口令只放 sessionStorage：关掉标签页即失效，不落 localStorage、不进 URL。
 *
 * 这套逻辑此前被 client.ts 和 stream.ts 各抄了一份（连 key 字符串都重复声明），
 * 两边的 401 补救要靠人肉保持一致。收拢到这里之后，两边只调同一组函数。
 */

export const ADMIN_TOKEN_KEY = 'hydrogen-radar-admin-token';

export function readAdminToken(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.sessionStorage.getItem(ADMIN_TOKEN_KEY)?.trim() ?? '';
  } catch {
    // 隐私模式禁用会话存储：读不到就当未授权，功能降级但不报错。
    return '';
  }
}

export function writeAdminToken(token: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
  } catch {
    // 存不进去时调用方仍持有本次要用的口令，当前这一次操作不受影响。
  }
  notifyChanged();
}

export function clearAdminToken(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    // 同上：清不掉也不该让界面崩掉。
  }
  notifyChanged();
}

/* ---------------------------------------------------------- 口令变化的订阅 */

type Listener = () => void;
const changeListeners = new Set<Listener>();

export function onAdminTokenChange(listener: Listener): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

function notifyChanged(): void {
  changeListeners.forEach((listener) => {
    listener();
  });
}

/* ------------------------------------------------ 401 时向界面索要一次口令 */

type Prompter = () => Promise<string | null>;
let prompter: Prompter | null = null;

/**
 * 由界面注册「怎么问用户要口令」。注册后 401 会弹应用内的登录浮层，
 * 而不是浏览器原生 prompt。
 */
export function registerAdminTokenPrompter(next: Prompter): () => void {
  prompter = next;
  return () => {
    if (prompter === next) prompter = null;
  };
}

/**
 * 401 补救入口。返回用户新输入的口令，或 null（用户取消）。
 *
 * 没有界面注册时退回 window.prompt——浮层尚未挂载、或在浮层自身内部发起请求时，
 * 功能不能整个失效。宁可丑，不可断。
 */
export async function requestAdminToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  if (prompter) return prompter();
  return window.prompt('该操作需要管理员口令。口令只保存在当前浏览器会话中。')?.trim() ?? null;
}
