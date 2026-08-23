import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Brain, Plus, Trash2 } from 'lucide-react';
import { apiGet, apiMutation, MemoryDeleteResult, MemoryItem } from '../../api';
import { ArtPageHead } from '../../components/cards/ArtPageHead';
import { useRouteMeta } from '../../hooks/useRouteMeta';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '请求未能完成';
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || '时间未知';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export default function MemoryPage() {
  const meta = useRouteMeta();
  const queryClient = useQueryClient();
  const [content, setContent] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const memoryQuery = useQuery({
    queryKey: ['memory'],
    queryFn: () => apiGet<MemoryItem[]>('/api/memory'),
  });

  const addMutation = useMutation({
    mutationFn: (value: string) => apiMutation<MemoryItem>('/api/memory', 'POST', { content: value }),
    onSuccess: () => {
      setContent('');
      setMessage('偏好已写入销售助手的长期记忆。');
      queryClient.invalidateQueries({ queryKey: ['memory'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiMutation<MemoryDeleteResult>(`/api/memory/${encodeURIComponent(id)}`, 'DELETE'),
    onSuccess: () => {
      setDeleteId(null);
      setMessage('这条偏好已删除，之后的对话不会再注入它。');
      queryClient.invalidateQueries({ queryKey: ['memory'] });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = content.trim();
    if (value) addMutation.mutate(value);
  }

  return (
    <main className="page">
      <ArtPageHead
        compact
        title={meta?.title ?? '销售记忆'}
        description={meta?.description}
        actions={<span className="badge badge-neutral">{memoryQuery.data?.length ?? 0} / 50 条</span>}
      />

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>新增关注偏好</h2>
            <p>一条只写一个长期规则，避免把临时任务保存为永久偏好。</p>
          </div>
        </div>
        <form className="panel-body" onSubmit={submit}>
          <div className="field">
            <label htmlFor="memory-content">记忆内容</label>
            <textarea
              id="memory-content"
              maxLength={200}
              value={content}
              onChange={(event) => {
                setContent(event.target.value);
                setMessage('');
              }}
              placeholder="例如：优先关注澳大利亚矿区、港口短倒与重卡替换项目。"
            />
            <small>{content.length}/200 字</small>
          </div>
          <div className="form-actions">
            <button
              className="btn btn-primary"
              type="submit"
              disabled={!content.trim() || addMutation.isPending || (memoryQuery.data?.length ?? 0) >= 50}
            >
              <Plus size={14} />{addMutation.isPending ? '正在保存…' : '加入长期记忆'}
            </button>
          </div>
          {addMutation.isError && <p className="notice notice-error" role="alert">{errorMessage(addMutation.error)}</p>}
          {message && <p className="notice" role="status">{message}</p>}
        </form>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>已保存偏好</h2>
            <p>删除立即生效，但不会改写历史对话或既有线索。</p>
          </div>
        </div>

        {memoryQuery.isLoading && (
          <div className="loading-stack" aria-busy="true" aria-label="正在加载销售记忆">
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line" />
          </div>
        )}

        {memoryQuery.isError && (
          <div className="error-state" role="alert">
            <AlertTriangle />
            <h2>销售记忆没有加载成功</h2>
            <p>{errorMessage(memoryQuery.error)}</p>
            <button className="btn btn-quiet" type="button" onClick={() => memoryQuery.refetch()}>重新加载</button>
          </div>
        )}

        {memoryQuery.data?.length === 0 && (
          <div className="empty-state">
            <Brain />
            <h2>销售助手还没有长期偏好</h2>
            <p>这不会阻止系统工作；助手会只根据当前线索和知识库回答。</p>
          </div>
        )}

        {!!memoryQuery.data?.length && (
          <div className="memory-list panel-body">
            {memoryQuery.data.map((item, index) => (
              <article className="memory-row" key={item.id}>
                <div className="memory-row-head">
                  <div>
                    <span className="badge badge-info">偏好 {index + 1}</span>
                    <p>{item.content}</p>
                    <p>保存于 {formatTime(item.created_at)}</p>
                  </div>
                  <button className="btn btn-danger" type="button" onClick={() => setDeleteId(item.id)}>
                    <Trash2 size={13} />删除
                  </button>
                </div>
                {deleteId === item.id && (
                  <div className="inline-confirm" role="group" aria-label="确认删除销售记忆">
                    <span>确认删除这条长期偏好？之后的回答将不再参考它。</span>
                    <div>
                      <button className="btn btn-quiet" type="button" disabled={deleteMutation.isPending} onClick={() => setDeleteId(null)}>取消</button>
                      <button className="btn btn-danger" type="button" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate(item.id)}>
                        {deleteMutation.isPending ? '正在删除…' : '确认删除'}
                      </button>
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}

        {deleteMutation.isError && <p className="notice notice-error" role="alert">{errorMessage(deleteMutation.error)}</p>}
      </section>
    </main>
  );
}
