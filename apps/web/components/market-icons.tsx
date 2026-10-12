"use client";

import type { SVGProps } from "react";
import { cn } from "@/lib/cn";

export type IconSizeProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
};

/* ------------------------------------------------------------------ */
/* Official Cryptocurrency & Commodity Vector Logos                   */
/* ------------------------------------------------------------------ */

/**
 * Official Bitcoin (BTC) Logo
 * Authentic 14-degree tilted symbol with iconic Bitcoin orange gradient.
 */
export function BitcoinIcon({ size = 24, className, ...props }: IconSizeProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-label="Bitcoin"
      {...props}
    >
      <defs>
        <radialGradient id="btc-grad" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#FFAA33" />
          <stop offset="60%" stopColor="#F7931A" />
          <stop offset="100%" stopColor="#D97706" />
        </radialGradient>
        <filter id="btc-shadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="1" stdDeviation="0.8" floodOpacity="0.25" />
        </filter>
      </defs>
      {/* Outer coin body */}
      <circle cx="16" cy="16" r="15" fill="url(#btc-grad)" stroke="#FFFFFF" strokeWidth="0.75" strokeOpacity="0.3" />
      <circle cx="16" cy="16" r="13.8" fill="none" stroke="#FFFFFF" strokeWidth="0.5" strokeDasharray="1.5 1.5" strokeOpacity="0.4" />
      {/* Official 14° tilted Bitcoin 'B' */}
      <g transform="rotate(14 16 16)" filter="url(#btc-shadow)">
        <path
          fill="#FFFFFF"
          fillRule="evenodd"
          clipRule="evenodd"
          d="M19.8 13.9C20.3 12.8 19.8 11.2 17.8 10.6L18.4 8.2L16.9 7.8L16.3 10.2C15.9 10.1 15.5 10 15.1 9.9L15.7 7.5L14.2 7.1L13.6 9.5C13.3 9.4 13 9.3 12.6 9.3L12.7 9.2L10.6 8.7L10.2 10.3C10.2 10.3 11.3 10.6 11.3 10.6C11.9 10.8 12 11.2 12 11.5L11.3 14.3C11.3 14.3 11.4 14.3 11.5 14.4C11.4 14.3 11.3 14.3 11.3 14.3L10.3 18.3C10.2 18.5 10 18.8 9.6 18.7C9.6 18.7 8.5 18.4 8.5 18.4L7.8 20.1L9.8 20.6C10.2 20.7 10.6 20.8 11 20.9L10.4 23.3L11.9 23.7L12.5 21.3C12.9 21.4 13.3 21.5 13.7 21.6L13.1 24L14.6 24.4L15.2 22C17.8 22.5 19.7 22.3 20.4 20C21 18.1 20.3 17 19.1 16.4C20 15.7 20.5 14.7 19.8 13.9ZM17.1 18.8C16.6 20.7 13.5 19.7 12.5 19.4L13.3 16.2C14.3 16.4 17.6 16.9 17.1 18.8ZM16.6 13.8C16.2 15.4 13.6 14.6 12.8 14.4L13.5 11.6C14.3 11.8 17 12.2 16.6 13.8Z"
        />
      </g>
    </svg>
  );
}

/**
 * Official Ethereum (ETH) Logo
 * Multifaceted geometric crystal with signature ether purple/indigo gradient.
 */
export function EthereumIcon({ size = 24, className, ...props }: IconSizeProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-label="Ethereum"
      {...props}
    >
      <defs>
        <radialGradient id="eth-bg" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#7E8CE0" />
          <stop offset="60%" stopColor="#5566D6" />
          <stop offset="100%" stopColor="#37449E" />
        </radialGradient>
      </defs>
      {/* Outer coin body */}
      <circle cx="16" cy="16" r="15" fill="url(#eth-bg)" stroke="#FFFFFF" strokeWidth="0.75" strokeOpacity="0.3" />
      <circle cx="16" cy="16" r="13.8" fill="none" stroke="#FFFFFF" strokeWidth="0.5" strokeDasharray="1.5 1.5" strokeOpacity="0.35" />
      {/* Multifaceted Ethereum Diamond */}
      <g transform="translate(9.5, 6) scale(0.024)">
        {/* Top left facet */}
        <polygon points="270,0 0.1,447.8 270,607.4" fill="#FFFFFF" fillOpacity="0.85" />
        {/* Top right facet */}
        <polygon points="270,0 270,607.4 539.9,447.8" fill="#FFFFFF" fillOpacity="0.98" />
        {/* Top center diamond facet */}
        <polygon points="270,325.2 0.1,447.8 270,607.4 539.9,447.8" fill="#FFFFFF" fillOpacity="0.4" />
        {/* Bottom left facet */}
        <polygon points="0,499 270,879.4 270,658.5" fill="#FFFFFF" fillOpacity="0.8" />
        {/* Bottom right facet */}
        <polygon points="270,658.5 270,879.4 540,499" fill="#FFFFFF" fillOpacity="0.95" />
      </g>
    </svg>
  );
}

