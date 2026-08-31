import { ExternalLink, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Lead } from '../../api/types';

/**
 * 客户信息卡 · 看板的基本单元
 *
 * 一张卡 = 一条商机。它替代的是原来的表格行，因此**信息量不许比表格行少**：
 * 主体、评分、行业/地区、规模/截止、产品匹配、信号类型，以及关键人角标与
 * 「有作战卡 / 交叉验证 / 海外」这些既有标记，一个都不能丢。
 *
 * 整卡可点是靠「拉伸链接」实现的（标题链接的 ::after 铺满整张卡），
 * 不是给 <article> 挂 onClick：
 *   · 卡里还有一个「原文」外链，<a> 套 <a> 是非法 HTML；
 *   · onClick 方案对键盘和读屏用户等于没有链接。
 * 「原文」按钮靠更高的 z-index 浮在拉伸层之上，所以它能被独立点到。
 */

function scoreTone(lead: Lead): string {
  if (lead.status === 'rejected') return 'badge-neutral';
  if ((lead.score ?? 0) >= 80) return 'badge-success';
  if ((lead.score ?? 0) >= 60) return 'badge-warning';
  return 'badge-neutral';
}

function day(value?: string | null): string {
  return value ? value.slice(0, 10) : '';
}

/** 事实格：值缺失时说清「公告未提及」，不留空白让人以为是没加载出来。 */
function Fact({ label, value, hint }: { label: string; value?: string | null; hint?: string | null }) {
  return (
    <div className="lead-card-fact">
      <span className="lead-card-fact-label">{label}</span>
      <strong className={value ? '' : 'is-missing'}>{value || '公告未提及'}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

export function ArtLeadCard({ lead }: { lead: Lead }) {
  const title = lead.company || lead.subject || lead.signal_title || '公告未提及采购主体';
  // 关键人角标数的口径与后端 _contact_counts 一致：**不含**被人工标忽略的。
  const contacts = lead.contacts_count ?? 0;
  const announced = lead.contacts_kinds?.announcement ?? 0;
  const inferred = lead.contacts_kinds?.inferred_path ?? 0;
  const manual = lead.contacts_kinds?.manual ?? 0;
  // 后端的 contact_live=true 表示这条的联系人库里没有、是本次请求现抽的。
  // 详情页有「未入库」徽章，卡片上也得看得出来——否则两处对同一条线索的说法不一致。
  const contactsPersisted = !lead.contact_live;

  return (
    <article className={`lead-card${lead.status === 'rejected' ? ' is-rejected' : ''}`}>
      <header className="lead-card-head">
        <span className={`badge ${scoreTone(lead)} lead-card-score`}>
          {lead.status === 'rejected' ? '非商机' : `${lead.score ?? '—'} 分`}
        </span>
        <div className="lead-card-title">
          <h3>
            <Link className="lead-card-link" to={`/opportunities/${lead.id}`}>{title}</Link>
          </h3>
          <small>
            #{lead.id}
            {lead.signal_type ? ` · ${lead.signal_type}` : ' · 未分类信号'}
            {lead.siblings > 1 ? ` · 同一公告 ${lead.siblings} 条标的` : ''}
          </small>
        </div>
      </header>

      {lead.subject && lead.company && <p className="lead-card-subject">{lead.subject}</p>}

      <div className="lead-card-facts">
        <Fact
          label="行业 / 地区"
          value={lead.industry || null}
          hint={lead.region || '公告未提及地区'}
        />
        <Fact
          label="规模 / 截止"
          value={lead.amount || lead.power_range || null}
          hint={lead.deadline ? `截止 ${day(lead.deadline)}` : '截止日期未载'}
        />
        <Fact
          label="产品匹配"
          value={lead.matched_product || null}
          hint={lead.matched_product ? null : '尚未配型'}
        />
      </div>

      <footer className="lead-card-foot">
        <div className="lead-card-tags">
          {contacts > 0 ? (
            <span
              className="badge badge-info lead-card-contacts"
              title={contactsPersisted
                ? `公告实证 ${announced} · 穿透路径 ${inferred} · 人工补录 ${manual}`
                : `本次现抽、未入库：公告实证 ${announced} · 穿透路径 ${inferred} · 人工补录 ${manual}`}
            >
              <Users size={11} aria-hidden="true" />关键人 {contacts}
              {/* 未入库的联系人是这次请求现抽的（后端 persisted=false），
                  下次可能就不一样了——角标上必须看得出来，不能和已入库的长一个样。 */}
              {!contactsPersisted && <i className="lead-card-fresh" aria-label="未入库">*</i>}
            </span>
          ) : (
            <span className="badge badge-neutral" title="公告原文未载可核对的联系方式，可在详情页按穿透路径联系或手动补录">
              <Users size={11} aria-hidden="true" />关键人 0
            </span>
          )}
          {lead.has_card ? <span className="badge badge-success">有作战卡</span> : null}
          {lead.corroboration && <span className="badge badge-ok">交叉验证</span>}
          {lead.overseas && <span className="badge badge-sea">海外</span>}
        </div>
        <a
          className="btn btn-link lead-card-source"
          href={lead.source_url}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
          aria-label={`在新标签打开 ${title} 的公告原文`}
        >
          原文<ExternalLink size={12} aria-hidden="true" />
        </a>
      </footer>
    </article>
  );
}
