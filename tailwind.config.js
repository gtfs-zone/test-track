/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{html,js,ts}", "./dist/**/*.html"],
  theme: {
    extend: {},
  },
  plugins: [require("daisyui")],
  daisyui: {
    themes: ["light", "dark", "business", "night", "dracula", "coffee", "dim", "nord", "abyss"],
    darkTheme: "night",
    base: true,
    styled: true,
    utils: true,
  },
}
