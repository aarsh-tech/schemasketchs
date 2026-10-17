import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ComponentProps, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

import { cx } from '@/lib/cx'

/* ---------- buttons ---------- */

type ButtonProps = ComponentProps<'button'> & {
  variant?: 'ghost' | 'outline' | 'primary' | 'danger'
  size?: 'sm' | 'md'
}

export function Button({ variant = 'ghost', size = 'md', className, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:opacity-45',
        size === 'sm' ? 'h-7 px-2 text-[12.5px]' : 'h-8 px-3 text-[13px]',
        variant === 'ghost' && 'text-ink-2 hover:bg-hover hover:text-ink',
        variant === 'outline' && 'border border-line-strong bg-raised text-ink hover:bg-hover',
        variant === 'primary' && 'bg-accent text-accent-ink hover:brightness-110',
        variant === 'danger' && 'bg-danger text-white hover:brightness-110',
        className,
      )}
      {...rest}
    />
  )
}

type IconButtonProps = ComponentProps<'button'> & { label: string; active?: boolean }

export function IconButton({ label, active, className, children, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-hover hover:text-ink disabled:opacity-40',
        active && 'bg-hover text-ink',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line-strong bg-panel px-1.5 py-px font-mono text-[11px] text-ink-2">{children}</kbd>
  )
}

/* ---------- dropdown menu ---------- */

/** Move focus to the next/previous enabled button inside `container`, wrapping around. */
function moveFocus(container: HTMLElement | null, dir: 1 | -1) {
  const buttons = [...(container?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
  if (!buttons.length) return
  const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
  buttons[(i + dir + buttons.length) % buttons.length]?.focus()
}

export interface MenuItem {
  label: string
  icon?: ReactNode
  hint?: string
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
}
export type MenuEntry = MenuItem | { heading: string } | 'separator'

export function Menu({
  trigger,
  items,
  align = 'start',
  width = 232,
}: {
  trigger: (props: { open: boolean; toggle: () => void; ref: (el: HTMLElement | null) => void; id: string }) => ReactNode
  items: MenuEntry[]
  align?: 'start' | 'end'
  width?: number
}) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const id = useId()

  const close = useCallback(() => {
    setOpen(false)
    anchor?.focus()
  }, [anchor])

  // measuring the trigger is a DOM read, which is what layout effects are for
  useLayoutEffect(() => {
    if (!open || !anchor) return
    const r = anchor.getBoundingClientRect()
    const left = align === 'end' ? r.right - width : r.left
    // oxlint-disable-next-line react/set-state-in-effect
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(left, window.innerWidth - width - 8)) })
  }, [open, anchor, align, width])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !anchor?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        moveFocus(menuRef.current, e.key === 'ArrowDown' ? 1 : -1)
      }
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus())
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, anchor, close])

  return (
    <>
      {trigger({ open, toggle: () => setOpen((o) => !o), ref: setAnchor, id })}
      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-labelledby={id}
              className="fixed z-[60] max-h-[70vh] overflow-y-auto rounded-lg border border-line bg-raised p-1 shadow-pop scrollbar-thin"
              style={{ top: pos.top, left: pos.left, width }}
            >
              <MenuItems
                items={items}
                onPick={(item) => {
                  setOpen(false)
                  item.onSelect()
                }}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

function MenuItems({ items, onPick }: { items: MenuEntry[]; onPick: (item: MenuItem) => void }) {
  return (
    <>
      {items.map((item, i) => {
        if (item === 'separator') return <div key={i} className="my-1 h-px bg-line" />
        if ('heading' in item)
          return (
            <div key={i} className="px-2.5 pt-2 pb-1 text-[11.5px] font-medium text-ink-3">
              {item.heading}
            </div>
          )
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => onPick(item)}
            className={cx(
              'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] outline-none hover:bg-hover focus-visible:bg-hover disabled:opacity-40',
              item.danger ? 'text-danger' : 'text-ink',
            )}
          >
            {item.icon ? <span className="flex w-4 justify-center text-ink-2">{item.icon}</span> : null}
            <span className="flex-1 truncate">{item.label}</span>
            {item.hint ? <span className="font-mono text-[11px] text-ink-3">{item.hint}</span> : null}
          </button>
        )
      })}
    </>
  )
}

/* ---------- popover at a point ---------- */

/**
 * A floating panel anchored at viewport coordinates, kept on screen. Closes on
 * Escape or a pointer press outside it, focuses its first control when it
 * opens and hands focus back when it closes.
 */
