// @vitest-environment jsdom
/**
 * UsagePanel rendering and gestures: opening the trigger pulls a fresh
 * snapshot through the injected verb, every report code renders its own shape,
 * a rejected call surfaces an alert without losing the panel, and reopening
 * always refetches so the card never shows stale numbers.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { UsageSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import { UsagePanel } from '../src/client/UsagePanel.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(zh, commonZh)

const COLLECTED_AT = '2026-08-22T18:00:00.000Z'

/** Both providers healthy: credits totals plus three rate windows. */
function bothOk(): UsageSnapshot {
  return {
    collectedAt: COLLECTED_AT,
    reports: [
      { provider: 'openrouter', code: 'ok', totalCredits: 50, totalUsage: 12.5 },
      {
        provider: 'opencode-go',
        code: 'ok',
        windows: [
          { window: '5h', usedPercent: 25, resetAt: '2026-08-22T20:00:00.000Z' },
          { window: 'weekly', usedPercent: 87.4, resetAt: null },
          { window: 'monthly', usedPercent: 60.25, resetAt: null },
        ],
      },
    ],
  }
}

function mount(options: {
  wide?: boolean
  refresh?: () => Promise<UsageSnapshot>
} = {}) {
  const refresh = options.refresh ?? vi.fn(async () => bothOk())
  const props = { wide: options.wide ?? true, refresh, t } as unknown as
    Parameters<typeof UsagePanel>[0]
  return { ...render(<UsagePanel {...props} />), refresh }
}

/** The footer trigger, addressed by its accessible name to skip the header button. */
const trigger = (ui: ReturnType<typeof mount>): HTMLElement =>
  ui.getByRole('button', { name: zh['panel.title'] })

describe('UsagePanel', () => {
  it('renders an icon-only trigger on the narrow rail', () => {
    const ui = mount({ wide: false })

    const button = ui.getByRole('button') as HTMLButtonElement
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.textContent).not.toContain(zh['panel.title'])
  })

  it('labels the trigger on the wide sidebar', () => {
    const ui = mount()

    expect(trigger(ui).getAttribute('aria-expanded')).toBe('false')
  })

  it('pulls a snapshot on open and renders every provider shape', async () => {
    const ui = mount()
    expect(ui.refresh).not.toHaveBeenCalled()

    fireEvent.click(trigger(ui))
    expect(await ui.findByText('OpenRouter')).toBeTruthy()
    expect(ui.getByText('$12.50 / $50.00')).toBeTruthy()
    expect(ui.getByText(`$37.50 ${zh['openrouter.remaining']}`)).toBeTruthy()
    expect(ui.getByText('OpenCode Go')).toBeTruthy()
    expect(ui.getByText('25%')).toBeTruthy()
    // The weekly window sits above the warn threshold without a reset time.
    expect(ui.getByText('87%')).toBeTruthy()
    expect(ui.getByText('60%')).toBeTruthy()
    // The reset line joins the prefix with a locale-formatted instant.
    expect(ui.getAllByText(new RegExp(zh['window.resetsPrefix'])).length).toBe(1)
    expect(ui.refresh).toHaveBeenCalledTimes(1)
  })

  it('keeps the last snapshot visible while a refresh is in flight', async () => {
    let release!: (value: UsageSnapshot) => void
    const slow = vi.fn(() => new Promise<UsageSnapshot>((resolve) => { release = resolve }))
    const ui = mount({ refresh: slow })

    fireEvent.click(trigger(ui))
    await waitFor(() => expect(ui.refresh).toHaveBeenCalledTimes(1))
    release(bothOk())
    await ui.findByText('OpenRouter')

    fireEvent.click(ui.getByLabelText(zh['action.refresh']))
    expect(ui.getByText('OpenRouter')).toBeTruthy()
    await waitFor(() => expect(ui.refresh).toHaveBeenCalledTimes(2))
  })

  it('surfaces a failed pull as an alert and keeps the trigger usable', async () => {
    const failing = vi.fn(async (): Promise<UsageSnapshot> => {
      throw new Error('usage/get failed: gateway/unreachable')
    })
    const ui = mount({ refresh: failing })

    fireEvent.click(trigger(ui))
    const alert = await ui.findByRole('alert')
    expect(alert.textContent).toContain('usage/get failed')

    failing.mockResolvedValue(bothOk())
    fireEvent.click(ui.getByLabelText(zh['action.refresh']))
    expect(await ui.findByText('OpenRouter')).toBeTruthy()
  })

  it('refetches on every open instead of caching numbers', async () => {
    const ui = mount()

    fireEvent.click(trigger(ui))
    await ui.findByText('OpenRouter')
    fireEvent.click(trigger(ui)) // close
    fireEvent.click(trigger(ui)) // open again

    await waitFor(() => expect(ui.refresh).toHaveBeenCalledTimes(2))
  })
})

