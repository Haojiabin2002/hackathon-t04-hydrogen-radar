import { Link } from 'react-router-dom';
import { CircleHelp, KeyRound, LogOut, RefreshCw, ShieldCheck, Unlock } from 'lucide-react';
import { ArtPageHead } from '../../components/cards/ArtPageHead';
import { ArtPanel } from '../../components/cards/ArtPanel';
import { ArtAuthForm } from '../../components/auth/ArtAuthForm';
import { useAdminAuth } from '../../hooks/useAdminAuth';
import { useRouteMeta } from '../../hooks/useRouteMeta';

/**
 * 账户与访问
 *
 * 这一页刻意**不做**头像、昵称、角色、登录历史——后端是一把共享口令，
 * 不是账号体系（见 api/adminToken.ts）。摆那些等于在界面上编数据。
 * 这里只展示能从后端真实读出来的东西：口令是否启用、本标签页是否解锁、
 * 口令保护了哪些操作。
 */

/** 受口令保护的写操作。路径与 radar/api.py 的路由一一对应，不是示意。 */
const GUARDED = [
  {
    group: '会产生费用或外部请求',
    items: [
      { label: '发起一轮采集', path: 'POST /api/collect' },
      { label: 'Agent 循环 / 流式 Agent', path: 'POST /api/agent · /api/agent/stream' },
      { label: '销售对话', path: 'POST /api/chat' },
      { label: '测试模型通道', path: 'POST /api/llm/channels/test' },
      { label: '探测数据源', path: 'POST /api/sources/probe' },
    ],
  },
  {
    group: '会改变系统配置',
    items: [
      { label: '新增 / 删除 / 启停数据源', path: 'POST · DELETE /api/sources' },
      { label: '改知识库正文', path: 'PUT /api/knowledge' },
      { label: '改技能与启停', path: 'PUT · POST · DELETE /api/skills' },
      { label: '改销售偏好', path: 'PUT /api/preferences' },
      { label: '增删销售记忆', path: 'POST · DELETE /api/memory' },
      { label: '改自动任务时刻', path: 'PUT /api/schedule' },
      { label: '改模型通道配置', path: 'PUT /api/llm/channels' },
    ],
  },
];

export default function AccountPage() {
  const meta = useRouteMeta();
  const { state, signIn, signOut, refresh } = useAdminAuth();

  return (
    <section className="page">
      <ArtPageHead
        compact
        title={meta?.title ?? '账户与访问'}
        description={meta?.description}
        actions={
          <button className="btn btn-quiet" type="button" onClick={refresh}>
            <RefreshCw size={14} aria-hidden="true" />重新检测
          </button>
        }
      />

      <ArtPanel title="当前状态" description="每次进入本页会向后端实际探测一次，不读缓存">
        <div className="account-state" data-state={state}>
          <span className="auth-badge" aria-hidden="true">
            {state === 'authorized' && <ShieldCheck size={18} />}
            {state === 'open' && <Unlock size={18} />}
            {state === 'locked' && <KeyRound size={18} />}
            {state === 'unknown' && <CircleHelp size={18} />}
          </span>

          <div className="account-state-text">
            {state === 'authorized' && (
              <>
                <strong>本标签页已解锁</strong>
                <p>口令存在这个标签页的会话存储里，关掉标签或退出即失效，不会写进磁盘。</p>
              </>
            )}
            {state === 'open' && (
              <>
                <strong>这个实例没有启用口令</strong>
                <p>
                  后端未配置 <code>RADAR_ADMIN_TOKEN</code>，所有写操作直接放行。
                  本地开发是正常的；<b>公网部署务必配上</b>，否则任何人都能改数据源、消耗模型额度。
                </p>
              </>
            )}
            {state === 'locked' && (
              <>
                <strong>写操作已锁定</strong>
                <p>浏览、检索、看溯源都不受影响。需要改配置或调用模型时，在下面输入口令。</p>
              </>
            )}
            {state === 'unknown' && (
              <>
                <strong>探测不到雷达服务</strong>
                <p>确认后端已启动：<code>cd radar &amp;&amp; .venv/bin/python -m uvicorn api:app --port 8000</code></p>
              </>
            )}
          </div>

          {state === 'authorized' && (
            <button className="btn btn-danger" type="button" onClick={signOut}>
              <LogOut size={14} aria-hidden="true" />退出并清除口令
            </button>
          )}
        </div>

        {state === 'locked' && (
          <div className="account-unlock">
            <ArtAuthForm submitLabel="解锁" onSubmit={signIn} />
          </div>
        )}
      </ArtPanel>

      <ArtPanel
        title="口令保护了哪些操作"
        description="读取一律公开：商机、信号、作战卡、溯源都不需要口令"
      >
        <div className="account-guarded">
          {GUARDED.map(({ group, items }) => (
            <div key={group}>
              <h4>{group}</h4>
              <ul>
                {items.map(({ label, path }) => (
                  <li key={path}>
                    <span>{label}</span>
                    <code>{path}</code>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </ArtPanel>

      <ArtPanel title="这套机制的边界" description="知道它不保护什么，比知道它保护什么更重要">
        <ul className="account-notes">
          <li>
            <b>一把共享钥匙，不是账号体系。</b>
            后端只有一个 <code>RADAR_ADMIN_TOKEN</code>，没有用户表、没有角色、没有操作留痕。
            所以这里不会显示「谁登录了」——那个信息不存在。
          </li>
          <li>
            <b>只挡写操作。</b>
            中间件按 HTTP 方法判断，GET 一律放行。公开部署时，看板上的数据本身是所有人可见的。
          </li>
          <li>
            <b>只在这个标签页有效。</b>
            口令放 <code>sessionStorage</code>，不进 localStorage、不进 URL、不进磁盘。
          </li>
          <li>
            <b>另有一层跨站保护。</b>
            写请求还必须带 <code>X-Radar-Local</code> 头，别的网站无法借你的浏览器发起写操作。
          </li>
        </ul>
        <p className="account-links">
          相关配置：<Link to="/settings/preferences">销售偏好</Link>
          <Link to="/settings/memory">销售记忆</Link>
          <Link to="/settings/models">模型通道</Link>
        </p>
      </ArtPanel>
    </section>
  );
}
