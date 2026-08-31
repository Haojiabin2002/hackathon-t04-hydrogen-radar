export type TraceStatus = 'empty' | 'unknown' | 'verified' | 'partial' | 'inferred';

export interface ContactEntry {
  label: '联系人' | '电话' | '邮箱' | string;
  value: string;
  context: string;
  official: boolean;
}

/**
 * 关键人的三种来源。**界面上必须分区显示，绝不许混为一谈**——
 * 这是本项目「可追溯」的底线，不是排版偏好。
 *
 *   announcement  公告实证：来自 raw_text 逐字抽取，evidence 是原文片段，可回原文核对
 *   inferred_path 穿透路径：按 knowledge.md 产业链穿透规则推出的「该找哪一方、怎么核实」，
 *                 **恒无姓名/电话/邮箱**（后端 add_inferred_path 的签名里就没有这三个参数），
 *                 说明文字存在 evidence 里。界面必须显式标「推断 · 非公告原文」。
 *   manual        人工补录：销售自己敲进来的，模型不参与，也没有任何自动补全。
 */
export type ContactKind = 'announcement' | 'inferred_path' | 'manual';

/**
 * 一条关键人记录 · 来源 api.py `_contact_view()` / `_live_announcement_views()`。
 *
 * `persisted === false` 是**唯一**一种 id 为 null 的情况：contacts 表里一条公告实证
 * 都没有时，后端拿同一份 raw_text 现场再抽一次。原料与规则都与落库那份相同，
 * 但它没进库，界面要如实标出来，也不能对它做增删改。
 */
export interface Contact {
  /** 未入库的实时抽取结果没有 id */
  id: number | null;
  lead_id: number;
  kind: ContactKind | string;
  name: string | null;
  title: string | null;
  phone: string | null;
  email: string | null;
  org: string | null;
  /** announcement=原文片段；inferred_path=路径说明；manual=人工备注 */
  evidence: string | null;
  official: boolean;
  source_note: string | null;
  created_at: string | null;
  updated_at: string | null;
  /** false = 本次请求现算的，未写进 contacts 表 */
  persisted: boolean;
  /** 只有 manual 可改可删；另外两类改了就断了溯源 */
  editable: boolean;
  ignored: boolean;
  ignore_reason: string | null;
  ignored_at: string | null;
  fingerprint: string | null;
}

/** GET /api/leads/{id}/contacts 与详情接口 contacts 块共用的结构。 */
export interface ContactsPayload {
  lead_id: number;
  announcement: Contact[];
  inferred_path: Contact[];
  manual: Contact[];
  /** 各类**未被忽略**的条数，卡片角标「关键人 N」的来源 */
  counts: Record<ContactKind | string, number>;
  total: number;
  /** true = 库里没有公告实证记录，announcement 那批是现算的 */
  announcement_live: boolean;
  note: string;
}

/** POST /api/leads/{id}/contacts、PUT /api/contacts/{cid} 的入参。整条覆盖，留空即清空。 */
export interface ManualContactInput {
  name?: string;
  title?: string;
  phone?: string;
  email?: string;
  org?: string;
  /** 人工备注：从哪儿拿到的、什么时候确认过 */
  evidence?: string;
  source_note?: string;
}

export interface ContactDeleteResult {
  deleted: number;
  lead_id: number;
  kind: string;
}

/** 详情接口 trace 数组的一项。**只有 verified 是原文实证**，其余必须与之区分显示。 */
export interface TraceEntry {
  field: string;
  label: string;
  value: string | null;
  status: TraceStatus;
  /** 原文里没找到的片段。非空即说明这个值里掺了模型补的成分 */
  unsourced: string[];
}

/** 被归并为同一标的的其他报道。 */
export interface CorroborationDuplicate {
  id: number;
  company: string | null;
  subject: string | null;
  source: string;
  source_url: string;
  signal_title: string;
  published_at: string | null;
}

