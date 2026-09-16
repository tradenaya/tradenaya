"use client"

import * as React from "react"
import { format, isValid, parseISO, startOfDay } from "date-fns"
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]

interface DatePickerProps {
  value: string | null
  onChange: (value: string | null) => void
  placeholder?: string
  minDate?: string | null
  maxDate?: string | null
  className?: string
}

function toDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined
  const date = parseISO(value)
  return isValid(date) ? date : undefined
}

function toISODate(date: Date): string {
  return format(date, "yyyy-MM-dd")
}

function buildDays(year: number, month: number): (Date | null)[] {
  const firstWeekday = new Date(year, month, 1).getDay()
  const dayCount = new Date(year, month + 1, 0).getDate()
  const cells: (Date | null)[] = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= dayCount; d++) cells.push(new Date(year, month, d))
  return cells
}

export function DatePicker({
  value,
  onChange,
  placeholder = "Select date",
  minDate,
  maxDate,
  className,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false)

  const selected = toDate(value)
  const min = toDate(minDate)
  const max = toDate(maxDate)
  const today = new Date()

  const [viewYear, setViewYear] = React.useState(selected?.getFullYear() ?? today.getFullYear())
  const [viewMonth, setViewMonth] = React.useState(selected?.getMonth() ?? today.getMonth())

  const handleOpenChange = (next: boolean) => {
    if (next) {
      const base = selected ?? today
      setViewYear(base.getFullYear())
      setViewMonth(base.getMonth())
    }
    setOpen(next)
  }

  const isDisabled = React.useCallback(
    (date: Date) => {
      const start = startOfDay(date)
      if (min && start < startOfDay(min)) return true
      if (max && start > startOfDay(max)) return true
      return false
    },
    [min, max],
  )

  const select = (date: Date) => {
    if (selected && date.toDateString() === selected.toDateString()) {
      onChange(null)
    } else {
      onChange(toISODate(date))
    }
    setOpen(false)
  }

  const goPrev = () => {
    if (viewMonth === 0) {
      setViewMonth(11)
      setViewYear(viewYear - 1)
    } else {
      setViewMonth(viewMonth - 1)
    }
  }

  const goNext = () => {
    if (viewMonth === 11) {
      setViewMonth(0)
      setViewYear(viewYear + 1)
    } else {
      setViewMonth(viewMonth + 1)
    }
  }

  const prevDisabled =
    min != null && (viewYear < min.getFullYear() || (viewYear === min.getFullYear() && viewMonth <= min.getMonth()))
  const nextDisabled =
    max != null && (viewYear > max.getFullYear() || (viewYear === max.getFullYear() && viewMonth >= max.getMonth()))

  const jumpToday = () => {
    setViewYear(today.getFullYear())
    setViewMonth(today.getMonth())
    if (!isDisabled(today)) select(today)
  }

  const days = buildDays(viewYear, viewMonth)
  const monthLabel = format(new Date(viewYear, viewMonth, 1), "MMMM yyyy")

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          className={cn(
            "relative h-8 w-40 rounded-lg border border-border bg-card pl-8 pr-8 text-left text-sm outline-none transition-colors hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
            selected ? "text-foreground" : "text-muted-foreground",
            className,
          )}
        >
          <CalendarDays className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
          <span className="block truncate">
            {selected ? format(selected, "dd MMM yyyy") : placeholder}
          </span>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <div className="select-none text-foreground">
          <div className="flex items-center justify-between px-1">
            <button
              type="button"
              onClick={goPrev}
              disabled={prevDisabled}
              aria-label="Previous month"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-primary/15 hover:text-primary disabled:pointer-events-none disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold text-primary">{monthLabel}</span>
            <button
              type="button"
              onClick={goNext}
              disabled={nextDisabled}
              aria-label="Next month"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-primary/15 hover:text-primary disabled:pointer-events-none disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-2 grid grid-cols-7 gap-1">
            {WEEKDAYS.map((day) => (
              <span
                key={day}
                className="flex h-7 w-8 items-center justify-center text-[0.7rem] font-medium text-muted-foreground"
              >
                {day}
              </span>
            ))}
            {days.map((date, index) =>
              date == null ? (
                <span key={`empty-${index}`} className="h-8 w-8" />
              ) : (
                <button
                  key={date.toDateString()}
                  type="button"
                  disabled={isDisabled(date)}
                  aria-pressed={selected?.toDateString() === date.toDateString()}
                  onClick={() => select(date)}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-md text-sm transition-colors",
                    selected?.toDateString() === date.toDateString()
                      ? "bg-primary font-semibold text-primary-foreground shadow-[0_0_12px_rgba(201,154,88,0.35)]"
                      : "text-foreground hover:bg-primary/15 hover:text-primary",
                    date.toDateString() === today.toDateString() &&
                      selected?.toDateString() !== date.toDateString() &&
                      "border border-primary/60 text-primary",
                    isDisabled(date) &&
                      "cursor-not-allowed text-muted-foreground/40 hover:bg-transparent hover:text-muted-foreground/40",
                  )}
                >
                  {date.getDate()}
                </button>
              ),
            )}
          </div>

          <div className="mt-2 flex items-center justify-between border-t border-border/60 pt-2">
            <button
              type="button"
              onClick={jumpToday}
              className="text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
            >
              Today
            </button>
            {selected && (
              <button
                type="button"
                onClick={() => {
                  onChange(null)
                  setOpen(false)
                }}
                className="text-xs font-medium text-muted-foreground transition-colors hover:text-destructive"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}