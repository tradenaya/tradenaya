"use client"

import { useCallback, useEffect, useRef, useState } from "react"

interface Options {
  pollMs?: number
}

export function useAsyncData<T>(fetcher: () => Promise<T>, deps: unknown[], options: Options = {}) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const fetcherRef = useRef(fetcher)

  useEffect(() => {
    fetcherRef.current = fetcher
  })

  const refresh = useCallback(() => setTick((t) => t + 1), [])

  const loading = data === null && error === null

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      try {
        const result = await fetcherRef.current()
        if (!cancelled) {
          setData(result)
          setError(null)
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load data")
        }
      }
    }

    run()

    if (options.pollMs && options.pollMs > 0) {
      const interval = setInterval(run, options.pollMs)
      return () => {
        cancelled = true
        clearInterval(interval)
      }
    }

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps])

  return { data, error, loading, refresh }
}