export function Popover({
  x,
  y,
  onClose,
  label,
  width = 288,
  role = 'dialog',
  above = false,
  anchor,
  className,
  onKeyDown,
  children,
}: {
  x: number
  /** with `above`, the bottom edge sits at y */
  y: number
  above?: boolean
  /** presses on this element (the button that opened it) don't count as outside */
  anchor?: HTMLElement | null
  onClose: () => void
  label: string
  width?: number
  role?: 'dialog' | 'menu'
  className?: string
  onKeyDown?: (e: ReactKeyboardEvent<HTMLDivElement>) => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  const anchorRef = useRef(anchor)
  useEffect(() => {
    closeRef.current = onClose
    anchorRef.current = anchor
  })

  // keep the panel inside the window; this is a DOM write, not React state
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    el.style.left = `${Math.max(8, Math.min(x, window.innerWidth - w - 8))}px`
    const top = above ? y - h : y
    el.style.top = `${top + h > window.innerHeight - 8 ? Math.max(8, window.innerHeight - h - 8) : Math.max(8, top)}px`
    el.style.visibility = 'visible'
  }, [x, y, above])

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchorRef.current?.contains(e.target as Node)) closeRef.current()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeRef.current()
      }
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    const raf = requestAnimationFrame(() => {
      const first = ref.current?.querySelector<HTMLElement>('[data-autofocus], input, select, textarea, button:not(:disabled)')
      first?.focus()
      if (first instanceof HTMLInputElement) first.select()
    })
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
      // only take focus back if it was left nowhere in particular
      if ((document.activeElement === document.body || !document.activeElement) && before?.isConnected) before.focus({ preventScroll: true })
    }
  }, [])

  return createPortal(
    <div
      ref={ref}
      role={role}
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cx('fixed z-[60] max-h-[80vh] overflow-y-auto rounded-lg border border-line bg-raised text-ink shadow-pop scrollbar-thin', className)}
      style={{ left: x, top: y, width: `min(${width}px, calc(100vw - 16px))`, visibility: 'hidden' }}
    >
      {children}
    </div>,
    document.body,
  )
}

/** A menu that opens at a point, e.g. on right-click. */
export function ContextMenu({
  x,
  y,
  items,
  label,
  onClose,
  width = 232,
  children,
}: {
  x: number
  y: number
  items: MenuEntry[]
  label: string
  onClose: () => void
  width?: number
  /** extra content under the items, such as a colour row */
  children?: ReactNode
}) {
  return (
    <Popover
      x={x}
      y={y}
      label={label}
      role="menu"
      width={width}
      onClose={onClose}
      className="p-1"
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          moveFocus(e.currentTarget, e.key === 'ArrowDown' ? 1 : -1)
        }
      }}
    >
      <MenuItems
        items={items}
        onPick={(item) => {
          onClose()
          item.onSelect()
        }}
      />
      {children}
    </Popover>
  )
}

/* ---------- dialog ---------- */

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 560,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  width?: number
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // closing it ourselves (open went false) also fires "close"; only report closes we didn't ask for,
      // or switching straight to another dialog would close that one too
      onClose={() => {
        if (open) onClose()
      }}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
      className="m-auto max-h-[88vh] w-[calc(100vw-24px)] overflow-hidden rounded-xl border border-line bg-raised p-0 text-ink shadow-pop"
      style={{ maxWidth: width }}
    >
      {open ? (
        <div className="flex max-h-[88vh] flex-col">
          <div className="flex items-start gap-3 px-5 pt-4 pb-3">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-[16px] font-semibold tracking-[-0.01em]">
                {title}
              </h2>
              {description ? <div className="mt-0.5 text-[13px] text-ink-2">{description}</div> : null}
            </div>
            <IconButton label="Close" onClick={onClose} className="-mt-1 -mr-2">
              <X size={16} />
            </IconButton>
          </div>
          {children ? <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 scrollbar-thin">{children}</div> : null}
          {footer ? <div className="flex items-center justify-end gap-2 border-t border-line bg-panel px-5 py-3">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  )
}

/* ---------- segmented control ---------- */

/** A row of tabs. Arrow keys move between them; `'separator'` draws a divider between groups. */
export function Tabs<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: ({ value: T; label: ReactNode } | 'separator')[]
  onChange: (v: T) => void
  label: string
}) {
  const tabs = options.filter((o): o is { value: T; label: ReactNode } => o !== 'separator')
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.value === value)
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : step ? (i + step + tabs.length) % tabs.length : -1
    if (next < 0) return
    e.preventDefault()
    onChange(tabs[next].value)
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${tabs[next].value}"]`)?.focus()
  }
  return (
    <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((o, i) =>
        o === 'separator' ? (
          <span key={`sep${i}`} aria-hidden className="mx-1 h-4 w-px bg-line max-sm:hidden" />
        ) : (
          <button
            key={o.value}
            role="tab"
            type="button"
            data-tab={o.value}
            aria-selected={value === o.value}
            tabIndex={value === o.value ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cx(
              'h-7 rounded-md px-2.5 text-[12.5px] font-medium',
              value === o.value ? 'bg-accent text-accent-ink' : 'text-ink-2 hover:bg-hover hover:text-ink',
            )}
          >
            {o.label}
          </button>
        ),
      )}
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: ReactNode; title?: string }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md bg-hover p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            'h-7 rounded-[5px] px-2.5 text-[12.5px] font-medium transition-colors',
            value === o.value ? 'bg-raised text-ink shadow-[0_1px_2px_rgb(0_0_0/0.12)]' : 'text-ink-2 hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
