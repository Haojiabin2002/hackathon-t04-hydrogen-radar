import { useEffect, useRef } from 'react';
import { ShieldAlert } from 'lucide-react';
import { ArtAuthForm } from './ArtAuthForm';
import { useAdminAuth } from '../../hooks/useAdminAuth';
import { verifyAdminToken } from '../../api/auth';

/**
 * 口令浮层 · 写请求撞上 401 时就地解锁
 *
 * 为什么不跳登录页：401 往往发生在用户已经填好一屏表单、点了保存之后。
 * 跳走等于把他刚写的东西丢了。这里就地要一次口令，拿到后 api 层会自动
 * 重发那一次请求，用户回到原处，什么都没丢。
 */
export function ArtAuthChallenge() {
  const { challengeOpen, answerChallenge } = useAdminAuth();
  const dialog = useRef<HTMLDivElement>(null);

  // Esc 关闭 = 放弃本次操作，等同点「稍后再说」
  useEffect(() => {
    if (!challengeOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') answerChallenge(null);
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, [challengeOpen, answerChallenge]);

  if (!challengeOpen) return null;

  return (
    <div className="auth-scrim" role="presentation" onMouseDown={(e) => {
      if (e.target === e.currentTarget) answerChallenge(null);
    }}>
      <div
        className="auth-dialog"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-dialog-title"
      >
        <div className="auth-dialog-head">
          <span className="auth-badge" aria-hidden="true"><ShieldAlert size={16} /></span>
          <div>
            <h2 id="auth-dialog-title">这一步需要管理员口令</h2>
            <p>读取数据不需要口令；改数据源、改知识库、调用模型这类写操作需要。</p>
          </div>
        </div>

        <ArtAuthForm
          autoFocus
          submitLabel="解锁并继续"
          onCancel={() => answerChallenge(null)}
          onSubmit={async (token) => {
            const ok = await verifyAdminToken(token);
            // 校验通过才交回 api 层，避免拿错口令去重发那次写请求。
            if (ok) answerChallenge(token);
            return ok;
          }}
        />

        <p className="auth-foot">口令只存在当前标签页，关掉即失效。</p>
      </div>
    </div>
  );
}