/**
 * GET /api/leads/{id} —— 详情页一次拿全。
 *
 * 它取代了原来「打 /api/leads 整表再自己 find」的做法：整表拿不到 trace 明细、
 * 拿不到作战卡与三类关键人，而且被归并为 duplicate 的线索根本不在整表里，
 * 佐证来源点进去会 404。
 */
export interface LeadDetail {
  lead: Lead;
  trace: TraceEntry[];
  card: { id: number; content: string; created_at: string | null } | null;
  contacts: ContactsPayload;
  corroboration: { note: string | null; duplicates: CorroborationDuplicate[] };
  signal: {
    id: number;
    source: string;
    source_url: string;
    title: string;
    published_at: string | null;
    fetched_at: string | null;
    /** 原文总字数。excerpt 只是前 4000 字 */
    text_len: number;
    excerpt: string;
    truncated: boolean;
  };
}

export interface Lead {
  id: number;
  signal_id: number;
  company: string | null;
  /** 标的物一句话描述。一条招投标汇总贴会合法地拆出多条商机，
   *  那时 signal_title 完全相同、company 还常常为空，只有 subject 能把它们区分开。 */
  subject: string | null;
  signal_type: string | null;
  power_range: string | null;
  region: string | null;
  amount: string | null;
  deadline: string | null;
  score: number | null;
  score_reason: string | null;
  matched_product: string | null;
  match_reason: string | null;
  industry: string | null;
  status: 'new' | 'rejected' | 'duplicate' | string;
  dup_of: number | null;
  corroboration: string | null;
  signal_title: string;
  source: string;
  source_url: string;
  fetched_at: string | null;
  published_at: string | null;
  has_card: number;
  /** 同一条公告拆出的可见商机总数（含自己）。>1 表示这是一篇多标的汇总贴。 */
  siblings: number;
  region_trace: TraceStatus;
  region_unsourced: string[];
  company_trace: TraceStatus;
  company_unsourced: string[];
  overseas: boolean;
  contact: ContactEntry[];
  /** true = contacts 表里没有公告实证记录，上面那批 contact 是本次请求现算的（未入库） */
  contact_live: boolean;
  /** 三类关键人各自**未被忽略**的条数。卡片角标只用它，明细在详情接口里 */
  contacts_kinds: Record<ContactKind | string, number>;
  contacts_count: number;
}

export interface Signal {
  id: number;
  source: string;
  source_url: string;
  title: string;
  fetched_at: string | null;
  published_at: string | null;
  text_len: number;
  excerpt: string;
  overseas: boolean;
}

export interface RadarStats {
  version: string;
  signals: number;
  leads: number;
  rejected: number;
  duplicate: number;
  pending: number;
  matched: number;
  cards: number;
  cards_orphan: number;
  high: number;
  overseas: number;
  /** 产出了在研商机的公告数。leads 与它不相等——一条汇总贴能拆出多条商机。 */
  lead_signals: number;
  /** 其中拆出了不止一条商机的公告数。 */
  multi_lead_signals: number;
}

export interface SourceSummary {
  key: string;
  name: string;
  enabled: boolean;
  kind: string;
  quota: number;
  reason: string;
  signals: number;
}

export interface SourceProbeSample {
  url: string;
  title: string;
  ok: boolean;
  chars: number;
  selector: string;
  published?: string;
  note: string;
}

export type SourceProbeSuggestion =
  | ''
  | 'reject'
  | 'save_disabled'
  | 'save_enabled'
  | 'save_enabled_warn';

export interface SourceProbeReport {
  url: string;
  usable: boolean;
  verdict: string;
  detail: string[];
  http_ok: boolean;
  page_bytes: number;
  anchors: number;
  keyword_links: number;
  article_pattern: string;
  body_selectors: string[];
  samples: SourceProbeSample[];
  same_domain_source: string | null;
  suggest: SourceProbeSuggestion;
}

export interface SourceProbeInput {
  url: string;
}

export interface SourceCreateInput {
  url: string;
  name: string;
  reason: string;
  quota?: number;
  enabled?: boolean;
  article_pattern?: string;
  body_selectors?: string[];
  attach_to?: string;
}

