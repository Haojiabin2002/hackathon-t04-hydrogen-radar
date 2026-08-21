---
name: 氢能商机雷达
description: 以冷色产品画布承载真实信号、可追溯判断与销售动作的专业工作台
colors:
  paper: "#fcfcfc"
  surface: "#ffffff"
  surface-subtle: "#f1f5f9"
  surface-pressed: "#e8eefc"
  wash: "#f0f4fe"
  midnight-ink: "#020520"
  secondary-ink: "#14141e"
  muted: "#5d6677"
  line: "#e2e8f0"
  line-strong: "#cbd5e1"
  royal-blue: "#145aff"
  royal-blue-strong: "#0e49dc"
  royal-blue-soft: "#eaf0ff"
  success: "#119c2a"
  success-soft: "#ebfaee"
  risk: "#a85c00"
  risk-soft: "#fff4e7"
  danger: "#c64338"
  danger-soft: "#fff0ee"
  focus: "#0099ff"
typography:
  display:
    fontFamily: "Source Han Sans CN, 思源黑体 CN, IBM Plex Sans Variable, PingFang SC, sans-serif"
    fontSize: "clamp(34px, 3.2vw, 48px)"
    fontWeight: 600
    lineHeight: 0.98
    letterSpacing: "-0.037em"
  headline:
    fontFamily: "Source Han Sans CN, 思源黑体 CN, IBM Plex Sans Variable, PingFang SC, sans-serif"
    fontSize: "clamp(19px, 1.7vw, 24px)"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  title:
    fontFamily: "IBM Plex Sans Variable, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.012em"
  body:
    fontFamily: "IBM Plex Sans Variable, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: "IBM Plex Sans Variable, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "normal"
rounded:
  inner: "10px"
  control: "12px"
  base: "14px"
  panel: "16px"
  floating: "18px"
  band: "22px"
  canvas: "24px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "18px"
  xl: "24px"
  xxl: "28px"
components:
  button-primary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.royal-blue}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.royal-blue}"
    textColor: "{colors.surface}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "44px"
  nav-floating:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.secondary-ink}"
    rounded: "{rounded.floating}"
    padding: "0 10px 0 12px"
    height: "60px"
  trace-band:
    backgroundColor: "{colors.wash}"
    textColor: "{colors.midnight-ink}"
    rounded: "{rounded.band}"
    padding: "10px 12px 12px"
  workbench:
    backgroundColor: "{colors.wash}"
    textColor: "{colors.midnight-ink}"
    rounded: "{rounded.canvas}"
    padding: "12px"
  status-chip:
    backgroundColor: "{colors.success-soft}"
    textColor: "{colors.success}"
    rounded: "{rounded.pill}"
    padding: "0 10px"
    height: "27px"
---

# Design System: 氢能商机雷达

## Overview

**Creative North Star: “冷色链路画布”**

界面是一块安静、通透但信息密集的冷色产品画布。它吸收 Relate 风格中克制的冷白空间、淡紫洗色、柔和层级与精确圆角，同时保留专业业务工具所需的扫描效率；它不是旧式方角纸面终端，也不借舱单、海关文件或纸张纹理塑造身份。

视觉始终服务于一条真实业务链：先确认链路健康，再选择信号，随后核对模型判断与原始证据，最后进入销售动作。皇家蓝负责交互和当前选择，绿、琥珀、红仅表达状态；关键事实仍由文本、图标和可回源内容共同说明，不能只靠色彩传达。

**Key Characteristics:**

- 冷白主画布与淡紫分组带，午夜墨文本与少量皇家蓝形成清晰对比。
- 浮动浅色导航、圆角链路带和圆角三栏工作台构成桌面主骨架。
- 容器有柔和层级但不厚重；边框只在字段分隔、焦点和需要核验的状态中出现。
- 胶囊动作、圆角产品容器和 5–7px 语义状态点反复出现，成为统一识别语言。
- 数据与状态来自真实接口；空、错、阻塞、正文编码异常和无关联记录都是完整界面状态。

