/** @type {import('tailwindcss').Config} */
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Palette lives in app/globals.css (:root) as RGB channels.
        gold: {
          DEFAULT: "rgb(var(--c-gold) / <alpha-value>)",
          dark: "rgb(var(--c-gold-dark) / <alpha-value>)",
          deep: "rgb(var(--c-gold-deep) / <alpha-value>)",
          700: "rgb(var(--c-gold-deep) / <alpha-value>)",
          light: "rgb(var(--c-gold-light) / <alpha-value>)",
          soft: "rgb(var(--c-gold-soft) / <alpha-value>)",
          pale: "rgb(var(--c-gold-pale) / <alpha-value>)",
        },
        ink: {
          DEFAULT: "rgb(var(--c-ink-1) / <alpha-value>)",
          1: "rgb(var(--c-ink-1) / <alpha-value>)",
          2: "rgb(var(--c-ink-2) / <alpha-value>)",
          3: "rgb(var(--c-ink-3) / <alpha-value>)",
          4: "rgb(var(--c-ink-4) / <alpha-value>)",
          5: "rgb(var(--c-ink-5) / <alpha-value>)",
          6: "rgb(var(--c-ink-6) / <alpha-value>)",
          7: "rgb(var(--c-ink-7) / <alpha-value>)",
        },
        paper: "rgb(var(--c-paper) / <alpha-value>)",
        bone: "rgb(var(--c-bone) / <alpha-value>)",
        mist: "rgb(var(--c-mist) / <alpha-value>)",
        void: "rgb(var(--c-void) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        1: "0 1px 0 0 rgba(16, 32, 27, 0.06)",
        2: "0 8px 24px -12px rgba(16, 32, 27, 0.18)",
        3: "0 16px 40px -16px rgba(16, 32, 27, 0.22)",
        4: "0 24px 56px -20px rgba(16, 32, 27, 0.28)",
        5: "0 40px 80px -28px rgba(16, 32, 27, 0.36)",
        pop: "0 0 0 1px rgba(16, 32, 27, 0.08), 0 12px 32px -16px rgba(16, 32, 27, 0.2)",
        glow: "0 0 0 1px rgba(205, 168, 83, 0.55)",
      },
      maxWidth: {
        stage: "88rem",
        measure: "38rem",
      },
      transitionDuration: {
        140: "140ms",
        180: "180ms",
        200: "200ms",
        240: "240ms",
        320: "320ms",
      },
      transitionTimingFunction: {
        brand: "cubic-bezier(0.22, 1, 0.36, 1)",
        cinematic: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.7" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "cart-pop": {
          "0%": { transform: "scale(0.7)" },
          "60%": { transform: "scale(1.12)" },
          "100%": { transform: "scale(1)" },
        },
        "slide-in": {
          from: { transform: "translateX(24px)", opacity: "0" },
          to: { transform: "translateX(0)", opacity: "1" },
        },
        "pop-in": {
          from: { opacity: "0", transform: "translateY(-4px) scale(0.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
      },
      animation: {
        "fade-in": "fade-in 280ms cubic-bezier(0.16, 1, 0.3, 1) backwards",
        "pulse-soft": "pulse-soft 1.6s ease-in-out infinite",
        shimmer: "shimmer 2s linear infinite",
        "cart-pop": "cart-pop 320ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "slide-in": "slide-in 320ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "pop-in": "pop-in 180ms cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [],
};
