// The Noble maker's-mark: a navy tile with a gold serifed "N" and a gold
// inset hairline. Matches /public/favicon.svg. Used in the sidebar, mobile
// top bar, and login. Sized via the `class`/`size` props.
export function NobleMark({ size = 34, class: className }: { size?: number; class?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" class={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#1a2b4a" />
      <rect x="3.25" y="3.25" width="25.5" height="25.5" rx="5.5" fill="none" stroke="#c9a227" stroke-width="1.1" stroke-opacity="0.85" />
      <path d="M10 22.5V9.5H12.9L19.1 18V9.5H22V22.5H19.1L12.9 14V22.5H10Z" fill="#c9a227" />
    </svg>
  );
}