## Colors

配色以冷白和淡紫建立低压工作环境，用午夜墨保证长时间阅读，用皇家蓝串起导航、选择、链接和主动作。

### Primary

- **皇家蓝**（`royal-blue`）：核心交互、当前路由、选中信号、链接、焦点附近的视觉强调，以及追溯链的品牌提示。
- **深皇家蓝**（`royal-blue-strong`）：选中态文字和需要更高对比的蓝色交互反馈。
- **浅皇家蓝**（`royal-blue-soft`）：选中、信息提示和次级动作的柔和底色。

### Secondary

- **淡紫洗色**（`wash`）：追溯链带、工作台底层、导航悬停和页面头部渐变的冷色分组面。
- **柔雾表面**（`surface-subtle`）：列表行、事实单元、运行状态和局部容器的次级表面。

### Tertiary

- **验证绿**（`success` / `success-soft`）：真实可回源、链路就绪和在线来源。
- **风险琥珀**（`risk` / `risk-soft`）：等待、部分成功、风险或需要恢复的状态。
- **阻断红**（`danger` / `danger-soft`）：错误、模型或采集阻断、缺失原文和编码异常。

### Neutral

- **冷白画布**（`paper`）与**纯白表面**（`surface`）：分别承载页面背景和可操作内容容器。
- **午夜墨**（`midnight-ink`）与**次级墨色**（`secondary-ink`）：主内容、标题和控件文字。
- **冷灰文字**（`muted`）：说明、时间、来源和辅助信息；不用于关键结论。
- **柔线**（`line`）与**强线**（`line-strong`）：仅用于表格、字段组、输入框和必要的结构分隔。

### Named Rules

**The Blue Means Interaction Rule.** 皇家蓝优先表示可操作、被选中或正在关注的对象，不替代绿、琥珀、红的状态语义。

**The Status Needs Words Rule.** 每个状态色必须与文字或图标同现；颜色深浅不能单独承担“实证、推断、阻断”等业务含义。

## Typography

**Display Font:** Source Han Sans CN / 思源黑体 CN，本机字体优先；回退到 IBM Plex Sans Variable、PingFang SC、sans-serif。

**Body Font:** IBM Plex Sans Variable，通过项目字体包加载；中文回退为 PingFang SC、Microsoft YaHei、sans-serif。

**Character:** 展示字体让中文大标题紧凑、稳定且有现代产品感；IBM Plex Sans 负责高密度正文、标签和数字。Source Han Sans CN 是本地可用字体，但实现不依赖单一机器字体：缺失时按既定回退链继续排版。

### Hierarchy

- **Display**（600，`clamp(34px, 3.2vw, 48px)`，0.98）：页面主标题，使用略紧字距和均衡换行。
- **Headline**（600，`clamp(19px, 1.7vw, 24px)`，1.25）：当前信号标题及关键状态标题。
- **Title**（600，15–16px，约 1.3）：面板名、分区名和需要快速扫描的条目标题。
- **Body**（400，15px，1.55）：全局正文；密集卡片和证据内容可降至 13–14px，并提高行高到 1.65–1.7。
- **Label**（600，10–12px）：日期、字段名、状态、数量单位和元信息，不强制全大写。
- **Numbers**：日期、编号、分数、数量与运行事实使用 `tabular-nums`，保证纵向比较稳定。

### Named Rules

**The Chinese Display Rule.** 只有页面标题和关键研判标题进入展示字体；导航、字段、状态与正文继续使用 IBM Plex Sans 工作字体。

## Layout

应用以最大宽度 1560px 的居中画布组织内容。顶部导航在桌面端高 80px，内部为 60px 的浮动圆角条；Today 页在导航下依次放置日期标题区、五段完整追溯链和三栏工作台，三个区域间保持紧凑的 12px 节奏，使首屏能够同时容纳健康状态、信号选择与判断证据。

桌面工作台使用不对称三栏：左侧信号约 0.82fr，中部研判约 1.48fr，右侧证据约 0.9fr；中栏获得最高视觉与阅读优先级。追溯链的五个节点等宽排列，每个节点同时呈现阶段、数量、单位和解释，不拆成独立 KPI 卡墙。

