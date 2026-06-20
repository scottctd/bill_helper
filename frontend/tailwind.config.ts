import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config: Config = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // === Semantic tokens (RGB triples consumed via rgb(var(--x))) ===
        border: "rgb(var(--border))",
        input: "rgb(var(--input))",
        ring: "rgb(var(--ring))",
        background: "rgb(var(--background))",
        foreground: "rgb(var(--foreground))",
        primary: {
          DEFAULT: "rgb(var(--primary))",
          foreground: "rgb(var(--primary-foreground))"
        },
        secondary: {
          DEFAULT: "rgb(var(--secondary))",
          foreground: "rgb(var(--secondary-foreground))"
        },
        destructive: {
          DEFAULT: "rgb(var(--destructive))",
          foreground: "rgb(var(--destructive-foreground))"
        },
        muted: {
          DEFAULT: "rgb(var(--muted))",
          foreground: "rgb(var(--muted-foreground))"
        },
        accent: {
          DEFAULT: "rgb(var(--accent))",
          foreground: "rgb(var(--accent-foreground))"
        },
        popover: {
          DEFAULT: "rgb(var(--popover))",
          foreground: "rgb(var(--popover-foreground))"
        },
        card: {
          DEFAULT: "rgb(var(--card))",
          foreground: "rgb(var(--card-foreground))"
        },
        success: {
          DEFAULT: "rgb(var(--success))",
          foreground: "rgb(var(--success-foreground))"
        },
        warning: {
          DEFAULT: "rgb(var(--warning))",
          foreground: "rgb(var(--warning-foreground))"
        },

        // === Geist full scales (namespaced to avoid Tailwind palette collision) ===
        geist: {
          gray: {
            100: "rgb(var(--geist-gray-100))",
            200: "rgb(var(--geist-gray-200))",
            300: "rgb(var(--geist-gray-300))",
            400: "rgb(var(--geist-gray-400))",
            500: "rgb(var(--geist-gray-500))",
            600: "rgb(var(--geist-gray-600))",
            700: "rgb(var(--geist-gray-700))",
            800: "rgb(var(--geist-gray-800))",
            900: "rgb(var(--geist-gray-900))",
            1000: "rgb(var(--geist-gray-1000))"
          },
          // gray-alpha is 8-digit hex; use directly without opacity modifiers.
          "gray-alpha": {
            100: "var(--geist-gray-alpha-100)",
            200: "var(--geist-gray-alpha-200)",
            300: "var(--geist-gray-alpha-300)",
            400: "var(--geist-gray-alpha-400)",
            500: "var(--geist-gray-alpha-500)",
            600: "var(--geist-gray-alpha-600)",
            700: "var(--geist-gray-alpha-700)",
            800: "var(--geist-gray-alpha-800)",
            900: "var(--geist-gray-alpha-900)",
            1000: "var(--geist-gray-alpha-1000)"
          },
          bg: {
            100: "rgb(var(--geist-bg-100))",
            200: "rgb(var(--geist-bg-200))"
          },
          blue: {
            100: "rgb(var(--geist-blue-100))",
            200: "rgb(var(--geist-blue-200))",
            300: "rgb(var(--geist-blue-300))",
            400: "rgb(var(--geist-blue-400))",
            500: "rgb(var(--geist-blue-500))",
            600: "rgb(var(--geist-blue-600))",
            700: "rgb(var(--geist-blue-700))",
            800: "rgb(var(--geist-blue-800))",
            900: "rgb(var(--geist-blue-900))",
            1000: "rgb(var(--geist-blue-1000))"
          },
          red: {
            100: "rgb(var(--geist-red-100))",
            200: "rgb(var(--geist-red-200))",
            300: "rgb(var(--geist-red-300))",
            400: "rgb(var(--geist-red-400))",
            500: "rgb(var(--geist-red-500))",
            600: "rgb(var(--geist-red-600))",
            700: "rgb(var(--geist-red-700))",
            800: "rgb(var(--geist-red-800))",
            900: "rgb(var(--geist-red-900))",
            1000: "rgb(var(--geist-red-1000))"
          },
          amber: {
            100: "rgb(var(--geist-amber-100))",
            200: "rgb(var(--geist-amber-200))",
            300: "rgb(var(--geist-amber-300))",
            400: "rgb(var(--geist-amber-400))",
            500: "rgb(var(--geist-amber-500))",
            600: "rgb(var(--geist-amber-600))",
            700: "rgb(var(--geist-amber-700))",
            800: "rgb(var(--geist-amber-800))",
            900: "rgb(var(--geist-amber-900))",
            1000: "rgb(var(--geist-amber-1000))"
          },
          green: {
            100: "rgb(var(--geist-green-100))",
            200: "rgb(var(--geist-green-200))",
            300: "rgb(var(--geist-green-300))",
            400: "rgb(var(--geist-green-400))",
            500: "rgb(var(--geist-green-500))",
            600: "rgb(var(--geist-green-600))",
            700: "rgb(var(--geist-green-700))",
            800: "rgb(var(--geist-green-800))",
            900: "rgb(var(--geist-green-900))",
            1000: "rgb(var(--geist-green-1000))"
          },
          teal: {
            100: "rgb(var(--geist-teal-100))",
            200: "rgb(var(--geist-teal-200))",
            300: "rgb(var(--geist-teal-300))",
            400: "rgb(var(--geist-teal-400))",
            500: "rgb(var(--geist-teal-500))",
            600: "rgb(var(--geist-teal-600))",
            700: "rgb(var(--geist-teal-700))",
            800: "rgb(var(--geist-teal-800))",
            900: "rgb(var(--geist-teal-900))",
            1000: "rgb(var(--geist-teal-1000))"
          },
          purple: {
            100: "rgb(var(--geist-purple-100))",
            200: "rgb(var(--geist-purple-200))",
            300: "rgb(var(--geist-purple-300))",
            400: "rgb(var(--geist-purple-400))",
            500: "rgb(var(--geist-purple-500))",
            600: "rgb(var(--geist-purple-600))",
            700: "rgb(var(--geist-purple-700))",
            800: "rgb(var(--geist-purple-800))",
            900: "rgb(var(--geist-purple-900))",
            1000: "rgb(var(--geist-purple-1000))"
          },
          pink: {
            100: "rgb(var(--geist-pink-100))",
            200: "rgb(var(--geist-pink-200))",
            300: "rgb(var(--geist-pink-300))",
            400: "rgb(var(--geist-pink-400))",
            500: "rgb(var(--geist-pink-500))",
            600: "rgb(var(--geist-pink-600))",
            700: "rgb(var(--geist-pink-700))",
            800: "rgb(var(--geist-pink-800))",
            900: "rgb(var(--geist-pink-900))",
            1000: "rgb(var(--geist-pink-1000))"
          }
        }
      },

      fontFamily: {
        sans: ['"Geist"', '"Segoe UI Variable Text"', '"Segoe UI"', "Helvetica Neue", "Arial", "sans-serif"],
        mono: ['"Geist Mono"', '"SFMono-Regular"', "Menlo", "Consolas", "monospace"]
      },

      // === Typography: remap Tailwind named sizes to Geist metrics + Geist type tokens ===
      fontSize: {
        xs: ["12px", { lineHeight: "16px" }],
        sm: ["14px", { lineHeight: "20px" }],
        base: ["16px", { lineHeight: "24px" }],
        lg: ["18px", { lineHeight: "28px" }],
        xl: ["20px", { lineHeight: "26px", letterSpacing: "-0.4px" }],
        "2xl": ["24px", { lineHeight: "32px", letterSpacing: "-0.96px" }],
        "3xl": ["32px", { lineHeight: "40px", letterSpacing: "-1.28px" }],
        "4xl": ["40px", { lineHeight: "48px", letterSpacing: "-2.4px" }],
        // Geist headings (weight 600, negative tracking tightens with size)
        "heading-14": ["14px", { lineHeight: "20px", letterSpacing: "-0.28px", fontWeight: "600" }],
        "heading-16": ["16px", { lineHeight: "24px", letterSpacing: "-0.32px", fontWeight: "600" }],
        "heading-20": ["20px", { lineHeight: "26px", letterSpacing: "-0.4px", fontWeight: "600" }],
        "heading-24": ["24px", { lineHeight: "32px", letterSpacing: "-0.96px", fontWeight: "600" }],
        "heading-32": ["32px", { lineHeight: "40px", letterSpacing: "-1.28px", fontWeight: "600" }],
        "heading-40": ["40px", { lineHeight: "48px", letterSpacing: "-2.4px", fontWeight: "600" }],
        "heading-48": ["48px", { lineHeight: "56px", letterSpacing: "-2.88px", fontWeight: "600" }],
        // Geist labels (single-line, scannable; weight 400)
        "label-12": ["12px", { lineHeight: "16px" }],
        "label-13": ["13px", { lineHeight: "16px" }],
        "label-14": ["14px", { lineHeight: "20px" }],
        "label-16": ["16px", { lineHeight: "24px" }],
        "label-20": ["20px", { lineHeight: "32px" }],
        // Geist copy (multi-line body; weight 400, taller leading)
        "copy-13": ["13px", { lineHeight: "18px" }],
        "copy-14": ["14px", { lineHeight: "20px" }],
        "copy-16": ["16px", { lineHeight: "24px" }],
        "copy-24": ["24px", { lineHeight: "36px" }],
        // Geist buttons (medium weight)
        "button-12": ["12px", { lineHeight: "16px", fontWeight: "500" }],
        "button-14": ["14px", { lineHeight: "20px", fontWeight: "500" }],
        "button-16": ["16px", { lineHeight: "20px", fontWeight: "500" }]
      },

      borderRadius: {
        sm: "var(--radius-sm)", // 6px — everyday surfaces + controls
        md: "var(--radius-md)", // 12px — menus + modals
        lg: "var(--radius-lg)", // 16px — fullscreen surfaces
        full: "9999px"
      },

      boxShadow: {
        "geist-sm": "var(--shadow-sm)",
        "geist-md": "var(--shadow-md)",
        "geist-lg": "var(--shadow-lg)"
      },

      transitionTimingFunction: {
        geist: "cubic-bezier(0.175, 0.885, 0.32, 1.1)"
      },

      maxWidth: {
        page: "var(--page-max-width)"
      },

      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" }
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" }
        }
      },

      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out"
      }
    }
  },
  plugins: [animate]
};

export default config;