export interface SourceCreateResult {
  action: 'noop' | 'attached' | 'created';
  key: string;
  message?: string;
  lists?: string[];
  source?: {
    key: string;
    name: string;
    enabled: boolean;
    kind: string;
    quota: number;
    base: string;
    lists: string[];
    article_pattern: string;
    body_selectors: string[];
    reason: string;
  };
}

export interface SourceToggleResult {
  key: string;
  enabled: boolean;
}

export interface SourceDeleteResult {
  deleted: string;
  signals_purged?: number;
  signals_kept?: number;
  message: string;
}

export interface CollectionResult {
  trigger: '手动' | '定时' | string;
  crawler_rc: number;
  crawler_tail: string[];
  crawler_added: number;
  source_errors: string[];
  crawler_error?: string;
  pipeline: string;
  pipeline_tail?: string[];
}

export interface CollectStatus {
  running: boolean;
  last_at: string | null;
  last_result: CollectionResult | null;
  last_error: string | null;
  next_at: string | null;
  last_skip: string | null;
  run_hours: number[];
  schedule_enabled: boolean;
}

export interface CollectStartResult {
  started: boolean;
  reason?: string;
}

export interface ScheduleConfig {
  schedule_enabled: boolean;
  run_hours: number[];
}

export interface ScheduleUpdateResult extends ScheduleConfig {
  next_at: string | null;
}

// ---------------------------------------------------------------- 每周复盘
// 来源：PUT /api/schedule/weekly、POST /api/weekly-review/run、
// GET /api/weekly-review/status（api.py），跑的是 radar/weekly_review.py。
// 档期单独一个接口，不并进 /api/schedule：字段形状完全不同，塞一起会导致
// 改采集时段时漏传周复盘的键、把别人的设置抹掉。

export interface WeeklyScheduleConfig {
  weekly_enabled: boolean;
  /** 1=周一 … 7=周日（ISO 口径，与后端 datetime.isoweekday 一致） */
  weekly_weekday: number;
  /** 0-23 */
  weekly_hour: number;
}

export interface WeeklyScheduleUpdateResult extends WeeklyScheduleConfig {
  next_at: string | null;
}

export interface WeeklyRunInput {
  /** 本周已跑过时后端默认跳过；force 是人明确要求再烧一次额度重跑 */
  force?: boolean;
}

export interface WeeklyRunResult {
  started: boolean;
  reason?: string;
  force?: boolean;
}

/** 模型给的提案逐条校验报告：丢了几条、为什么丢、哪几条打了提示。 */
export interface WeeklyValidationReport {
  received: number;
  accepted: number;
  dropped: number;
  reasons: string[];
  flags: string[];
}

/**
 * 一轮周复盘的真实结果。ok=false 时 error 里是原因（如 LLM 通道不可用），
 * **此时提案数为 0**——跑不成就是跑不成，后端不会用兜底文本凑数。
 */
export interface WeeklyRunRecord {
  ok: boolean;
  week?: string;
  /** 本周已跑过而跳过时为 true，此时 reason 是跳过说明 */
  skipped?: boolean;
  reason?: string;
  error?: string;
  started_at?: string;
  finished_at?: string;
  steps?: number;
  validation?: WeeklyValidationReport;
  proposal_ids?: string[];
  propose_errors?: string[];
  material_digest?: WeeklyMaterialDigest;
  material_errors?: Record<string, string>;
  /** '定时' | '手动' */
  trigger?: string;
}

/**
 * GET /api/weekly-review/status。
 * ⚠ done_this_week / proposals_pending 可能是 null（后端读不出来，errors 里有说明）——
 * 「本周没跑」和「我不知道」不是一回事，界面必须分开显示。
 */
export interface WeeklyReviewStatus extends WeeklyScheduleConfig {
  running: boolean;
  last_at: string | null;
  last_result: WeeklyRunRecord | null;
  last_error: string | null;
  next_at: string | null;
  last_skip: string | null;
  week: string | null;
  done_this_week: boolean | null;
  done_reason: string | null;
  proposals_pending: number | null;
  errors: Record<string, string>;
}

