---
name: 氢能商机雷达
description: 以冷色产品画布承载真实信号、可追溯判断与销售动作的专业工作台
shell: 左侧栏 + 顶栏 + 多标签的后台骨架（结构取自 art-design-pro），视觉沿用冷色链路画布
tokenLayers:
  atom: "--h2-*  固定色阶，永不随主题变化，只在角色层被引用"
  role: "--app-bg / --surface / --ink / --brand / --success 等语义角色，亮暗两套只换这一层"
  knob: "--radius-knob / --control-h / --sidebar-w 等几何旋钮"
colors:
  paper: "#fcfcfd"
  surface: "#ffffff"
  surface-subtle: "#f1f5f9"
  surface-pressed: "#e8eefc"
  surface-hover: "#f8fafc"
  wash: "#f0f4fe"
  midnight-ink: "#020520"
  secondary-ink: "#14141e"
  muted: "#5d6677"
  faint: "#94a3b8"
  line: "#e2e8f0"
  line-strong: "#cbd5e1"
  royal-blue: "#145aff"
  royal-blue-strong: "#0e49dc"
  royal-blue-soft: "#eaf0ff"
  royal-blue-line: "#bdcdf9"
  success: "#119c2a"
  success-soft: "#ebfaee"
  risk: "#a85c00"
  risk-soft: "#fff4e7"
  danger: "#c64338"
  danger-soft: "#fff0ee"
  focus: "#0099ff"
colorsDark:
  paper: "#070911"
  surface: "#0d1120"
  surface-subtle: "#141a2c"
  surface-pressed: "#1c2338"
  wash: "#141a2c"
  midnight-ink: "#eef2fb"
  secondary-ink: "#dbe2f0"
  muted: "#97a3bb"
  faint: "#6f7c96"
  line: "rgba(255,255,255,.10)"
  line-strong: "rgba(255,255,255,.18)"
  royal-blue: "由 --brand-seed 提亮 68% 派生"
  success: "#45d16a"
  risk: "#f0a53c"
  danger: "#ff7a6b"
  focus: "#4db8ff"
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
  page-title-compact:
    fontFamily: "IBM Plex Sans Variable, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "20px"
    fontWeight: 620
    lineHeight: 1.3
    letterSpacing: "-0.02em"
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
  knob: "14px"
  xs: "calc(knob / 2) = 7px"
  inner: "calc(knob - 4px) = 10px"
  control: "calc(knob - 2px) = 12px"
  base: "knob = 14px"
  panel: "calc(knob + 2px) = 16px"
  floating: "calc(knob + 4px) = 18px"
  band: "calc(knob + 8px) = 22px"
  canvas: "calc(knob + 10px) = 24px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "18px"
  xl: "24px"
  xxl: "28px"
layout:
  sidebar: "232px（收起 68px）"
  sidebarCollapsed: "68px"
  header: "60px"
  worktab: "42px"
  containerMax: "1560px（可切铺满）"
  contentGutter: "20px（窄屏 15px）"
  controlHeight: "36px（触屏 44px）"
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
  sidebar-link:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "40px"
  sidebar-link-active:
    backgroundColor: "{colors.royal-blue-soft}"
    textColor: "{colors.royal-blue}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "40px"
  header-bar:
    backgroundColor: "{colors.surface} 86% + backdrop-blur(12px)"
    textColor: "{colors.secondary-ink}"
    rounded: "0"
    padding: "0 20px"
    height: "60px"
  worktab-item:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted}"
    rounded: "{rounded.xs}"
    padding: "0 8px 0 11px"
    height: "28px"
  tool-button:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "0"
    height: "36px"
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

**Creative North Star: “冷色链路画布，装在专业后台骨架里”**

界面是一块安静、通透但信息密集的冷色产品画布，装在一副标准的后台工作骨架上：
左侧栏承载全部入口，顶栏承载当前位置与全局动作，多标签让并行核对多条线索不丢上下文。

