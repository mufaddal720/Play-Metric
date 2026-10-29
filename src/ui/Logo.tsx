export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="#141416" stroke="#3A3A42" />
      <rect x="6" y="8" width="5" height="16" rx="1" fill="#E4002B" />
      <rect x="12" y="8" width="14" height="5" rx="1" fill="#00843D" />
      <rect x="12" y="13.5" width="14" height="5" rx="1" fill="#FFFFFF" />
      <rect x="12" y="19" width="14" height="5" rx="1" fill="#0B0B0C" stroke="#5a5a64" strokeWidth=".6" />
    </svg>
  );
}
