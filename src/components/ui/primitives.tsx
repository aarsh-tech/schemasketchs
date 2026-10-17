import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ComponentProps, ReactNode } from 'react'
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
        const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const next = e.key === 'ArrowDown' ? (i + 1) % buttons.length : (i - 1 + buttons.length) % buttons.length
        buttons[next]?.focus()
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
                    onClick={() => {
                      setOpen(false)
                      item.onSelect()
                    }}
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
            </div>,
            document.body,
          )
        : null}
    </>
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
      onClose={onClose}
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
