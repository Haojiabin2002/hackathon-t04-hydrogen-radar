import { ChangeEvent, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, Code2, FileWarning, Pencil, Plus, RefreshCw,
  Save, ShieldAlert, Trash2, Upload, Wrench,
} from 'lucide-react';
import {
  apiGet,
  apiMutation,
  ToolConfirmResult,
  ToolCustomFile,
  ToolEntry,
  ToolFileDeleteResult,
  ToolReloadResult,
  ToolsResponse,
  ToolSourceSaveResult,
  ToolToggleResult,
} from '../../api';
import { apiGetText } from '../../api/client';
import { ArtPageHead } from '../../components/cards/ArtPageHead';
import { useRouteMeta } from '../../hooks/useRouteMeta';
import './tools.css';

/**
 * 工具面板 —— agent 能调的全部工具，以及人对它们的启停 / 确认要求 / 源码管理
 *
 * 接口（契约来源 radar/api.py，读取公开、写操作要 X-Radar-Local 头）：
 *   GET    /api/tools                      全量视图：工具 + 装载错误 + 目录文件 + 配置问题
 *   POST   /api/tools/reload               重新扫描 tools_custom/
 *   PUT    /api/tools/{name}/toggle        启停（内置与自定义通用）
 *   PUT    /api/tools/{name}/confirm       确认要求，**只许收紧**，放松一律 400
 *   GET    /api/tools/custom/{file}        读源码，text/plain，坏文件也读得到
 *   PUT    /api/tools/custom/{file}        新建 / 覆盖 / 上传（同一个动词）
 *   DELETE /api/tools/custom/{file}        删除
 *
 * 这个页面**只呈现，不放宽**：
 *  · 自定义工具 requires_confirm 恒为 true，界面不给放松的入口；
 *  · confirm_locked 的工具确认开关置灰，理由写在旁边；
 *  · 后端拒绝放松时返回的 400 detail 原样显示，不改写、不吞掉；
 *  · 装载失败的文件在顶部单独列出来——坏文件不许悄悄消失，否则人不知道自己
 *    上传的工具为什么没出现在清单里。
 */

/** 副作用等级的展示顺序。标签文案取后端 effect_labels，前端不写死。 */
const EFFECT_ORDER = ['readonly', 'write', 'net', 'proposal', 'unknown'];

/** 与后端 CUSTOM_FILE_RE 对齐；下划线开头的文件装载器会跳过。 */
const FILE_RE = /^[\w-]{1,60}\.py$/;

const MODE_LABEL: Record<string, string> = { chat: '问答', investigate: '调查' };

/** 后端示例工具的文件名，用作「新建」的模板来源。 */
const TEMPLATE_FILE = 'hello_custom.py';

/** 示例工具被删掉时的兜底骨架——契约照抄自 radar/tools.py 的文件契约。 */
const FALLBACK_TEMPLATE = `"""自定义工具 · 一个文件一个工具

契约：模块级 TOOL 字典 + 模块级 run(args) 函数。
run 必须返回可 JSON 序列化的 dict；参数不对就抛 ValueError("说人话的原因")。
这段代码在本机以服务进程权限执行，只写你自己看得懂的东西。
"""

TOOL = {
    "name": "my_tool",
    "desc": "一句话说清这个工具干什么——模型靠它决定要不要调用",
    "args": {"keyword": "要查的关键词"},
}


def run(args):
    keyword = str(args.get("keyword") or "").strip()
    if not keyword:
        raise ValueError("keyword 不能为空")
    return {"keyword": keyword, "note": "把真实逻辑写在这里"}
`;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '请求未能完成';
}

function fileNameOf(name: string) {
  const trimmed = name.trim();
  return trimmed.endsWith('.py') ? trimmed : `${trimmed}.py`;
}

interface EditorState {
  file: string;
  content: string;
  /** 新建 / 上传时文件名可改；编辑既有文件时钉死 */
  isNew: boolean;
  hint: string;
}

