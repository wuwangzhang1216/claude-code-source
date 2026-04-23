/**
 * Bun preload plugin for running Claude Code from source.
 *
 * Handles two compile-time features that don't exist at runtime:
 * 1. bun:bundle - Feature flag system (DCE at build time)
 * 2. MACRO.* - Build-time constants inlined by the bundler
 */

import { plugin } from "bun";

// Shim bun:bundle's feature() to return false for all feature flags.
// In the official build, feature() is evaluated at compile time and
// dead code is eliminated. At runtime, we just disable all gates.
plugin({
  name: "bun-bundle-shim",
  setup(build) {
    build.module("bun:bundle", () => {
      return {
        exports: {
          feature: (_name: string) => false,
        },
        loader: "object",
      };
    });
  },
});

// MACRO.* globals are inlined at build time by Bun's bundler.
// We define them as runtime globals instead.
(globalThis as any).MACRO = {
  VERSION: "2.1.113",
  ISSUES_EXPLAINER: "https://github.com/anthropics/claude-code/issues",
};
