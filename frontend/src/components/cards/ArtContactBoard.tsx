import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BadgeCheck, EyeOff, Mail, Pencil, Phone, Plus, RotateCcw,
  Route, Trash2, UserRound, X,
} from 'lucide-react';
import { apiMutation } from '../../api/client';
import type { Contact, ContactsPayload, ManualContactInput } from '../../api/types';

/**
 * 关键人区块 · 三种来源分区显示
 *
 * 这个组件存在的全部意义，是让人一眼看出「这个名字是从哪儿来的」：
 *
 *   ① 公告实证 announcement —— 原文里逐字出现的，evidence 就是那段原文，可回原文核对。
 *   ② 穿透路径 inferred_path —— **没有人名**，只有「该找哪一方、怎么核实」。
 *      必须显式标「推断 · 非公告原文」，不许和 ① 混在一个列表里。
 *   ③ 人工补录 manual —— 销售自己敲的，带填写时间，可改可删。
 *
 * 界面上这三块用不同的边色与标题分开，是硬要求不是排版偏好：
 * 把推断出来的路径画得像实证联系人，就是在造假数据。
 *
 * 另外两条与后端对齐的约束：
 *   · ① ② 不提供编辑与删除（后端返回 409）。要让它们不再出现，只能「标为无关」
 *     并写明理由——原始记录留在库里可回溯。
 *   · 库里没有公告实证记录时，后端会拿同一份 raw_text 现算一份（persisted=false）。
 *     那不是假数据，但它没入库，界面要如实标出来。
 */

const KIND_COPY = {
  announcement: {
    title: '公告实证',
    hint: '来自公告原文逐字抽取，每条都能回到原文核对。',
    icon: <BadgeCheck size={15} aria-hidden="true" />,
  },
  inferred_path: {
    title: '穿透路径（推断）',
    hint: '按知识库产业链穿透规则推出的「该找哪一方、怎么核实」。这里没有姓名电话，不许当成联系人用。',
    icon: <Route size={15} aria-hidden="true" />,
  },
  manual: {
    title: '人工补录',
    hint: '销售自己确认后填入的，模型不参与。',
    icon: <UserRound size={15} aria-hidden="true" />,
  },
} as const;

const EMPTY_FORM: ManualContactInput = {
  name: '', title: '', phone: '', email: '', org: '', evidence: '',
};

function stamp(value?: string | null): string {
  return value ? value.replace('T', ' ') : '';
}

// ---------------------------------------------------------------- 单条

function ContactIdentity({ contact }: { contact: Contact }) {
  const lines: ReactNode[] = [];
  if (contact.phone) {
    lines.push(
      <span key="phone" className="contact-line">
        <Phone size={12} aria-hidden="true" />
        <a href={`tel:${contact.phone}`}>{contact.phone}</a>
      </span>,
    );
  }
  if (contact.email) {
    lines.push(
      <span key="email" className="contact-line">
        <Mail size={12} aria-hidden="true" />
        <a href={`mailto:${contact.email}`}>{contact.email}</a>
      </span>,
    );
  }
  const heading = contact.name || contact.org || (contact.phone ?? contact.email ?? '');
  return (
    <>
      <div className="contact-name">
        <strong>{heading || '（这条记录只有备注）'}</strong>
        {contact.title && <span className="contact-title">{contact.title}</span>}
      </div>
      {contact.org && contact.org !== heading && <p className="contact-org">{contact.org}</p>}
      {lines.length > 0 && <div className="contact-lines">{lines}</div>}
    </>
  );
}