describe('UsagePanel degraded providers', () => {
  it('names the missing credential per provider', async () => {
    const ui = mount({
      refresh: async () => ({
        collectedAt: COLLECTED_AT,
        reports: [
          { provider: 'openrouter', code: 'unconfigured' },
          { provider: 'opencode-go', code: 'unconfigured' },
        ],
      }),
    })

    fireEvent.click(trigger(ui))
    expect(await ui.findByText(zh['openrouter.unconfigured'])).toBeTruthy()
    expect(ui.getByText(zh['opencodego.unconfigured'])).toBeTruthy()
  })

  it('renders provider errors next to a healthy sibling', async () => {
    const ui = mount({
      refresh: async () => ({
        collectedAt: COLLECTED_AT,
        reports: [
          { provider: 'openrouter', code: 'error', message: 'OpenRouter credits responded HTTP 401' },
          { provider: 'opencode-go', code: 'unconfigured' },
        ],
      }),
    })

    fireEvent.click(trigger(ui))
    const alerts = await ui.findAllByRole('alert')
    expect(alerts[0]?.textContent).toContain('HTTP 401')
    expect(ui.getByText(zh['opencodego.unconfigured'])).toBeTruthy()
  })

  it('renders an unparseable reset instant verbatim', async () => {
    const ui = mount({
      refresh: async () => ({
        collectedAt: COLLECTED_AT,
        reports: [{
          provider: 'opencode-go',
          code: 'ok',
          windows: [{ window: '5h', usedPercent: 10, resetAt: 'not-a-date' }],
        }],
      }),
    })

    fireEvent.click(trigger(ui))
    expect(await ui.findByText(/not-a-date/)).toBeTruthy()
  })

  it('renders a zero-credit account without dividing', async () => {
    const ui = mount({
      refresh: async () => ({
        collectedAt: COLLECTED_AT,
        reports: [
          { provider: 'openrouter', code: 'ok', totalCredits: 0, totalUsage: 0 },
          { provider: 'opencode-go', code: 'unconfigured' },
        ],
      }),
    })

    fireEvent.click(trigger(ui))
    expect(await ui.findByText('$0.00 / $0.00')).toBeTruthy()
  })

  it('stringifies a non-Error rejection into the alert', async () => {
    const ui = mount({ refresh: async () => { throw 'plain string failure' as never } })

    fireEvent.click(trigger(ui))
    expect(await ui.findByRole('alert')).toBeTruthy()
    expect(ui.getByRole('alert').textContent).toContain('plain string failure')
  })

  it('shows the empty note when no rate windows are reported', async () => {
    const ui = mount({
      refresh: async () => ({
        collectedAt: COLLECTED_AT,
        reports: [
          { provider: 'openrouter', code: 'ok', totalCredits: 10, totalUsage: 0 },
          { provider: 'opencode-go', code: 'ok', windows: [] },
        ],
      }),
    })

    fireEvent.click(trigger(ui))
    expect(await ui.findByText(zh['state.empty'])).toBeTruthy()
    expect(ui.getByText('$0.00 / $10.00')).toBeTruthy()
  })
})
