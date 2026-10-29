import { useId, type SVGProps } from "react";

type BrandMarkProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
  /** Draw the green app-icon tile behind the G. Off for the bare mark. */
  tile?: boolean;
};

// Same geometry as brand/goldos-icon.svg, without the shadow and bevel lines that vanish at UI sizes.
const G_PATH =
  "M723.2 355 A268 268 0 1 0 780 520 L560 520 L538 570 L560 620 L636.9 620 A160 160 0 1 1 638.1 421.5 Z";

export function BrandMark({ size = 28, tile = true, className, ...props }: BrandMarkProps) {
  const id = useId();
  const metal = `${id}-metal`;
  const bg = `${id}-bg`;
  return (
    <svg
      width={size}
      height={size}
      viewBox={tile ? "100 100 824 824" : "232 240 560 560"}
      aria-hidden
      className={className}
      {...props}
    >
      <defs>
        <linearGradient id={bg} x1="0" y1="0" x2="0.55" y2="1">
          <stop offset="0" stopColor="#0F5545" />
          <stop offset="0.55" stopColor="#083A2F" />
          <stop offset="1" stopColor="#021A14" />
        </linearGradient>
        <linearGradient id={metal} gradientUnits="userSpaceOnUse" x1="330" y1="250" x2="700" y2="800">
          <stop offset="0" stopColor="#FFF3CC" />
          <stop offset="0.3" stopColor="#EBCD85" />
          <stop offset="0.6" stopColor="#CDA853" />
          <stop offset="1" stopColor="#8E6B28" />
        </linearGradient>
      </defs>
      {tile ? (
        <>
          <rect x="100" y="100" width="824" height="824" rx="185" fill={`url(#${bg})`} />
          <rect
            x="104"
            y="104"
            width="816"
            height="816"
            rx="181"
            fill="none"
            stroke="#9FF0D2"
            strokeOpacity="0.18"
            strokeWidth="8"
          />
        </>
      ) : null}
      <path d={G_PATH} fill={`url(#${metal})`} />
    </svg>
  );
}
