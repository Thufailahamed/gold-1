/** @type {import('tailwindcss').Config} */
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        gold: {
          DEFAULT: "#C9A227",
          dark: "#A8861B",
          deep: "#8C6D1F",
          light: "#E7C65A",
          soft: "#F3E9C6",
          pale: "#FBF6E5",
        },
        ink: {
          DEFAULT: "#1c1917",
          1: "#1c1917",
          2: "#292524",
          3: "#44403c",
          4: "#78716c",
          5: "#a8a29e",
          6: "#d6d3d1",
          7: "#e7e5e4",
        },
        paper: "#ffffff",
        bone: "#fafaf9",
        mist: "#e7e5e4",
        void: "#0c0a09",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        1: "0 1px 0 0 rgba(28, 25, 23, 0.06)",
        2: "0 8px 24px -12px rgba(28, 25, 23, 0.18)",
        3: "0 16px 40px -16px rgba(28, 25, 23, 0.22)",
        4: "0 24px 56px -20px rgba(28, 25, 23, 0.28)",
        5: "0 40px 80px -28px rgba(28, 25, 23, 0.36)",
        pop: "0 0 0 1px rgba(28, 25, 23, 0.08), 0 12px 32px -16px rgba(28, 25, 23, 0.2)",
        glow: "0 0 0 1px rgba(201, 162, 39, 0.55)",
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
      },
      animation: {
        "fade-in": "fade-in 280ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "pulse-soft": "pulse-soft 1.6s ease-in-out infinite",
        shimmer: "shimmer 2s linear infinite",
        "cart-pop": "cart-pop 320ms cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [],
};
