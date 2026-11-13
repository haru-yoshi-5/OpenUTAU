import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  fmt: {
    ignorePatterns: ["dist/**", "public/samples/**"],
  },
  lint: {
    ignorePatterns: ["dist/**"],
    plugins: ["typescript", "unicorn", "oxc", "react", "jsx-a11y", "vitest"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
