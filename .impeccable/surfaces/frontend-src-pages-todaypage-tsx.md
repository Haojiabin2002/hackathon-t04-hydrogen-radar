---
version: 1
slug: "frontend-src-pages-todaypage-tsx"
primary_target: "frontend/src/pages/TodayPage.tsx"
related_targets:
  - "frontend/src/app/AppShell.tsx"
  - "frontend/src/styles.css"
---

# 今日工作台

- Mode: Operate。
- Scope: `/` 路由、`TodayPage.tsx`，以及它在 `AppShell.tsx` 和全局样式中的导航与响应式外壳。
- Audience: 氢能企业海外销售、销售运营与行业情报人员。
- Job: 先确认真实采集与研判链路是否健康，再从最新公开信号中选择对象，核对判断、字段溯源与原始证据，最后进入商机或恢复动作。
- Success: 首屏数秒内看清链路是否通、当前信号是什么、判断依据能否回源，以及下一步可执行动作；三个栏位不需要靠猜测建立关系。
- Direction: “冷色链路画布”。冷白 `#fcfcfc`、淡紫 `#f0f4fe`、午夜墨 `#020520` 和皇家蓝 `#145aff`；浮动浅色导航、22px 圆角链路带与 24px 圆角三栏工作台构成主画面，白色产品容器、胶囊控件、柔和阴影和小型语义状态点建立层级。
- Information flow: 浮动导航中的链路健康与“启动雷达”主操作 → 五段完整追溯链 → 左侧信号舱单 → 中部研判、字段溯源与优先队列 → 右侧原始证据、管线状态和恢复动作。
- Memorable interaction: 选择一条真实信号时，中部研判单和右侧证据卡同步执行一次 360ms `signal-sync`；移动端随后滚动并聚焦研判区，reduced-motion 下即时完成。
- Data states: 加载、接口错误、无信号、无关联商机、模型通道阻塞、部分来源失败、正文编码异常、缺失原文链接和 `*_unsourced` 都必须如实呈现；没有真实阶段百分比时不显示合成进度。
- Responsive: `>1280px` 保持不对称三栏；`861–1280px` 为信号与研判两栏、证据下置；`≤860px` 为单列工作流和抽屉导航，追溯链局部横向滚动并显示滑动提示。
- Typography: 工作体为 IBM Plex Sans Variable，中文回退 PingFang SC / Microsoft YaHei；页面主标题与选中信号标题使用本地 Source Han Sans CN / 思源黑体 CN，随后回退 IBM Plex Sans Variable / PingFang SC / sans-serif。
- Constraints: 只展示真实 API 数据；不伪造客户、商机、进度或结果；保留原文链接；不修改后端、数据契约和业务逻辑；状态色必须配合文字或图标。
- Avoid: 旧“出口商情终端”的方角纸面与舱单隐喻、深色命令栏、密集规则线、SaaS KPI 卡片墙、大 Hero、英文眉题、霓虹雷达、装饰网格、厚重玻璃拟态和无意义动效。
