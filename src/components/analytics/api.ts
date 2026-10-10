"use client"

import { fetchData } from "@/lib/api-client"

export interface AnalyticsFilterState {
  botId: number | null
  symbol: string | null
  side: "BUY" | "SELL" | null
  startTime: number | null
  endTime: number | null
  granularity: "daily" | "weekly" | "monthly"
}

export const DEFAULT_FILTERS: AnalyticsFilterState = {
  botId: null,
  symbol: null,
  side: null,
  startTime: null,
  endTime: null,
  granularity: "daily",
}

export function filtersEqual(a: AnalyticsFilterState, b: AnalyticsFilterState): boolean {
  return (
    a.botId === b.botId &&
    a.symbol === b.symbol &&
    a.side === b.side &&
    a.startTime === b.startTime &&
    a.endTime === b.endTime &&
    a.granularity === b.granularity
  )
}

export function toQuery(filters: AnalyticsFilterState): Record<string, string> {
  const query: Record<string, string> = {}
  if (filters.botId != null) query.botId = String(filters.botId)
  if (filters.symbol) query.symbol = filters.symbol
  if (filters.side) query.side = filters.side
  if (filters.startTime != null) query.startTime = String(filters.startTime)
  if (filters.endTime != null) query.endTime = String(filters.endTime)
  return query
}

/** GET an analytics endpoint; throws ApiError (with the real cause) on failure. */
export async function apiGet<T>(path: string, params?: Record<string, string | number | null | undefined>): Promise<T> {
  const url = new URL(path, window.location.origin)
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value != null && value !== "") url.searchParams.set(key, String(value))
  })
  return fetchData<T>(url.pathname + url.search)
}

/** POST/PUT/DELETE an endpoint; throws ApiError (with the real cause) on failure. */
export async function apiSend<T>(path: string, init: RequestInit): Promise<T> {
  return fetchData<T>(path, init)
}
