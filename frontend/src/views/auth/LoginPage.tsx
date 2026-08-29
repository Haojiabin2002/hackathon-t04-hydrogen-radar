import { useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, RadioTower, ShieldCheck, Unlock } from 'lucide-react';
import { ArtAuthForm } from '../../components/auth/ArtAuthForm';
import { useAdminAuth } from '../../hooks/useAdminAuth';

/**
 * 登录页 · 解锁写操作
 *
 * 说清楚这里到底在验什么，别让人以为有账号体系：
 * 后端只有一把共享口令（RADAR_ADMIN_TOKEN），读取全程公开，
 * 口令保护的是写操作。所以这页没有用户名、没有注册、没有找回密码——
 * 那三样在这套后端下都是假的。
 */
export default function LoginPage() {
  const { state, signIn, refresh } = useAdminAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // 从哪儿被拦过来的，登录后回哪儿去
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  useEffect(() => { refresh(); }, [refresh]);

  const done = () => { navigate(from, { replace: true }); };

  return (
    <main className="auth-page">
      <div className="auth-page-grid" aria-hidden="true" />

      <div className="auth-card">
        <header className="auth-brand">
          <span className="auth-brand-mark" aria-hidden="true"><RadioTower size={17} /></span>
          <div>
            <strong>氢能商机雷达</strong>
            <small>从公开公告抓取商机 · 每个字段可回原文核对</small>
          </div>
        </header>

        {state === 'open' && (
          <section className="auth-open" role="status">
            <span className="auth-badge is-open" aria-hidden="true"><Unlock size={16} /></span>
            <div>
              <h1>当前实例没有启用口令</h1>
              <p>
                后端未配置 <code>RADAR_ADMIN_TOKEN</code>，写操作直接放行——本地开发就是这个状态。
                这里没有什么可登录的，直接进去即可。
              </p>
              <button className="btn btn-primary" type="button" onClick={done}>
                进入看板<ArrowRight size={14} aria-hidden="true" />
              </button>
            </div>
          </section>
        )}

        {state === 'authorized' && (
          <section className="auth-open" role="status">
            <span className="auth-badge is-ok" aria-hidden="true"><ShieldCheck size={16} /></span>
            <div>
              <h1>这个标签页已经解锁</h1>
              <p>口令存在当前标签页的会话里，关掉标签即失效。</p>
              <button className="btn btn-primary" type="button" onClick={done}>
                回到看板<ArrowRight size={14} aria-hidden="true" />
              </button>
            </div>
          </section>
        )}

        {(state === 'locked' || state === 'unknown') && (
          <>
            <h1 className="auth-title">解锁写操作</h1>
            <p className="auth-lede">
              浏览商机、信号与溯源不需要口令。
              <b>改数据源、改知识库、发起采集、调用模型</b>这些会花钱或改状态的操作需要。
            </p>

            <ArtAuthForm
              autoFocus
              onSubmit={async (token) => {
                const ok = await signIn(token);
                if (ok) done();
                return ok;
              }}
            />

            {state === 'unknown' && (
              <p className="auth-warn" role="alert">
                探测不到雷达服务。确认 <code>uvicorn api:app</code> 已经起来了。
              </p>
            )}

            <p className="auth-foot">
              口令由部署方在环境变量 <code>RADAR_ADMIN_TOKEN</code> 里设置，只保存在当前标签页。
              <Link to="/">先只看不改</Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
