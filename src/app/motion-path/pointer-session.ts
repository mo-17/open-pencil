import type { MotionPathHandle } from './types'

export interface MotionPathPointerCaptureTarget {
  setPointerCapture(pointerId: number): void
  hasPointerCapture(pointerId: number): boolean
  releasePointerCapture(pointerId: number): void
}

export interface MotionPathPointerSessionCallbacks {
  begin(handle: MotionPathHandle): void
  update(handle: MotionPathHandle, clientX: number, clientY: number): void
  commit(): void
  rollback(): void
}

interface ActiveMotionPathPointer {
  pointerId: number
  target: MotionPathPointerCaptureTarget
  handle: MotionPathHandle
}

function releasePointer(active: ActiveMotionPathPointer): void {
  if (active.target.hasPointerCapture(active.pointerId)) {
    active.target.releasePointerCapture(active.pointerId)
  }
}

/** Owns one pointer capture and one undo transaction at a time. */
export class MotionPathPointerSession {
  #active: ActiveMotionPathPointer | null = null

  constructor(private readonly callbacks: MotionPathPointerSessionCallbacks) {}

  get active(): boolean {
    return this.#active !== null
  }

  start(target: MotionPathPointerCaptureTarget, pointerId: number, handle: MotionPathHandle): void {
    this.cancel()
    this.callbacks.begin(handle)
    try {
      target.setPointerCapture(pointerId)
      this.#active = { target, pointerId, handle }
    } catch (error) {
      this.callbacks.rollback()
      throw error
    }
  }

  update(pointerId: number, clientX: number, clientY: number): boolean {
    const active = this.#active
    if (!active || active.pointerId !== pointerId) return false
    this.callbacks.update(active.handle, clientX, clientY)
    return true
  }

  finish(pointerId: number): boolean {
    const active = this.#active
    if (!active || active.pointerId !== pointerId) return false
    this.#active = null
    try {
      this.callbacks.commit()
    } catch (error) {
      this.callbacks.rollback()
      throw error
    } finally {
      releasePointer(active)
    }
    return true
  }

  cancel(pointerId?: number): boolean {
    const active = this.#active
    if (!active || (pointerId !== undefined && active.pointerId !== pointerId)) return false
    this.#active = null
    try {
      this.callbacks.rollback()
    } finally {
      releasePointer(active)
    }
    return true
  }

  lostPointerCapture(pointerId: number): boolean {
    return this.cancel(pointerId)
  }

  dispose(): void {
    this.cancel()
  }
}
