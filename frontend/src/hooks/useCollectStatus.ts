import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiMutation } from '../api/client';
import type { CollectStartResult, CollectStatus, RadarStats } from '../api/types';

/**
 * 采集链路状态 · 顶栏与当日研判共用
 *
 * ⚠️ 这里的判断口径受 CLAUDE.md 第四条约束：
 * 模型阻塞、来源错误、采集异常都必须原样透出，不许被"部分成功"或空状态吞掉。
 * 改这段之前先确认不会让一次失败的采集在界面上看起来像成功。
 */

export function formatTime(value?: string | null): string {
  if (!value) return '暂无记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/**
 * @param watchCompletion 是否负责"采集结束后重取看板数据"。
 *   这个副作用**只能有一个持有者**（当前是 ArtHeaderBar）——
 *   本 hook 会被侧栏和顶栏分别调用，不加这道闸就会重复触发。
 */
export function useCollectStatus({ watchCompletion = false } = {}) {
  const queryClient = useQueryClient();

  const stats = useQuery({
    queryKey: ['stats'],
    queryFn: () => apiGet<RadarStats>('/api/stats'),
    staleTime: 15_000,
  });

  const status = useQuery({
    queryKey: ['collect-status'],
    queryFn: () => apiGet<CollectStatus>('/api/collect/status'),
    refetchInterval: (query) => (query.state.data?.running ? 2500 : 15_000),
  });

  const start = useMutation({
    mutationFn: () => apiMutation<CollectStartResult>('/api/collect', 'POST'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['collect-status'] });
    },
  });

  const isRunning = Boolean(status.data?.running);

  // 采集从"运行中"落回"已结束"的那一刻，把看板数据全部作废重取。
  // 少了这一步，采集完成后 signals / leads / stats 会一直停在旧值——
  // stats 是 refetchOnWindowFocus: false，页面开着就永远不会自己更新。
  const wasRunning = useRef(false);
  useEffect(() => {
    if (!watchCompletion) return;
    if (wasRunning.current && !isRunning) {
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      void queryClient.invalidateQueries({ queryKey: ['signals'] });
      void queryClient.invalidateQueries({ queryKey: ['leads'] });
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
    }
    wasRunning.current = isRunning;
  }, [watchCompletion, isRunning, queryClient]);

  const result = status.data?.last_result;
  const lastError = status.data?.last_error?.trim() ?? '';
  const crawlerError = result?.crawler_error?.trim() ?? '';
  const pipelineStatus = result?.pipeline?.trim() ?? '';
  const sourceErrorCount = result?.source_errors?.length ?? 0;

  // 研判进程非 0 退出码，或文案里出现模型/通道相关字样，都算阻断
  const pipelineBlocked =
    /blocked|阻塞|模型|通道|llm/i.test(pipelineStatus) || /\brc=(?!0\b)-?\d+\b/i.test(pipelineStatus);
  const chainBlocked =
    status.isError || Boolean(lastError || crawlerError) || pipelineBlocked;
  const chainFailed = !isRunning && (chainBlocked || sourceErrorCount > 0);

  const headline = isRunning
    ? '雷达运行中'
    : status.isError
      ? '链路状态不可用'
      : lastError
        ? '采集链路失败'
        : crawlerError
          ? '采集链路阻断'
          : pipelineBlocked
            ? '研判链路阻断'
            : sourceErrorCount > 0
              ? '部分来源异常'
              : `${stats.data?.signals ?? '—'} 条信号`;

  const detail = isRunning
    ? '正在等待真实结果'
    : status.isError
      ? status.error instanceof Error
        ? status.error.message
        : '无法读取采集状态'
      : lastError
        ? lastError
        : crawlerError
          ? `采集异常：${crawlerError}`
          : pipelineBlocked
            ? pipelineStatus
            : sourceErrorCount > 0
              ? `${sourceErrorCount} 个数据源采集失败`
              : `上次 ${formatTime(status.data?.last_at)}`;

  return {
    stats,
    status,
    start,
    isRunning,
    chainFailed,
    chainBlocked,
    headline,
    detail,
    sourceErrorCount,
  };
}