export interface MemoryItem {
  id: string;
  content: string;
  created_at: string;
}

export interface MemoryCreateInput {
  content: string;
}

export interface MemoryDeleteResult {
  deleted: string;
}

export interface KnowledgeMeta {
  scoring_weights: Record<string, number>;
  industry_taxonomy: string[];
}

export interface KnowledgeDocument {
  content: string;
  problems: string[];
  meta: KnowledgeMeta | Record<string, never>;
  sections: Record<string, unknown>;
}

export interface KnowledgeSaveResult {
  saved: true;
  sections: string[];
  note: string;
}

/**
 * 知识库文件清单的一项 —— GET /api/knowledge/files
 * 契约来源：radar/api.py 的 list_knowledge_files()。
 *
 * files[0] 恒为 kind:"main" 的 knowledge.md：它是**契约主文件**，
 * frontmatter 与四个必需小节被 pipeline 的提示词直接消费，
 * 因此不经这套文件接口编辑——保存必须走 PUT /api/knowledge（parse_kb + validate_kb 校验）。
 * 其余为 kind:"doc" 的附加文档：不参与提示词装配，agent 用 read_knowledge 按需取用。
 */
export interface KnowledgeFileEntry {
  kind: 'main' | 'doc';
  /** 带 .md 后缀，可直接作为 /api/knowledge/files/{name} 的路径段（记得 encodeURIComponent） */
  name: string;
  title: string;
  purpose: string;
  updated: string;
  bytes: number;
  mtime: string;
  /** 仅 main 有：提示这套接口不负责改主文件 */
  readonly_here?: boolean;
  /** 仅 main 有：主文件真正的编辑端点，固定是 /api/knowledge */
  edit_api?: string;
  note?: string;
  /** 单篇读取失败时后端给出的中文原因；此时列表照常返回，不整页失败 */
  problem?: string;
}

/** GET /api/knowledge/files 的响应。problems 是目录级问题（如 knowledge/ 不可读）。 */
export interface KnowledgeFilesResponse {
  files: KnowledgeFileEntry[];
  problems: string[];
  dir: string;
}

/** PUT /api/knowledge/files/{name} 的响应。新建与覆盖是同一个动词。 */
export interface KnowledgeFileSaveResult {
  saved: true;
  name: string;
  bytes: number;
  note: string;
}

/** DELETE /api/knowledge/files/{name} 的响应。 */
export interface KnowledgeFileDeleteResult {
  deleted: string;
}

export interface BuiltinSkill {
  icon: string;
  name: string;
  builtin: true;
  description: string;
}

export interface CustomSkill {
  key: string;
  problems: string[];
  enabled: boolean;
  name: string;
  description: string;
  icon: string;
  scope: 'lead' | string;
}

export interface SkillsResponse {
  builtin: BuiltinSkill[];
  custom: CustomSkill[];
  placeholders: Record<string, string>;
  /** 新建技能的骨架正文（后端 SKILL_TEMPLATE）。老版本后端没有这个字段。 */
  template?: string;
  /** key 规则的人话说明，直接显示给人看 */
  key_rule?: string;
  create_api?: string;
}

export interface SkillDocument {
  key: string;
  content: string;
}

export interface SkillSaveResult {
  saved: true;
  key: string;
  name: string;
}

export interface SkillToggleResult {
  key: string;
  enabled: boolean;
}

export interface SkillDeleteResult {
  deleted: string;
}

export interface SkillRunResult {
  key: string;
  name: string;
  lead_id: number;
  answer: string;
}

export type ChatAction =
  | { type: 'collect' }
  | { type: 'open_lead'; id: number }
  | { type: 'filter_board'; filter: 'all' | 'high' | 'mid' | 'sea' | 'card' | 'rej' }
  | { type: 'remember'; content: string };

