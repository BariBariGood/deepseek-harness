# @deepseek-ai/dsh-client-ui-usage

[English](README.md) | 中文

基于 [`usage`](../../host/usage/README.zh.md) Remote 的侧栏用量界面。本插件向 `sidebar.footer.action` 列表贡献一个条目：一个图标触发器，打开锚定在页脚上方的浮动提供商用量卡片（侧栏会裁剪溢出，因此卡片依据触发器的实测偏移定位）。每次打开都会重新拉取，头部按钮可按需刷新。

组件是纯展示层：注入面只暴露一个解包 Remote 信封的 `refresh` 动词，全部视图状态（开合、最近快照、请求进行中标记、错误）都保留在组件本地。每份报告按其 `code` 渲染：OpenRouter 额度总量渲染为美元进度条与余量，OpenCode Go 窗口渲染为百分比条与重置时刻，`unconfigured` 渲染为指明缺失凭据引用的提示，错误则作为内联告警显示在健康提供商旁边。文案位于 zh 优先的 `usage` 本地化命名空间。

## Model Experience

无：此侧栏卡片渲染的提供商账单状态从不进入 Session 日志、模型上下文或遥测。

#### KV Cache 效应

无；本包从不组装模型输入。

## 已知限制与延后工作

- **仅拉取** —— 数字在打开或显式操作时刷新；没有后台轮询或推送更新。
- **美元格式固定** —— OpenRouter 以美元计费，因此无论界面语言如何，金额都通过 en-US 货币格式化器渲染。
