import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ExternalLink, RefreshCw } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiGet } from '../../api/client';
import type { Lead } from '../../api/types';
import { AgentPanel } from './AgentPanel';

/**
 * 首页 = 与 Agent 的对话。
 *
 * 曾经这里有「问答 / Agent」两种模式。问答模式是单轮、不带工具的快捷通道，
 * 能力上已被 Agent 完全覆盖（Agent 自己会去读同一批数据，还留下可复盘的轨迹），
 * 留着两个入口只会让人先选一次模式再开口。2026-08-30 拍板下掉，
 * 首页只剩一个对话框。后端 /api/chat 未动——那是别处可能还在用的端点。
 *
 * 2026-08-30 再次精简（负责人指着截图逐块圈掉）：页头标题与说明、面板头
 * 「Agent / 给一个目标…」、工具能力提示条、右侧「Agent 的上下文 + 可用工具」
 * 整条侧栏全部拿掉。理由是它们对用着的人是无效信息——
 * 侧栏那份 30 个工具的目录还把页面撑到 5000px，把首页 hero 挤成一条缝。
 * 这些内容并没有消失：工具目录在「能力配置 → 工具面板」，
 * 记忆与偏好在「记忆面板 / 销售偏好」，各自有正经的页面。
 *
 * 这一层现在只负责两件事：`?lead=` 聚焦上下文，以及把错误如实摊开。
 * 对话本身（消息累积、多轮上文、轨迹、审批卡）全在 AgentPanel 里。
 */
export default function AssistantPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const rawLeadId = searchParams.get('lead');
  const leadId = rawLeadId && /^\d+$/.test(rawLeadId) ? Number(rawLeadId) : null;
  const leads = useQuery({ queryKey: ['leads'], queryFn: () => apiGet<Lead[]>('/api/leads') });
  const activeLead = leadId ? leads.data?.find((lead) => lead.id === leadId) : undefined;
  const invalidContext = Boolean(rawLeadId && leads.isSuccess && !activeLead);

  if (leads.isError) {
    return (
      <section className="page">
        <div className="error-state" role="alert">
          <AlertTriangle size={24} /><h2>助手上下文加载失败</h2>
          <p>{leads.error instanceof Error ? leads.error.message : '无法读取商机索引。'}</p>
          <button className="btn btn-quiet" onClick={() => void leads.refetch()}>
            <RefreshCw size={14} />重新加载
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="page chat-page">
      <div className="chat-column">
        {/* 聚焦某条线索时保留一条极窄的返回入口——它是当前上下文的实指，
            不是介绍性文字；没有它，用户不知道这轮对话挂在哪条线索上。 */}
        {activeLead && (
          <div className="chat-focus-bar">
            <span>聚焦商机 <b>#{activeLead.id}</b> {activeLead.company || activeLead.signal_title}</span>
            <Link className="btn btn-quiet" to={`/opportunities/${activeLead.id}`}>
              查看详情<ExternalLink size={14} />
            </Link>
          </div>
        )}

        {invalidContext && (
          <div className="notice notice-error" role="alert">
            网址里的商机 #{rawLeadId} 当前不存在或已被归并，本次对话按全局上下文进行。
            <button className="btn btn-link" onClick={() => setSearchParams({}, { replace: true })}>
              清掉这个参数
            </button>
          </div>
        )}

        <AgentPanel
          leads={leads.data ?? []}
          focusLead={activeLead}
          onClearFocus={() => setSearchParams({}, { replace: true })}
        />
      </div>
    </section>
  );
}