在 1280px 以下，工作台收为两栏，证据与恢复动作横跨下一行；在 1040px 以下，导航项收为图标，追溯链允许局部横向滚动；在 860px 以下，导航切换为左侧抽屉，Today 工作台变为单列，点击信号后滚动并聚焦研判区。移动追溯链明确显示横向滑动提示，不允许链路撑宽整页。触控目标最小 44px，文本必须换行、截断或断词以避免页面级横向溢出。

**The Linked Selection Rule.** 同一条选中信号必须同步驱动中部研判和右侧证据，不能让三个栏位成为互不相关的信息卡。

## Elevation & Depth

系统采用“色调分层为主、柔和阴影为辅”的深度策略。冷白页面上先用淡紫带包住流程组，再以白色容器浮出可操作内容；卡片阴影是低对比的午夜墨与皇家蓝混合环境影，浮层和菜单使用更宽的柔光影。顶部导航允许轻微透明与背景模糊，页面背景也有很淡的径向蓝紫光晕，但这种处理只建立画布空气感，不扩散为玻璃卡片或发光装饰。

### Shadow Vocabulary

- **Card ambient**（`0 1px 2px rgba(2, 5, 32, .04), 0 10px 30px rgba(20, 90, 255, .055)`）：普通面板、链路节点和页面头部。
- **Floating ambient**（`0 2px 8px rgba(2, 5, 32, .06), 0 24px 64px rgba(20, 90, 255, .09)`）：菜单、运行详情和移动导航抽屉。
- **Interactive lift**：信号行和队列项悬停时轻移 1px 并出现小范围蓝色环境影；静态列表不持续漂浮。

### Named Rules

**The Soft Hierarchy Rule.** 先用色调和留白分组，再用阴影确认层级；阴影不能比内容或状态更醒目。

## Shapes

形状语言来自圆角产品容器而非方角纸张。10–14px 用于内部事实块、列表行、输入和状态容器，16–18px 用于面板、浮动导航和弹层，22–24px 用于链路带、页面头部与工作台大容器；所有动作型按钮、筛选器和小型状态标签使用完全胶囊形。圆形只用于小型语义状态点、追溯节点标记和运行图标。

边框保持克制：面板主要靠表面与阴影分层，1px 线条用于内部字段分隔、输入边界、焦点和需要明确验证含义的状态标签。嵌套容器的圆角应逐级缩小，避免多个同半径轮廓叠在一起。

## Components

### Floating Navigation

- **Style:** 冷白半透明外层与纯白内部条，18px 圆角和低对比环境影；品牌标记为 38px 皇家蓝圆角方块。
- **Navigation states:** 默认文字为冷灰，悬停和当前路由使用淡紫底与皇家蓝文字；当前路由同时提高字重。
- **Health and action:** 运行状态是带图标、标题和说明的圆角控件；“启动雷达”是蓝色描边胶囊，悬停填充皇家蓝，运行时禁用并保持真实状态文案。
- **Responsive:** 1040px 以下先收为图标；860px 以下改为浮动抽屉并使用遮罩，保留链路健康入口。

### Buttons

- **Shape:** 主动作和次级动作使用完全胶囊圆角，标准高度 42–44px；图标按钮使用 12px 圆角方形。
- **Primary:** 白底、皇家蓝文字和 1px 蓝色描边；悬停变为蓝底白字并增强环境影。
- **Secondary / Quiet:** 次级按钮使用浅蓝底；安静按钮使用白底和冷灰边界。
- **States:** `:active` 下移 1px；禁用态降低透明度并保留原因相关文案；键盘焦点统一使用 2px 亮蓝外轮廓。

### Trace Band

- **Container:** 淡紫大圆角带（22px）承载标题和五个白色节点。
- **Node:** 每个节点以 14px 圆角、柔和卡片影和 32px 圆形状态标记展示阶段、数量、单位与解释。
- **Semantics:** 就绪为绿，等待或来源异常为琥珀，研判阻断为红；移动端保持横向顺序并提供滑动提示。

