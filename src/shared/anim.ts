// Small, cheap animations for the terminal UI.
//
// A terminal cannot move anything by less than a cell, so motion here is
// colour: hover fades, a glow on new steps, a shimmer over "Thinking…", the
// mode colour blending into the next one. Everything runs on ONE shared
// ticker that only exists while something is actually animating, so an idle
// UI renders nothing at all.

import { useEffect, useRef, useState } from 'react'

/** ~30 frames a second: smooth in a terminal, cheap for Ink. */
export const FRAME_MS = 33

let enabled = true

/** Animations on or off (settings: interface → animations). */
export function setAnimations(on: boolean): void {
  enabled = on
}

export function animationsOn(): boolean {
  return enabled
}

// ── Shared ticker ────────────────────────────────────────────────────────────

const subscribers = new Set<(now: number) => void>()
let timer: ReturnType<typeof setInterval> | null = null

function subscribe(fn: (now: number) => void): () => void {
  subscribers.add(fn)
  if (!timer) {
    timer = setInterval(() => {
      const now = Date.now()
      for (const s of [...subscribers]) s(now)
    }, FRAME_MS)
  }
  return () => {
    subscribers.delete(fn)
    if (subscribers.size === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

// ── Easing and colour ────────────────────────────────────────────────────────

export const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3)
export const easeInOut = (t: number) => {
  const x = Math.min(1, Math.max(0, t))
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** The colour `t` of the way from `a` to `b` (both "#rrggbb"). */
export function mix(a: string, b: string, t: number): string {
  if (t <= 0) return a
  if (t >= 1) return b
  const [r1, g1, b1] = rgb(a)
  const [r2, g2, b2] = rgb(b)
  const c = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0')
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`
}

// ── Hooks ────────────────────────────────────────────────────────────────────

/**
 * A number that glides to `target` over `ms` instead of jumping. Without
 * animations it jumps.
 */
export function useTween(target: number, ms = 160): number {
  const shown = useRef(target)
  const seg = useRef({ from: target, to: target })
  if (seg.current.to !== target) seg.current = { from: shown.current, to: target }
  const p = useProgress(target, ms)
  shown.current = seg.current.from + (seg.current.to - seg.current.from) * p
  return shown.current
}

/** A colour that blends into the next one when it changes. */
export function useColorTween(color: string, ms = 240): string {
  const shown = useRef(color)
  const pair = useRef({ from: color, to: color })
  if (pair.current.to !== color) pair.current = { from: shown.current, to: color }
  const p = useProgress(color, ms)
  shown.current = mix(pair.current.from, pair.current.to, p)
  return shown.current
}

/** 0 → 1 over `ms`, restarting whenever `key` changes (1 = settled). */
export function useProgress(key: string | number | boolean, ms: number): number {
  const [state, setState] = useState({ key, start: 0 })
  const [, tick] = useState(0)
  let s = state
  if (state.key !== key) {
    s = { key, start: enabled ? Date.now() : 0 }
    setState(s)
  }
  useEffect(() => {
    if (!s.start) return
    const stop = subscribe((now) => {
      tick((n) => n + 1)
      if (now - s.start >= ms) stop()
    })
    return stop
  }, [s.key, s.start])
  if (!s.start) return 1
  const t = (Date.now() - s.start) / ms
  return t >= 1 ? 1 : easeInOut(t)
}

/**
 * 1 → 0 over `ms` after mount, for something that has only just appeared
 * (`fresh`). Things that were already there start at 0, so scrolling an old
 * entry back into view does not make it glow again.
 */
export function useGlow(fresh: boolean, ms = 900): number {
  const [g, setG] = useState(fresh && enabled ? 1 : 0)
  useEffect(() => {
    if (!fresh || !enabled) return
    const start = Date.now()
    const stop = subscribe((now) => {
      const t = (now - start) / ms
      setG(t >= 1 ? 0 : 1 - easeInOut(t))
      if (t >= 1) stop()
    })
    return stop
  }, [])
  return g
}

/** The time, ticking every frame while `active` (for shimmers). */
export function useFrameTime(active: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active || !enabled) return
    return subscribe(setNow)
  }, [active])
  return now
}

/**
 * Colours for a light sweeping across `length` characters, one per
 * character: `base` everywhere, `peak` under the light.
 */
export function shimmer(length: number, now: number, base: string, peak: string, periodMs = 1600): string[] {
  if (!enabled) return Array.from({ length }, () => base)
  // The light travels a little past both ends so it enters and leaves softly.
  const span = length + 8
  const pos = ((now % periodMs) / periodMs) * span - 4
  return Array.from({ length }, (_, i) => {
    const d = Math.abs(i - pos)
    return mix(base, peak, Math.max(0, 1 - d / 3.5))
  })
}