/**
 * Minted Gold Coin (XAU)
 * High-karat gold finish with reeded edge, relief border, and sculpted Au hallmark.
 */
export function GoldCoinIcon({ size = 24, className, ...props }: IconSizeProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-label="Gold (Au)"
      {...props}
    >
      <defs>
        <radialGradient id="gold-coin-outer" cx="30%" cy="25%" r="75%">
          <stop offset="0%" stopColor="#FFF4D0" />
          <stop offset="30%" stopColor="#F3CA68" />
          <stop offset="70%" stopColor="#CDA853" />
          <stop offset="100%" stopColor="#7E6223" />
        </radialGradient>
        <linearGradient id="gold-coin-inner" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FEE69A" />
          <stop offset="50%" stopColor="#CDA853" />
          <stop offset="100%" stopColor="#967425" />
        </linearGradient>
      </defs>
      {/* Outer coin bevel */}
      <circle cx="16" cy="16" r="15" fill="url(#gold-coin-outer)" stroke="#FFF8DC" strokeWidth="0.75" />
      {/* Coin reeded ring */}
      <circle cx="16" cy="16" r="13.2" fill="none" stroke="#7E6223" strokeWidth="0.75" strokeDasharray="1.5 1.5" strokeOpacity="0.6" />
      {/* Recessed coin center */}
      <circle cx="16" cy="16" r="12" fill="url(#gold-coin-inner)" />
      <circle cx="16" cy="16" r="12" fill="none" stroke="#FFF2BE" strokeWidth="0.5" strokeOpacity="0.7" />
      {/* Sculpted "Au" relief with 999.9 fine gold micro-hallmark */}
      <text
        x="16"
        y="17"
        textAnchor="middle"
        dominantBaseline="central"
        fill="#3D2F0E"
        fontSize="10.5"
        fontWeight="800"
        fontFamily="var(--font-display, ui-sans-serif, system-ui)"
        style={{ letterSpacing: "-0.04em" }}
      >
        Au
      </text>
      <text
        x="16"
        y="23.2"
        textAnchor="middle"
        fill="#5D4715"
        fontSize="3.8"
        fontWeight="700"
        letterSpacing="0.08em"
        fontFamily="var(--font-mono, monospace)"
      >
        999.9
      </text>
      {/* Highlight sheen */}
      <path
        d="M8 8 C11 5 21 5 24 8"
        stroke="#FFFFFF"
        strokeWidth="1"
        strokeLinecap="round"
        strokeOpacity="0.6"
      />
    </svg>
  );
}

/**
 * Minted Silver Coin (XAG)
 * High-luster silver bullion finish with mirror reflection and Ag hallmark.
 */
export function SilverCoinIcon({ size = 24, className, ...props }: IconSizeProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-label="Silver (Ag)"
      {...props}
    >
      <defs>
        <radialGradient id="silver-coin-outer" cx="30%" cy="25%" r="75%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="35%" stopColor="#E2E8F0" />
          <stop offset="70%" stopColor="#94A3B8" />
          <stop offset="100%" stopColor="#475569" />
        </radialGradient>
        <linearGradient id="silver-coin-inner" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F8FAFC" />
          <stop offset="50%" stopColor="#CBD5E1" />
          <stop offset="100%" stopColor="#64748B" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="15" fill="url(#silver-coin-outer)" stroke="#FFFFFF" strokeWidth="0.75" />
      <circle cx="16" cy="16" r="13.2" fill="none" stroke="#334155" strokeWidth="0.75" strokeDasharray="1.5 1.5" strokeOpacity="0.45" />
      <circle cx="16" cy="16" r="12" fill="url(#silver-coin-inner)" />
      <circle cx="16" cy="16" r="12" fill="none" stroke="#FFFFFF" strokeWidth="0.5" strokeOpacity="0.8" />
      <text
        x="16"
        y="17"
        textAnchor="middle"
        dominantBaseline="central"
        fill="#1E293B"
        fontSize="10.5"
        fontWeight="800"
        fontFamily="var(--font-display, ui-sans-serif, system-ui)"
        style={{ letterSpacing: "-0.04em" }}
      >
        Ag
      </text>
      <text
        x="16"
        y="23.2"
        textAnchor="middle"
        fill="#334155"
        fontSize="3.8"
        fontWeight="700"
        letterSpacing="0.08em"
        fontFamily="var(--font-mono, monospace)"
      >
        999.0
      </text>
      <path d="M8 8 C11 5 21 5 24 8" stroke="#FFFFFF" strokeWidth="1" strokeLinecap="round" strokeOpacity="0.75" />
    </svg>
  );
}

