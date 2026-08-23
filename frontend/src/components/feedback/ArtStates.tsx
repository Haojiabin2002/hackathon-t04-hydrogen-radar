import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * 加载 / 空 / 错误 三态
 *
 * ⚠️ CLAUDE.md 第四条：空态和错误态必须分开。
 * "没有关联记录" 和 "研判受阻" 是两回事，不许用同一个空态吞掉。
 */

export function ArtLoading({ label = '正在加载', lines = 3 }: { label?: string; lines?: number }) {
  return (
    <div className="panel loading-stack" aria-busy="true" aria-label={label}>
      {Array.from({ length: lines }, (_, index) => (
        <div className="skeleton skeleton-line" key={index} />
      ))}
    </div>
  );
}

export function ArtEmpty({
  icon,
  title,
  description,
  actions,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="empty-state panel">
      {icon}
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {actions && <div className="row-actions">{actions}</div>}
    </div>
  );
}

export function ArtError({
  title,
  error,
  onRetry,
}: {
  title: string;
  error: unknown;
  onRetry?: () => void;
}) {
  const message = error instanceof Error ? error.message : '接口未返回可用内容。';
  return (
    <div className="error-state" role="alert">
      <AlertTriangle size={24} aria-hidden="true" />
      <h3>{title}</h3>
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="btn btn-quiet" onClick={onRetry}>
          <RefreshCw size={15} aria-hidden="true" />重新读取
        </button>
      )}
    </div>
  );
}
