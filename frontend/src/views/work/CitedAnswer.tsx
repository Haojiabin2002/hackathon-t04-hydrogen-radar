import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Lead } from '../../api/types';

/**
 * 把回答里的 #13 变成可点链接。
 *
 * 只有当这个 ID 在当前可见的商机列表里才转成链接——模型引用了一个不存在的
 * 编号时保持纯文本，不能造出一个点开是 404 的链接。
 */
export function CitedAnswer({ text, leads }: { text: string; leads: Lead[] }) {
  const known = useMemo(() => new Set(leads.map((lead) => lead.id)), [leads]);
  return (
    <>
      {text.split(/(#\d+)/g).map((part, index): ReactNode => {
        const matched = part.match(/^#(\d+)$/);
        const id = matched ? Number(matched[1]) : null;
        return id && known.has(id)
          ? <Link className="btn-link" to={`/opportunities/${id}`} key={`${part}-${index}`}>{part}</Link>
          : part;
      })}
    </>
  );
}
