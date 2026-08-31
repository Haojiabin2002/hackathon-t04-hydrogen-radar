import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../api/client';
import type { ProposalStatus, ProposalsResponse } from '../api/types';

/**
 * 审批队列。来源：GET /api/proposals（api.py list_proposals_api）。
 *
 * 队列文件在本机 ~/.config/hydrogen-radar/proposals.json，agent 跑调查任务时
 * 会往里写；所以刷新间隔要短一点，否则跑完一轮还得手动刷新才看得见新卡。
 */
export const PROPOSALS_KEY = 'proposals';

/** 'all' 不是提案自身的状态，是后端筛选参数里的「不过滤」——审批页的历史 tab 用它。 */
export type ProposalFilter = ProposalStatus | 'all';

export function useProposals(status: ProposalFilter = 'pending') {
  return useQuery({
    queryKey: [PROPOSALS_KEY, status],
    queryFn: () => apiGet<ProposalsResponse>(`/api/proposals?status=${status}`),
    refetchInterval: 60_000,
    // 触网模块不可用时后端给 503。侧栏徽标读不到就不画，别一直重试刷屏。
    retry: false,
  });
}

/**
 * 侧栏徽标用的待审数。
 *
 * 读不到就返回 null——**不许拿 0 顶替**：「没有待审」和「读不出来」
 * 在界面上必须是两回事，0 会让人以为审批队列是空的。
 */
export function useProposalCount(): number | null {
  const query = useProposals('pending');
  if (!query.isSuccess) return null;
  const pending = query.data?.pending;
  return typeof pending === 'number' ? pending : null;
}
