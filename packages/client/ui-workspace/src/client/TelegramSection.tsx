/** The Telegram-origin sessions section: platform header + session rows. */

import { IconSendOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import clsx from 'clsx'
import { useState } from 'react'
import { IconTriangleRightFill14 } from '@deepseek-ai/dsh-client-ui-primitives'
import { SessionNodeItem, type RowTranslate } from './rows/Rows.tsx'
import rowsCss from './rows/Rows.module.css'
import type { SessionNode } from './tree.ts'
import css from './rows/WorkspaceBrowser.module.css'

/** Rows visible before the show-more affordance; mirrors workspace groups. */
const COLLAPSED_SESSION_LIMIT = 5

/**
 * One collapsible section listing Telegram-started sessions above the local
 * lists. The header reuses the project-row chrome with the send glyph in the
 * folder slot; rows reuse the standard session row without drag (messaging
 * sessions keep out of workspace ordering).
 */
export function TelegramSection({
  nodes, expanded, onToggle, currentId, now, onOpen, onFork, onRename, onArchive, label, t,
}: {
  nodes: readonly SessionNode[]
  /** Persisted fold state; the section renders nothing while it has no rows. */
  expanded: boolean
  onToggle(): void
  currentId: SessionNode['id'] | undefined
  now: number
  onOpen(sessionId: SessionNode['id']): void
  onFork(sessionId: SessionNode['id']): void
  onRename(sessionId: SessionNode['id'], currentTitle: string): void
  onArchive(sessionId: SessionNode['id']): void
  label: string
  t: RowTranslate
}) {
  const [showAll, setShowAll] = useState(false)
  if (nodes.length === 0) return null
  const visible = expanded || showAll ? nodes : nodes.slice(0, COLLAPSED_SESSION_LIMIT)
  return (
    <div className={css.groupSection}>
      <div
        role="treeitem"
        aria-expanded={expanded}
        className={clsx(rowsCss.projectRow)}
        onClick={onToggle}
      >
        <span className={clsx(rowsCss.slot, rowsCss.folder)}>
          <IconSendOutline16 />
        </span>
        <span className={clsx(rowsCss.slot, rowsCss.chevron)}>
          <IconTriangleRightFill14 className={clsx(rowsCss.arrow, expanded && rowsCss.arrowOpen)} />
        </span>
        <span className={rowsCss.projectText}>
          <span className={rowsCss.title}>{label}</span>
        </span>
        <span className={rowsCss.rowActions} />
      </div>
      {expanded && (
        <>
          {visible.map(node => (
            <SessionNodeItem
              key={node.id}
              node={node}
              currentId={currentId}
              now={now}
              onOpen={onOpen}
              onFork={onFork}
              onRename={onRename}
              onArchive={onArchive}
              t={t}
            />
          ))}
          {nodes.length > COLLAPSED_SESSION_LIMIT && (
            <button
              type="button"
              className={css.sessionOverflowButton}
              aria-expanded={showAll}
              onClick={() => {
                setShowAll(value => !value)
              }}
            >
              {showAll ? t('sessions.collapse') : t('sessions.expand', { n: nodes.length - COLLAPSED_SESSION_LIMIT })}
            </button>
          )}
        </>
      )}
    </div>
  )
}
