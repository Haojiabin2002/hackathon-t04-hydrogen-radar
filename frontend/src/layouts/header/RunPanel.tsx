import { CircleDot, X } from 'lucide-react';
import type { CollectStatus } from '../../api/types';
import { formatTime } from '../../hooks/useCollectStatus';

/**
 * 采集运行详情 · 从顶栏状态按钮展开
 *
 * ⚠️ 后端不提供阶段进度，因此运行中只显示不确定进度条，绝不合成百分比。
 */
export function RunPanel({ status, onClose }: { status?: CollectStatus; onClose: () => void }) {
  const result = status?.last_result;
  const outcome = status?.last_error
    ? '上次运行失败'
    : result?.crawler_error
      ? '采集进程异常'
      : result?.source_errors?.length
        ? '部分数据源未成功'
        : result?.pipeline?.startsWith('blocked')
          ? '采集完成，研判受阻'
          : result
            ? '上次运行已完成'
            : '尚无运行结果';

  return (
    <aside className="run-panel" aria-label="雷达运行详情">
      <div className="run-panel-head">
        <div>
          <span className="run-label">采集链路</span>
          <h2>{status?.running ? '雷达正在采集真实信号' : outcome}</h2>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭运行详情">
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      {status?.running && (
        <div className="run-live" role="status">
          <span className="run-live-track"><i /></span>
          <p>正在等待后端返回真实结果。当前接口未提供阶段进度，因此不显示虚假百分比。</p>
        </div>
      )}

      <dl className="run-facts">
        <div><dt>上次运行</dt><dd>{formatTime(status?.last_at)}</dd></div>
        <div><dt>下次计划</dt><dd>{status?.schedule_enabled ? formatTime(status?.next_at) : '自动任务未启用'}</dd></div>
        <div><dt>新增信号</dt><dd>{result?.crawler_added ?? '—'}</dd></div>
        <div><dt>异常信源</dt><dd>{result?.source_errors?.length ?? 0}</dd></div>
      </dl>

      {(status?.last_error || result?.crawler_error || result?.pipeline) && (
        <div className="run-result">
          <CircleDot size={16} aria-hidden="true" />
          <p>{status?.last_error || result?.crawler_error || result?.pipeline}</p>
        </div>
      )}
    </aside>
  );
}
