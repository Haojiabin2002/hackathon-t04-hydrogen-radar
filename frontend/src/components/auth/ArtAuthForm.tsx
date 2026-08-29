import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react';

/**
 * 口令表单 · 登录页与 401 浮层共用
 *
 * 只有一个字段：管理员口令。**不要加用户名输入框**——后端是一把共享钥匙，
 * 摆个用户名进去是假的（见 api/adminToken.ts）。
 *
 * onSubmit 返回 false 表示口令不对，由本组件就地显示错误，不抛给上层。
 */
export function ArtAuthForm({
  onSubmit,
  onCancel,
  submitLabel = '进入看板',
  autoFocus = false,
}: {
  onSubmit: (token: string) => Promise<boolean>;
  onCancel?: () => void;
  submitLabel?: string;
  autoFocus?: boolean;
}) {
  const fieldId = useId();
  const [token, setToken] = useState('');
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const clean = token.trim();
    if (!clean || pending) return;
    setPending(true);
    setError('');
    try {
      const ok = await onSubmit(clean);
      if (!ok) setError('口令不正确。它由部署方在 RADAR_ADMIN_TOKEN 中设置。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法连接雷达服务');
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor={fieldId}>管理员口令</label>
        <div className="auth-input">
          <KeyRound size={15} aria-hidden="true" />
          <input
            id={fieldId}
            type={visible ? 'text' : 'password'}
            value={token}
            autoFocus={autoFocus}
            autoComplete="current-password"
            placeholder="输入口令以解锁写操作"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${fieldId}-error` : undefined}
            onChange={(event) => { setToken(event.target.value); if (error) setError(''); }}
          />
          <button
            type="button"
            className="auth-reveal"
            aria-label={visible ? '隐藏口令' : '显示口令'}
            onClick={() => setVisible((v) => !v)}
          >
            {visible ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
          </button>
        </div>
        {error && <small id={`${fieldId}-error`} className="auth-error" role="alert">{error}</small>}
      </div>

      <div className="auth-actions">
        {onCancel && (
          <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={pending}>
            稍后再说
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={!token.trim() || pending}>
          {pending && <Loader2 size={14} className="spin" aria-hidden="true" />}
          {pending ? '验证中' : submitLabel}
        </button>
      </div>
    </form>
  );
}
