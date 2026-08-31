import {
  AlertTriangle,
  Ban,
  BookOpenText,
  CalendarClock,
  CheckCircle2,
  Compass,
  Globe2,
  Loader2,
  Quote,
  ShieldQuestion,
  SlidersHorizontal,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import type {
  Proposal,
  ProposalProbe,
  WeeklyMaterialDigest,
  WeeklyReviewPayload,
} from '../../api/types';

/**
 * 审批卡 · 三种：新增信息源申请 / 拉黑确认 / 每周复盘建议
 *
 * 前两种存在的唯一理由是防钓鱼。提案的 domain / title / reason 全部抽自
 * **公开网页**，是不可信数据：
 *   · 一律纯文本渲染（React 默认转义，别改成 dangerouslySetInnerHTML）
 *   · 域名和网址单独拎出来醒目展示，不做成可点链接——
 *     批准一个源等于把它写进抓取名单，人要先看清那串字符本身
 *   · 理由只是申请人的说法，不是证据，界面上要这么写
 *
 * 第三种（weekly_review）的文字是**模型写的**，同样按不可信数据渲染。
 * 它的重点不是域名而是「依据」：suggestion 是模型的主张，evidence 才是它能不能
 * 兑现的凭证。所以依据单独成块、旁边贴上后端存下来的真实数字，
 * 让人当场对得上；对不上的建议就该驳回。
 */

function kindLabel(kind: string): string {
  if (kind === 'add_source') return '新增信息源申请';
  if (kind === 'deny_domain') return '拉黑确认';
  if (kind === 'weekly_review') return '每周复盘建议';
  return `未知提案类型（${kind}）`;
}

function statusBadge(status: string) {
  if (status === 'approved') return <span className="badge badge-success">已批准</span>;
  if (status === 'rejected') return <span className="badge badge-neutral">已驳回</span>;
  return <span className="badge badge-inferred">待审</span>;
}

/**
 * 后端那句回话里带 markdown 的 `**强调**`（"系统**没有**改动 knowledge.md"）。
 * 这里只把星号换成 <strong>，一个字都不改、也不解析任何其它标记——
 * 那句话是要原样给人看的。
 */
function emphasize(text: string) {
  return text.split(/\*\*(.+?)\*\*/g).map((part, index) => (
    index % 2 === 1 ? <b key={index}>{part}</b> : <span key={index}>{part}</span>
  ));
}

/** 复探报告摘要。批准新增源时服务端会真跑一次 crawler.probe_source。 */
function ProbeSummary({ probe }: { probe: ProposalProbe }) {
  if (!probe.ok) {
    return (
      <div className="notice notice-warning" role="status">
        <AlertTriangle size={13} aria-hidden="true" />
        {' '}服务端复探失败：{probe.error ?? '后端未给出原因'}。
        批准仍然生效（那是人的决定），但这个站点当下抓不动，源注册那一步要据此再判一次。
      </div>
    );
  }
  const report = probe.report;
  if (!report) return null;
  return (
    <div className="proposal-probe">
      <p>
        <b>服务端复探：</b>
        {report.usable ? '可用' : '不可用'} · {report.verdict}
      </p>
      <small className="form-hint">
        列表页关键词链接 {report.keyword_links} 条 · 文章特征 {report.article_pattern || '未识别'}
        {report.samples?.length ? ` · 取样 ${report.samples.length} 篇` : ''}
        {probe.probed_at ? ` · ${probe.probed_at}` : ''}
      </small>
      {(report.detail?.length ?? 0) > 0 && (
        <ul className="proposal-probe-detail">
          {(report.detail ?? []).map((line, index) => <li key={index}>{line}</li>)}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 每周复盘

const WEEKLY_TYPES: Record<string, {
  label: string;
  icon: typeof BookOpenText;
  /** 批准后要人亲手落地的地方。批准本身不改任何文件。 */
  links: Array<{ to: string; label: string }>;
  hint: string;
}> = {
  knowledge_edit: {
    label: '知识库补充',
    icon: BookOpenText,
    links: [{ to: '/knowledge/main', label: '打开主知识库编辑页' }],
    hint: '批准 = 标记「已采纳」。系统不会替你改 knowledge.md——改一句就会改变之后所有线索的打分口径，这一步由人亲手落笔。',
  },
  preference_edit: {
    label: '偏好调整',
    icon: SlidersHorizontal,
    links: [
      { to: '/settings/preferences', label: '打开销售偏好' },
      { to: '/settings/memory', label: '打开记忆面板' },
    ],
    hint: '批准 = 标记「已采纳」。系统不会替你改偏好或记忆——它们每轮都注入 agent 上下文，改动由人亲手做。',
  },
  source_focus: {
    label: '检索重心',
    icon: Compass,
    links: [{ to: '/sources', label: '打开数据源' }],
    hint: '批准 = 标记「已采纳」。这条只是下周的检索重心备忘，系统不会自动改采集配置。',
  },
};

const DIGEST_LABELS: Array<[keyof WeeklyMaterialDigest, string]> = [
  ['new_signals', '新增公告'],
  ['new_leads', '新增线索'],
  ['new_cards', '新增作战卡'],
  ['rejected_ratio', '判非商机占比'],
  ['dead_end_total', '触网撞墙'],
  ['new_memories', '新增记忆'],
];

function digestValue(key: keyof WeeklyMaterialDigest, value: number | null | undefined) {
  // null 是「这一段素材读失败」，不是 0——两者在界面上必须分得开。
  if (value === null || value === undefined) return '读不出来';
  if (key === 'rejected_ratio') return `${(value * 100).toFixed(1)}%`;
  return String(value);
}

/** 依据块：这张卡最重要的部分。没有依据的建议不值得批。 */
function WeeklyEvidence({ payload }: { payload: WeeklyReviewPayload }) {
  const evidence = String(payload.evidence ?? '').trim();
  const digest = payload.material_digest;
  const rows = digest
    ? DIGEST_LABELS.filter(([key]) => key in digest)
    : [];

  return (
    <div className="proposal-evidence">
      <Quote size={14} aria-hidden="true" />
      <div>
        <b>依据</b>
        <p>{evidence || '（这条提案没写依据——后端本应拦下，遇到就直接驳回）'}</p>
        {rows.length > 0 && (
          <dl className="proposal-digest">
            {rows.map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{digestValue(key, digest?.[key])}</dd>
              </div>
            ))}
          </dl>
        )}
        <small className="form-hint">
          上面这行数字是复盘当时由代码统计后随提案存下来的，不是模型算的；
          依据里的说法要能和它们对得上，对不上就驳回。
        </small>
      </div>
    </div>
  );
}

function WeeklyBody({ proposal, outcome }: {
  proposal: Proposal;
  outcome?: { message: string; error?: boolean };
}) {
  const payload = proposal.payload as WeeklyReviewPayload;
  const type = String(payload.type ?? '');
  const spec = WEEKLY_TYPES[type];
  const suggestion = String(payload.suggestion ?? '').trim();
  const win = payload.window;
  const flags = Array.isArray(payload.flags) ? payload.flags : [];
  const approved = proposal.status === 'approved';

  return (
    <>
      <div className="proposal-weekly-meta">
        <CalendarClock size={13} aria-hidden="true" />
        <span>
          {payload.week ? `第 ${payload.week} 周` : '（未注明周次）'}
          {win?.from && win?.to ? ` · 素材窗口 ${win.from} 至 ${win.to}` : ''}
          {payload.generated_at ? ` · 生成于 ${payload.generated_at}` : ''}
        </span>
      </div>

      <dl className="proposal-fields">
        {type === 'knowledge_edit' && (
          <>
            <dt>目标小节</dt>
            <dd>{String(payload.section ?? '').trim() || '（未注明小节）'}</dd>
          </>
        )}
        {type === 'source_focus' && (
          <>
            <dt>检索方向</dt>
            <dd>{String(payload.direction ?? '').trim() || '（未注明方向）'}</dd>
          </>
        )}
        <dt>建议动作</dt>
        <dd>{suggestion || '（未填）'}</dd>
      </dl>

      <WeeklyEvidence payload={payload} />

      {flags.map((flag, index) => (
        <div className="notice notice-warning" role="status" key={index}>
          <AlertTriangle size={13} aria-hidden="true" />{' '}{flag}
        </div>
      ))}

      <p className="form-hint">
        {spec?.hint
          ?? '批准 = 标记「已采纳」。系统不会自动改动任何文件，落地动作由人执行。'}
      </p>

      {approved && payload.adopted_at && !outcome && (
        <div className="notice" role="status">
          <CheckCircle2 size={13} aria-hidden="true" />
          {' '}已于 {payload.adopted_at} 标记为「已采纳」。系统未做任何自动改动。
        </div>
      )}
    </>
  );
}

/** 批准后的「去哪改」直达链接。后端那句指路原样显示在上面的回执里，这里配腿。 */
function WeeklyFollowup({ type }: { type: string }) {
  const spec = WEEKLY_TYPES[type];
  if (!spec) return null;
  return (
    <div className="proposal-followup">
      <small className="form-hint">落地动作要人亲手做，从这里去：</small>
      <div className="row-actions">
        {spec.links.map((link) => (
          <Link className="btn btn-quiet" to={link.to} key={link.to}>
            {link.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 卡本体

export function ArtProposalCard({ proposal, onResolve, busy, outcome }: {
  proposal: Proposal;
  /** 不给就是只读展示（例如已裁决过的历史卡） */
  onResolve?: (approve: boolean) => void;
  busy?: boolean;
  /** 裁决完成后后端返回的那句话 */
  outcome?: { message: string; error?: boolean };
}) {
  const { payload } = proposal;
  const isWeekly = proposal.kind === 'weekly_review';
  const isDeny = proposal.kind === 'deny_domain';
  const target = String(payload.url ?? payload.example_url ?? '').trim();
  const domain = String(payload.domain ?? '').trim();
  const probe = payload.probe_report;
  const pending = proposal.status === 'pending';
  const weeklySpec = isWeekly ? WEEKLY_TYPES[String(payload.type ?? '')] : undefined;
  const WeeklyIcon = weeklySpec?.icon;

  return (
    <article className={`proposal-card ${isDeny ? 'is-deny' : ''} ${isWeekly ? 'is-weekly' : ''}`}>
      <header className="proposal-card-head">
        <div>
          <b>
            {isWeekly && WeeklyIcon ? <WeeklyIcon size={14} aria-hidden="true" /> : null}
            {isWeekly && !WeeklyIcon ? <CalendarClock size={14} aria-hidden="true" /> : null}
            {!isWeekly && (isDeny
              ? <Ban size={14} aria-hidden="true" />
              : <ShieldQuestion size={14} aria-hidden="true" />)}
            {' '}{kindLabel(proposal.kind)}
            {isWeekly && (
              <span className="badge badge-neutral">
                {weeklySpec?.label ?? `未知子类型（${String(payload.type ?? '空')}）`}
              </span>
            )}
          </b>
          <small className="form-hint">{proposal.created}{proposal.resolved ? ` · 裁决于 ${proposal.resolved}` : ''}</small>
        </div>
        {statusBadge(proposal.status)}
      </header>

      {isWeekly ? <WeeklyBody proposal={proposal} outcome={outcome} /> : (
        <>
          {/* 域名/网址：这张卡最要紧的一行，单独醒目展示，且不做成链接 */}
          <div className="proposal-target">
            <Globe2 size={14} aria-hidden="true" />
            <div>
              <code>{domain || '（提案没写域名）'}</code>
              {target && <code className="proposal-target-url">{target}</code>}
              <small className="form-hint">
                以上字符抽自公开网页，未做成可点链接。要打开请自行复制，先看清这串域名本身。
              </small>
            </div>
          </div>

          <dl className="proposal-fields">
            {!isDeny && (
              <>
                <dt>网站 Title</dt>
                <dd>{String(payload.title ?? '').trim() || '（页面没给标题）'}</dd>
              </>
            )}
            <dt>{isDeny ? '拉黑理由' : '申请理由'}</dt>
            <dd>{String(payload.reason ?? '').trim() || '（未填）'}</dd>
            {!isDeny && payload.task && (
              <>
                <dt>来自任务</dt>
                <dd>{String(payload.task)}</dd>
              </>
            )}
          </dl>

          <p className="form-hint">
            {isDeny
              ? '同域第二次撞上人机验证才会生成这张卡。批准 = 该域写入本机 overlay，之后一律拒抓。'
              : '理由是申请人的说法，不是证据。批准后服务端会真去抓一次这个站点并把报告贴回这张卡；常驻源注册由数据侧完成。'}
          </p>

          {probe && <ProbeSummary probe={probe} />}
        </>
      )}

      {outcome && (
        <div className={`notice ${outcome.error ? 'notice-error' : ''}`} role="status">
          {outcome.error
            ? <AlertTriangle size={13} aria-hidden="true" />
            : <CheckCircle2 size={13} aria-hidden="true" />}
          {' '}{emphasize(outcome.message)}
        </div>
      )}

      {isWeekly && proposal.status === 'approved' && (
        <WeeklyFollowup type={String(payload.type ?? '')} />
      )}

      {onResolve && pending && (
        <div className="row-actions proposal-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => onResolve(true)}
          >
            {busy && <Loader2 size={14} className="art-trace-spin" aria-hidden="true" />}
            批准
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy}
            onClick={() => onResolve(false)}
          >
            驳回
          </button>
        </div>
      )}
    </article>
  );
}