/**
 * POST /api/chat 的出入参。
 *
 * 2026-08-30 首页下掉了「问答模式」，前端已经没有地方调它——但**端点仍在后端跑着**，
 * 别处（脚本、别的客户端）可能还在用。留着这两个形状是给它的契约存档，
 * 不是给首页留后门：首页只剩 Agent 一个对话框。
 */
export interface ChatInput {
  lead_id?: number | null;
  question: string;
}

export interface ChatResponse {
  lead_id: number | null;
  answer: string;
  action?: ChatAction | null;
}

export type LlmChannelKey = 'claude_cli' | 'codex_cli' | 'api';
export type LlmIsolationStatus = 'passed' | 'failed' | 'untested';

/**
 * 赞助线路 · 来源 llm.py route_status()，随 `api` 通道一起从 /api/llm/channels 回来。
 *
 * ⚠ 接口里**没有也不会有** api_key 明文：只有 key_tail 这个掩码尾巴
 * （形如「…a1b2」，未导入时是空串）。界面上不许出现第二个 key 字段。
 */
export interface LlmRoute {
  id: number;
  name: string;
  quota_usd: number;
  note: string;
  /** 本机是否已导入这条线路的 key */
  imported: boolean;
  /** 是否是当前生效线路 */
  active: boolean;
  key_tail: string;
  base_url: string;
}

export interface LlmChannel {
  key: LlmChannelKey;
  name: string;
  current: boolean;
  installed: boolean;
  configured: boolean;
  detail: string;
  isolation: LlmIsolationStatus;
  isolation_detail: string;
  path?: string;
  base_url?: string;
  model?: string;
  key_set?: boolean;
  style?: string;
  /** 只有 key === 'api' 的通道带下面三项 */
  active_route?: number;
  thinking?: string;
  routes?: LlmRoute[];
}

export interface LlmChannelsResponse {
  current: LlmChannelKey;
  channels: LlmChannel[];
}

export interface LlmChannelInput {
  channel: LlmChannelKey;
  base_url?: string;
  model?: string;
  api_key?: string;
  style?: string;
}

export interface ChannelTestResult {
  ok: boolean;
  reason?: string;
  stage?: 'connect' | 'isolation' | string;
  latency_s?: number;
  reply?: string;
  isolation_ok?: boolean;
  isolation_detail?: string;
}

export interface LlmChannelSaveResult {
  saved: true;
  channel: LlmChannelKey;
  test: ChannelTestResult;
}

export interface LlmHealthResponse {
  ok: boolean;
  detail: string;
}

// ---------------------------------------------------------------- Agent

/** Agent 执行轨迹里的一步。工具步与收敛步字段不同，用 done 区分。 */
export interface AgentStep {
  step: number;
  thought?: string;
  /** 收敛步没有 tool */
  tool?: string;
  args?: Record<string, unknown>;
  ok?: boolean;
  /** 工具成功时的结果预览（已被后端截断） */
  result_preview?: string;
  /** 工具失败或模型输出不合法时的原因 */
  error?: string;
  done?: boolean;
  /** 通道瞬时故障后的重试步。不是失败，是同一步重来一次 */
  retry?: boolean;
  elapsed_s?: number;
}

/**
 * 触网任务里被拦下的写盘动作。
 *
 * 形状来自 radar/tools.py 的 `_defer_write`：`{type, payload, summary}`。
 * 为什么会有这东西：公告正文是抓来的不可信文本、已经进过 prompt，
 * 「读了网页之后直接改长期记忆」等于让网页改我们的配置，所以一律转提案。
 * 注意它和 ChatAction 里的 `remember` 不是一个形状——那个是 `{type,content}`。
 */
export interface DeferredWrite {
  type: 'remember' | 'set_preference' | string;
  payload: Record<string, unknown>;
  /** 后端给人看的一句话，如「记住：优先河南」 */
  summary: string;
}

/** proposed_actions 里混着两种东西：界面动作 与 被拦下的写盘动作。 */
export type ProposedAction = ChatAction | DeferredWrite;