骨架结构参考开源项目 [art-design-pro](https://github.com/Daymychen/art-design-pro)（MIT）：
侧栏 + 顶栏 + 多标签 + 设置抽屉、令牌分层、列表页三段式、圆角单旋钮。
**只借结构与工程约定，不借它的视觉皮肤**——配色、字体、状态语义仍是本项目自己的冷色画布。

视觉始终服务于一条真实业务链：先确认链路健康，再选择信号，随后核对模型判断与原始证据，最后进入销售动作。
皇家蓝负责交互和当前选择，绿、琥珀、红仅表达状态；关键事实仍由文本、图标和可回源内容共同说明，不能只靠色彩传达。

**Key Characteristics:**

- 冷白主画布与淡紫分组带，午夜墨文本与少量皇家蓝形成清晰对比；暗色模式用冷调深蓝夜底，不用纯黑。
- 左侧栏 + 顶栏 + 多标签构成桌面主骨架；当日研判在内容区里保留自己的圆角链路带与三栏工作台。
- 容器有柔和层级但不厚重；边框只在字段分隔、焦点和需要核验的状态中出现。
- 胶囊动作、圆角产品容器和 5–7px 语义状态点反复出现，成为统一识别语言。
- 数据与状态来自真实接口；空、错、阻塞、正文编码异常和无关联记录都是完整界面状态。

## Tokens

令牌分三层，实现在 `frontend/src/styles/tokens.css`。**组件样式只准消费 ② 和 ③，
出现十六进制色值或直接引用 ① 都算违规。**

### ① 原子层 `--h2-*`

固定色阶：`--h2-blue-50..900`、`--h2-gray-0..900`、`--h2-wash-*`、`--h2-green/amber/red-*`、`--h2-night-500..900`。
它们永远不随主题变化，只被角色层引用。新增颜色先在这一层定色阶。

### ② 角色层

语义角色：`--app-bg`、`--surface`、`--surface-subtle`、`--surface-pressed`、`--surface-hover`、`--wash`、
`--ink`、`--ink-2`、`--muted`、`--faint`、`--line`、`--line-strong`、`--card-border`、
`--brand`、`--brand-strong`、`--brand-soft`、`--brand-line`、`--brand-on`、
`--success/-soft/-line`、`--risk/-soft/-line`、`--danger/-soft/-line`、`--focus`、
`--shadow-card`、`--shadow-float`、`--skeleton`。

亮暗两套**只在这一层切换**，各写一遍，不许写第三遍。跟随系统由 `index.html` 的首绘前脚本
解析成 `data-theme="light|dark"` 再落到 `<html>`，因此 CSS 里没有第三份
`@media (prefers-color-scheme)` 复制块。

### ③ 旋钮层

`--radius-knob`（默认 14px）派生全部层级圆角；`--control-h`、`--sidebar-w`、`--header-h`、
`--worktab-h`、`--container-max`、`--content-gutter`、`--art-full-height`。

### Named Rules

**The Single Seed Rule.** 品牌色只有一个可调点 `--brand-seed`。
`--brand`、`--brand-strong`、`--brand-soft`、`--brand-line` 全部用 `color-mix` 从它派生，
暗色模式再整体提亮。**状态色（绿/琥珀/红）不受品牌色影响**——换主题色不能改变"实证/风险/阻断"的语义。

**The One Knob Rule.** 圆角只有一个旋钮 `--radius-knob`。
任何组件写 `border-radius: 12px` 都是违规，必须写 `var(--radius-control)`。
阶梯名与本文件 `rounded` 块一一对应，改名要两处同改。

## Colors

配色以冷白和淡紫建立低压工作环境，用午夜墨保证长时间阅读，用皇家蓝串起导航、选择、链接和主动作。
暗色模式把画布换成冷调夜蓝（`#070911` / `#0d1120`），状态色统一提亮以保住正文对比度。

### Primary

- **皇家蓝**（`--brand`）：核心交互、当前路由、选中信号、链接、焦点附近的视觉强调。
- **深皇家蓝**（`--brand-strong`）：选中态文字和需要更高对比的蓝色交互反馈。
- **浅皇家蓝**（`--brand-soft`）：选中、信息提示和次级动作的柔和底色。

### Secondary

- **淡紫洗色**（`--wash`）：追溯链带、工作台底层、指标条底面。
- **柔雾表面**（`--surface-subtle`）：列表行、事实单元、运行状态和局部容器的次级表面。

### Tertiary

- **验证绿**（`--success` / `-soft`）：真实可回源、链路就绪和在线来源。
- **风险琥珀**（`--risk` / `-soft`）：等待、部分成功、风险或需要恢复的状态。
- **阻断红**（`--danger` / `-soft`）：错误、模型或采集阻断、缺失原文和编码异常。

### Neutral

- **冷白画布**（`--app-bg`）与**纯白表面**（`--surface`）：分别承载页面背景和可操作内容容器。
- **午夜墨**（`--ink`）与**次级墨色**（`--ink-2`）：主内容、标题和控件文字。
- **冷灰文字**（`--muted`）：说明、时间、来源和辅助信息；不用于关键结论。
- **柔线**（`--line`）与**强线**（`--line-strong`）：仅用于表格、字段组、输入框和必要的结构分隔。

### Named Rules

**The Blue Means Interaction Rule.** 皇家蓝优先表示可操作、被选中或正在关注的对象，不替代绿、琥珀、红的状态语义。

**The Status Needs Words Rule.** 每个状态色必须与文字或图标同现；颜色深浅不能单独承担"实证、推断、阻断"等业务含义。

## Typography

**Display Font:** Source Han Sans CN / 思源黑体 CN，本机字体优先；回退到 IBM Plex Sans Variable、PingFang SC、sans-serif。

**Body Font:** IBM Plex Sans Variable，通过项目字体包加载；中文回退为 PingFang SC、Microsoft YaHei、sans-serif。

### Hierarchy

- **Display**（600，`clamp(34px, 3.2vw, 48px)`）：**仅当日研判的页面主标题**。
- **Headline**（600，`clamp(19px, 1.7vw, 24px)`）：当前信号标题及关键状态标题。
- **Compact page title**（620，20px）：列表页与详情页的页头标题，用工作字体。
- **Title**（600，15–16px）：面板名、分区名和需要快速扫描的条目标题。
- **Body**（400，15px，1.55）：全局正文；密集卡片和证据内容可降至 13–14px，行高提到 1.65–1.7。
- **Label**（600，10–12px）：日期、字段名、状态、数量单位和元信息，不强制全大写。
- **Numbers**：日期、编号、分数、数量与运行事实使用 `tabular-nums`。

### Named Rules

**The Chinese Display Rule.** 展示字体只留给当日研判的工作台主标题和关键研判标题。
列表页、详情页、编辑页一律用 20px 紧凑页头——面包屑和多标签已经交代了"我在哪"，
不需要再用 150px 的渐变大页头重复一遍，那些纵向空间应该还给表格。

## Layout

### 壳

```
.app-layout
  #app-sidebar    232px（可收 68px）· 品牌 + 分组菜单 + 收起开关
  #app-main
    #app-header   60px  · 面包屑 / 采集链路状态 / 启动雷达 / 明暗 / 设置
    #app-worktab  42px  · 多标签页
    #app-content  限宽 1560px（可切铺满）· gutter 20px
```

侧栏菜单、面包屑、多标签**全部由路由 `meta` 派生**（`frontend/src/router/modules/*`）。
加一个页面 = 加一条路由记录，三处一起出现。**不许再维护第二份菜单数组。**

`启动雷达` 是全局主动作，任何页面都能触发，因此留在壳里而不是页面里。

### 断点

- **≤1180px**：顶栏状态胶囊收起文字，只留图标。
- **≤900px**：侧栏变浮动抽屉 + 遮罩；多标签隐藏；`.art-full-height` 放开为自然高度；
  表格头工具条改为上下两段；gutter 收到 15px。
- **≤760px**：面包屑退场（抽屉里能看到当前位置）。
- **≤620px**：页头改上下堆叠；搜索栏栅格收为单列；指标卡两列。
- **触屏（hover: none）**：所有可点目标不小于 44px。

### Named Rules

**The Linked Selection Rule.** 当日研判里同一条选中信号必须同步驱动中部研判和右侧证据，
不能让三个栏位成为互不相关的信息卡。

**The Menu Has One Source Rule.** 菜单只有路由 `meta` 一个来源。
在组件里手写导航数组是本项目最容易出现的漂移点。

## Page Composition

### 列表页三段式

结构取自 art-design-pro，顺序不可调换：

1. **搜索栏** `ArtSearchBar` —— 默认收起，由表格头的搜索按钮控制显隐。
   输入不即时请求，按「查询」或回车才生效；条件写进 URL，刷新和分享都能还原。
2. **表格头** `ArtTableHeader` —— **左侧是业务动作与筛选，右侧是表格工具**（搜索、刷新、列设置）。
   左右不可对调；工具组不换行，宁可让左侧折行。
3. **表格** `ArtTable` + `ArtPagination` —— 列定义（含排序、宽度、显隐）来自 `useTable`，
   页面不直接写 `<th>` / `<td>`。

### 高度契约

列表页根节点加 `.art-full-height`（固定为视口剩余高度，flex 列），
`.art-table-card` 为 `flex: 1; min-height: 0`，于是**表格在卡片内滚动，页面本身不长出滚动条**。
窄屏自动放开为自然高度。

### 状态

`ArtLoading` / `ArtEmpty` / `ArtError` 三态必须分开使用。
**"没有关联记录" 和 "研判受阻" 是两回事，不许用同一个空态吞掉。**

## Elevation & Depth

系统采用"色调分层为主、柔和阴影为辅"的深度策略。冷白页面上先用淡紫带包住流程组，
再以白色容器浮出可操作内容；卡片阴影是低对比的午夜墨与皇家蓝混合环境影，浮层和菜单使用更宽的柔光影。
顶栏允许轻微透明与背景模糊。暗色模式改用纯黑向阴影，不做发光。

卡片形态由 `data-box-mode` 一个属性统一切换：

- `shadow-mode`（默认）：透明描边 + `--shadow-card`
- `border-mode`：1px `--card-border` + 无阴影

### Shadow Vocabulary

- **Card ambient**（`--shadow-card`）：普通面板、链路节点、表格卡片和页面头部。
- **Floating ambient**（`--shadow-float`）：菜单、运行详情、设置抽屉和移动导航抽屉。
- **Interactive lift**：信号行和队列项悬停时轻移 1px 并出现小范围蓝色环境影；静态列表不持续漂浮。

### Named Rules

**The Soft Hierarchy Rule.** 先用色调和留白分组，再用阴影确认层级；阴影不能比内容或状态更醒目。

## Shapes

形状语言来自圆角产品容器而非方角纸张。全部圆角由 `--radius-knob` 派生（见 `rounded` 块）：
7px 用于标签页与小徽章，10–14px 用于内部事实块、列表行、输入和状态容器，
16–18px 用于面板、浮层和抽屉，22–24px 用于链路带、页面头部与工作台大容器；
所有动作型按钮、筛选器和小型状态标签使用完全胶囊形。
圆形只用于小型语义状态点、追溯节点标记和运行图标。

边框保持克制：面板主要靠表面与阴影分层，1px 线条用于内部字段分隔、输入边界、焦点和需要明确验证含义的状态标签。
嵌套容器的圆角应逐级缩小。

## Components

### Sidebar

- **Style:** 纯白（暗色为夜蓝）竖栏，右侧 1px `--card-border`；品牌标记为 34px 皇家蓝圆角方块。
- **Groups:** 三组——销售工作 / 情报配置 / 系统运行；分组标题为 11px 冷灰标签，收起时退化为一条分隔线。
- **Item states:** 默认冷灰文字；悬停换 `--surface-hover`；当前路由用 `--brand-soft` 底 + 皇家蓝文字 + 加粗。
- **Badge:** 待研判数量等实时计数以皇家蓝小徽章挂在菜单项右侧；**数字为 0 时不显示徽章**。
- **Collapsed:** 68px 只留图标，标题走 `title` 提示。窄屏改为浮动抽屉，收起开关隐藏（抽屉形态下它没有动作）。

### Header Bar

- **Breadcrumb:** 分组 → 父页面 → 当前页，全部来自路由 `meta`；匹配不到路由时只显示原始路径，**不编造标题**。
- **链路状态:** 带图标的胶囊，显示 `headline` + `detail`；就绪为绿，运行中脉冲，失败或阻断为琥珀。
  点开是运行详情浮层。
- **启动雷达:** 蓝色描边胶囊，悬停填充皇家蓝，运行时禁用并保持真实状态文案。
- **明暗与设置:** 36px 圆角图标按钮。

### Work Tab

- **Item:** 28px 高、7px 圆角的小标签，当前页用 `--brand-soft` 底 + 皇家蓝文字。
- **Rules:** 首页固定不可关；动态路由（商机详情）按完整路径各占一个标签，标题带编号；
  关掉当前标签落到左邻。标签状态存 `sessionStorage`，刷新保留。
- **Responsive:** ≤900px 整条隐藏。

### Settings Drawer

右侧圆角抽屉，分四段：主题（亮/暗/跟随系统）、品牌色（6 个预设种子）、
形态（圆角旋钮 8–20px、卡片描边或阴影）、布局（限宽或铺满、多标签开关、侧栏收起）。
全部即时生效并写入 `localStorage`；首绘前由 `index.html` 的脚本还原，**不会闪一下再切**。

### Buttons

- **Shape:** 主动作和次级动作使用完全胶囊圆角，标准高度 42–44px；图标按钮 36px、`--radius-control` 方形。
- **Primary:** 白底、皇家蓝文字和 1px 蓝色描边；悬停变为蓝底白字并增强环境影。
- **Secondary / Quiet:** 次级按钮使用浅蓝底；安静按钮使用白底和冷灰边界。
- **States:** `:active` 下移 1px；禁用态降低透明度并保留原因相关文案；键盘焦点统一 2px 亮蓝外轮廓。

### Trace Band（当日研判）

- **Container:** 淡紫大圆角带（22px）承载标题和五个白色节点。
- **Node:** 每个节点以 14px 圆角、柔和卡片影和 32px 圆形状态标记展示阶段、数量、单位与解释。
- **Semantics:** 就绪为绿，等待或来源异常为琥珀，研判阻断为红；移动端保持横向顺序并提供滑动提示。

### Signal Manifest（当日研判）

- **Row:** 整行是按钮，柔雾底、11px 圆角、两行标题截断和稳定编号列。
- **Selected:** 浅蓝底、皇家蓝文字、细蓝色内轮廓与轻环境影；同时触发研判单和证据卡同步更新。

### Review Sheet & Evidence（当日研判）

- **Review sheet:** 浅冷白圆角表面，标题区采用白到淡紫的轻渐变；顶部状态胶囊内含 6px 语义点。
- **Facts and provenance:** 事实使用四列柔雾块；字段溯源统一显示"实证 / 部分实证 / 系统推断 / 待核验 / 未载"，
  任何 `*_unsourced` 片段直接以红色说明展示。
- **Evidence:** 正文、来源、发布时间、抓取时间、长度与原文链接组成同一张证据卡；
  正文编码异常时隐藏乱码，显示错误说明并保留打开原公告动作。
- **No-result state:** 没有商机时区分"研判受阻"和"尚无关联记录"。

### Status Chips & Dots

- **Verified:** 绿字配浅绿底，表示可验证、就绪或在线。
- **Waiting / risk:** 琥珀字配浅琥珀底，表示等待、部分完成或风险。
- **Blocked / error:** 红字配浅红底，表示错误、阻断、缺失或编码异常。
- **Informational / inferred:** 皇家蓝字配浅蓝底；标签内的 5–7px 小圆点是辅助状态信号。

### Loading, Empty & Error States

- **Loading:** 柔雾骨架线；没有后端阶段百分比时只显示真实运行状态，**不合成进度**。
- **Empty:** 直接说明无真实信号、无关联商机或无可推进记录，并给出已有页面中的检查入口。
- **Error:** 淡红容器、明确错误文本和"重新读取"动作；采集、来源、模型与全局启动失败不能被普通空状态吞掉。

### Motion

- 菜单、路由和浮层使用 120–180ms 的短过渡；交互需可打断。
- 选择信号时，研判单和证据卡同步执行一次 360ms 的 `signal-sync` 轻位移与阴影恢复。
- 切换主题时给 `<html>` 加 60ms 的 `.theme-switching` 掐掉全局过渡，避免整页颜色逐个补间。
- 运行中图标可做柔和脉冲或旋转；未知进度只用不确定进度动画，不展示百分比。
- `prefers-reduced-motion: reduce` 下关闭平滑滚动并把动画、过渡压缩到近乎即时。

## Do's and Don'ts

### Do:

- **Do** 让用户沿"链路健康 → 选信号 → 核判断与证据 → 销售动作"的真实顺序工作。
- **Do** 只消费角色层与旋钮层令牌；新颜色先在原子层定色阶，再起语义名。
- **Do** 让菜单、面包屑、多标签都从路由 `meta` 派生。
- **Do** 列表页按「搜索栏 → 表格头 → 表格」三段式组织，并套上 `.art-full-height` 高度契约。
- **Do** 用小型语义点、图标和明确文案共同表达就绪、等待、阻断和推断。
- **Do** 保留原文链接、字段溯源、异常细节与恢复动作；无法确认的字段明确标记。

### Don't:

- **Don't** 在组件样式里写十六进制色值或 `border-radius: Npx`。
- **Don't** 在组件里手写第二份导航数组。
- **Don't** 把亮暗角色变量写第三遍（比如再补一个 `@media (prefers-color-scheme)` 块）。
- **Don't** 让品牌色影响绿 / 琥珀 / 红的状态语义。
- **Don't** 在列表页用 150px 的渐变大页头重复面包屑已经说过的话。
- **Don't** 回到"出口商情终端"的方角纸面、舱单纹理、深色命令栏或密集规则线视觉世界。
- **Don't** 使用渐变文字、霓虹雷达、装饰网格、厚重玻璃拟态、进度圆环或无内容的漂浮卡片。
- **Don't** 用虚构客户、商机、处理结果或百分比填补真实数据缺口。
- **Don't** 隐藏模型阻塞、来源错误、正文编码异常、`*_unsourced` 或无关联记录。
- **Don't** 创建不可点击的按钮造型；没有动作的入口应删除或明确禁用。
