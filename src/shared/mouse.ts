// Hover and click for Ink elements.
//
// Ink has no idea where the mouse is, but every element it lays out has a
// Yoga node with its computed position. A component registers a "hitbox" (a
// ref to its Box plus what to do on hover / click); the pointer events that
// shared/screen.ts reads from the terminal are matched against those boxes.
// The app is fullscreen and painted from the top-left corner, so layout
// coordinates are screen cells.

import { createContext, useContext, useEffect, useRef, useState, RefObject } from 'react'
import type { DOMElement } from 'ink'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface Hitbox {
  ref: RefObject<DOMElement>
  clip: RefObject<DOMElement> | null
  handlers: { current: HitHandlers }
}

export interface HitHandlers {
  onClick?: () => void
  /**
   * The mouse entered or left. `moved` is false when the layout moved under
   * a resting mouse; lists only follow the mouse when it really moved.
   */
  onHover?: (inside: boolean, moved: boolean) => void
  disabled?: boolean
}

const boxes = new Set<Hitbox>()
let hovered: Hitbox | null = null
let pointer: { x: number; y: number } | null = null

/**
 * Elements that scroll inside a clipped viewport (the transcript) pass the
 * viewport here, so a row scrolled out of sight cannot be hovered.
 */
export const HitClip = createContext<RefObject<DOMElement> | null>(null)

type YogaLike = {
  getComputedLeft(): number
  getComputedTop(): number
  getComputedWidth(): number
  getComputedHeight(): number
}

/** Where an element is on screen, in cells. */
export function rectOf(el: DOMElement | null): Rect | null {
  if (!el) return null
  const own = (el as unknown as { yogaNode?: YogaLike }).yogaNode
  if (!own) return null
  let x = 0
  let y = 0
  let n: unknown = el
  while (n) {
    const yn = (n as { yogaNode?: YogaLike }).yogaNode
    if (yn) {
      x += yn.getComputedLeft()
      y += yn.getComputedTop()
    }
    n = (n as { parentNode?: unknown }).parentNode
  }
  return { x, y, w: own.getComputedWidth(), h: own.getComputedHeight() }
}

const inside = (r: Rect | null, x: number, y: number) =>
  !!r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h

/** The innermost enabled hitbox under (x, y). */
function hit(x: number, y: number): Hitbox | null {
  let best: Hitbox | null = null
  let bestArea = Infinity
  for (const b of boxes) {
    if (b.handlers.current.disabled) continue
    const r = rectOf(b.ref.current)
    if (!r || !inside(r, x, y)) continue
    if (b.clip && !inside(rectOf(b.clip.current), x, y)) continue
    const area = r.w * r.h
    if (area <= bestArea) {
      best = b
      bestArea = area
    }
  }
  return best
}

function setHovered(next: Hitbox | null, moved: boolean): void {
  if (next === hovered) return
  const prev = hovered
  hovered = next
  prev?.handlers.current.onHover?.(false, moved)
  next?.handlers.current.onHover?.(true, moved)
}

/** The mouse moved to (x, y). */
export function pointerMove(x: number, y: number): void {
  pointer = { x, y }
  setHovered(hit(x, y), true)
}

/** A click at (x, y). Returns whether something took it. */
export function pointerClick(x: number, y: number): boolean {
  pointer = { x, y }
  const target = hit(x, y)
  setHovered(target, true)
  const onClick = target?.handlers.current.onClick
  if (!onClick) return false
  onClick()
  return true
}

/**
 * The layout changed under a mouse that did not move (scrolling, new
 * output): hover whatever is under it now.
 */
export function refreshHover(): void {
  if (pointer) setHovered(hit(pointer.x, pointer.y), false)
}

/** The mouse left the window or was turned off. */
export function pointerLeave(): void {
  pointer = null
  setHovered(null, true)
}

/**
 * Make the returned ref's element hoverable / clickable. Returns the ref and
 * whether the mouse is over it.
 */
export function useHitbox(handlers: HitHandlers = {}): [RefObject<DOMElement>, boolean] {
  const ref = useRef<DOMElement>(null)
  const clip = useContext(HitClip)
  const [hover, setHover] = useState(false)
  const latest = useRef<HitHandlers>(handlers)
  latest.current = {
    ...handlers,
    onHover: (on, moved) => {
      setHover(on)
      handlers.onHover?.(on, moved)
    },
  }
  useEffect(() => {
    const box: Hitbox = { ref, clip, handlers: latest }
    boxes.add(box)
    return () => {
      boxes.delete(box)
      if (hovered === box) hovered = null
    }
  }, [])
  return [ref, hover && !handlers.disabled]
}

/** For tests. */
export function hitboxCount(): number {
  return boxes.size
}

// ── Panes ─────────────────────────────────────────────────────────────────────
// A drag selects inside the column it started in, so selecting an answer
// does not pull in the sidebar next to it. The app says where the columns are.

let panes: Array<[number, number]> = []

export function setPanes(next: Array<[number, number]>): void {
  panes = next
}

export function getPanes(): Array<[number, number]> {
  return panes
}