/** 运行时判别：带 payload + summary 的是被拦下的写盘动作。 */
export function isDeferredWrite(item: ProposedAction): item is DeferredWrite {
  return typeof (item as DeferredWrite).summary === 'string'
    && typeof (item as DeferredWrite).payload === 'object'
    && (item as DeferredWrite).payload !== null;
}

/** 调查任务的额度账。来源：agent.py `_investigation_summary` → sess.budget()。 */
export interface InvestigationBudget {
  search_used: number;
  fetch_used: number;
  /** 陌生域 → 本任务已抓页数 */
  gray_pages: Record<string, number>;
  daily_used: number;
  /** 博查检索的总余额（独立 key，与模型通道无关） */
  bocha_left: number;
  /** 域名 → 命中人机验证次数。同域第二次会触发拉黑审批卡 */
  challenge_hits: Record<string, number>;
  /** 域名 → 抓取失败次数 */
  fail_hits: Record<string, number>;
}

/** investigate=true 时 /api/agent 多出来的一块账。 */
export interface InvestigationSummary {
  budget: InvestigationBudget;
  /** 本任务真正落库的公告/取证页 */
  saved_signals: Array<{ signal_id: number; kind: string; url: string }>;
  /** 本任务新产生的线索 id */
  new_leads: number[];
  /** 撞墙次数：验证码、抓不动、此路不通 */
  dead_ends: number;
  /** 被拦下的写盘动作（与 proposed_actions 尾部同源） */
  proposals: DeferredWrite[];
  tool_calls: number;
}

export interface AgentResult {
  answer: string;
  /** 收敛时模型给的最终界面动作。历史契约，保留 */
  action: ChatAction | null;
  /** 整轮里提过的全部动作：界面动作在前，被拦下的写盘动作在后 */
  proposed_actions?: ProposedAction[];
  trace: AgentStep[];
  steps: number;
  /** 步数耗尽仍未收敛。此时 answer 是如实说明，不是结论。 */
  exhausted?: boolean;
  /** 模型通道中断。answer 说明中断原因，已完成的步骤保留在 trace 里。 */
  interrupted?: boolean;
  /** 只有 investigate=true 才有 */
  investigation?: InvestigationSummary;
}

/**
 * 一条对话上文。**顺序是时间从旧到新**，最后一条是上一轮的 assistant 回复。
 *
 * 后端 agent.py 把它压成一个 `<对话上文>` 块注进 SYSTEM，只用来解
 * 「那条线索 / 它 / 第二条」这类指代——不是让模型把上文里的结论当已核实事实抄。
 */
