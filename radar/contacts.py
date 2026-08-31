"""线索关键人：从公告原文逐字抽取联系方式，并落进 contacts 表。

这个模块原本长在 api.py 里（每次请求实时正则、不落库）。搬到数据侧的原因有两个：
抽取属于数据加工不属于呈现；落库之后联系人才能被回溯、被人工补录、被 agent 查询。

**红线（整个模块的存在理由）**

1. 只抽，不推断，不补全。每一个 name/phone/email 都能在 raw_text 里原样搜到。
2. 不能把发文单位自己的联系方式当成采购方的。政策解读、会议通知类公告里常带
   媒体或主办方电话，直接放进「联系方式」栏，销售照着打过去就是打给了写稿的人。
3. 会议 / 展会 / 招商推广类联系人一律不要。脱敏示例：
   「八、会议联系方式 参会/赞助/申请报告联系： 示例经理 电话：202-555-0101」——
   这是论坛赞助商务，不是采购方关键人。**宁可漏，不可错**：
   漏一个销售自己回源翻一下就有了，错一个是让销售打错电话。

模块里的两层过滤要分清：
  · 第一层（PROCUREMENT_CUES + official）是从 api.py 原样搬过来的，逻辑一字未改，
    有黄金样本回归固定住（见 tests/test_contacts.py）。
  · 第二层（EXCLUDE_CUES + _implausible_name）是本次新增的排除层，只做减法：
    它只会把候选**删掉**，永远不会凭空造出一个候选。
"""
import datetime as dt
import re

# ---------------------------------------------------------------- 第一层：原样搬迁
# 以下 PROCUREMENT_CUES / CONTACT_PATTERNS / _extract_contact_raw 三段，
# 与 api.py v1.2.0 里的实现逐字一致。改这里等于改线上行为，改动前先跑黄金样本回归。

# 采购语境词：启发式抽取的联系方式必须出现在这些词附近，
# 否则抓到的很可能是公告发布方（媒体、会议主办方、发文机关）自己的电话。
PROCUREMENT_CUES = ["招标", "采购", "投标", "标书", "报名", "询价", "比选",
                    "开标", "供应商", "项目联系", "商务", "技术咨询"]

# (标签, 正则, 是否为结构化官方字段)
CONTACT_PATTERNS = [
    ("邮箱", re.compile(r"\[官方采购联系邮箱\]\s*([^\s\n]+)"), True),
    ("联系人", re.compile(r"联\s*系\s*人[：:]\s*([^\s，,；;。]{2,20})"), False),
    ("电话", re.compile(r"(?:联系电话|电\s*话|Tel)[：:]\s*(\d[\d\-— ]{6,20}\d)"), False),
    ("邮箱", re.compile(r"([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})"), False),
]


def _extract_contact_raw(raw_text: str):
    """从公告原文里逐字抽联系方式。抽不到返回空列表——由前端显示「公告未载」。

    死规矩：不编造联系人/电话/邮箱。这里只做正则摘取，不做补全或推断，
    每一项都能在 raw_text 里原样找到。

    同样重要的一条：**不能把发文单位自己的联系方式当成采购方的**。
    政策解读、会议通知类公告里常带媒体或主办方电话，直接放进
    「联系方式」栏，销售照着打过去就是打给了写稿的人。
    因此启发式命中必须落在采购语境附近，并附原文片段供人工核对；
    TED 的结构化官方字段本身已标明是采购联系人，不受此限。
    """
    if not raw_text:
        return []
    found, seen = [], set()
    for label, pat, official in CONTACT_PATTERNS:
        for m in pat.finditer(raw_text):
            val = m.group(1).strip(" \u3000：:，,。、（）()[]【】")
            if not val or val in seen:
                continue
            lo = max(0, m.start() - 120)
            ctx = re.sub(r"\s+", " ", raw_text[lo:m.end() + 60]).strip()
            if not official and not any(c in ctx for c in PROCUREMENT_CUES):
                continue
            seen.add(val)
            found.append({"label": label, "value": val,
                          "context": ctx, "official": official})
            if len(found) >= 4:
                return found
    return found


# ---------------------------------------------------------------- 第二层：排除
# 采购语境词是「像不像采购」，排除词是「是不是压根不该出现在关键人栏里」。
# 排除词优先级更高：一个片段同时命中「报名」和「参会」，按会议推广处理，丢掉。
# 这一层只做减法，命中就丢，绝不新增候选。
EXCLUDE_CUES = [
    # 会议 / 论坛 / 展会 / 培训招商
    "会议联系", "参会", "赞助", "报告联系", "大会", "论坛", "峰会", "展会", "展位",
    "博览会", "研讨会", "年会", "会务", "参展", "招展", "赞助商", "培训报名",
    # 媒体 / 转载 / 投稿
    "媒体", "编辑部", "投稿", "转载", "版权", "记者", "撰稿", "本网", "新闻热线",
    # 平台客服 / 技术支持（不是采购方，是电子交易平台的坐席）
    "客服", "服务热线", "咨询热线", "技术支持热线", "平台客服", "CA证书", "数字证书",
]

# 姓名字段的形状约束。正则允许 2-20 字，正文一长串被整段当成姓名的情况实测存在：
#   「联系人： 投标人在购买招标文件页面务必填写本次投标」← 这是句子不是人名
# 中文姓名加称谓超不过 8 字（示例经理 / 王工程师 / 李副处长），放宽到 10 字。
NAME_MAX = 10
# 出现这些词说明抓到的是正文而不是人名
NAME_NEVER = ["投标人", "务必", "请", "填写", "详见", "如下", "页面", "登录", "下载"]


