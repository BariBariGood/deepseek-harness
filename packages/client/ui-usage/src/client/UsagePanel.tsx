/** Sidebar footer usage trigger and the fixed usage panel it opens above the footer. */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  IconDataOutline16, IconRefreshOutline16, IconWarningOutline16, useDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { UsageProviderId, UsageReport, UsageSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { UsageFace } from './slots.ts'
import type { UsageKey } from './locales.ts'
import css from './UsagePanel.module.css'

/** Full panel props composed by the sidebar footer-action slot. */
export type UsagePanelProps =
  PropsRuntime<'sidebar.footer.action'> & InjectFace<UsageFace> & PropsLocale<'usage'>

const PROVIDER_TITLES = {
  openrouter: 'OpenRouter',
  'opencode-go': 'OpenCode Go',
} as const satisfies Record<UsageProviderId, string>

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const resetFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
})

function formatReset(iso: string): string {
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? iso : resetFormat.format(at)
}

/** A provider's billing name; brand names are locale-independent. */
function providerTitle(provider: UsageProviderId): string {
  return PROVIDER_TITLES[provider]
}

interface BarProps {
  percent: number
  warn?: boolean
}

/** Horizontal allowance bar; the fill clamps to the track. */
function Bar({ percent, warn = false }: BarProps) {
  const clamped = Math.max(0, Math.min(100, percent))
  return (
    <span className={css.barTrack} aria-hidden>
      <span className={css.barFill} data-warn={warn || undefined} style={{ width: `${clamped}%` }} />
    </span>
  )
}

interface ReportRowProps {
  report: UsageReport
  t: (key: UsageKey) => string
}

/** Render one provider's report in its `code` shape. */
function ReportRow({ report, t }: ReportRowProps) {
  const title = <span className={css.reportTitle}>{providerTitle(report.provider)}</span>
  if (report.code === 'unconfigured') {
    return (
      <div className={css.report} data-provider={report.provider}>
        {title}
        <p className={css.note}>
          {report.provider === 'openrouter' ? t('openrouter.unconfigured') : t('opencodego.unconfigured')}
        </p>
      </div>
    )
  }
  if (report.code === 'error') {
    return (
      <div className={css.report} data-provider={report.provider}>
        {title}
        <p className={css.error} role="alert">
          <IconWarningOutline16 size={12} />
          <span>{report.message}</span>
        </p>
      </div>
    )
  }
  if (report.provider === 'openrouter') {
    const remaining = Math.max(0, report.totalCredits - report.totalUsage)
    const usedPercent = report.totalCredits > 0 ? (report.totalUsage / report.totalCredits) * 100 : 0
    return (
      <div className={css.report} data-provider="openrouter">
        {title}
        <Bar percent={usedPercent} warn={usedPercent >= 85} />
        <div className={css.line}>
          {/* OpenRouter bills in USD regardless of UI language. */}
          <span>{`${usd.format(report.totalUsage)} / ${usd.format(report.totalCredits)}`}</span>
          <span className={css.muted}>{`${usd.format(remaining)} ${t('openrouter.remaining')}`}</span>
        </div>
      </div>
    )
  }
  if (report.windows.length === 0) {
    return (
      <div className={css.report} data-provider="opencode-go">
        {title}
        <p className={css.note}>{t('state.empty')}</p>
      </div>
    )
  }
  return (
    <div className={css.report} data-provider="opencode-go">
      {title}
      {report.windows.map(window => (
        <div key={window.window} className={css.windowRow}>
          <div className={css.windowHead}>
            <span className={css.windowLabel}>{t(`window.${window.window}`)}</span>
            <span className={css.muted}>
              {window.resetAt === null ? '' : `${t('window.resetsPrefix')} ${formatReset(window.resetAt)}`}
            </span>
          </div>
          <div className={css.windowBody}>
            <Bar percent={window.usedPercent} warn={window.usedPercent >= 85} />
            <span className={css.windowPercent}>{`${Math.round(window.usedPercent)}%`}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * The panel keeps its own view state: the last snapshot stays visible while a
 * refresh is in flight, and opening the trigger always refetches so the card
 * never shows a stale number without an explicit refresh.
 */
export function UsagePanel({ wide, refresh, t }: UsagePanelProps) {
  const [open, setOpen] = useState(false)
  const [snapshot, setSnapshot] = useState<UsageSnapshot>()
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState<string>()
  const rootRef = useRef<HTMLDivElement>(null)
  const [anchor, setAnchor] = useState<{ left: number; bottom: number }>()

  const load = useCallback(async (): Promise<void> => {
    setFetching(true)
    setError(undefined)
    try {
      setSnapshot(await refresh())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setFetching(false)
    }
  }, [refresh])

  useEffect(() => {
    if (open) void load()
  }, [load, open])

  // The panel is position: fixed (the sidebar clips overflow), so it hugs the
  // trigger through a measured offset instead of document flow.
  useLayoutEffect(() => {
    if (!open) return
    const place = (): void => {
      const rect = rootRef.current?.getBoundingClientRect()
      /* v8 ignore next 1 -- getBoundingClientRect returns a rect in every real browser; the guard only covers hosts with no layout box. */
      if (rect !== undefined) setAnchor({ left: rect.left, bottom: window.innerHeight - rect.top + 8 })
    }
    place()
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('resize', place) }
  }, [open])

  useDismissOnOutsidePointer(rootRef, open, setOpen)

  return (
    <div ref={rootRef} className={css.layer}>
      <button
        type="button"
        className={css.badge}
        aria-expanded={open}
        data-active={open || undefined}
        onClick={() => { setOpen(value => !value) }}
      >
        <IconDataOutline16 />
        {wide ? <span className={css.badgeLabel}>{t('panel.title')}</span> : null}
      </button>
      {open && (
        <section
          className={css.panel}
          style={{ left: anchor?.left ?? 8, bottom: anchor?.bottom ?? 8 }}
          aria-label={t('panel.title')}
        >
          <header className={css.header}>
            <span className={css.title}>{t('panel.title')}</span>
            <button
              type="button"
              className={css.refresh}
              aria-label={t('action.refresh')}
              disabled={fetching}
              onClick={() => { void load() }}
            >
              <span className={fetching ? css.spinning : css.refreshIcon}>
                <IconRefreshOutline16 size={14} />
              </span>
            </button>
          </header>
          <div className={css.body}>
            {error !== undefined && (
              <p className={css.error} role="alert">
                <IconWarningOutline16 size={12} />
                <span>{error}</span>
              </p>
            )}
            {snapshot === undefined
              ? (error === undefined ? <p className={css.note}>{t('state.loading')}</p> : null)
              : snapshot.reports.map(report => (
                <ReportRow key={report.provider} report={report} t={t} />
              ))}
          </div>
        </section>
      )}
    </div>
  )
}