function ContactRow({ contact, actions, children }: {
  contact: Contact;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const isPath = contact.kind === 'inferred_path';
  return (
    <li className={`contact-row${contact.ignored ? ' is-ignored' : ''}`}>
      <div className="contact-row-main">
        {isPath ? (
          <>
            <span className="badge badge-inferred">推断 · 非公告原文</span>
            <p className="contact-path">{contact.evidence || '（后端返回了一条没有说明文字的穿透路径）'}</p>
          </>
        ) : (
          <ContactIdentity contact={contact} />
        )}

        {contact.kind === 'announcement' && (
          <div className="contact-flags">
            <span className={`badge ${contact.official ? 'badge-success' : 'badge-warning'}`}>
              {contact.official ? '官方字段' : '采购语境命中'}
            </span>
            {!contact.persisted && (
              <span className="badge badge-neutral" title="contacts 表里还没有这条线索的公告实证记录，这批是本次请求用同一份公告正文现抽的">
                未入库 · 本次现抽
              </span>
            )}
          </div>
        )}

        {contact.evidence && !isPath && (
          <details className="contact-evidence">
            <summary>{contact.kind === 'announcement' ? '原文片段（可逐字核对）' : '补录备注'}</summary>
            <p>{contact.evidence}</p>
          </details>
        )}

        {contact.kind === 'manual' && (
          <small className="form-hint">
            {contact.created_at ? `填写于 ${stamp(contact.created_at)}` : '填写时间未记录'}
            {contact.updated_at ? ` · 最后修改 ${stamp(contact.updated_at)}` : ''}
            {contact.source_note && contact.source_note !== 'manual' ? ` · 填写人 ${contact.source_note}` : ''}
          </small>
        )}

        {contact.ignored && (
          <div className="notice notice-warning">
            已标为无关：{contact.ignore_reason || '未写理由'}
            {contact.ignored_at ? `（${stamp(contact.ignored_at)}）` : ''}
          </div>
        )}

        {children}
      </div>
      {actions && <div className="contact-row-actions">{actions}</div>}
    </li>
  );
}

// ---------------------------------------------------------------- 补录表单

function ManualForm({ idPrefix, initial, busy, error, onSubmit, onCancel }: {
  /** 补录表单与编辑表单可能同时开着，id 必须能区分，否则 label 会点到另一张表单上 */
  idPrefix: string;
  initial?: ManualContactInput;
  busy: boolean;
  error: string | null;
  onSubmit: (value: ManualContactInput) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<ManualContactInput>({ ...EMPTY_FORM, ...initial });
  const set = (key: keyof ManualContactInput) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(form);
  };

  return (
    <form className="contact-form" onSubmit={submit}>
      <div className="contact-form-grid">
        <div className="field">
          <label htmlFor={`${idPrefix}-name`}>姓名</label>
          <input id={`${idPrefix}-name`} value={form.name ?? ''} onChange={set('name')} maxLength={40} placeholder="例：王工" />
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-title`}>职务</label>
          <input id={`${idPrefix}-title`} value={form.title ?? ''} onChange={set('title')} maxLength={60} placeholder="例：设备采购经理" />
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-phone`}>电话</label>
          <input id={`${idPrefix}-phone`} value={form.phone ?? ''} onChange={set('phone')} maxLength={40} placeholder="例：13800000000 转 812" />
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-email`}>邮箱</label>
          <input id={`${idPrefix}-email`} value={form.email ?? ''} onChange={set('email')} maxLength={120} placeholder="例：wang@example.com" />
        </div>
        <div className="field is-wide">
          <label htmlFor={`${idPrefix}-org`}>单位</label>
          <input id={`${idPrefix}-org`} value={form.org ?? ''} onChange={set('org')} maxLength={120} placeholder="例：开沃新能源 新能源采购部" />
        </div>
        <div className="field is-wide">
          <label htmlFor={`${idPrefix}-evidence`}>备注 · 这个人是怎么来的</label>
          <textarea
            id={`${idPrefix}-evidence`}
            value={form.evidence ?? ''}
            onChange={set('evidence')}
            maxLength={1000}
            rows={3}
            placeholder="例：2026-03 氢能展会换的名片，电话已打通确认在职，负责电堆选型。"
          />
        </div>
      </div>
      <p className="form-hint">
        姓名 / 电话 / 邮箱 / 单位 / 备注至少填一项。这里的每个字都由人填写，
        系统不会替你补全，也不会拿模型去猜——补录进来的内容会明确标成「人工补录」。
      </p>
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      <div className="row-actions">
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? '保存中…' : '保存'}
        </button>
        <button className="btn btn-quiet" type="button" onClick={onCancel} disabled={busy}>取消</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- 忽略表单

function IgnoreForm({ idPrefix, busy, error, onSubmit, onCancel }: {
  idPrefix: string;
  busy: boolean;
  error: string | null;
  onSubmit: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <form
      className="contact-ignore-form"
      onSubmit={(event) => { event.preventDefault(); onSubmit(reason); }}
    >
      <div className="field">
        <label htmlFor={`${idPrefix}-reason`}>为什么这条与本商机无关</label>
        <input
          id={`${idPrefix}-reason`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={200}
          placeholder="例：这是会议赞助商务联系人，不是采购方"
        />
      </div>
      <p className="form-hint">
        记录不会被删除，原始内容留在库里可回溯，只是界面上不再当成关键人显示。
      </p>
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      <div className="row-actions">
        <button className="btn btn-secondary" type="submit" disabled={busy}>
          {busy ? '提交中…' : '确认标为无关'}
        </button>
        <button className="btn btn-quiet" type="button" onClick={onCancel} disabled={busy}>取消</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- 主体

export function ArtContactBoard({ leadId, contacts }: {
  leadId: number;
  contacts: ContactsPayload;
}) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [ignoringId, setIgnoringId] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = async () => {
    setFormError(null);
    setAdding(false);
    setEditingId(null);
    setIgnoringId(null);
    // 列表页的角标「关键人 N」也来自后端计数，一起刷新，两处不会打架
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['lead-detail', leadId] }),
      queryClient.invalidateQueries({ queryKey: ['leads'] }),
    ]);
  };

  const fail = (error: unknown) =>
    setFormError(error instanceof Error ? error.message : '请求未能完成');

  const create = useMutation({
    mutationFn: (body: ManualContactInput) =>
      apiMutation<Contact>(`/api/leads/${leadId}/contacts`, 'POST', body),
    onSuccess: refresh,
    onError: fail,
  });

  const update = useMutation({
    mutationFn: ({ cid, body }: { cid: number; body: ManualContactInput }) =>
      apiMutation<Contact>(`/api/contacts/${cid}`, 'PUT', body),
    onSuccess: refresh,
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: (cid: number) => apiMutation<unknown>(`/api/contacts/${cid}`, 'DELETE'),
    onSuccess: refresh,
    onError: fail,
  });

  const ignore = useMutation({
    mutationFn: ({ cid, reason }: { cid: number; reason: string }) =>
      apiMutation<Contact>(`/api/contacts/${cid}/ignore`, 'POST', { reason }),
    onSuccess: refresh,
    onError: fail,
  });

  const unignore = useMutation({
    mutationFn: (cid: number) => apiMutation<Contact>(`/api/contacts/${cid}/ignore`, 'DELETE'),
    onSuccess: refresh,
    onError: fail,
  });

  const busy = create.isPending || update.isPending || remove.isPending
    || ignore.isPending || unignore.isPending;

  const active = (list: Contact[]) => list.filter((item) => !item.ignored);
  const hidden = (list: Contact[]) => list.filter((item) => item.ignored);

  const announcement = contacts.announcement ?? [];
  const inferred = contacts.inferred_path ?? [];
  const manual = contacts.manual ?? [];
  const nothing = active(announcement).length === 0
    && active(inferred).length === 0
    && active(manual).length === 0;

  /** ① ② 不能改也不能删，只能标忽略——理由见文件头。 */
  const ignoreAction = (contact: Contact) => {
    if (!contact.persisted || contact.id === null) return null;
    if (contact.ignored) {
      return (
        <button
          className="btn btn-link"
          type="button"
          disabled={busy}
          onClick={() => unignore.mutate(contact.id as number)}
        >
          <RotateCcw size={13} aria-hidden="true" />撤销忽略
        </button>
      );
    }
    return (
      <button
        className="btn btn-link"
        type="button"
        disabled={busy}
        onClick={() => { setFormError(null); setIgnoringId(contact.id); }}
      >
        <EyeOff size={13} aria-hidden="true" />标为无关
      </button>
    );
  };

  const section = (
    kind: keyof typeof KIND_COPY,
    list: Contact[],
    emptyText: string,
    renderActions: (contact: Contact) => ReactNode,
    extra?: ReactNode,
  ) => {
    const copy = KIND_COPY[kind];
    const shown = active(list);
    const buried = hidden(list);
    return (
      <section className={`contact-section is-${kind}`}>
        <header className="contact-section-head">
          <h3>{copy.icon}{copy.title}</h3>
          <span className="badge badge-neutral">{shown.length}</span>
        </header>
        <p className="contact-section-hint">{copy.hint}</p>
        {shown.length === 0 ? (
          <p className="contact-section-empty">{emptyText}</p>
        ) : (
          <ul className="contact-list">
            {shown.map((contact, index) => (
              <ContactRow
                key={contact.id ?? `live-${index}`}
                contact={contact}
                actions={renderActions(contact)}
              >
                {ignoringId !== null && ignoringId === contact.id && (
                  <IgnoreForm
                    idPrefix={`ignore-${contact.id}`}
                    busy={busy}
                    error={formError}
                    onCancel={() => { setIgnoringId(null); setFormError(null); }}
                    onSubmit={(reason) => {
                      setFormError(null);
                      ignore.mutate({ cid: contact.id as number, reason });
                    }}
                  />
                )}
                {editingId !== null && editingId === contact.id && (
                  <ManualForm
                    idPrefix={`edit-${contact.id}`}
                    busy={busy}
                    error={formError}
                    initial={{
                      name: contact.name ?? '', title: contact.title ?? '',
                      phone: contact.phone ?? '', email: contact.email ?? '',
                      org: contact.org ?? '', evidence: contact.evidence ?? '',
                    }}
                    onCancel={() => { setEditingId(null); setFormError(null); }}
                    onSubmit={(body) => {
                      setFormError(null);
                      update.mutate({ cid: contact.id as number, body });
                    }}
                  />
                )}
              </ContactRow>
            ))}
          </ul>
        )}
        {buried.length > 0 && (
          <details className="contact-hidden">
            <summary>已标为无关 {buried.length} 条（记录仍在库里，可撤销）</summary>
            <ul className="contact-list">
              {buried.map((contact, index) => (
                <ContactRow
                  key={contact.id ?? `buried-${index}`}
                  contact={contact}
                  actions={ignoreAction(contact)}
                />
              ))}
            </ul>
          </details>
        )}
        {extra}
      </section>
    );
  };

  return (
    <div className="contact-board">
      {nothing && (
        <div className="notice notice-warning contact-board-empty">
          <strong>这条商机目前没有可用的关键人。</strong>
          <span>
            公告未载联系人——国内来源多是行业媒体转载，采购联系方式在转载时就被剥离了，
            所以「抽不到」是常态，不是抓取失败。可以按下方的穿透路径找对口单位，
            或者把销售手上已确认的人直接补录进来。系统不会替你猜一个名字出来。
          </span>
        </div>
      )}

      {contacts.announcement_live && active(announcement).length > 0 && (
        <div className="notice">
          下面这批公告实证联系人<b>尚未入库</b>：contacts 表里还没有这条线索的记录，
          这是本次请求用同一份公告正文现抽的结果。跑一次 <code>backfill_contacts.py</code> 或让管线重跑即可落库。
        </div>
      )}

      {section(
        'announcement',
        announcement,
        '公告原文里没有能逐字核对的联系方式。',
        (contact) => ignoreAction(contact),
      )}

      {section(
        'inferred_path',
        inferred,
        '还没有为这条商机写入穿透路径。产业链穿透由数据侧的 agent 工具写入，界面不代写——凭空补一条推断路径没有意义。',
        (contact) => ignoreAction(contact),
      )}

      {section(
        'manual',
        manual,
        '还没有人工补录的关键人。',
        (contact) => (
          <>
            <button
              className="btn btn-link"
              type="button"
              disabled={busy}
              onClick={() => { setFormError(null); setEditingId(contact.id); }}
            >
              <Pencil size={13} aria-hidden="true" />编辑
            </button>
            <button
              className="btn btn-link is-danger"
              type="button"
              disabled={busy}
              onClick={() => {
                if (contact.id === null) return;
                if (window.confirm('删除这条人工补录？记录会被真删除，无法撤销。')) {
                  setFormError(null);
                  remove.mutate(contact.id);
                }
              }}
            >
              <Trash2 size={13} aria-hidden="true" />删除
            </button>
          </>
        ),
        adding ? (
          <ManualForm
            idPrefix={`add-${leadId}`}
            busy={busy}
            error={formError}
            onCancel={() => { setAdding(false); setFormError(null); }}
            onSubmit={(body) => { setFormError(null); create.mutate(body); }}
          />
        ) : (
          <button
            className="btn btn-secondary contact-add-btn"
            type="button"
            onClick={() => { setFormError(null); setAdding(true); setEditingId(null); setIgnoringId(null); }}
          >
            <Plus size={14} aria-hidden="true" />补录关键人
          </button>
        ),
      )}

      {formError && !adding && editingId === null && ignoringId === null && (
        <div className="notice notice-error" role="alert">
          <X size={13} aria-hidden="true" />{formError}
        </div>
      )}
    </div>
  );
}