def _implausible_name(value: str) -> bool:
    if len(value) > NAME_MAX:
        return True
    return any(w in value for w in NAME_NEVER)


def extract_contact(raw_text: str, strict: bool = True):
    """公开入口。strict=True（默认）在原有逻辑之上再过一遍排除层。

    strict=False 只跑第一层，用于黄金样本回归——证明搬迁没有改变原有行为。
    生产路径（api.py 展示、pipeline 落库、回填脚本）一律走 strict=True。
    """
    found = _extract_contact_raw(raw_text)
    if not strict:
        return found
    kept = []
    for c in found:
        if any(w in c["context"] for w in EXCLUDE_CUES):
            continue
        if c["label"] == "联系人" and _implausible_name(c["value"]):
            continue
        kept.append(c)
    return kept


# ---------------------------------------------------------------- 落库
KINDS = ("announcement", "inferred_path", "manual")
# 抽取标签 → contacts 表列名
_LABEL_COL = {"联系人": "name", "电话": "phone", "邮箱": "email"}


def _now():
    return dt.datetime.now().isoformat(timespec="seconds")


def _exists(conn, lead_id, kind, col, value):
    return conn.execute(
        f"SELECT 1 FROM contacts WHERE lead_id=? AND kind=? AND {col}=? LIMIT 1",
        (lead_id, kind, value)).fetchone() is not None


def save_announcement_contacts(conn, lead_id: int, raw_text: str,
                               source_note: str = "pipeline"):
    """把公告原文里抽到的联系方式写进 contacts（kind=announcement）。

    幂等：同一条线索、同一个值不重复插——回填脚本可以反复跑。
    不 commit，由调用方决定事务边界。返回本次实际新增的条数。
    """
    added = 0
    for c in extract_contact(raw_text or ""):
        col = _LABEL_COL.get(c["label"])
        if not col:
            continue
        if _exists(conn, lead_id, "announcement", col, c["value"]):
            continue
        cols = {"name": None, "phone": None, "email": None}
        cols[col] = c["value"]
        conn.execute(
            "INSERT OR IGNORE INTO contacts"
            " (lead_id, kind, name, phone, email, evidence, official,"
            "  source_note, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            (lead_id, "announcement", cols["name"], cols["phone"], cols["email"],
             c["context"], 1 if c["official"] else 0,
             f"{source_note}:regex:{c['label']}", _now(), None))
        added += 1
    return added


# 穿透路径里禁止出现的东西：手机号 / 座机 / 400 热线 / 邮箱。
# 姓名没法用正则可靠识别，但真正会造成损害的是「照着拨出去」——所以卡这两类。
_CONTACT_IN_PATH = re.compile(
    r"[\w.+-]+@[\w-]+\.[\w.-]+"                 # 邮箱
    r"|(?<!\d)1[3-9]\d{9}(?!\d)"                  # 手机号
    r"|(?<!\d)(?:400|800)[-\s]?\d{3}[-\s]?\d{4}(?!\d)"   # 400/800 热线
    r"|(?<!\d)0\d{2,3}[-\s]?\d{7,8}(?!\d)")     # 区号+座机


def add_inferred_path(conn, lead_id: int, path_note: str,
                      source_note: str = "agent"):
    """写一条穿透路径（kind=inferred_path）。

    **这条记录里没有姓名/电话/邮箱**，只有「该找哪一方、怎么核实」。
    按 knowledge.md 产业链穿透规则第 2 条：中间层未在公告中点名时写清识别路径，
    不许编一个中间商的名字出来。函数签名里根本不接受人名参数，是刻意的。

    幂等：同一条线索同样的路径说明不重复插。
    """
    note = (path_note or "").strip()
    if not note:
        raise ValueError("path_note 不能为空")
    # 参数集里没有 name/phone/email，但 path_note 是自由文本——模型仍可能在散文里
    # 夹一句「找开沃采购部张经理 13812345678」。姓名难用正则判，电话和邮箱能：
    # 而恰恰是电话邮箱会被销售直接拨出去。推断路径按定义不是实证，
    # 这两样只能来自公告原文（announcement 类），这里一律拒收。
    # （2026-08-30 对抗审查指出的残留编造通道。）
    hit = _CONTACT_IN_PATH.search(note)
    if hit:
        raise ValueError(
            f"穿透路径里不许出现电话或邮箱（发现「{hit.group(0)[:24]}」）——"
            "推断路径只写『该找哪一方、怎么核实』。"
            "真实联系方式只能来自公告原文，由系统从 raw_text 逐字抽取入库。")
    if conn.execute(
            "SELECT 1 FROM contacts WHERE lead_id=? AND kind='inferred_path'"
            " AND evidence=? LIMIT 1", (lead_id, note)).fetchone():
        return 0
    conn.execute(
        "INSERT OR IGNORE INTO contacts (lead_id, kind, evidence, official,"
        " source_note, created_at) VALUES (?,?,?,?,?,?)",
        (lead_id, "inferred_path", note, 0, source_note, _now()))
    return 1


def list_contacts(conn, lead_id: int):
    """按 kind 分组返回某条线索的联系人。界面要分开显示，不许混为一谈。"""
    rows = conn.execute(
        "SELECT id, kind, name, title, phone, email, org, evidence, official,"
        " source_note, created_at, updated_at FROM contacts"
        " WHERE lead_id=? ORDER BY id", (lead_id,)).fetchall()
    grouped = {k: [] for k in KINDS}
    for r in rows:
        d = dict(r)
        grouped.setdefault(d["kind"], []).append(d)
    return grouped