### Signal Manifest

- **Row:** 整行是按钮，使用柔雾底、11px 圆角、两行标题截断和稳定编号列。
- **Selected:** 浅蓝底、皇家蓝文字、细蓝色内轮廓与轻环境影；同时触发研判单和证据卡同步更新。
- **Hover / Focus:** 悬停轻移并增强层级；键盘使用全局清晰焦点，不以颜色替代选择语义。

### Review Sheet & Evidence

- **Review sheet:** 浅冷白圆角表面，标题区采用白到淡紫的轻渐变；顶部状态胶囊内含 6px 语义点。
- **Facts and provenance:** 事实使用四列柔雾块；字段溯源统一显示“实证 / 部分实证 / 系统推断 / 待核验 / 未载”，任何 `*_unsourced` 片段直接以红色说明展示。
- **Evidence:** 正文、来源、发布时间、抓取时间、长度与原文链接组成同一张证据卡；正文编码异常时隐藏乱码，显示错误说明并保留打开原公告动作。
- **No-result state:** 没有商机时区分“研判受阻”和“尚无关联记录”，提供恢复模型通道或查看完整信号的真实下一步，不显示虚假进度。

### Status Chips & Dots

- **Verified:** 绿字配浅绿底，表示可验证、就绪或在线。
- **Waiting / risk:** 琥珀字配浅琥珀底，表示等待、部分完成或风险。
- **Blocked / error:** 红字配浅红底，表示错误、阻断、缺失或编码异常。
- **Informational / inferred:** 皇家蓝字配浅蓝底，表示中性信息、交互选择或系统推断；标签内的 5–7px 小圆点是辅助状态信号。

### Loading, Empty & Error States

- **Loading:** 使用柔雾骨架线；没有后端阶段百分比时只显示真实运行状态，不合成进度。
- **Empty:** 直接说明无真实信号、无关联商机或无可推进记录，并给出已有页面中的检查入口。
- **Error:** 淡红容器、明确错误文本和“重新读取”动作；采集、来源、模型与全局启动失败不能被普通空状态吞掉。

### Motion

- 菜单、路由和浮层使用 120–180ms 的短过渡；交互需可打断。
- 选择信号时，研判单和证据卡同步执行一次 360ms 的 `signal-sync` 轻位移与阴影恢复。
- 运行中图标可做柔和脉冲或旋转；未知进度只用不确定进度动画，不展示百分比。
- `prefers-reduced-motion: reduce` 下关闭平滑滚动并把动画、过渡压缩到近乎即时。

## Do's and Don'ts

### Do:

- **Do** 让用户沿“链路健康 → 选信号 → 核判断与证据 → 销售动作”的真实顺序工作。
- **Do** 复用冷白、淡紫、午夜墨和皇家蓝，以及 10–24px 的分层圆角和胶囊控件。
- **Do** 用小型语义点、图标和明确文案共同表达就绪、等待、阻断和推断。
- **Do** 保留原文链接、字段溯源、异常细节与恢复动作；无法确认的字段明确标记。
- **Do** 在桌面保持三栏关系，在窄屏按信号、研判、证据的任务顺序重排。

### Don't:

- **Don't** 回到“出口商情终端”的方角纸面、舱单纹理、深色命令栏或密集规则线视觉世界。
- **Don't** 把追溯阶段拆成一墙同尺寸 KPI 卡，或用大 Hero 挤出首屏的真实任务。
- **Don't** 使用渐变文字、霓虹雷达、装饰网格、厚重玻璃拟态、进度圆环或无内容的漂浮卡片。
- **Don't** 用虚构客户、商机、处理结果或百分比填补真实数据缺口。
- **Don't** 隐藏模型阻塞、来源错误、正文编码异常、`*_unsourced` 或无关联记录。
- **Don't** 创建不可点击的按钮造型；没有动作的入口应删除或明确禁用。
