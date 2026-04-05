# Changelog

All notable changes tracked here. This is a local/educational source mirror of Claude Code, not an official release stream.

## 2.1.89 — April 1, 2026

This release applies the **user-facing, tractable subset** of the upstream 2.1.89 changelog. See "Applied" and "Not applied (upstream-only)" sections below.

### Applied in this local source tree

- Added `CLAUDE_CODE_NO_FLICKER=1` environment variable (read at startup; wired through to the renderer as a feature flag).
- Added `MCP_CONNECTION_NONBLOCKING=true` for `-p` mode to skip the MCP connection wait entirely; bounded `--mcp-config` server connections at 5s at bootstrap time.
- Added `"defer"` permission decision to `PermissionBehavior` and a `PermissionDeferDecision` type (for headless `-p --resume` pause/re-evaluate semantics).
- Added `showThinkingSummaries` setting (defaults to `false` — opt-in to restore thinking summaries in interactive sessions).
- Rejected `cleanupPeriodDays: 0` in settings validation with an actionable error message.
- Fixed `Edit`/`Write` tools doubling CRLF on Windows and stripping Markdown hard line breaks (two trailing spaces).
- Improved collapsed tool summary to show "Listed N directories" for `ls`/`tree`/`du` instead of "Read N files".
- Improved `@`-mention typeahead to rank source files above MCP resources and include named subagents.
- Image paste no longer inserts a trailing space.
- Preserved task notifications when backgrounding a running command with Ctrl+B.
- `/usage` now hides the redundant "Current week (Sonnet only)" bar for Pro and Enterprise plans.
- `PreToolUse`/`PostToolUse` hooks now receive `file_path` as an absolute path for `Write`/`Edit`/`Read` tools.
- Bumped local source version to `2.1.89` (from `2.1.88`).

### Not applied (upstream-only internal fixes)

These items from the upstream changelog require forensic access to internals not faithfully present in the deobfuscated source, or are platform-specific infra fixes:

- Prompt-cache byte-level fixes, tool-schema cache bytes mid-session
- LSP server zombie-state restart
- Memory leak from large-JSON LRU cache keys
- Crash removing message from >50MB session files, out-of-memory on Edit of >1GiB files
- `~/.claude/history.jsonl` 4KB CJK/emoji boundary truncation
- Devanagari combining-mark truncation, iTerm2/tmux streaming jitter, main-screen render artifacts
- macOS `claude-cli://` deep-link handling, Apple-Silicon voice mic perms
- Shift+Enter on Windows Terminal Preview 1.25, PowerShell 5.1 stderr-progress misclassification
- Autocompact thrash loop detection, nested CLAUDE.md re-injection, prompt cache misses in long sessions
- Several smaller rendering/notification/prompt-history infra fixes
- `/buddy` April Fool's command (explicitly skipped per user)

See upstream Anthropic Claude Code 2.1.89 release notes for full details.
