/** `usage` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'panel.title': '提供商用量',
  'action.refresh': '刷新',
  'state.loading': '加载中…',
  'state.empty': '暂无用量数据',
  'openrouter.unconfigured': '未配置 OPENROUTER_API_KEY：可在「模型」页写入',
  'opencodego.unconfigured': '未配置 OPENCODE_GO_API_KEY：可在「模型」页写入',
  'openrouter.remaining': '余量',
  'window.5h': '5 小时',
  'window.weekly': '每周',
  'window.monthly': '每月',
  'window.resetsPrefix': '重置于',
} satisfies Record<string, string>

/** The usage namespace key union. */
export type UsageKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The provider usage panel's copy. */
    usage: UsageKey
  }
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'panel.title': 'Provider usage',
  'action.refresh': 'Refresh',
  'state.loading': 'Loading…',
  'state.empty': 'No usage data',
  'openrouter.unconfigured': 'OPENROUTER_API_KEY is not configured; store it on the Models page.',
  'opencodego.unconfigured': 'OPENCODE_GO_API_KEY is not configured; store it on the Models page.',
  'openrouter.remaining': 'remaining',
  'window.5h': '5-hour',
  'window.weekly': 'Weekly',
  'window.monthly': 'Monthly',
  'window.resetsPrefix': 'Resets',
} satisfies Record<UsageKey, string>