/**
 * Minted Copper Coin (HG)
 * Burnished reddish-copper finish with Cu hallmark.
 */
export function CopperCoinIcon({ size = 24, className, ...props }: IconSizeProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-label="Copper (Cu)"
      {...props}
    >
      <defs>
        <radialGradient id="cu-coin-outer" cx="30%" cy="25%" r="75%">
          <stop offset="0%" stopColor="#FED7AA" />
          <stop offset="35%" stopColor="#FB923C" />
          <stop offset="70%" stopColor="#C2410C" />
          <stop offset="100%" stopColor="#7C2D12" />
        </radialGradient>
        <linearGradient id="cu-coin-inner" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FDBA74" />
          <stop offset="50%" stopColor="#EA580C" />
          <stop offset="100%" stopColor="#9A3412" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="15" fill="url(#cu-coin-outer)" stroke="#FED7AA" strokeWidth="0.75" />
      <circle cx="16" cy="16" r="13.2" fill="none" stroke="#7C2D12" strokeWidth="0.75" strokeDasharray="1.5 1.5" strokeOpacity="0.5" />
      <circle cx="16" cy="16" r="12" fill="url(#cu-coin-inner)" />
      <circle cx="16" cy="16" r="12" fill="none" stroke="#FFEDD5" strokeWidth="0.5" strokeOpacity="0.7" />
      <text
        x="16"
        y="17"
        textAnchor="middle"
        dominantBaseline="central"
        fill="#431407"
        fontSize="10.5"
        fontWeight="800"
        fontFamily="var(--font-display, ui-sans-serif, system-ui)"
        style={{ letterSpacing: "-0.04em" }}
      >
        Cu
      </text>
      <text
        x="16"
        y="23.2"
        textAnchor="middle"
        fill="#7C2D12"
        fontSize="3.8"
        fontWeight="700"
        letterSpacing="0.08em"
        fontFamily="var(--font-mono, monospace)"
      >
        COMEX
      </text>
      <path d="M8 8 C11 5 21 5 24 8" stroke="#FFFFFF" strokeWidth="1" strokeLinecap="round" strokeOpacity="0.6" />
    </svg>
  );
}

/**
 * Minted Platinum Coin (XPT)
 * Cool crystalline platinum-blue metallic finish with Pt hallmark.
 */
export function PlatinumCoinIcon({ size = 24, className, ...props }: IconSizeProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-label="Platinum (Pt)"
      {...props}
    >
      <defs>
        <radialGradient id="pt-coin-outer" cx="30%" cy="25%" r="75%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="35%" stopColor="#BAE6FD" />
          <stop offset="70%" stopColor="#38BDF8" />
          <stop offset="100%" stopColor="#0369A1" />
        </radialGradient>
        <linearGradient id="pt-coin-inner" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#E0F2FE" />
          <stop offset="50%" stopColor="#7DD3FC" />
          <stop offset="100%" stopColor="#0284C7" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="15" fill="url(#pt-coin-outer)" stroke="#E0F2FE" strokeWidth="0.75" />
      <circle cx="16" cy="16" r="13.2" fill="none" stroke="#075985" strokeWidth="0.75" strokeDasharray="1.5 1.5" strokeOpacity="0.5" />
      <circle cx="16" cy="16" r="12" fill="url(#pt-coin-inner)" />
      <circle cx="16" cy="16" r="12" fill="none" stroke="#FFFFFF" strokeWidth="0.5" strokeOpacity="0.8" />
      <text
        x="16"
        y="17"
        textAnchor="middle"
        dominantBaseline="central"
        fill="#082F49"
        fontSize="10.5"
        fontWeight="800"
        fontFamily="var(--font-display, ui-sans-serif, system-ui)"
        style={{ letterSpacing: "-0.04em" }}
      >
        Pt
      </text>
      <text
        x="16"
        y="23.2"
        textAnchor="middle"
        fill="#0369A1"
        fontSize="3.8"
        fontWeight="700"
        letterSpacing="0.08em"
        fontFamily="var(--font-mono, monospace)"
      >
        999.5
      </text>
      <path d="M8 8 C11 5 21 5 24 8" stroke="#FFFFFF" strokeWidth="1" strokeLinecap="round" strokeOpacity="0.75" />
    </svg>
  );
}

/**
 * Minted Palladium Coin (XPD)
 * Warm smoky-titanium palladium finish with Pd hallmark.
 */
