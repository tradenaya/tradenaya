import type { SVGProps } from "react"

/** Brand gold used across the dark Tradenaya theme. */
export const BRAND_GOLD = "#c99a58"

/**
 * Vector trace of public/logo/tradenaya-logo.png: transparent background,
 * crisp at any size. Colour follows `currentColor`, so set it with `color`
 * or a text-* class. Defaults to the brand gold.
 */
export function TradenayaLogo({ title = "Tradenaya", style, ...props }: SVGProps<SVGSVGElement> & { title?: string }) {
  return (
    <svg
      viewBox="63 265 1068 667"
      fill="currentColor"
      role="img"
      aria-label={title}
      style={{ color: BRAND_GOLD, ...style }}
      {...props}
    >
      <title>{title}</title>
      <polygon points="63,265 715,265 810,362 63,362" />
      <polygon points="337,362 453,362 453,610 337,722" />
      <polygon points="160,932 397,720 692,426 1002,754 1002,284 1131,410 1131,932 1029,932 683,558 289,932" />
      <polygon points="579,712 682,612 682,932 579,932" />
    </svg>
  )
}