export interface AgentHistoryEntry {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * 后端真正会读的上文条数（agent.py `HISTORY_MAX_TURNS`）。
 * 前端按这个数截断后再发：发 20 条而后端只认 6 条，等于在界面上骗人说"它记得"。
 */
export const AGENT_HISTORY_LIMIT = 6;

export interface AgentInput {
  goal: string;
  /** 前几轮问答，时间从旧到新。后端还会再截一次，这里先按 AGENT_HISTORY_LIMIT 截。 */
  history?: AgentHistoryEntry[];
  /** 调查模式默认 40、上限 40；普通模式默认 8、上限 12（api.py `_agent_steps`） */
  max_steps?: number;
  /** 聚焦某条线索：档案与公告原文直接进上下文 */
  lead_id?: number | null;
  /** true = 调查任务：额外挂一个受控触网会话，可检索/抓页/提案 */
  investigate?: boolean;
  /** 本次任务的标识，进审计日志与提案载荷。限 ^[A-Za-z0-9_.:-]{1,64}$，非法 400 */
  task_id?: string;
}

export interface AgentToolSpec {
  name: string;
  description: string;
  args: Record<string, string>;
  /** true 表示 agent 不能自己执行，只能提议，要人确认 */
  requires_confirm: boolean;
}

export interface AgentToolsResponse {
  tools: AgentToolSpec[];
}

// ---------------------------------------------------------------- 偏好

export interface Preferences {
  focus_regions: string[];
  focus_products: string[];
  min_score: number;
  exclude_regions: string[];
  tone: string;
}

export type PreferenceKey = keyof Preferences;

export interface PreferencesResponse {
  preferences: Preferences;
  /** 键 → 人类可读说明，由后端 PREF_SCHEMA 提供 */
  schema: Record<string, string>;
}

export interface PreferenceInput {
  key: PreferenceKey;
  value: string | number | string[];
}

export interface PreferenceSaveResult {
  saved: Record<string, unknown>;
}

// ---------------------------------------------------------------- 审批提案
// 来源：GET /api/proposals、POST /api/proposals/{pid}/resolve（api.py），
// 底层是 reach.list_proposals / reach.resolve_proposal，队列文件在
// ~/.config/hydrogen-radar/proposals.json。

export type ProposalStatus = 'pending' | 'approved' | 'rejected';
export type ProposalKind = 'add_source' | 'deny_domain' | 'weekly_review';

/**
 * ⚠ payload 里的 domain / title / reason 抽自公开网页，是**不可信数据**。
 * 审批界面必须纯文本渲染，并把域名/网址单独醒目展示——
 * 防钓鱼是这张卡存在的理由，不是装饰。
 */
export interface AddSourcePayload {
  domain?: string;
  title?: string;
  reason?: string;
  /** 提出这条提案的任务 id */
  task?: string | null;
  url?: string;
  /** 批准时服务端强制复探的报告，写回队列文件 */
  probe_report?: ProposalProbe;
}

export interface DenyDomainPayload {
  domain?: string;
  reason?: string;
  example_url?: string;
}

/** 每周复盘只提这三类，别的一律被后端 validate_proposals 丢弃，不会进队列。 */
export type WeeklyProposalType = 'knowledge_edit' | 'preference_edit' | 'source_focus';

/** 素材窗口。口径是「日期 >= today-days（含今天）」，note 由后端写死带过来。 */
export interface WeeklyReviewWindow {
  days?: number;
  from?: string;
  to?: string;
  week?: string;
  note?: string;
}

/**
 * 随提案存下来的关键数字，供审批人当场核对依据，不必回头再查库。
 * ⚠ 任何一项都可能是 null（那一段素材读失败）——**不许画成 0**。
 */
export interface WeeklyMaterialDigest {
  new_signals?: number | null;
  new_leads?: number | null;
  new_cards?: number | null;
  rejected_ratio?: number | null;
  dead_end_total?: number | null;
  new_memories?: number | null;
}

/**
 * 每周复盘提案的 payload。
 *
 * ⚠ suggestion / evidence / section / direction 是**模型生成的文本**，
 * 和公开网页一样按不可信数据对待：纯文本渲染，不做成链接、不解析 HTML。
 * evidence 是这张卡的核心——没有依据的建议不值得批。
 */
export interface WeeklyReviewPayload {
  type?: WeeklyProposalType | string;
  /** 具体建议做什么 */
  suggestion?: string;
  /** 依据：必须引用素材里的数字或记忆条目 id，后端已强制非空 */
  evidence?: string;
  /** 仅 knowledge_edit：要改 knowledge.md 的哪一节 */
  section?: string;
  /** 仅 source_focus：下周的检索方向 */
  direction?: string;
  /** 后端校验时打的提示（如「依据里没有出现数字」），不阻断提案，交人判断 */
  flags?: string[];
  /** ISO 周号，如 2026-W35 */
  week?: string;
  generated_at?: string;
  window?: WeeklyReviewWindow;
  material_digest?: WeeklyMaterialDigest;
  /** 批准后 reach.resolve_proposal 打的「已采纳」标记。**批准不改任何文件** */
  adopted_at?: string;
}

export type ProposalPayload =
  (AddSourcePayload & DenyDomainPayload & WeeklyReviewPayload) & Record<string, unknown>;

export interface Proposal {
  id: string;
  kind: ProposalKind | string;
  status: ProposalStatus | string;
  created: string;
  resolved?: string | null;
  payload: ProposalPayload;
}

export interface ProposalsResponse {
  status: string;
  count: number;
  /** 待审总数（与 status 过滤无关，始终是 pending 的条数） */
  pending: number;
  proposals: Proposal[];
}

/** 批准新增源时服务端的复探回执。report 就是 crawler.probe_source 的完整报告。 */
export interface ProposalProbe {
  ok: boolean;
  url?: string;
  report?: SourceProbeReport;
  probed_at?: string;
  error?: string;
  /** 报告写回队列文件失败时才有 */
  store_error?: string;
}

export interface ProposalResolveInput {
  approve: boolean;
}

export interface ProposalResolveResult {
  proposal: Proposal;
  approved: boolean;
  /** 只有「批准新增源」才有；其余为 null */
  probe: ProposalProbe | null;
  message: string;
}

// ---------------------------------------------------------------- 受控触网的账
// 来源：GET /api/reach/status。
// ⚠ 任何一块读失败时该字段是 null 且 errors 里有说明——
// 前端**不许把 null 画成 0**：「今天一页没抓」和「计数读不出来」是两回事。

export interface ReachStatus {
  bocha_total: number | null;
  bocha_remaining: number | null;
  bocha_used: number | null;
  fetch_today: number | null;
  fetch_daily_cap: number | null;
  proposals_pending: number | null;
  proposals_pending_by_kind: Record<string, number> | null;
  domains: { allow: number; signpost: number; deny: number } | null;
  task_budget: { search: number; fetch: number; gray_page: number } | null;
  errors: Record<string, string>;
}

// ---------------------------------------------------------------- 工具面板
// 来源：GET /api/tools（读取公开）。写操作全部要 X-Radar-Local 头，apiMutation 已带。
//
// 边界提醒（后端硬编码，前端只是如实呈现，**不许在界面上放宽**）：
//  · 自定义工具 requires_confirm 恒为 true，confirm_locked 也恒为 true；
//  · 新装载的自定义工具默认停用，要人在这个页面上手动启用；
//  · confirm 只许收紧不许放松，放松会被后端 400 拒绝，理由原样显示给人。

export type ToolEffect = 'readonly' | 'write' | 'net' | 'proposal' | 'unknown';

export interface ToolEntry {
  name: string;
  description: string;
  args: Record<string, string>;
  custom: boolean;
  /** 只有 custom=true 时非空，是 tools_custom/ 下的文件名 */
  file: string | null;
  enabled: boolean;
  requires_confirm: boolean;
  confirm_default: boolean;
  /** true = 确认要求是代码下限，界面上置灰，放松会被 400 */
  confirm_locked: boolean;
  effect: ToolEffect | string;
  effect_label: string;
  modes: string[];
}

/** tools_custom/ 目录里的一个文件。装载失败的文件 tool=null、error 有值。 */
export interface ToolCustomFile {
  file: string;
  tool: string | null;
  error: string | null;
  bytes: number;
  mtime: string;
  enabled?: boolean;
}

export interface ToolLoadError {
  file: string;
  error: string;
}

export interface ToolsResponse {
  tools: ToolEntry[];
  errors: ToolLoadError[];
  custom_files: ToolCustomFile[];
  config_problems: string[];
  custom_dir: string;
  config_file: string;
  effect_labels: Record<string, string>;
}

export interface ToolReloadResult {
  reloaded: true;
  errors: ToolLoadError[];
  custom_count: number;
}

export interface ToolToggleResult {
  name: string;
  enabled: boolean;
}

export interface ToolConfirmResult {
  name: string;
  requires_confirm: boolean;
  confirm_default: boolean;
}

export interface ToolSourceSaveResult {
  saved: true;
  file: string;
  tool: string;
  bytes: number;
  /** 落盘后重装时才暴露出来的错误；正常是 null */
  load_error: string | null;
  enabled: boolean;
  requires_confirm: boolean;
  note: string;
}

export interface ToolFileDeleteResult {
  deleted: string;
  tool: string | null;
}