export function PalladiumCoinIcon({ size = 24, className, ...props }: IconSizeProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-label="Palladium (Pd)"
      {...props}
    >
      <defs>
        <radialGradient id="pd-coin-outer" cx="30%" cy="25%" r="75%">
          <stop offset="0%" stopColor="#F5F5F4" />
          <stop offset="35%" stopColor="#D6D3D1" />
          <stop offset="70%" stopColor="#A8A29E" />
          <stop offset="100%" stopColor="#57534E" />
        </radialGradient>
        <linearGradient id="pd-coin-inner" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FAFAF9" />
          <stop offset="50%" stopColor="#B5AFA9" />
          <stop offset="100%" stopColor="#78716C" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="15" fill="url(#pd-coin-outer)" stroke="#FFFFFF" strokeWidth="0.75" />
      <circle cx="16" cy="16" r="13.2" fill="none" stroke="#292524" strokeWidth="0.75" strokeDasharray="1.5 1.5" strokeOpacity="0.45" />
      <circle cx="16" cy="16" r="12" fill="url(#pd-coin-inner)" />
      <circle cx="16" cy="16" r="12" fill="none" stroke="#FFFFFF" strokeWidth="0.5" strokeOpacity="0.75" />
      <text
        x="16"
        y="17"
        textAnchor="middle"
        dominantBaseline="central"
        fill="#292524"
        fontSize="10.5"
        fontWeight="800"
        fontFamily="var(--font-display, ui-sans-serif, system-ui)"
        style={{ letterSpacing: "-0.04em" }}
      >
        Pd
      </text>
      <text
        x="16"
        y="23.2"
        textAnchor="middle"
        fill="#44403C"
        fontSize="3.8"
        fontWeight="700"
        letterSpacing="0.08em"
        fontFamily="var(--font-mono, monospace)"
      >
        999.5
      </text>
      <path d="M8 8 C11 5 21 5 24 8" stroke="#FFFFFF" strokeWidth="1" strokeLinecap="round" strokeOpacity="0.7" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* 3D Gold Bullion Bar & Specialty Graphic Badges                     */
/* ------------------------------------------------------------------ */

/**
 * 3D Stamped Fine Gold Bullion Ingot (999.9)
 * Isometric gold bar with bevels, polished face and official purity stamp.
 */
export function GoldBarIcon({ size = 24, className, ...props }: IconSizeProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-label="Gold Ingot"
      {...props}
    >
      <defs>
        <linearGradient id="bar-top" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFF2CE" />
          <stop offset="45%" stopColor="#E2C27A" />
          <stop offset="100%" stopColor="#CDA853" />
        </linearGradient>
        <linearGradient id="bar-front" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#CDA853" />
          <stop offset="100%" stopColor="#7E6223" />
        </linearGradient>
        <linearGradient id="bar-side" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#A88A3E" />
          <stop offset="100%" stopColor="#5E4612" />
        </linearGradient>
      </defs>
      {/* Shadow */}
      <ellipse cx="16" cy="27" rx="13" ry="2.8" fill="#000000" fillOpacity="0.3" />
      {/* Front Face */}
      <polygon points="3,17 25,17 24,25 2,25" fill="url(#bar-front)" />
      {/* Right Side Face */}
      <polygon points="25,17 30,12 29,20 24,25" fill="url(#bar-side)" />
      {/* Top Polished Face */}
      <polygon points="7,12 30,12 25,17 3,17" fill="url(#bar-top)" stroke="#FFF9E0" strokeWidth="0.5" />
      {/* Hallmarks on Top */}
      <text
        x="16"
        y="15"
        fill="#3D2F0E"
        fontSize="2.7"
        fontWeight="800"
        fontFamily="var(--font-mono, monospace)"
        letterSpacing="0.1em"
        textAnchor="middle"
      >
        FINE GOLD · 999.9
      </text>
      {/* Ingot highlight sheen */}
      <line x1="8" y1="13" x2="28" y2="13" stroke="#FFFFFF" strokeWidth="0.75" strokeOpacity="0.7" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Sri Lankan Sovereign (Pawn · 8g) Gold Coin
 * Traditional pawn medallion with floral hallmark.
 */
export function SovereignPawnIcon({ size = 24, className, ...props }: IconSizeProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-label="Pawn 8g"
      {...props}
    >
      <defs>
        <radialGradient id="pawn-grad" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#FFF3D6" />
          <stop offset="40%" stopColor="#F59E0B" />
          <stop offset="85%" stopColor="#B45309" />
          <stop offset="100%" stopColor="#78350F" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="14.5" fill="url(#pawn-grad)" stroke="#FEF3C7" strokeWidth="0.75" />
      <circle cx="16" cy="16" r="12.5" fill="none" stroke="#78350F" strokeWidth="0.6" strokeDasharray="1.2 1.2" strokeOpacity="0.6" />
      <circle cx="16" cy="16" r="10.5" fill="#D97706" fillOpacity="0.5" stroke="#FDE68A" strokeWidth="0.5" />
      {/* 8G Sovereign Crown / Scale */}
      <path
        d="M11 17.5 L12.5 12.5 L16 15 L19.5 12.5 L21 17.5 Z"
        fill="#FEF3C7"
        stroke="#78350F"
        strokeWidth="0.5"
      />
      <circle cx="12.5" cy="12.5" r="1" fill="#FEF3C7" />
      <circle cx="16" cy="15" r="1" fill="#FEF3C7" />
      <circle cx="19.5" cy="12.5" r="1" fill="#FEF3C7" />
      <text
        x="16"
        y="22"
        textAnchor="middle"
        fill="#3D2005"
        fontSize="3.8"
        fontWeight="800"
        fontFamily="var(--font-mono, monospace)"
        letterSpacing="0.05em"
      >
        8 GRAMS
      </text>
    </svg>
  );
}

/**
 * Currency Exchange (USD ⇄ LKR) Graphic Icon
 */
export function FxExchangeIcon({ size = 24, className, ...props }: IconSizeProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-label="Currency Exchange"
      {...props}
    >
      <defs>
        <linearGradient id="fx-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#38BDF8" />
          <stop offset="100%" stopColor="#0284C7" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="14.5" fill="url(#fx-grad)" stroke="#BAE6FD" strokeWidth="0.75" />
      {/* Intertwined Exchange Arrows */}
      <path
        d="M9 13.5 H21 M21 13.5 L17.5 10 M21 13.5 L17.5 17"
        stroke="#FFFFFF"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M23 18.5 H11 M11 18.5 L14.5 15 M11 18.5 L14.5 22"
        stroke="#E0F2FE"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Gold / Silver Dual Ratio Balance Icon
 */
export function RatioScaleIcon({ size = 24, className, ...props }: IconSizeProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-label="Gold Silver Ratio"
      {...props}
    >
      <defs>
        <radialGradient id="ratio-bg" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#C4B5FD" />
          <stop offset="100%" stopColor="#7C3AED" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="14.5" fill="url(#ratio-bg)" stroke="#DDD6FE" strokeWidth="0.75" />
      {/* Central Scale Pivot */}
      <path d="M16 8 V23 M11 23 H21" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M9 11.5 L16 10 L23 11.5" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      {/* Gold Pan (Left) */}
      <path d="M6 16.5 C6 18.5 12 18.5 12 16.5 Z" fill="#FDE047" stroke="#FEF08A" strokeWidth="0.8" />
      <line x1="9" y1="11.5" x2="6.5" y2="16.5" stroke="#FFFFFF" strokeWidth="0.8" />
      <line x1="9" y1="11.5" x2="11.5" y2="16.5" stroke="#FFFFFF" strokeWidth="0.8" />
      {/* Silver Pan (Right) */}
      <path d="M20 16.5 C20 18.5 26 18.5 26 16.5 Z" fill="#E2E8F0" stroke="#F8FAFC" strokeWidth="0.8" />
      <line x1="23" y1="11.5" x2="20.5" y2="16.5" stroke="#FFFFFF" strokeWidth="0.8" />
      <line x1="23" y1="11.5" x2="25.5" y2="16.5" stroke="#FFFFFF" strokeWidth="0.8" />
    </svg>
  );
}

/**
 * Board vs Market Spread Gauge Icon
 */
export function SpreadGaugeIcon({ size = 24, className, ...props }: IconSizeProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-label="Board vs Market"
      {...props}
    >
      <defs>
        <radialGradient id="gauge-bg" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#6EE7B7" />
          <stop offset="100%" stopColor="#059669" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="14.5" fill="url(#gauge-bg)" stroke="#A7F3D0" strokeWidth="0.75" />
      {/* Dial Arc */}
      <path
        d="M8.5 20 A 9.5 9.5 0 1 1 23.5 20"
        stroke="#FFFFFF"
        strokeWidth="2.2"
        strokeLinecap="round"
        fill="none"
      />
      {/* Target Marker */}
      <line x1="16" y1="7.5" x2="16" y2="10" stroke="#FEF08A" strokeWidth="2" strokeLinecap="round" />
      {/* Gauge Needle */}
      <path d="M16 18 L19.5 12" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
      <circle cx="16" cy="18" r="2.2" fill="#FFFFFF" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* World Currency Flags (Crisp Circular Badges)                       */
/* ------------------------------------------------------------------ */

export function CountryFlag({ code, size = 18, className }: { code: string; size?: number; className?: string }) {
  const c = code.toUpperCase();
  const radius = size / 2;

  switch (c) {
    case "LKR":
      // Sri Lanka 🇱🇰
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" className={cn("shrink-0 rounded-full", className)}>
          <defs>
            <clipPath id="sl-clip"><circle cx="16" cy="16" r="16" /></clipPath>
          </defs>
          <g clipPath="url(#sl-clip)">
            {/* Golden Outer Border */}
            <rect width="32" height="32" fill="#F7B500" />
            {/* Green & Orange Stripes on Left */}
            <rect x="2" y="2" width="4" height="28" fill="#005A36" />
            <rect x="6" y="2" width="4.5" height="28" fill="#E65A00" />
            {/* Maroon Main Field */}
            <rect x="11.5" y="2" width="18.5" height="28" fill="#880024" />
            {/* Gold Lion Silhouette */}
            <path
              d="M17 19 C18 19 20 18 21 16 C22 14 24 13 25 14 C26 15 25 17 23 19 C22 20 20 21 17 21 Z M22 13 L25 11 L25 14 Z"
              fill="#F7B500"
            />
            {/* 4 Bo leaves corners */}
            <circle cx="13.5" cy="4.5" r="1.2" fill="#F7B500" />
            <circle cx="27.5" cy="4.5" r="1.2" fill="#F7B500" />
            <circle cx="13.5" cy="27.5" r="1.2" fill="#F7B500" />
            <circle cx="27.5" cy="27.5" r="1.2" fill="#F7B500" />
          </g>
        </svg>
      );

    case "USD":
      // United States 🇺🇸
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" className={cn("shrink-0 rounded-full", className)}>
          <defs><clipPath id="us-clip"><circle cx="16" cy="16" r="16" /></clipPath></defs>
          <g clipPath="url(#us-clip)">
            <rect width="32" height="32" fill="#B22234" />
            {[1, 3, 5, 7, 9, 11].map((i) => (
              <rect key={i} y={i * 2.46} width="32" height="2.46" fill="#FFFFFF" />
            ))}
            {/* Blue Canton */}
            <rect width="16" height="15" fill="#3C3B6E" />
            {/* Stars */}
            <circle cx="4" cy="4" r="0.8" fill="#FFFFFF" />
            <circle cx="8" cy="4" r="0.8" fill="#FFFFFF" />
            <circle cx="12" cy="4" r="0.8" fill="#FFFFFF" />
            <circle cx="6" cy="7.5" r="0.8" fill="#FFFFFF" />
            <circle cx="10" cy="7.5" r="0.8" fill="#FFFFFF" />
            <circle cx="4" cy="11" r="0.8" fill="#FFFFFF" />
            <circle cx="8" cy="11" r="0.8" fill="#FFFFFF" />
            <circle cx="12" cy="11" r="0.8" fill="#FFFFFF" />
          </g>
        </svg>
      );

    case "EUR":
      // European Union 🇪🇺
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" className={cn("shrink-0 rounded-full", className)}>
          <defs><clipPath id="eu-clip"><circle cx="16" cy="16" r="16" /></clipPath></defs>
          <g clipPath="url(#eu-clip)">
            <rect width="32" height="32" fill="#003399" />
            {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((deg) => {
              const rad = (deg * Math.PI) / 180;
              const cx = 16 + 9 * Math.cos(rad);
              const cy = 16 + 9 * Math.sin(rad);
              return <circle key={deg} cx={cx} cy={cy} r="1.1" fill="#FFCC00" />;
            })}
          </g>
        </svg>
      );

    case "GBP":
      // United Kingdom 🇬🇧
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" className={cn("shrink-0 rounded-full", className)}>
          <defs><clipPath id="uk-clip"><circle cx="16" cy="16" r="16" /></clipPath></defs>
          <g clipPath="url(#uk-clip)">
            <rect width="32" height="32" fill="#012169" />
            {/* White diagonals */}
            <path d="M0 0 L32 32 M32 0 L0 32" stroke="#FFFFFF" strokeWidth="4.5" />
            {/* Red diagonals */}
            <path d="M0 0 L32 32 M32 0 L0 32" stroke="#C8102E" strokeWidth="2.2" />
            {/* White cross */}
            <path d="M16 0 V32 M0 16 H32" stroke="#FFFFFF" strokeWidth="7" />
            {/* Red cross */}
            <path d="M16 0 V32 M0 16 H32" stroke="#C8102E" strokeWidth="4.2" />
          </g>
        </svg>
      );

    case "INR":
      // India 🇮🇳
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" className={cn("shrink-0 rounded-full", className)}>
          <defs><clipPath id="in-clip"><circle cx="16" cy="16" r="16" /></clipPath></defs>
          <g clipPath="url(#in-clip)">
            <rect width="32" height="10.7" fill="#FF9933" />
            <rect y="10.7" width="32" height="10.6" fill="#FFFFFF" />
            <rect y="21.3" width="32" height="10.7" fill="#138808" />
            {/* Ashoka Chakra */}
            <circle cx="16" cy="16" r="3.6" fill="none" stroke="#000080" strokeWidth="0.8" />
            <circle cx="16" cy="16" r="0.8" fill="#000080" />
          </g>
        </svg>
      );

    case "AED":
      // United Arab Emirates 🇦🇪
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" className={cn("shrink-0 rounded-full", className)}>
          <defs><clipPath id="ae-clip"><circle cx="16" cy="16" r="16" /></clipPath></defs>
          <g clipPath="url(#ae-clip)">
            <rect width="32" height="10.7" fill="#00732F" />
            <rect y="10.7" width="32" height="10.6" fill="#FFFFFF" />
            <rect y="21.3" width="32" height="10.7" fill="#000000" />
            {/* Red vertical bar */}
            <rect width="9" height="32" fill="#FF0000" />
          </g>
        </svg>
      );

    case "SAR":
      // Saudi Arabia 🇸🇦
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" className={cn("shrink-0 rounded-full", className)}>
          <defs><clipPath id="sa-clip"><circle cx="16" cy="16" r="16" /></clipPath></defs>
          <g clipPath="url(#sa-clip)">
            <rect width="32" height="32" fill="#006C35" />
            {/* White Shahada & Sword */}
            <path d="M10 13 H22 M11 11 H21" stroke="#FFFFFF" strokeWidth="1.2" strokeLinecap="round" />
            <path d="M9 19 H23 L21 17.5" stroke="#FFFFFF" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        </svg>
      );

    case "QAR":
      // Qatar 🇶🇦
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" className={cn("shrink-0 rounded-full", className)}>
          <defs><clipPath id="qa-clip"><circle cx="16" cy="16" r="16" /></clipPath></defs>
          <g clipPath="url(#qa-clip)">
            <rect width="32" height="32" fill="#8D1B3D" />
            <path d="M0 0 H10 L13 2 L10 4 L13 6 L10 8 L13 10 L10 12 L13 14 L10 16 L13 18 L10 20 L13 22 L10 24 L13 26 L10 28 L13 30 L10 32 H0 Z" fill="#FFFFFF" />
          </g>
        </svg>
      );

    case "KWD":
      // Kuwait 🇰🇼
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" className={cn("shrink-0 rounded-full", className)}>
          <defs><clipPath id="kw-clip"><circle cx="16" cy="16" r="16" /></clipPath></defs>
          <g clipPath="url(#kw-clip)">
            <rect width="32" height="10.7" fill="#007A3D" />
            <rect y="10.7" width="32" height="10.6" fill="#FFFFFF" />
            <rect y="21.3" width="32" height="10.7" fill="#CE1126" />
            <polygon points="0,0 9,10.7 9,21.3 0,32" fill="#000000" />
          </g>
        </svg>
      );

    case "OMR":
      // Oman 🇴🇲
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" className={cn("shrink-0 rounded-full", className)}>
          <defs><clipPath id="om-clip"><circle cx="16" cy="16" r="16" /></clipPath></defs>
          <g clipPath="url(#om-clip)">
            <rect width="32" height="10.7" fill="#FFFFFF" />
            <rect y="10.7" width="32" height="10.6" fill="#DB161E" />
            <rect y="21.3" width="32" height="10.7" fill="#008000" />
            <rect width="8" height="32" fill="#DB161E" />
            <circle cx="4" cy="5" r="1.5" fill="#FFFFFF" />
          </g>
        </svg>
      );

    case "AUD":
      // Australia 🇦🇺
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" className={cn("shrink-0 rounded-full", className)}>
          <defs><clipPath id="au-clip"><circle cx="16" cy="16" r="16" /></clipPath></defs>
          <g clipPath="url(#au-clip)">
            <rect width="32" height="32" fill="#00008B" />
            <rect width="16" height="15" fill="#012169" />
            <path d="M0 0 L16 15 M16 0 L0 15" stroke="#FFFFFF" strokeWidth="2.2" />
            <path d="M0 0 L16 15 M16 0 L0 15" stroke="#C8102E" strokeWidth="1.2" />
            <path d="M8 0 V15 M0 7.5 H16" stroke="#FFFFFF" strokeWidth="3.2" />
            <path d="M8 0 V15 M0 7.5 H16" stroke="#C8102E" strokeWidth="1.8" />
            {/* Commonwealth Star */}
            <circle cx="8" cy="22" r="2.2" fill="#FFFFFF" />
            {/* Southern Cross */}
            <circle cx="24" cy="6" r="1" fill="#FFFFFF" />
            <circle cx="21" cy="12" r="1" fill="#FFFFFF" />
            <circle cx="27" cy="14" r="1" fill="#FFFFFF" />
            <circle cx="24" cy="22" r="1" fill="#FFFFFF" />
          </g>
        </svg>
      );

    case "CAD":
      // Canada 🇨🇦
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" className={cn("shrink-0 rounded-full", className)}>
          <defs><clipPath id="ca-clip"><circle cx="16" cy="16" r="16" /></clipPath></defs>
          <g clipPath="url(#ca-clip)">
            <rect width="32" height="32" fill="#FF0000" />
            <rect x="8" width="16" height="32" fill="#FFFFFF" />
            {/* Maple Leaf */}
            <path
              d="M16 8 L17.5 12 L20 11.5 L18.5 14.5 L21 16 L17.5 17.5 L17 21 L16 23 L15 21 L14.5 17.5 L11 16 L13.5 14.5 L12 11.5 L14.5 12 Z"
              fill="#FF0000"
            />
          </g>
        </svg>
      );

    case "SGD":
      // Singapore 🇸🇬
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" className={cn("shrink-0 rounded-full", className)}>
          <defs><clipPath id="sg-clip"><circle cx="16" cy="16" r="16" /></clipPath></defs>
          <g clipPath="url(#sg-clip)">
            <rect width="32" height="16" fill="#ED2939" />
            <rect y="16" width="32" height="16" fill="#FFFFFF" />
            {/* Crescent & 5 Stars */}
            <circle cx="8.5" cy="8" r="4.5" fill="#FFFFFF" />
            <circle cx="10" cy="8" r="4.2" fill="#ED2939" />
            <circle cx="12" cy="6" r="0.8" fill="#FFFFFF" />
            <circle cx="14" cy="7" r="0.8" fill="#FFFFFF" />
            <circle cx="13.5" cy="9" r="0.8" fill="#FFFFFF" />
            <circle cx="11.5" cy="9.5" r="0.8" fill="#FFFFFF" />
          </g>
        </svg>
      );

    case "JPY":
      // Japan 🇯🇵
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" className={cn("shrink-0 rounded-full", className)}>
          <defs><clipPath id="jp-clip"><circle cx="16" cy="16" r="16" /></clipPath></defs>
          <g clipPath="url(#jp-clip)">
            <rect width="32" height="32" fill="#FFFFFF" stroke="#E2E8F0" strokeWidth="0.5" />
            <circle cx="16" cy="16" r="6.8" fill="#BC002D" />
          </g>
        </svg>
      );

    case "CNY":
      // China 🇨🇳
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" className={cn("shrink-0 rounded-full", className)}>
          <defs><clipPath id="cn-clip"><circle cx="16" cy="16" r="16" /></clipPath></defs>
          <g clipPath="url(#cn-clip)">
            <rect width="32" height="32" fill="#DE2910" />
            <circle cx="6.5" cy="7" r="2.8" fill="#FFDE00" />
            <circle cx="12" cy="4" r="0.9" fill="#FFDE00" />
            <circle cx="14" cy="6.5" r="0.9" fill="#FFDE00" />
            <circle cx="14" cy="9.5" r="0.9" fill="#FFDE00" />
            <circle cx="12" cy="12" r="0.9" fill="#FFDE00" />
          </g>
        </svg>
      );

    case "CHF":
      // Switzerland 🇨🇭
      return (
        <svg width={size} height={size} viewBox="0 0 32 32" className={cn("shrink-0 rounded-full", className)}>
          <defs><clipPath id="ch-clip"><circle cx="16" cy="16" r="16" /></clipPath></defs>
          <g clipPath="url(#ch-clip)">
            <rect width="32" height="32" fill="#D52B1E" />
            <rect x="13" y="7" width="6" height="18" fill="#FFFFFF" />
            <rect x="7" y="13" width="18" height="6" fill="#FFFFFF" />
          </g>
        </svg>
      );

    default:
      // Generic circular currency fallback
      return (
        <span
          className={cn(
            "flex shrink-0 items-center justify-center rounded-full bg-ink/[0.08] font-mono text-[9px] font-bold text-ink-3",
            className
          )}
          style={{ width: size, height: size }}
        >
          {c.slice(0, 2)}
        </span>
      );
  }
}

/* ------------------------------------------------------------------ */
/* Master Market Icon Component (Replaces flat metal coin)           */
/* ------------------------------------------------------------------ */

export function MarketIcon({ symbol, size = 28, className }: { symbol: string; size?: number; className?: string }) {
  const s = symbol.toUpperCase();
  switch (s) {
    case "BTC":
      return <BitcoinIcon size={size} className={className} />;
    case "ETH":
      return <EthereumIcon size={size} className={className} />;
    case "XAU":
      return <GoldCoinIcon size={size} className={className} />;
    case "XAG":
      return <SilverCoinIcon size={size} className={className} />;
    case "HG":
      return <CopperCoinIcon size={size} className={className} />;
    case "XPT":
      return <PlatinumCoinIcon size={size} className={className} />;
    case "XPD":
      return <PalladiumCoinIcon size={size} className={className} />;
    default:
      // Fallback
      return <GoldCoinIcon size={size} className={className} />;
  }
}