export default function ToolsPage() {
  const meta = useRouteMeta();
  const queryClient = useQueryClient();
  const uploadRef = useRef<HTMLInputElement>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleteFile, setDeleteFile] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [localError, setLocalError] = useState('');

  const toolsQuery = useQuery({
    queryKey: ['tools'],
    queryFn: () => apiGet<ToolsResponse>('/api/tools'),
  });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['tools'] });
    queryClient.invalidateQueries({ queryKey: ['agent-tools'] });
  }

  const toggleMutation = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
      apiMutation<ToolToggleResult>(`/api/tools/${encodeURIComponent(name)}/toggle`, 'PUT', { enabled }),
    onSuccess: (result) => {
      setMessage(`${result.name} 已${result.enabled ? '启用' : '停用'}。`);
      refresh();
    },
  });

  const confirmMutation = useMutation({
    mutationFn: ({ name, requiresConfirm }: { name: string; requiresConfirm: boolean }) =>
      apiMutation<ToolConfirmResult>(`/api/tools/${encodeURIComponent(name)}/confirm`, 'PUT', {
        requires_confirm: requiresConfirm,
      }),
    onSuccess: (result) => {
      setMessage(`${result.name} ${result.requires_confirm ? '现在需要人工确认' : '已取消额外的确认要求'}。`);
      refresh();
    },
  });

  const reloadMutation = useMutation({
    mutationFn: () => apiMutation<ToolReloadResult>('/api/tools/reload', 'POST'),
    onSuccess: (result) => {
      setMessage(result.errors.length
        ? `已重新装载，${result.errors.length} 个文件仍有错误（见下方装载错误）。`
        : `已重新装载，当前 ${result.custom_count} 个自定义工具。`);
      refresh();
    },
  });

  const saveMutation = useMutation({
    mutationFn: ({ file, content }: { file: string; content: string }) =>
      apiMutation<ToolSourceSaveResult>(`/api/tools/custom/${encodeURIComponent(file)}`, 'PUT', { content }),
    onSuccess: (result) => {
      setEditor(null);
      setMessage(result.load_error
        ? `${result.file} 已保存，但装载报错：${result.load_error}`
        : `${result.file} 已保存，注册为工具 ${result.tool}。${result.note}`);
      refresh();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (file: string) =>
      apiMutation<ToolFileDeleteResult>(`/api/tools/custom/${encodeURIComponent(file)}`, 'DELETE'),
    onSuccess: (result) => {
      setDeleteFile(null);
      if (editor && editor.file === result.deleted) setEditor(null);
      setMessage(`${result.deleted} 已删除${result.tool ? `，工具 ${result.tool} 已下架。` : '。'}`);
      refresh();
    },
  });

  async function openSource(file: string) {
    setLocalError('');
    try {
      const content = await apiGetText(`/api/tools/custom/${encodeURIComponent(file)}`);
      setEditor({ file, content, isNew: false, hint: `正在编辑 tools_custom/${file}` });
    } catch (error) {
      setLocalError(errorMessage(error));
    }
  }

  async function startNew() {
    setLocalError('');
    let content = FALLBACK_TEMPLATE;
    let hint = '已载入内置骨架。保存前请改掉 TOOL["name"] 和文件名。';
    try {
      content = await apiGetText(`/api/tools/custom/${TEMPLATE_FILE}`);
      hint = `模板取自示例工具 ${TEMPLATE_FILE}。保存前必须改掉 TOOL["name"]，否则会和示例工具重名被拒。`;
    } catch {
      // 示例文件被删了就用兜底骨架，不影响新建
    }
    setEditor({ file: '', content, isNew: true, hint });
  }

  async function onUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';           // 同一个文件连传两次也要触发
    if (!file) return;
    setLocalError('');
    if (!FILE_RE.test(file.name)) {
      setLocalError(`文件名 ${file.name} 不合法：只能用字母、数字、下划线、连字符，以 .py 结尾，不超过 60 字。`);
      return;
    }
    if (file.name.startsWith('_')) {
      setLocalError(`文件名 ${file.name} 以下划线开头，装载器会跳过它——换个名字。`);
      return;
    }
    let content = '';
    try {
      content = await file.text();
    } catch (error) {
      setLocalError(`读取本地文件失败：${errorMessage(error)}`);
      return;
    }
    // 先放进编辑器再提交：万一后端因语法/契约报错，人当场就能改这份内容重存。
    setEditor({ file: file.name, content, isNew: false, hint: `来自本地文件 ${file.name}` });
    saveMutation.mutate({ file: file.name, content });
  }

  const data = toolsQuery.data;
  const grouped = useMemo(() => {
    const buckets = new Map<string, ToolEntry[]>();
    (data?.tools ?? []).forEach((tool) => {
      const key = EFFECT_ORDER.includes(tool.effect) ? tool.effect : 'unknown';
      const list = buckets.get(key) ?? [];
      list.push(tool);
      buckets.set(key, list);
    });
    return EFFECT_ORDER
      .filter((key) => buckets.has(key))
      .map((key) => ({ key, tools: buckets.get(key) ?? [] }));
  }, [data]);

  const editorBytes = useMemo(
    () => (editor ? new TextEncoder().encode(editor.content).length : 0),
    [editor],
  );
  const editorFile = editor ? fileNameOf(editor.file) : '';
  const editorNameValid = !!editor && FILE_RE.test(editorFile) && !editorFile.startsWith('_');
  const badFiles = (data?.custom_files ?? []).filter((f) => f.error);

  function saveEditor() {
    if (!editor || !editorNameValid || !editor.content.trim()) return;
    saveMutation.mutate({ file: editorFile, content: editor.content });
  }

  return (
    <main className="page tools-page">
      <ArtPageHead
        compact
        title={meta?.title ?? '工具面板'}
        description={meta?.description}
        actions={(
          <>
            <button
              className="btn btn-quiet"
              type="button"
              disabled={reloadMutation.isPending}
              onClick={() => reloadMutation.mutate()}
            >
              <RefreshCw size={14} />{reloadMutation.isPending ? '正在重装…' : '重新装载'}
            </button>
            <button className="btn btn-quiet" type="button" onClick={() => uploadRef.current?.click()}>
              <Upload size={14} />上传 .py 文件
            </button>
            <button className="btn btn-primary" type="button" onClick={() => void startNew()}>
              <Plus size={14} />新建工具
            </button>
            <input
              ref={uploadRef}
              className="visually-hidden-input"
              type="file"
              accept=".py,text/x-python"
              onChange={(event) => void onUpload(event)}
            />
          </>
        )}
      />

      <section className="panel tool-warning" aria-label="自定义工具须知">
        <div className="panel-body stack">
          <p className="notice notice-warning">
            <ShieldAlert size={14} aria-hidden="true" />
            <span>
              自定义工具是<b>在本机以服务进程权限执行的 Python 代码</b>，它能做的事和 radar 服务一样多。
              只上传你自己写得懂的文件。为此后端硬编码了两条安全默认值——自定义工具一律需要人工确认才执行，
              且新上传的默认停用，要你在下面手动启用。
              {' '}
              <b>另外要知道：保存时文件会被真正执行一次</b>（这是读取 TOOL 与 run 的唯一办法），
              所以即使它因为契约不合格被退回、文件没有落盘，模块最外层的代码也已经跑过了。
              别把「先传上去看看报什么错」当成安全的试探方式。
            </span>
          </p>
          <p className="notice">
            <Wrench size={14} aria-hidden="true" />
            <span>
              <b>模型无权创建或修改工具</b>：注册表里没有任何一个工具能写 tools_custom/ 或 tools_config.yaml。
              只有你能从这个本地页面增删改。
            </span>
          </p>
        </div>
      </section>

      {message && <p className="notice" role="status">{message}</p>}
      {localError && <p className="notice notice-error" role="alert">{localError}</p>}
      {(toggleMutation.isError || confirmMutation.isError || reloadMutation.isError || deleteMutation.isError) && (
        <p className="notice notice-error" role="alert">
          {errorMessage(toggleMutation.error ?? confirmMutation.error ?? reloadMutation.error ?? deleteMutation.error)}
        </p>
      )}

      {toolsQuery.isLoading && (
        <section className="panel loading-stack" aria-busy="true" aria-label="正在加载工具">
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line" />
        </section>
      )}

      {toolsQuery.isError && (
        <div className="error-state" role="alert">
          <AlertTriangle />
          <h2>工具清单没有加载成功</h2>
          <p>{errorMessage(toolsQuery.error)}</p>
          <button className="btn btn-quiet" type="button" onClick={() => void toolsQuery.refetch()}>重新加载</button>
        </div>
      )}

      {data && (
        <div className="stack">
          {(!!data.errors.length || !!data.config_problems.length) && (
            <section className="panel tool-errors" aria-label="装载错误">
              <div className="panel-head">
                <div>
                  <h2>装载错误</h2>
                  <p>这些文件没有变成工具。原因是后端原文，改完点「重新装载」。</p>
                </div>
                <span className="badge badge-danger">{data.errors.length + data.config_problems.length} 条</span>
              </div>
              <div className="panel-body stack">
                {data.config_problems.map((problem) => (
                  <div className="tool-error-row" key={problem}>
                    <code>{data.config_file}</code>
                    <pre className="code-error">{problem}</pre>
                    <p className="form-hint">配置文件读不出来时，后端按「全部启用」跑。</p>
                  </div>
                ))}
                {data.errors.map((item) => (
                  <div className="tool-error-row" key={item.file}>
                    <div className="tool-error-head">
                      <code>{data.custom_dir}/{item.file}</code>
                      <button className="btn btn-quiet" type="button" onClick={() => void openSource(item.file)}>
                        <Pencil size={13} />打开修复
                      </button>
                    </div>
                    <pre className="code-error">{item.error}</pre>
                  </div>
                ))}
              </div>
            </section>
          )}

          {editor && (
            <section className="panel tool-editor" aria-label="自定义工具源码">
              <div className="panel-head">
                <div>
                  <h2>{editor.isNew ? '新建自定义工具' : `编辑 ${editor.file}`}</h2>
                  <p>{editor.hint}</p>
                </div>
                <div className="row-actions">
                  <button className="btn btn-quiet" type="button" onClick={() => setEditor(null)}>关闭</button>
                  <button
                    className="btn btn-primary"
                    type="button"
                    disabled={!editorNameValid || !editor.content.trim() || saveMutation.isPending}
                    onClick={saveEditor}
                  >
                    <Save size={14} />{saveMutation.isPending ? '正在校验并保存…' : '保存并装载'}
                  </button>
                </div>
              </div>
              <div className="panel-body form-grid">
                <div className="field is-wide">
                  <label htmlFor="tool-file">文件名</label>
                  <input
                    id="tool-file"
                    maxLength={60}
                    readOnly={!editor.isNew}
                    value={editor.file}
                    placeholder="例如：lead_digest.py"
                    onChange={(event) => setEditor({ ...editor, file: event.target.value })}
                  />
                  <small>
                    {!editor.file || editorNameValid
                      ? `保存到 ${data.custom_dir}/${editor.file ? editorFile : '<文件名>.py'}；字母、数字、下划线、连字符，不以下划线开头。`
                      : '文件名不合法：只能用字母、数字、下划线、连字符，以 .py 结尾，且不以下划线开头。'}
                  </small>
                </div>
                <div className="field is-wide">
                  <label htmlFor="tool-source">Python 源码</label>
                  <textarea
                    id="tool-source"
                    className="code-editor"
                    spellCheck={false}
                    wrap="off"
                    value={editor.content}
                    onChange={(event) => setEditor({ ...editor, content: event.target.value })}
                  />
                  <small>
                    契约：模块级 TOOL = {'{'}"name", "desc", "args"{'}'} + 模块级 run(args) 返回可 JSON 序列化的
                    dict；抛 ValueError 视为工具错误。当前 {(editorBytes / 1024).toFixed(1)} KB / 64 KB 上限。
                  </small>
                </div>
              </div>
              {saveMutation.isError && (
                <div className="panel-body">
                  <p className="notice notice-error" role="alert">后端拒绝保存，原文如下（文件没有落盘）：</p>
                  <pre className="code-error">{errorMessage(saveMutation.error)}</pre>
                </div>
              )}
            </section>
          )}

          {grouped.map(({ key, tools }) => (
            <section className="panel" key={key}>
              <div className="panel-head">
                <div>
                  <h2>{data.effect_labels[key] ?? key}</h2>
                  <p>
                    {key === 'readonly' && '只读本项目自己的数据，不出网、不写库。'}
                    {key === 'write' && '会改数据库里的内容。哪条需要人工确认以行上的徽标为准，你可以把任意一条收紧成必须确认。'}
                    {key === 'net' && '会向外部发请求，只在调查任务里可用，并受检索与抓取额度约束。'}
                    {key === 'proposal' && '只生成一条待裁决的提案，动作要你在提案里点批准才发生。'}
                    {key === 'unknown' && '人上传的 Python 代码，副作用无从静态判断，一律按最严处理。'}
                  </p>
                </div>
                <span className="badge badge-neutral">{tools.length} 个</span>
              </div>
              <div className="skill-list panel-body">
                {tools.map((tool) => (
                  <article className="skill-row tool-row" key={tool.name}>
                    <div className="skill-row-head">
                      <div>
                        <div className="toolbar-group">
                          <h3><code>{tool.name}</code></h3>
                          <span className={tool.enabled ? 'badge badge-success' : 'badge badge-neutral'}>
                            {tool.enabled ? '已启用' : '已停用'}
                          </span>
                          {tool.requires_confirm && (
                            <span className="badge badge-warning">需人工确认</span>
                          )}
                          {tool.custom && (
                            <span className="badge badge-neutral"><Code2 size={11} />自定义</span>
                          )}
                          <span className="badge badge-neutral">{tool.effect_label}</span>
                          <span className="badge badge-neutral">
                            {tool.modes.map((mode) => MODE_LABEL[mode] ?? mode).join(' / ')}
                          </span>
                        </div>
                        <p>{tool.description}</p>
                        {!!Object.keys(tool.args).length && (
                          <dl className="tool-args">
                            {Object.entries(tool.args).map(([arg, desc]) => (
                              <div key={arg}>
                                <dt><code>{arg}</code></dt>
                                <dd>{desc}</dd>
                              </div>
                            ))}
                          </dl>
                        )}
                        {!Object.keys(tool.args).length && <p className="tool-args-empty">无参数</p>}
                        {tool.custom && tool.file && (
                          <p className="tool-file-meta">源码：{data.custom_dir}/{tool.file}</p>
                        )}
                      </div>
                      <div className="row-actions tool-actions">
                        <label className="tool-switch">
                          <span>启用</span>
                          <button
                            className={tool.enabled ? 'switch is-on' : 'switch'}
                            type="button"
                            role="switch"
                            aria-checked={tool.enabled}
                            aria-label={`${tool.enabled ? '停用' : '启用'} ${tool.name}`}
                            disabled={toggleMutation.isPending}
                            onClick={() => toggleMutation.mutate({ name: tool.name, enabled: !tool.enabled })}
                          />
                        </label>
                        <label className="tool-switch">
                          <span>需确认</span>
                          <button
                            className={tool.requires_confirm ? 'switch is-on' : 'switch'}
                            type="button"
                            role="switch"
                            aria-checked={tool.requires_confirm}
                            aria-label={`${tool.name} 的确认要求`}
                            disabled={tool.confirm_locked || confirmMutation.isPending}
                            title={tool.confirm_locked
                              ? '这条的确认要求是代码里的安全下限，只能收紧不能放松。'
                              : '打开后 agent 调用它前必须经你确认。'}
                            onClick={() => confirmMutation.mutate({
                              name: tool.name,
                              requiresConfirm: !tool.requires_confirm,
                            })}
                          />
                        </label>
                        {tool.custom && tool.file && (
                          <>
                            <button className="btn btn-quiet" type="button" onClick={() => void openSource(tool.file ?? '')}>
                              <Pencil size={13} />源码
                            </button>
                            <button className="btn btn-danger" type="button" onClick={() => setDeleteFile(`tool:${tool.file}`)}>
                              <Trash2 size={13} />删除
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {tool.confirm_locked && (
                      <p className="tool-locked-note">
                        确认要求已锁定：{tool.custom
                          ? '自定义工具是人上传的任意代码，副作用无从静态判断，必须确认。'
                          : `「${tool.effect_label}」是代码里的安全下限，配置只能收紧不能放松。`}
                      </p>
                    )}
                    {deleteFile === `tool:${tool.file}` && tool.file && (
                      <div className="inline-confirm" role="group" aria-label={`确认删除 ${tool.file}`}>
                        <span>删除后 {data.custom_dir}/{tool.file} 会从磁盘移除，工具立即下架，无法从界面恢复。</span>
                        <div>
                          <button className="btn btn-quiet" type="button" disabled={deleteMutation.isPending} onClick={() => setDeleteFile(null)}>取消</button>
                          <button className="btn btn-danger" type="button" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate(tool.file ?? '')}>
                            {deleteMutation.isPending ? '正在删除…' : '确认删除'}
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>
          ))}

          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>自定义工具文件</h2>
                <p>{data.custom_dir}/ 目录里的全部 .py。装载失败的文件也列在这里，点进去修。</p>
              </div>
              <span className="badge badge-neutral">{data.custom_files.length} 个文件</span>
            </div>

            {!data.custom_files.length && (
              <div className="empty-state">
                <FileWarning />
                <h2>目录里还没有文件</h2>
                <p>新建一个，或上传一份你自己写的 .py。上传后默认停用，需要你手动启用。</p>
                <button className="btn btn-primary" type="button" onClick={() => void startNew()}>新建第一个工具</button>
              </div>
            )}

            {!!data.custom_files.length && (
              <div className="skill-list panel-body">
                {data.custom_files.map((item: ToolCustomFile) => (
                  <article className="skill-row tool-file-row" key={item.file}>
                    <div className="skill-row-head">
                      <div>
                        <div className="toolbar-group">
                          <h3><code>{item.file}</code></h3>
                          {item.error
                            ? <span className="badge badge-danger">装载失败</span>
                            : <span className={item.enabled ? 'badge badge-success' : 'badge badge-neutral'}>
                                {item.enabled ? '已启用' : '已停用'}
                              </span>}
                          {item.tool && <span className="badge badge-neutral">工具 {item.tool}</span>}
                        </div>
                        <p className="tool-file-meta">
                          {(item.bytes / 1024).toFixed(1)} KB · 修改于 {item.mtime || '未知'}
                        </p>
                        {item.error && <pre className="code-error">{item.error}</pre>}
                      </div>
                      <div className="row-actions">
                        <button className="btn btn-quiet" type="button" onClick={() => void openSource(item.file)}>
                          <Pencil size={13} />查看 / 编辑
                        </button>
                        <button className="btn btn-danger" type="button" onClick={() => setDeleteFile(`file:${item.file}`)}>
                          <Trash2 size={13} />删除
                        </button>
                      </div>
                    </div>
                    {deleteFile === `file:${item.file}` && (
                      <div className="inline-confirm" role="group" aria-label={`确认删除 ${item.file}`}>
                        <span>删除后 {data.custom_dir}/{item.file} 会从磁盘移除，无法从界面恢复。</span>
                        <div>
                          <button className="btn btn-quiet" type="button" disabled={deleteMutation.isPending} onClick={() => setDeleteFile(null)}>取消</button>
                          <button className="btn btn-danger" type="button" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate(item.file)}>
                            {deleteMutation.isPending ? '正在删除…' : '确认删除'}
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>

          {!!badFiles.length && (
            <p className="form-hint">
              上面有 {badFiles.length} 个文件装载失败：它们不会出现在工具清单里，改好之后点页头的「重新装载」。
            </p>
          )}
        </div>
      )}
    </main>
  );
}
