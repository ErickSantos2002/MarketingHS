import type { Config } from "tailwindcss";

// Uma cor de token com suporte a modificador de opacidade (bg-primary/20).
// O token é hexadecimal; color-mix aplica o alfa sem precisar de canais HSL.
const cor = (variavel: string) =>
  `color-mix(in srgb, var(${variavel}) calc(<alpha-value> * 100%), transparent)`;

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      colors: {
        // shadcn — apelidos definidos em src/index.css
        border: cor("--border"),
        input: cor("--input"),
        ring: cor("--ring"),
        background: cor("--background"),
        foreground: cor("--foreground"),
        primary: {
          DEFAULT: cor("--primary"),
          foreground: cor("--primary-foreground"),
          50: cor("--color-primary-50"),
          100: cor("--color-primary-100"),
          200: cor("--color-primary-200"),
          300: cor("--color-primary-300"),
          400: cor("--color-primary-400"),
          500: cor("--color-primary-500"),
          600: cor("--color-primary-600"),
          700: cor("--color-primary-700"),
          800: cor("--color-primary-800"),
          900: cor("--color-primary-900"),
        },
        secondary: { DEFAULT: cor("--secondary"), foreground: cor("--secondary-foreground") },
        destructive: { DEFAULT: cor("--destructive"), foreground: cor("--destructive-foreground") },
        success: { DEFAULT: cor("--success"), foreground: cor("--success-foreground") },
        muted: { DEFAULT: cor("--muted"), foreground: cor("--muted-foreground") },
        accent: { DEFAULT: cor("--accent"), foreground: cor("--accent-foreground") },
        popover: { DEFAULT: cor("--popover"), foreground: cor("--popover-foreground") },
        card: { DEFAULT: cor("--card"), foreground: cor("--card-foreground") },
        // Design System — vocabulário do adocao.md, para as telas migradas
        action: { DEFAULT: cor("--action"), hover: cor("--action-hover"), tint: cor("--action-tint") },
        surface: { DEFAULT: cor("--surface"), base: cor("--bg-base"), elevated: cor("--surface-elevated") },
        borda: { DEFAULT: cor("--border-color"), muted: cor("--border-muted"), strong: cor("--border-strong") },
        conteudo: {
          DEFAULT: cor("--text-body"),
          heading: cor("--text-heading"),
          muted: cor("--text-muted"),
          faint: cor("--text-faint"),
        },
        danger: cor("--color-danger-500"),
        warning: cor("--color-warning-500"),
        info: cor("--color-info-500"),
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        "2xl": "var(--radius-2xl)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in-right": {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
        "spin-slow": {
          from: { transform: "rotate(0deg)" },
          to: { transform: "rotate(360deg)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.5s ease-out forwards",
        "slide-in-right": "slide-in-right 0.3s ease-out",
        "spin-slow": "spin-slow 20s linear infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
