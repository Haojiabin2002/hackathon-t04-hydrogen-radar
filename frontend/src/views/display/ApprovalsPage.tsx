import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Inbox, RefreshCw, Stamp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiMutation } from '../../api/client';
import type { Proposal, ProposalResolveResult } from '../../api/types';
import { ArtPageHead } from '../../components/cards/ArtPageHead';
import { ArtProposalCard } from '../../components/cards/ArtProposalCard';
import { useRouteMeta } from '../../hooks/useRouteMeta';
import { PROPOSALS_KEY, useProposals } from '../../hooks/useProposals';
import type { ProposalFilter } from '../../hooks/useProposals';

/**
 * 审批页 · 三种卡：新增信息源申请 / 拉黑确认 / 每周复盘建议
 *
 * 卡片本体在 components/cards/ArtProposalCard.tsx（首页对话里用的是同一张），
 * 裁决走同一个 POST /api/proposals/{id}/resolve，所以两处结果一致。
 *
 * 这一页刻意不做批量勾选、不做全部批准：批准一个源等于把一个域名写进抓取名单，
 * 那是一次一条、要看清域名再点的动作。
 */

type Tab = { key: ProposalFilter; label: string };

const TABS: Tab[] = [
  { key: 'pending', label: '待审' },
  { key: 'all', label: '全部（含历史）' },
];

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '请求未能完成';
}

export default function ApprovalsPage() {
  const meta = useRouteMeta();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab['key']>('pending');
  // 裁决回执按提案 id 记住：后端那句 message 里写着「常驻源注册由数据侧完成」
  // 之类的后续动作，刷完列表就没了，所以留在卡上。
  const [outcomes, setOutcomes] = useState<Record<string, { message: string; error?: boolean }>>({});
  // 刚裁决过的那张卡：裁决完它就不在「待审」结果里了，列表一刷新就整张消失，
  // 连带后端那句回执（周复盘的「去哪改」、新增源的复探报告）也一起没了。
  // 所以把它按原位留在页面上，直到人切换筛选或刷新队列。
  const [justResolved, setJustResolved] = useState<Record<string, { proposal: Proposal; index: number }>>({});

  const proposals = useProposals(tab);

  const items = useMemo(() => {
    const base = [...(proposals.data?.proposals ?? [])];
    const seen = new Set(base.map((item) => item.id));
    Object.values(justResolved)
      .filter((entry) => !seen.has(entry.proposal.id))
      .sort((a, b) => a.index - b.index)
      .forEach((entry) => base.splice(Math.min(entry.index, base.length), 0, entry.proposal));
    return base;
  }, [justResolved, proposals.data]);

  const resolveProposal = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      apiMutation<ProposalResolveResult>(
        `/api/proposals/${encodeURIComponent(id)}/resolve`,
        'POST',
        { approve },
      ),
    onSuccess: (result, variables) => {
      setOutcomes((current) => ({ ...current, [variables.id]: { message: result.message } }));
      // result.proposal 是裁决后的那条（status 已经是 approved/rejected），
      // 位置沿用它裁决前在列表里的下标，别让卡片跳到别处去。
      setJustResolved((current) => ({
        ...current,
        [variables.id]: {
          proposal: result.proposal,
          index: Math.max(items.findIndex((item) => item.id === variables.id), 0),
        },
      }));
      void queryClient.invalidateQueries({ queryKey: [PROPOSALS_KEY] });
    },
    onError: (error, variables) => {
      setOutcomes((current) => ({
        ...current,
        [variables.id]: { message: errorMessage(error), error: true },
      }));
    },
  });

  return (
    <section className="page">
      <ArtPageHead
        compact
        title={meta?.title ?? '审批'}
        description={meta?.description}
        actions={(
          <button
            className="btn btn-quiet"
            type="button"
            disabled={proposals.isFetching}
            onClick={() => {
              // 刷新 = 人主动要一份新队列，留在页面上的那几张裁决完的卡到此为止
              setJustResolved({});
              void proposals.refetch();
            }}
          >
            <RefreshCw size={14} />{proposals.isFetching ? '正在刷新…' : '刷新队列'}
          </button>
        )}
      />

      {proposals.isError && (
        <div className="error-state" role="alert">
          <AlertTriangle size={24} />
          <h2>审批队列读取失败</h2>
          <p>{errorMessage(proposals.error)}</p>
          <button className="btn btn-quiet" type="button" onClick={() => void proposals.refetch()}>
            <RefreshCw size={14} />重新加载
          </button>
        </div>
      )}

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>待裁决</h2>
            <p>
              队列文件在本机 ~/.config/hydrogen-radar/proposals.json，由 agent 的调查任务写入；
              也可以在<Link className="btn-link" to="/">对话</Link>里当场裁决，用的是同一个接口。
            </p>
          </div>
          <div className="toolbar-group" role="tablist" aria-label="审批队列筛选">
            {TABS.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={tab === item.key}
                className={tab === item.key ? 'filter-chip is-active' : 'filter-chip'}
                onClick={() => {
                  setTab(item.key);
                  setJustResolved({});
                }}
              >
                {item.label}
                {item.key === 'pending' && proposals.isSuccess && ` ${proposals.data.pending}`}
              </button>
            ))}
            <Stamp size={16} aria-hidden="true" />
          </div>
        </div>

        <div className="panel-body">
          {proposals.isLoading && (
            <div className="loading-stack" aria-busy="true" aria-label="正在加载审批队列">
              <div className="skeleton skeleton-line" />
              <div className="skeleton skeleton-line" />
            </div>
          )}

          {proposals.isSuccess && items.length === 0 && (
            <div className="empty-state">
              <Inbox size={26} />
              <h3>{tab === 'pending' ? '暂无待审提案' : '队列里还没有任何提案'}</h3>
              <p>
                提案由 agent 在调查任务里提出：遇到没抓过的站点会申请新增信息源，
                同一个域名两次撞上人机验证会申请拉黑；每周一的复盘还会带着本周真实数字
                提优化点。这里不会预置样例卡。
              </p>
            </div>
          )}

          {items.length > 0 && (
            <div className="stack">
              {items.map((proposal) => (
                <ArtProposalCard
                  key={proposal.id}
                  proposal={proposal}
                  outcome={outcomes[proposal.id]}
                  busy={resolveProposal.isPending && resolveProposal.variables?.id === proposal.id}
                  onResolve={(approve) => resolveProposal.mutate({ id: proposal.id, approve })}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </section>
  );
}
