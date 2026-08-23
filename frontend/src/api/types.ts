export type TraceStatus = 'empty' | 'unknown' | 'verified' | 'partial' | 'inferred';

export interface ContactEntry {
  label: '联系人' | '电话' | '邮箱' | string;
  value: string;
  context: string;
  official: boolean;
}

export interface Lead {
  id: number;
  signal_id: number;
  company: string | null;
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
  region_trace: TraceStatus;
  region_unsourced: string[];
  company_trace: TraceStatus;
  company_unsourced: string[];
  overseas: boolean;
  contact: ContactEntry[];
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
