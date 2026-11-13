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
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      // テスト用のアサーション関数（内部で expect を呼ぶ）
      "vitest/expect-expect": ["warn", { assertFunctionNames: ["expect", "expectUstxError"] }],
    },
    options: { typeAware: true, typeCheck: true },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
