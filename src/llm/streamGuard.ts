// Two ways a streamed completion must be able to end early:
//
//  • The user stops the task (ctrl+c). The HTTP request has to be cancelled
//    too — otherwise the server keeps generating the abandoned answer, and
//    LM Studio (one slot per loaded model) makes the next request wait until
//    it is done. That looked like "nothing happens" after aborting.
//  • The server goes quiet: no data for minutes, stream never closed. Without
//    a limit the UI waited forever.

/** No data for this long (also before the first token) ends the request. */
export const STREAM_IDLE_MS = 120_000

export class StreamStalledError extends Error {
  constructor(seconds: number) {
    super(
      `No data from the model server for ${seconds} s. It may be stuck, overloaded, or busy with another request — check the model server, then try again.`,
    )
    this.name = 'StreamStalledError'
  }
}

export interface StreamGuard {
  /** Pass to fetch(). */
  signal: AbortSignal
  /** Call whenever data arrives. */
  alive(): void
  /** The guard ended the request because the stream went quiet. */
  readonly stalled: boolean
  /** Always call when the request is over. */
  dispose(): void
}

export function streamGuard(external?: AbortSignal, idleMs = STREAM_IDLE_MS): StreamGuard {
  const ctl = new AbortController()
  let stalled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const alive = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      stalled = true
      ctl.abort()
    }, idleMs)
  }
  const onAbort = () => ctl.abort()
  if (external?.aborted) ctl.abort()
  else external?.addEventListener('abort', onAbort)
  alive()
  return {
    signal: ctl.signal,
    alive,
    get stalled() {
      return stalled
    },
    dispose() {
      if (timer) clearTimeout(timer)
      external?.removeEventListener('abort', onAbort)
    },
  }
}
