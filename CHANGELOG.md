# Changelog

All notable changes tracked here. This is a local/educational source mirror of Claude Code, not an official release stream.

## 2.1.139 — May 11, 2026

Folds the user-facing, tractable subset of upstream `2.1.139`. New top-level commands (`/goal`, `/scroll-speed`, `claude agents`, `claude plugin details`) and the bulk of the Ink/UI rendering fixes (cursor blink, transcript shortcuts, scroll behavior, CJK/emoji width, ProgressBar, hyperlink theme contrast, multi-image paste, mouse-wheel scrolling) need infrastructure this mirror doesn't reproduce and stayed unapplied.

### Applied in this local source tree

- **Compaction prompt instructs the model to preserve sensitive user instructions verbatim** — the "Primary Request and Intent" section in `BASE_COMPACT_PROMPT`, `PARTIAL_COMPACT_PROMPT`, and `PARTIAL_COMPACT_UP_TO_PROMPT` now explicitly tells the summarizer to copy security constraints, do-not-do rules, behavioral directives, and credentials/access policies into the summary unchanged, so guardrails continue to be enforced after `/compact` (`src/services/compact/prompt.ts`).
- **`autoAllowBashIfSandboxed` now auto-approves commands with shell expansions** — `$VAR` / `$(cmd)` / backtick / control-flow commands tokenize as `too-complex` from the tree-sitter security parser, which short-circuited to `behavior: 'ask'` before the sandbox auto-allow check ran. The too-complex branch now consults `checkSandboxAutoAllow` (which still respects explicit deny/ask rules and the dangerous-`rm` containment check) before falling through to ask, matching the simple-parse branch's flow (`src/tools/BashTool/bashPermissions.ts`).
- **Settings hot-reload detects edits to symlinked `~/.claude/settings.json`** — `getWatchTargets` now resolves each settings path via `fs.promises.realpath`. When the target differs from the symlink (Dropbox / dotfiles / external syncs), the target's directory is added to chokidar's watch set and the realpath is registered in `symlinkTargetToSource` so change events on the realpath route back to the symlink's logical `SettingSource` (`src/utils/settings/changeDetector.ts`).
- **`Skill(name *)` permission rules work as a prefix match** — added a third matcher branch alongside the existing exact and `name:*` forms. Trailing-` *` rules now match the bare skill name and any space-extended form (`Skill(review *)` covers both `review` and `review pr`), mirroring `Bash(ls *)` behaviour. Order is exact → `:*` → ` *` so existing rule semantics are unchanged (`src/tools/SkillTool/SkillTool.ts`).
- **Two-file diff snippets stop over-reporting truncated lines by one** — the truncation cut already aligns on a `\n` boundary, so the `+1` borrowed from `BashTool`'s arbitrary-byte truncation (which compensates for a partial trailing line that doesn't exist when cutting on a newline) inflated the hidden-line count. Removed for line-boundary cuts (`src/tools/FileEditTool/utils.ts`).
- **Skill argument substitution escapes regex metacharacters in argument names** — frontmatter `arguments: foo.bar` previously compiled into `new RegExp('\\$foo.bar(?![\\[\\w])')`, where `.` matched any character. Names are now escaped before the regex is built, and the replacement is passed via a function callback so `$&` / `$1` patterns in argument values aren't re-interpreted as backreferences (`src/utils/argumentSubstitution.ts`).
- **MCP stdio servers receive `CLAUDE_PROJECT_DIR` in their environment** — matches the hook contract introduced in earlier releases. Plugin configs can now also reference `${CLAUDE_PROJECT_DIR}` literally inside `command` / `args` and the placeholder is substituted at spawn time (no shell needed) — useful for plugin MCP servers whose binary lives inside the user's project (`src/services/mcp/client.ts`).
- **`/model` picker "Default" row reflects `ANTHROPIC_DEFAULT_OPUS_MODEL` / `ANTHROPIC_DEFAULT_SONNET_MODEL` overrides** — `getClaudeAiUserDefaultModelDescription` previously hard-coded "Opus 4.6" / "Sonnet 4.6" labels for Max/Team Premium and PAYG 1P, masking any env override. The label now honors `ANTHROPIC_DEFAULT_*_MODEL_NAME` (falling back to `renderModelName(getDefaultOpusModel())` / `renderModelName(getDefaultSonnetModel())`) when an override is set (`src/utils/model/model.ts`).
- **Spurious "stream idle timeout" 5 minutes after a response completed** — `queryModel` allocated the streaming-watchdog `setTimeout` handles inside the inner try block, so `clearStreamIdleTimers()` was only reachable from the inner catch/finally. When the generator was cancelled before entering the stream loop (consumer `.return()`, abort signal during stream creation, or an exception bubbling out of the outer catch), the timer kept running and logged a watchdog fire long after the response was already done. Hoisted `outerStream*Timer` refs above the outer try, mirrored each `setTimeout` into them, and added `clearOuterStreamIdleTimers()` to the outer `finally` as a belt-and-suspenders clear (`src/services/api/claude.ts`).
- **`@server:` autocomplete no longer surfaces resources from disconnected servers** — `useTypeahead` now derives a `connectedServerNames` `Set` from `s.mcp.clients` (filtered to `type === 'connected'`) and threads it through `generateUnifiedSuggestions`. Resources owned by absent / failed / disconnected servers are filtered out before scoring, so stale entries that linger in `s.mcp.resources` until the next dispose pass no longer pollute results (`src/hooks/unifiedSuggestions.ts`, `src/hooks/useTypeahead.tsx`).
- **Bumped local source version to `2.1.139`** (from `2.1.138`) — `package.json` and `preload.ts` MACRO.

### Not applied (upstream-only or out of scope)

- **New top-level commands (`/goal`, `/scroll-speed`, `claude agents`, `claude plugin details`)** — each needs nontrivial Ink/UI infrastructure (overlay panel for `/goal`'s live elapsed/turns/tokens; mouse-wheel preview UI for `/scroll-speed`; session aggregation across processes for the agent view; component-inventory + per-session token cost projection for `plugin details`).
- **Transcript view navigation (`?`, `{` / `}`, `v` shortcuts)** — Ink keystroke routing inside the transcript renderer is out of scope.
- **Hook `args: string[]` exec form** — adding the schema field is trivial, but it would change the hook spawn path from `exec` (shell) to `spawn` (direct argv) and depends on the hook-runner internals that the local fork already diverges from in subprocess env handling.
- **Hook `continueOnBlock` for PostToolUse** — needs hook-protocol semantics changes (feeding the rejection reason back to the turn) plus per-hook config plumbing into `executeToolHooks`.
- **`/mcp` Reconnect picking up `.mcp.json` edits without a restart + HTTP status / URL on failure** — requires reloading server configs in-place and surfacing transport status codes that the local mirror's `useManageMCPConnections` flow doesn't expose.
- **`/context all` per-skill token estimates using model tokenizer + rounded** — depends on the tokenizer-cost UI feature that isn't wired in this mirror.
- **`claude plugin install <name>@<marketplace>` auto-refreshing the marketplace before reporting not found** — would change marketplace fetch + retry semantics across an obfuscated section.
- **`/plugin installed-plugin details` clean rendering of hook event names + MCP server names** — Ink rendering pass.
- **`/context` showing the providing plugin's name for plugin-sourced skills** — Ink rendering field plumbing only.
- **Remote MCP reconnect retry on transient failures now enabled for all users** — the local mirror does not gate it; this is a no-op here.
- **Subagent `x-claude-code-agent-id` / `x-claude-code-parent-agent-id` HTTP headers + `agent_id` / `parent_agent_id` OTEL span attributes** — would touch the API request layer and span emission across the agent execution graph; defer until we can audit the full propagation chain.
- **Disabling Remote Control / `/schedule` / claude.ai MCP connectors / notification preferences when `ANTHROPIC_API_KEY` / `apiKeyHelper` / `ANTHROPIC_AUTH_TOKEN` is set** — broad conditional gate spanning several services; the safer pass is one change at a time.
- **Expired credentials + `forceRemoteSettingsRefresh` policy blocking auth login/logout/status** — auth refresh + remote-settings cache deadlock in obfuscated source.
- **Hook writes corrupting on-screen interactive prompts (hooks now run without terminal access)** — child stdio handling change that ripples through hook spawn + REPL render coordination.
- **Capping SSE response bodies at 16 MB per frame for HTTP/SSE MCP transports** — obfuscated SSE transport layer.
- **Settings hot-reload edge: symlinked drop-in directory (`managed-settings.d/`)** — only the file-level symlink case is applied; symlinked drop-in directories would need the same realpath treatment for the drop-in dir itself.
- **`claude_code.active_time.total` OTEL metric not emitted in `--print` mode** — `--print` path metric registration lives in code we don't fully exercise here.
- **`claude plugin update` not preserving cross-plugin symlinks inside a marketplace** — plugin sync layer.
- **Plugin dependency stale count when manifest name differs from source identifier** — plugin-dep accounting bug; needs deeper rework of the dep graph than a localized fix supports.
- **Insights Time-of-Day chart skew on unparseable timestamps; `--print` mode metric** — Insights renderer.
- **Keybindings with only cmd/super/win modifier flagged as unparseable** — keybinding parser allows-the-modifier-alone change; risk of regressing real parse errors.
- **Cache-dir-unwritable silent exit when 10+ MCP servers configured** — depends on early-startup MCP cache initialization that's mostly opaque here.
- **Pasting / dropping multiple images only inserting the last one** — Ink paste handler internals.
- **Hyperlink color adapting to active theme on dark themes** — theme context propagation into the link renderer.
- **Model picker redundant "Current model" row for 3P opus alias; legacy Opus picker entry for PAYG 3P resolving to the default entry** — both depend on the 3P provider catalog reading logic and the picker option-merging code path.
- **All other Ink / UI rendering bugs** (cursor blink on tab names + list pointers, transcript letter shortcuts after mouse click, Bash-mode up-arrow history repeating first entry, mouse-wheel speed in Cursor / VS Code, scroll behavior in Windows Terminal + VS Code background sessions, border-embedded CJK / emoji overflow, fuzzy-match highlight splitting emoji, ProgressBar fractional cell rendering, two-file diff over-truncation [also covered above], Grep result Windows drive-letter relativization).
- **Task polling / `fs.watch` being resurrected when last subscriber leaves while a fetch is in flight** — task polling lifecycle change in a subscriber ref-counting layer this mirror doesn't fully reproduce.
- **`[VSCode] Cmd/Ctrl+Shift+T` reopens recently closed session tab** — extension-only.

---

## 2.1.138 — May 9, 2026

Single-bump pulls the user-facing, tractable subset of upstream `2.1.136`. Upstream `2.1.137` was a VS Code Windows hotfix and `2.1.138` was "Internal fixes" — neither reproduces here.

### Applied in this local source tree

- **`CLAUDE_CODE_ENABLE_FEEDBACK_SURVEY_FOR_OTEL=1` re-enables the session-quality survey for OTel-only enterprises** — `isFeedbackSurveyDisabled()` previously returned `true` whenever `isTelemetryDisabled()` did, which silently dropped the survey for orgs that only have OTLP analytics. The env var now overrides that suppression so OTLP pipelines see the same survey events as 1P telemetry would. `NODE_ENV=test` still wins and `isTelemetryDisabled()` without the opt-in still hides the survey (`src/services/analytics/config.ts`).
- **`/branch <multi-line name>` saves a single-line session title** — collapse whitespace runs to a single space before persisting. Matches what `deriveFirstPrompt` already does for the auto-derived path. Without this, a pasted multi-line value would break the `/resume` picker layout and show raw newlines in the session list (`src/commands/branch/branch.ts`).
- **`AskUserQuestion` accepts array answers for multi-select** — input schema's `answers` value is now `string | string[]` with a Zod transform that joins arrays with `", "`. SDK hosts and bridge clients that submit `{ "Pick languages?": ["Go", "Rust"] }` instead of `"Go, Rust"` are no longer silently dropped. Output shape (the model-visible side) stays `Record<string, string>` — the transform normalizes during input parsing (`src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx`).
- **Plugin `uninstall` / `enable` / `disable` match slugs case-insensitively** — `findPluginInSettings` and `findPluginByIdentifier` now compare lower-cased names. Users who type `claude plugin disable Foo` (display-name casing) no longer see the silent no-op when the persisted slug is `foo`. The original casing of the persisted key is preserved in the returned `pluginId` so downstream `enabledPlugins` writes still hit the correct entry (`src/services/plugins/pluginOperations.ts`).
- **Bumped local source version to `2.1.138`** (from `2.1.133`) — `package.json` and `preload.ts` MACRO.

### Not applied (upstream-only or out of scope)

- `settings.autoMode.hard_deny` classifier rules — adding the schema field is easy but wiring it into the classifier (so unconditional denies actually bypass user-intent and allow-rule exceptions) requires touching `yoloClassifier.ts` enforcement in ways the obfuscated decision path doesn't surface cleanly.
- MCP servers from `.mcp.json` / plugins / claude.ai connectors silently disappearing after `/clear` in VS Code / JetBrains / Agent SDK — host-integration-specific path not exposed in this mirror.
- Concurrent credential-write OAuth refresh race; concurrent MCP-OAuth refresh-token loss — auth refresh layer in obfuscated source.
- API 400 when extended thinking emits a redacted thinking block after a tool call; `--resume` / `--continue` not finding sessions when project path contains underscores; plan mode not blocking writes against a matching `Edit(...)` allow rule; WSL2 PowerShell image-paste fallback; plugin Stop / UserPromptSubmit hooks failing when cache cleanup deletes an in-use version; colors at wrong positions in bash output / markdown code blocks; ReasonML diff "undefined" artifacts; worktree exit dialog wrong-directory warning; `@`-mention file picker mid-session / >100-entry edge cases; truncated tool calls not click-to-expand in fullscreen; Backspace / Ctrl+Backspace swap after Ctrl+G; `/usage` weekly reset showing time instead of date; CJK welcome banner overflow; `/insights` crash on malformed tool input; renderer crash on collapsibility-class change; plugin manifest `skills` entry hiding default `skills/` directory; IDE shell-integration lock files not respecting `CLAUDE_CONFIG_DIR`; trailing whitespace on streaming copy; tool-error truncation negative count for surrogate pairs; `CLAUDE_ENV_FILE` `SessionStart` env-var staleness after `/resume`/`/clear`; stray leading space on wrapped text; Esc not dismissing several dialogs; `/doctor` MCP schema error formatting; Bash permission-prompt parser-diagnostic surfacing; plugin slash commands with spaces (`/myplugin review`); `/clear <name>` not labeling cleared session; `CronList` qualifier output; CJK "Jump to bottom" color artifacts; wide-table stale render; pasted-text truncation silently dropping content; `/release-notes` stuck on old version; `/mcp` server list scrolling; mid-input slash autocomplete; auto-follow re-engage with `autoScrollEnabled: false`; prompt-suggestion Enter-submit; keyboard-shortcut hints not reflecting rebinds; `/settings` language reverted on Escape; `/terminal-setup` autocomplete partial-prefix; "Chat about this" erasing question; MCP content-block results invisible; `--worktree` collision error message copy; plugin-marketplace removal key change `r` → `d`; `[VSCode] claudeProcessWrapper`-style host fixes — Ink rendering / native-build / Windows / SDK / host-integration / obfuscated UI internals.

---

## 2.1.133 — May 7, 2026

Folds the user-facing, tractable subset of upstream `2.1.133`.

### Applied in this local source tree

- **`worktree.baseRef` setting (`fresh` | `head`)** — adds a settings key under the existing `worktree` block that controls the base ref for `--worktree`, `EnterWorktree`, and agent-isolation worktrees. **The default is now `fresh`**, which restores the upstream pre-2.1.128 behaviour: new worktrees branch from `origin/<default-branch>`. Users who want unpushed commits to carry over (the local mirror's 2.1.128 default) can set `"worktree": { "baseRef": "head" }` (`src/utils/settings/types.ts`, `src/utils/worktree.ts`).
- **Hooks and Bash tool see the active effort level via `$CLAUDE_EFFORT`** — `subprocessEnv()` injects `CLAUDE_EFFORT=<level>` whenever the user has set an explicit effort (env override or persisted setting). Resolution is settings + `CLAUDE_CODE_EFFORT_LEVEL` only — the model-default fallback is skipped so hooks don't see a level the user didn't ask for. Bash tool commands inherit it via the standard `subprocessEnv()` call (`src/utils/effort.ts`, `src/utils/subprocessEnv.ts`).
- **Hooks JSON payload gains `effort: { level }`** — `createBaseHookInput` adds the field when an explicit effort is set (omitted otherwise so existing hooks don't have to special-case "auto"). Lazy-require avoids cyclic imports between `hooks.ts` and `effort.ts` (`src/utils/hooks.ts`).
- **`claude --help` now lists `--remote-control`** — dropped `.hideHelp()` from `--remote-control [name]`. The `--rc` alias stays hidden so completion noise stays low. Documentation already referenced the flag; the help output and docs now agree (`src/main.tsx`).
- **Bumped local source version to `2.1.133`** (from `2.1.132`) — `package.json` and `preload.ts` MACRO.

### Not applied (upstream-only or out of scope)

- `sandbox.bwrapPath` / `sandbox.socatPath` managed settings — bubblewrap is Linux/WSL only and the sandbox-adapter binary-discovery layer in this mirror doesn't expose a hookable override.
- `parentSettingsBehavior` admin-tier key (`first-wins` | `merge`) for SDK managedSettings — SDK parent-tier settings plumbing is in the SDK host code not reproduced here.
- Improved focus mode behavior; warm-spare background worker memory-pressure releases; mapped-network-drive Edit/Write/Read on Windows; Remote Control stop/interrupt from claude.ai not fully cancelling; `/effort` cross-session race; subagents not discovering project/user/plugin skills via the Skill tool; Esc during compaction spurious error notification; HTTP(S)_PROXY / NO_PROXY / mTLS for the full MCP OAuth flow; refresh-token race wiping shared credentials; Edit/Write allow rules scoped to a drive root or POSIX `/`; ECOMPROMISED file lock; `[VSCode] claudeProcessWrapper` — Ink / native-build / Windows / SDK / VS Code internals.

---

## 2.1.132 — May 6, 2026

Folds the user-facing, tractable subset of upstream `2.1.132` (2.1.130 was a VS Code Windows hotfix + Mantle endpoint x-api-key — neither reproduces here; 2.1.131 was an internal patch).

### Applied in this local source tree

- **`CLAUDE_CODE_SESSION_ID` is now exposed to every subprocess** — moved from a narrow `USER_TYPE === 'ant'`-only injection in `Shell.ts` into `subprocessEnv()`, so Bash, hooks, MCP stdio, LSP, and shell-snapshot processes all see the same `session_id` the hooks payload already carries. Skipped when `getSessionId()` is still undefined during early startup so children never see the literal string `"undefined"` (`src/utils/subprocessEnv.ts`, `src/utils/Shell.ts`).
- **`CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN=1` opts out of the fullscreen alt-screen renderer** — layered above `CLAUDE_CODE_NO_FLICKER` and the `tui` setting in `isFullscreenEnvEnabled()`, so it wins over both. Useful for users who want the conversation to stay in native terminal scrollback (copy/paste, scroll-up workflows) even when the renderer would otherwise pick fullscreen (`src/utils/fullscreen.ts`).
- **Bedrock and Vertex no longer hit 400s when `ENABLE_PROMPT_CACHING_1H` is set** — `should1hCacheTTL()` now returns `false` early for any non–first-party provider, so the `cache_control: { ttl: '1h' }` beta extension is never sent to Bedrock/Vertex/Foundry/`ANTHROPIC_BASE_URL` gateways that don't yet accept it. Bedrock still has the dedicated `ENABLE_PROMPT_CACHING_1H_BEDROCK` opt-in. First-party users keep the GrowthBook-allowlisted 1h TTL (`src/services/api/claude.ts`).
- **Pasting text starting with `/` no longer silently swallowed** — slash-command parsing in both `handlePromptSubmit` and `processUserInput.runProcessUserInput` now gates on the *typed* prompt (`input` / `preExpansionInput`) starting with `/`, not just the post-expansion `finalInput` / `inputString`. Previously, pasting `/usr/local/bin/foo` into an empty prompt expanded the placeholder into a string beginning with `/`, hit the slash-command lookup, and was either silently dropped or surfaced as "Unknown command" (`src/utils/handlePromptSubmit.ts`, `src/utils/processUserInput/processUserInput.ts`).
- **MCP `tools/list` retries once before giving up** — `fetchToolsForClient` now wraps the first `tools/list` request in a try/catch and retries once with a 250 ms backoff. Some MCP servers establish the session quickly enough to look "connected" but fail their first `tools/list` (slow registry warm-up, racy initialisation). The one-shot retry rescues those without changing the outcome for persistent failures, which still throw to the outer catch and log "Failed to fetch tools" (`src/services/mcp/client.ts`).
- **Bumped local source version to `2.1.132`** (from `2.1.129`) — `package.json` and `preload.ts` MACRO.

### Pre-aligned (already correct in this mirror)

- **`/effort` picker reflects `CLAUDE_CODE_EFFORT_LEVEL` env override** — `showCurrentEffort()` already consults `getEffortEnvOverride()` before falling back to AppState; nothing to change.

### Not applied (upstream-only or out of scope)

- "Pasting…" footer hint while a Ctrl+V image paste is being read — Ink prompt-footer rendering.
- External SIGINT (IDE stop button, `kill -INT`) running graceful shutdown — handler already exists and calls `gracefulShutdown()` for non-print mode SIGINT; the specific race upstream fixed isn't identifiable without more context.
- Uncaught exception on terminal close / SSH disconnect under the native build — native build crash recovery.
- `--resume` "no low surrogate in string" emoji split sanitization — session JSONL parsing in obfuscated path.
- `--permission-mode` ignored with `-p --continue/--resume` in plan mode — permission-mode wiring across the resume path.
- Fullscreen blank screen after sleep/wake or Ctrl+Z/fg; cursor mid-grapheme on Ctrl+E/A/K/U/arrows; bold headers with keycap/ZWJ/skin-tone emoji truncation; long-URL wrapped-row click; mouse wheel speed in Cursor / VS Code 1.92–1.104; JetBrains 2025.2 scroll wheel; bracketed-paste interleaving with focus/mouse events; `/agents` Library arrow nav; slash-command autocomplete popup height; statusline `context_window` cumulative totals; `/usage Ctrl+S` Linux/X11 clipboard hang; `/terminal-setup` Windows Terminal contradiction; `/status` default-model display; slash-command dialog spacing; `/tui` startup banner copy; Alt+T thinking toggle on macOS terminals without "Option as Meta"; dead Windows keyboard input after re-opening a background session — Ink rendering / terminal-input / native-build / UI internals.
- vim operators corrupting NFD-decomposed accented characters — grapheme-aware operator implementation in upstream vim engine.
- Unbounded memory growth when an MCP stdio server writes non-protocol data to stdout — stdio transport buffer in upstream MCP SDK.
- Unauthorised claude.ai connectors showing "failed" instead of "needs auth"; headless `-p` retrying non-transient 4xx connection failures — claude.ai-MCP connector state machine + headless retry policy.
- Bedrock/Vertex `400 ENABLE_PROMPT_CACHING_1H` — applied above.
- `2.1.131` VS Code extension Windows activation (hardcoded build path in bundled SDK) and Mantle endpoint `x-api-key` — neither code path exists in this mirror (no VS Code extension build, no Mantle integration).

---

## 2.1.129 — May 6, 2026

Applies the user-facing, tractable subset of upstream `2.1.129`.

### Applied in this local source tree

- **`CLAUDE_CODE_FORCE_SYNC_OUTPUT=1` force-enables DEC mode 2026 synchronized output** — bypasses the env-based detection in `isSynchronizedOutputSupported()` for terminals our heuristics miss (Emacs `eat`, niche emulators that proxy BSU/ESU correctly but don't advertise themselves via `TERM`/`TERM_PROGRAM`). The escape passes through harmlessly on terminals that ignore it, so opt-in is safe (`src/ink/terminal.ts`).
- **Spinner tips: gate first-party-surface tips on `is1PApiCustomer()`** — `guest-passes` (refers to `/passes`, a claude.ai referral surface) and `overage-credit` (refers to `/extra-usage`) now bail out for Bedrock/Vertex/Foundry/`ANTHROPIC_BASE_URL` gateway deployments, where those surfaces don't exist. Matches the existing `is1PApiCustomer()` gate already on the other claude.ai-only tips (`src/services/tips/tipRegistry.ts`).
- **Unrecognized 400 API errors show the underlying message instead of the raw JSON body** — when the Anthropic SDK falls back to JSON-stringifying the response body into `APIError.message` (e.g. `400 {"type":"error","error":{"message":"…"}}`), `sanitizeAPIError` now extracts the inner `error.message` (both Anthropic's `error.error.message` and Bedrock's `error.message` shapes) before HTML-sanitizing it. Matches the existing JSONL-deserialization recovery path; users see the actual reason instead of a JSON dump (`src/services/api/errorUtils.ts`).
- **`deniedMcpServers` wildcard patterns are case-insensitive** — `urlPatternToRegex` now compiles with the `i` flag. URL schemes and hostnames are case-insensitive per RFC 3986, so a denylist entry with a `*://` scheme wildcard previously failed to match `HTTPS://API.Example.com` and admins' policy could be bypassed by varying case. Case-insensitivity is slightly broader than strict HTTP (it covers the path too) — that's the safer direction for a denylist (`src/services/mcp/config.ts`).
- **Policy refusal errors include the API Request ID** — `getErrorMessageIfRefusal` now takes an optional `requestId` and appends `(Request ID: …)` to the user-facing message; the streaming call site in `claude.ts` passes `streamRequestId` through. Users hitting a content-policy refusal that looks wrong can now copy the ID directly into a support ticket without grepping for it in `--debug` output (`src/services/api/errors.ts`, `src/services/api/claude.ts`).
- **`claude_code.pull_request.count` OTel metric counts PRs/MRs created via MCP tools** — added `trackMcpPrCreate(toolName)` and `isMcpPrCreateToolName(toolName)` helpers in `gitOperationTracking.ts`. The regex `(?:^|_)(create[_-]?pull[_-]?request|create[_-]?merge[_-]?request|create[_-]?pr)$` matches the convention used by the major Git-host MCP servers (`mcp__github__create_pull_request`, `mcp__gitlab__create_merge_request`, `mcp__bitbucket__create_pull_request`, and per-org variants like `mcp__github_acme__create_pull_request`). Called from `toolExecution.ts` on successful MCP-tool invocations only (`src/tools/shared/gitOperationTracking.ts`, `src/services/tools/toolExecution.ts`).
- **Bumped local source version to `2.1.129`** (from `2.1.128`) — `package.json` and `preload.ts` MACRO.

### Not applied (upstream-only or out of scope)

- `--plugin-url <url>` for fetching `.zip` plugin archives — the local plugin loader doesn't have the URL-fetch / archive-extract dispatch upstream relies on; `--plugin-dir` is the only entry point here.
- `CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE` (Homebrew / WinGet upgrade-in-background-then-prompt-restart) — package-manager-driven update flow lives in installer/auto-update code not surfaced in this mirror.
- Plugin manifests: `themes` / `monitors` declared under `experimental: { … }` with a warning from `claude plugin validate` — `PluginManifestSchema` here does not yet expose those keys, so there's no migration to warn about.
- Gateway `/v1/models` discovery now opt-in via `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1` — the discovery path was upstream-only in 2.1.126–128 and wasn't ported to this mirror; nothing to gate.
- `Ctrl+R` history picker defaulting to all-projects / all-sessions (Ctrl+S to narrow) — Ink history-picker UI in obfuscated source.
- `skillOverrides` (`off` / `user-invocable-only` / `name-only`) — setting not present in this mirror's settings schema.
- `/clear` resetting terminal tab title; `/rename` chip surviving overlays; agent panel below prompt; `/context` ASCII grid dump; `/agents` Library arrow nav; `/branch` session-id in success message; bold headers + keycap/ZWJ/skin-tone emoji truncation; `/agents` Library arrow nav; external-editor Ctrl+G blanking conversation; `/clear` in VSCode — Ink rendering / commands behind compiled UI code.
- Server-managed settings policy not applying for OAuth credentials lacking `user:inference` scope; OAuth refresh race after wake-from-sleep; 1-hour prompt cache TTL silent downgrade; cache-miss false positive after `/clear` or compaction; harmless WebSocket warning logged as error in `--debug` voice mode — auth / streaming / cache / voice internals in obfuscated source.
- `Bash(mkdir *)` / `Bash(touch *)` allow rules not honoured for in-project paths — the in-project-path matcher these rules expect isn't part of this mirror's Bash permission classifier.

---

## 2.1.128 — May 4, 2026

Folds the user-facing, tractable subset of upstream `2.1.128` (2.1.127 was a one-line hotfix that doesn't reproduce here).

### Applied in this local source tree

- **Bare `/color` picks a random session color** — instead of printing the available-colors list, an empty `/color` now rerolls. Pool excludes the current color so the reroll always actually changes something; persists via `saveAgentColor` like an explicit pick (`src/commands/color/color.ts`).
- **Subprocesses no longer inherit `OTEL_*` env vars** — `subprocessEnv()` strips every `OTEL_*` key unconditionally (not gated on `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`, since this is about telemetry isolation, not secret hygiene). Prevents OTEL-instrumented apps invoked through Bash/MCP/LSP/hooks from picking up the CLI's OTLP endpoint, sample rate, service name, etc. — flooding the user's Claude Code session telemetry with the child app's spans (`src/utils/subprocessEnv.ts`).
- **MCP: `workspace` is now a reserved server name** — `isReservedMcpServerName()` helper added to `mcp/config.ts`; `addMcpConfig()` rejects an attempt to create a `workspace` server with the same "this name is reserved" error used for `claude-in-chrome` and computer-use. `getClaudeCodeMcpConfigs()` also skips any already-persisted `workspace` entry with a `logError` warning so a stale settings.json doesn't shadow the built-in (`src/services/mcp/config.ts`).
- **`EnterWorktree` branches from local `HEAD` instead of `origin/<default-branch>`** — the previous behaviour forked from the remote tip, which silently dropped any unpushed commits the user had on top of main and required a fetch round-trip on every new worktree. The non-PR path now uses `HEAD` directly; the PR-fetch path still uses `FETCH_HEAD`. Dropped the now-unused `getDefaultBranch` / `resolveRef` imports from this file (`src/utils/worktree.ts`).
- **Auto mode classifier "unavailable" message includes actionable next steps** — `buildClassifierUnavailableMessage()` appends a trailing line suggesting retry / `/compact` / `--debug`, the three things users would naturally try in order (retry first, shrink the classifier transcript if it persists, capture a debug log if it still fails). The existing "wait briefly" guidance stays since some failures are transient backend issues (`src/utils/messages.ts`).
- **Bedrock default model: prefer the region-appropriate prefix over `global.anthropic.*`** — `getBedrockInferenceProfiles()` often returns `global.anthropic.<model>` before any regional alternative, and the old `findFirstMatch` substring search picked whichever came first. Added `findBestMatch(profiles, needle)` that maps `AWS_REGION` to its prefix (`us-*` → `us`, `eu-*` → `eu`, `ap-*` → `apac`) and prefers a profile with that prefix, falling back to any non-`global.*` match before `global.*`. `getBedrockModelStrings()` now uses `findBestMatch`. Avoids accidentally cross-region routing for accounts that need EU/APAC residency (`src/utils/model/bedrock.ts`, `src/utils/model/modelStrings.ts`).
- **vim `<Space>` in NORMAL mode moves cursor right** — matches stock `vi`/`vim` behaviour. Added `' '` alongside `'l'` in `applySingleMotion` and to `SIMPLE_MOTIONS` so it composes with counts and operators (e.g. `5<Space>` moves right five characters, `d<Space>` deletes the character to the right) (`src/vim/types.ts`, `src/vim/motions.ts`).
- **Bumped local source version to `2.1.128`** (from `2.1.126`) — `package.json` and `preload.ts` MACRO.

### Not applied (upstream-only or out of scope)

- `/model` picker collapsing duplicate Opus 4.7 entries / showing current Opus as "Opus" — the mirror's current Opus is 4.6 and already labelled "Opus" via `getOpus46Option`; there are no Opus 4.7 entries to collapse.
- `/mcp` showing tool counts and flagging connected-with-0-tools servers — `/mcp` view in obfuscated Ink components.
- `--plugin-dir` accepting `.zip` plugin archives — plugin loader's directory-walk path is the entry point; zip-extract integration would land in `pluginLoader.ts` but the local mirror's plugin loader does not have the file-vs-archive dispatch hooks the upstream change relies on.
- `--channels` with console (API key) authentication + `channelsEnabled: true` for managed orgs — channels feature gating lives in auth code paths not surfaced in this mirror.
- MCP reconnect tool-name flood summarised by server prefix — reconnect/announce path in obfuscated source.
- SDK hosts receiving a persistent `localSettings` suggestion for Bash permission prompts — SDK permission-prompt plumbing.
- Auto-mode spinner colour, focus-mode dimming, OSC 9 ("4;0;") stray notification on `/exit`, Remote-Control rate-limit empty message, drag-and-drop image upload hang, long-URL wrapped-row click, `/plugin Components` "Marketplace 'inline' not found", MCP-result image dropping with both structured + content blocks, fenced-code-blocks-in-list-items clipboard whitespace, `/config` tab focus, markdown link `label (url)` rendering on terminals without OSC 8, parallel-shell sibling cancellation, 1M-context autocompact `Prompt is too long`, banner "with X effort" on no-effort models, `/fast` 3P fuzzy-match, OSC 9;4 progress flicker, `/rename` on compact-boundary resume, stale "remote-control is active" status, stale `installed_plugins.json` PATH pollution, `CLAUDE_CODE_SHELL_PREFIX` corrupting MCP stdio args, sub-agent summary cache miss, sub-agent summary idle dedup, headless `stream-json` `init.plugin_errors` from `--plugin-dir` — UI / Ink / channels / native-build / SDK internals not reproduced here.
- `>10 MB` stdin to `claude -p` crash — stdin buffering in obfuscated CLI bootstrap.
- `/plugin update` detecting npm-sourced plugin updates — npm update probe path inside obfuscated update logic.

---

## 2.1.126 — May 1, 2026

Applies the user-facing, tractable subset of the upstream `2.1.126` changelog.

### Applied in this local source tree

- **OTEL `claude_code.skill_activated` event** — fires for every skill activation site and carries an `invocation_trigger` attribute (`'user-slash'`, `'claude-proactive'`, or `'nested-skill'`). Emitted alongside the existing BQ events:
  - `executeForkedSkill` in `SkillTool.ts` (proactive / nested cases — split on `queryTracking.depth`).
  - Both `tengu_input_command` emit paths and the `tengu_slash_command_forked` path in `processSlashCommand.tsx` (user-slash). Payload is the safe-cardinality subset of the BQ event (`invocation_trigger`, `command_name` routed through `OTEL_LOG_TOOL_DETAILS` redaction, `command_source` from `loadedFrom`, plus `query_depth` / `execution_context` where available) (`src/tools/SkillTool/SkillTool.ts`, `src/utils/processUserInput/processSlashCommand.tsx`).
- **`--dangerously-skip-permissions` now bypasses every `classifierApprovable` safetyCheck** — the 2.1.121 carve-out only re-opened writes to `.claude/{skills,agents,commands}/`. The 2.1.126 broadening drops the per-path predicate (`isAuthorAssetPath`) and falls through any `safetyCheck` decision whose `decisionReason.classifierApprovable === true`. That covers the rest of `.claude/`, `.git/`, `.vscode/`, and shell config files (`.bashrc`, `.zshrc`, `.profile`, …). `classifierApprovable: false` decisions (suspicious Windows path patterns, catastrophic-rm targets) still prompt as the safety net the upstream changelog calls out. `isAuthorAssetPath` is gone since the new path no longer needs it (`src/utils/permissions/permissions.ts`).
- **Removed the per-file malware-assessment `<system-reminder>` from Read tool output** — previously appended `CYBER_RISK_MITIGATION_REMINDER` to every text read for non-exempt models. Caused spurious refusals and "this is not malware" prefaces on legacy models, and the same guidance now lives in the system prompt. Dropped the constant, `MITIGATION_EXEMPT_MODELS`, `shouldIncludeFileReadMitigation`, and the now-unused `getCanonicalName / getMainLoopModel` import; updated the stale reminder reference in `transcriptSearch.ts`'s tool-result-indexing comment (`src/tools/FileReadTool/FileReadTool.ts`, `src/utils/transcriptSearch.ts`).
- **Security: `allowManagedDomainsOnly` / `allowManagedReadPathsOnly` are honoured even when a higher-priority managed source lacks a `sandbox` block** — `policySettings` uses first-source-wins, so any non-empty remote managed settings (e.g. `enableAllProjectMcpServers: true`) would shadow an MDM/managed-settings.json `sandbox` lock-down and silently disable both flags. The two helpers in `sandbox-adapter.ts` now scan the managed-source chain (remote → MDM → managed-file → HKCU) and honour the first source whose `sandbox` block is defined. Non-sandbox fields keep first-source-wins (`src/utils/sandbox/sandbox-adapter.ts`).
- **`/plugin Uninstall` no longer reports "Enabled"** — after a successful uninstall, `enabledPlugins[id]` is removed, so `enabledPlugins[id] !== false` evaluates `true` and the manage flow diverted to `PluginOptionsFlow`. With no userConfig to fill, that flow `finish()`-ed with `✓ Enabled <plugin>`. Gate the diversion on `operation !== 'uninstall' && operation !== 'update'`; both fall through to the standard `✓ Uninstalled` / `✓ Updated` message (`src/commands/plugin/ManagePlugins.tsx`).
- **PowerShell tool: bare `--` no longer mis-flagged as `--%`** — the parser embedded a PowerShell snippet that set `hasStopParsing` for both `[TokenKind]::Generic` text `'--%'` and `[TokenKind]::MinusMinus`. The latter represents bare `--` (the decrement operator and the POSIX option-terminator) and fired on commands like `git diff -- file`. Dropped the `MinusMinus` branch; `--%` is consistently lexed as Generic across PS5.1 and PS7, so the surviving Generic check covers the real stop-parsing token (`src/utils/powershell/parser.ts`).
- **claude.ai MCP connectors no longer suppressed by a manual server stuck in `needs-auth`** — `dedupClaudeAiMcpServers` only skipped manual servers when `isMcpServerDisabled(name)` was true, so a manual server with a stale 401 still claimed the URL signature and erased its connector twin — leaving the user with neither client connected. Added an optional `needsAuthManualNames: ReadonlySet<string>` parameter that is treated like the disabled-name list; in `useManageMCPConnections.ts` we read the current `mcp.clients` via a synchronous `setAppState(s => s)` callback and pass the set of names whose `type === 'needs-auth'` to dedup (`src/services/mcp/config.ts`, `src/services/mcp/useManageMCPConnections.ts`).
- **Bumped local source version to `2.1.126`** (from `2.1.123`) — `package.json` and `preload.ts` MACRO.

### Not applied (upstream-only or out of scope)

- `/model` picker listing models from a gateway's `/v1/models` endpoint when `ANTHROPIC_BASE_URL` points at an Anthropic-compatible gateway — the local `ModelPicker.tsx` builds entries from a static `modelOptions.ts` list; there is no `/v1/models` discovery client.
- `claude project purge [path]` (+ `--dry-run` / `-y` / `-i` / `--all`) — no `claude project` command group in the mirror.
- `claude auth login` accepting pasted OAuth codes from blocked-callback environments (WSL2, SSH, containers) — OAuth callback handling is in the auth flow internals not reproduced here.
- Auto-mode spinner turning red on stalled permission checks — Ink spinner/status internals.
- Host-managed `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST` no longer auto-disabling analytics on Bedrock/Vertex/Foundry — provider-managed analytics gate lives in obfuscated source.
- Windows PowerShell 7 detection (Store/MSI-without-PATH/.NET global tool) and using PowerShell as primary shell when the PowerShell tool is enabled — Windows-only shell selection.
- Image-paste 2000px downscale + auto-remove + retry for oversized images already in history — downscale itself was pre-aligned in 2.1.123 (`IMAGE_MAX_WIDTH = 2000`); the history-rewrite/retry path doesn't exist in this mirror.
- OAuth login screen for "OAuth not allowed for organization" errors + timeout fixes for slow/proxied connections, IPv6-only devcontainers, and unreachable browser callbacks — OAuth flow internals.
- Concurrent-credential-write race clearing a valid OAuth refresh token — credential persistence layer.
- API-retry countdown sticking at `0s`; "Stream idle timeout" after Mac sleep or long thinking pauses; assistant finishing-thinking-with-no-output hang; OAuth countdown UI — streaming / Ink internals.
- Trackpad scroll speed in Cursor / VS Code 1.92–1.104 integrated terminals — terminal-specific Ink scroll handling.
- claude.ai MCP connectors suppressed by manual servers stuck in `needs-auth` — applied above; the related "MCP connectors hidden by manual duplicate URL" UI hint from 2.1.123 stays unimplemented (UI string in obfuscated `/mcp` view).
- CJK garbled-character rendering on Windows in no-flicker mode — Ink renderer Windows-specific buffer handling.
- `Ctrl+L` clearing prompt input (now only forces redraw) — Ink keybinding handler.
- Deferred tools (`WebSearch`, `WebFetch`, …) unavailable to `context: fork` skills on their first turn — subagent tool-resolution wiring.
- Plan-mode tools unavailable in interactive `--channels` sessions — channels session wiring.
- Bounded total size of file-modified `<system-reminder>` blocks — reminder-batching layer not in mirror.
- `/remote-control` retry status / failure-reason notification; Remote Control "Always allow" persistence — Remote Control internals.
- Windows clipboard writes via process-argv (EDR/SIEM exposure) + >22KB selection truncation — Windows-specific clipboard backend.
- Agent SDK hang on malformed parallel-tool-call tool name — agent SDK loop not exposed in this mirror.

---

## 2.1.123 — April 29, 2026

Folds in upstream `2.1.122` (April 28) + the single-fix `2.1.123` release (April 29, 2026).

### Applied in this local source tree

- **`ANTHROPIC_BEDROCK_SERVICE_TIER` env var** — sent as `X-Amzn-Bedrock-Service-Tier` HTTP header on every Bedrock request. Wired into the Bedrock client construction in `client.ts` next to the `AWS_BEARER_TOKEN_BEDROCK` block; trimmed and pass-through (Bedrock surfaces invalid values as 400 instead of us silently dropping a typo). Added to `SAFE_ENV_VARS` so managed deployments can set it (`src/services/api/client.ts`, `src/utils/managedEnvConstants.ts`).
- **`!exit` / `!quit` in bash mode no longer terminates the CLI** — `handlePromptSubmit`'s exit-keyword gate now skips when `mode === 'bash'` and the input is bare `exit`/`quit`. Vim-style shortcuts (`:q`, `:wq`, etc.) stay routed to `/exit` even in bash mode since they aren't valid shell commands (`src/utils/handlePromptSubmit.ts`).
- **`spinnerTipsOverride.excludeDefault` now suppresses defaults unconditionally** — previously the gate required `customTips.length > 0`, so a user with `excludeDefault: true` and no custom tips still saw built-in tips. The new behavior matches the setting name (`src/services/tips/tipRegistry.ts`).
- **Malformed hooks entries no longer invalidate the entire settings.json** — `HooksSchema` now accepts the leaves as `z.unknown()` and runs `HookMatcherSchema().safeParse` per matcher inside the transform. Bad matchers are dropped; salvage path keeps a matcher's `matcher` string and any individually-valid hooks alive even when one entry inside is broken (e.g. a stale `mcp_tool` whose server was renamed) (`src/schemas/hooks.ts`).
- **OTEL: numeric attrs on `api_request` / `api_error` are numbers** — `logOTelEvent` widened to accept `string | number | undefined` so OTLP receivers see token counts, durations, and costs as quantities instead of having to re-parse strings. `api_error` `status_code` is parsed (NaN for network errors → omitted) (`src/utils/telemetry/events.ts`, `src/services/api/logging.ts`).
- **OTEL: new `claude_code.at_mention` event for @-mention resolution** — emitted in `processAgentMentions` alongside the existing `tengu_at_mention_*` analytics events. Carries `kind` and `resolved`; the agent name itself is high-cardinality / potentially PII so it is not surfaced. (`src/utils/attachments.ts`).
- **Bumped local source version to `2.1.123`** (from `2.1.121`). Folds 2.1.122 + 2.1.123 in a single bump since the latter is a one-line auth fix that doesn't reproduce here.

### Pre-aligned (already correct in this mirror)

- **2.1.123 OAuth 401 retry loop with `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1`** — the `OAUTH_BETA_HEADER` is added unconditionally for Claude.ai subscribers in `getAllModelBetas` (`src/utils/betas.ts:251-253`) and the `DISABLE_EXPERIMENTAL_BETAS` strip in `api.ts` only filters tool-schema fields, not request headers. The upstream regression doesn't manifest in this mirror.
- **Image resize to 2000px max** — already enforced by `IMAGE_MAX_WIDTH = IMAGE_MAX_HEIGHT = 2000` in `src/constants/apiLimits.ts`. Upstream's regression to 2576px doesn't appear here.

### Not applied (upstream-only or out of scope)

- `/resume` search by PR URL across GitHub / GHE / GitLab / Bitbucket — session-search internals.
- `/mcp` showing claude.ai connectors hidden by a manually-added duplicate URL with a hint to remove the duplicate; clarified post-OAuth "still unauthorized" message — `/mcp` UI in obfuscated source.
- `/branch` rewound-timeline fork producing tool_use without tool_result — `/branch` session-export internals.
- `/model` Effort option for Bedrock application inference profile ARNs + `output_config.effort` propagation — model picker + Bedrock adapter.
- Vertex AI / Bedrock structured-output `output_config: Extra inputs are not permitted` — provider adapter.
- Vertex AI count_tokens 400 behind proxy gateways — count_tokens adapter.
- ToolSearch missing MCP tools that connected after session start in nonblocking mode — MCP/tool-search interplay.
- Images sent to newer models 2576px regression (already at 2000px locally).
- Remote-control idle status redrawing twice per second (tmux `-CC` flooding) — Remote Control internal.
- Stale view preference making assistant messages appear blank — Ink view-preference state.
- Voice mode keybindings bound to Caps Lock — voice-mode keybinding validation.
- 2.1.123 OAuth retry loop fix — pre-aligned (above).

---

## 2.1.121 — April 28, 2026

Applies the user-facing, tractable subset of the upstream 2.1.121 changelog (same-day double-release with 2.1.120).

### Applied in this local source tree

- **Added `alwaysLoad` to MCP server config** — when set on a server entry in settings.json / .mcp.json, every tool that server advertises skips tool-search deferral and is always available to the model. Schema added to all four user-configurable transport variants (stdio, sse, http, ws). Wired into `client.ts:1802` so the per-server flag is OR-merged with the existing per-tool `_meta['anthropic/alwaysLoad']` (per-tool still wins; server flag fills in for tools without per-tool meta) (`src/services/mcp/types.ts`, `src/services/mcp/client.ts`).
- **PostToolUse hooks can replace tool output for all tools, not just MCP** — added `hookSpecificOutput.updatedToolOutput` (works for every tool) alongside the legacy `updatedMCPToolOutput` (kept as a back-compat alias). When both are set, the new key wins. Lifted the `isMcpTool` gate in `runPostToolUseHooks` and `toolExecution.ts` so the replacement applies to Bash/File/Web/etc. The variable still carries the legacy name through the executor pipeline to avoid touching the entire chain (`src/types/hooks.ts`, `src/utils/hooks.ts`, `src/services/tools/toolHooks.ts`, `src/services/tools/toolExecution.ts`, `src/entrypoints/sdk/coreSchemas.ts`).
- **`--dangerously-skip-permissions` no longer prompts for writes to `.claude/skills/`, `.claude/agents/`, `.claude/commands/`** — added `isAuthorAssetPath()` helper and a carve-out at step 1g of `hasPermissionsToUseToolInner`. When in `bypassPermissions` mode (or plan mode with bypass available) and the write target matches one of the three author-asset directories, the existing `safetyCheck` ask falls through to step 2a's bypass branch. `settings.json`, `hooks/`, and other `.claude/` contents stay safetyCheck-immune — only those three asset directories are carved out (`src/utils/permissions/permissions.ts`).
- **`/focus` now explains how to enable fullscreen instead of silently no-opping** — when `isFullscreenEnvEnabled()` returns false, `/focus` prints "Focus view requires fullscreen rendering. Run /tui fullscreen…" rather than toggling state that has no visible effect. Mirrors the upstream "Fixed /focus showing 'Unknown command' when the fullscreen renderer is off" fix (`src/commands/focus/focus.ts`).
- **OTEL LLM request spans now carry `stop_reason`, `gen_ai.response.finish_reasons`, and (gated) `user_system_prompt`** — added optional `stopReason` to the `endLLMRequestSpan()` metadata; emits both the legacy attribute name and the OTel GenAI semconv `gen_ai.response.finish_reasons` (always emitted as a single-element JSON array of strings). `logAPISuccess` already received `stopReason` from the streaming response handler, now it threads through. `user_system_prompt` is set on the request span when `OTEL_LOG_USER_PROMPTS=true`, distinct from the existing 500-char `system_prompt_preview` and the de-duplicated `system_prompt` log event (`src/utils/telemetry/sessionTracing.ts`, `src/utils/telemetry/betaSessionTracing.ts`, `src/services/api/logging.ts`).
- **Bumped local source version to `2.1.121`** (from `2.1.120`) — `package.json` and `preload.ts` MACRO.

### Not applied (upstream-only or out of scope)

- `claude plugin prune` + `plugin uninstall --prune` cascade — plugin CLI subcommand wiring + dependency-graph walker.
- Type-to-filter search box in `/skills` — Ink list/filter UI in obfuscated source.
- Fullscreen prompt scroll preservation when typing; dialogs scrollable via arrow / PgUp / PgDn / mouse wheel; long-URL wrap click open — Ink/scroll internals.
- SDK + `claude -p`: `CLAUDE_CODE_FORK_SUBAGENT=1` lifting the interactive-only restriction — fork subagent gate at `src/tools/AgentTool/forkSubagent.ts:35` references `getIsNonInteractiveSession()`; the upstream change drops that branch but our local print/SDK plumbing depends on the branch elsewhere, so the change isn't safe to land in isolation.
- `/terminal-setup` enabling iTerm2 "Applications in terminal may access clipboard" — terminal-setup script in obfuscated source.
- MCP servers retry up to 3 times on transient startup errors — MCP client startup orchestrator.
- Terminal tab title generated in configured language — terminal-title hook.
- Claude.ai connectors deduplicated by upstream URL — connector list resolver.
- Vertex AI X.509 / mTLS ADC support — Vertex auth path.
- Faster startup: remove Recent Activity panel from release-notes splash — splash UI.
- LSP diagnostic summary expand-on-click + expand hint — LSP diagnostic renderer.
- SDK `mcp_authenticate` `redirectUri` for custom-scheme completion — SDK auth handler.
- VSCode voice dictation language fallback + `/context` native dialog — VSCode integration.
- Memory leak fixes (image processing RSS, `/usage` 2GB, long-running tool no-progress); Bash unusable when start dir deleted; `--resume` external-build crash + corrupt-line skip; Bedrock Opus 4.7 `thinking.type.enabled`; Microsoft 365 MCP OAuth duplicate prompt; Ctrl+L scrollback duplication on tmux/GNOME/Windows Terminal/Konsole; Claude.ai connector silent-disappearance on auth blip; remote-session "Always allow" persistence; managed-settings `NO_PROXY` propagation; managed-settings approval prompt exit-on-accept; `/usage` rate-limited stale-token refresh; legacy enum invalidating settings.json; `/usage` no-flicker clipping; embedded grep/find/rg deleted-binary fallback; native `find` peak fd usage — internals/native-build patches.

---

## 2.1.120 — April 28, 2026

Applies the user-facing, tractable subset of the upstream 2.1.120 changelog.

### Applied in this local source tree

- **Set `AI_AGENT=claude_code` for spawned subprocesses** — env-aware CLIs like `gh` use this to attribute traffic. Injected in `subprocessEnv()` (the helper that backs every Bash/Shell tool spawn) so it applies on both the GHA-scrub and non-scrub paths. Doesn't override an existing `AI_AGENT` so wrapper tooling can keep its own attribution (`src/utils/subprocessEnv.ts`).
- **Skills can now reference `${CLAUDE_EFFORT}`** — expansion is wired into `loadSkillsDir.getPromptForCommand()` after the existing `${CLAUDE_SKILL_DIR}` / `${CLAUDE_SESSION_ID}` substitutions. Resolves to the displayed effort level for the current model (e.g. "high", "medium", "max"), honoring `/effort` changes mid-session. Falls back to empty string if effort resolution fails so the model never sees a literal `${CLAUDE_EFFORT}` (`src/skills/loadSkillsDir.ts`).
- **`claude plugin validate` now accepts `$schema`, `version`, and `description` at the top level of `marketplace.json`, and `$schema` in `plugin.json`** — added to `PluginManifestSchema` and `PluginMarketplaceSchema`. Top-level `version`/`description` in `marketplace.json` are documented as preferred over the existing nested `metadata.version` / `metadata.description` (which stay for back-compat). `$schema` is purely an editor hint and ignored at runtime (`src/utils/plugins/schemas.ts`).
- **Spinner tips that recommend creating agents are hidden once the user has agents** — `custom-agents` and `agent-flag` tip `isRelevant` now consults a session-cached `userHasCustomOrPluginAgents()` probe that walks the agents directory via `getAgentDefinitionsWithOverrides()`. Probe failure falls back to the original numStartups-only gate so we err toward showing rather than silently swallowing the tip (`src/services/tips/tipRegistry.ts`).
- **Bumped local source version to `2.1.120`** (from `2.1.119`) — `package.json` and `preload.ts` MACRO.

### Not applied (upstream-only or out of scope)

- Windows: PowerShell fallback when Git Bash is absent — shell selection internals around `getCurrentShell()` interact with the Bash tool's command parser; the local mirror's PowerShell path is incomplete enough that auto-fallback would silently break Bash auto-approval. Document and skip.
- `claude ultrareview [target]` non-interactive subcommand — `/ultrareview` is the cloud multi-agent review feature; the non-interactive subcommand wraps that backend.
- "Use PgUp/PgDn to scroll" hint when terminal sends arrow keys instead of scroll events — Ink keypress + scroll-detection internals.
- Faster session start with many unauthorized claude.ai connectors — MCP startup orchestrator in obfuscated source.
- Auto-mode denial-message link to configuration docs — UI string, but the message construction lives in obfuscated permission code.
- Auto-compact lowercase "auto" without token count — `TokenWarning.tsx` label rework; cosmetic and easy to mis-render in non-fullscreen mode without the upstream layout fix.
- DISABLE_TELEMETRY / CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC suppression of usage metrics for API/enterprise — this mirror's `isTelemetryDisabled()` already gates both Datadog and 1P paths via `getPrivacyLevel()`; the upstream regression doesn't manifest here, so no fix needed.
- Fixed Esc during stdio MCP tool call closing the entire server connection (regression in 2.1.105) — MCP stdio client lifecycle in obfuscated source.
- Fixed `/rewind` and other interactive overlays not responding after `claude --resume` — overlay focus management in Ink-internal code.
- Fixed terminal scrollback duplication in non-fullscreen mode — Ink/TUI scroll bookkeeping.
- Fixed false-positive "Dangerous rm operation" prompts in auto mode for multi-line bash with both pipe and redirect — `pathValidation.ts` multi-statement pipe+redirect parsing edge case.
- Fixed long selection menus clipping below terminal in fullscreen + Write tool "+N lines" expand collapse + slash-command picker jumping/contiguous-substring highlight + `/plugin marketplace` unrecognized-source-format handling — Ink/TUI internals.
- VSCode `/usage` native dialog opening + voice dictation language setting — VSCode integration not in this mirror.
- Bash `find` exhausting open file descriptors on large trees — Bash tool internals; native macOS/Linux build only.

---

## 2.1.119 — April 23, 2026

Applies the user-facing, tractable subset of the upstream 2.1.119 changelog (same-day double-release with 2.1.118).

### Applied in this local source tree

- **Added `prUrlTemplate` setting** — points the footer PR badge at a custom code-review URL instead of github.com. Schema-only addition with `{owner}`, `{repo}`, `{pr}` placeholders documented in the describe (`src/utils/settings/types.ts`).
- **Added `CLAUDE_CODE_HIDE_CWD` env var** — gates the cwd line in the startup logo via `getLogoDisplayData()`. When connected to a remote server we still surface the server identity (the more privacy-relevant signal), but the local path is suppressed. Allowlisted in `SAFE_ENV_VARS` (`src/utils/logoV2Utils.ts`, `src/utils/managedEnvConstants.ts`).
- **Hooks: `PostToolUse` and `PostToolUseFailure` inputs now include `duration_ms`** — wall time of `tool.call()`, excluding permission prompts and PreToolUse hooks. Threaded from the existing `durationMs` capture in `toolExecution.ts` through `runPostToolUseHooks` / `runPostToolUseFailureHooks` into `executePostToolHooks` / `executePostToolUseFailureHooks`. Schema (`PostToolUseHookInputSchema`, `PostToolUseFailureHookInputSchema`) extended with optional `duration_ms` field for back-compat (`src/utils/hooks.ts`, `src/services/tools/toolHooks.ts`, `src/services/tools/toolExecution.ts`, `src/entrypoints/sdk/coreSchemas.ts`).
- **OTEL `tool_decision` and `tool_result` events now include `tool_use_id`; `tool_result` also includes `tool_input_size_bytes`** — emission sites in `toolExecution.ts` updated. `tool_use_id` lets dashboards correlate decision and result for the same call. Also fixed a long-standing typo on the failure path that wrote `use_id` instead of `tool_use_id`. `tool_input_size_bytes` is emitted unconditionally on both success and failure paths (size is not PII) so dashboards see a value for every emission (`src/services/tools/toolExecution.ts`).
- **Status line stdin JSON now includes `effort.level` and `thinking.enabled`** — `buildStatusLineCommandInput()` reads `effortValue` from AppState (same source as the runtime model gate, so /effort changes flow without re-reading settings) and `shouldEnableThinkingByDefault()` from the existing thinking helper. `effort` is omitted on models that don't support effort, matching the displayed-effort logic (`src/components/StatusLine.tsx`).
- **Tool search disabled by default on Vertex AI** — Vertex rejects the beta header that tool search emits with "tool_reference is not a valid block type". `isToolSearchEnabledOptimistic()` now returns false on `getAPIProvider() === 'vertex'` unless the user explicitly sets `ENABLE_TOOL_SEARCH`, matching the existing escape hatch for non-first-party gateways (`src/utils/toolSearch.ts`).
- **Bumped local source version to `2.1.119`** (from `2.1.118`) — `package.json` and `preload.ts` MACRO.

### Not applied (upstream-only or out of scope)

- `/config` settings full settings.json persistence + project/local/policy precedence migration — most theme/fastMode/effort settings already persist via `updateSettingsForSource('userSettings', ...)` in this mirror; the upstream change is a deeper rework of which `/config` knobs go to disk and the precedence chain that we don't fully replicate.
- `--from-pr` accepting GitLab merge-request, Bitbucket pull-request, GitHub Enterprise — current `--from-pr` resolution sits in obfuscated session-search code; pattern matching extension would need that to land first.
- `--print` mode honoring agent `tools:` / `disallowedTools:` frontmatter; `--agent <name>` honoring agent `permissionMode` for built-ins — agent runner internals not in this mirror's surface.
- PowerShell auto-approval matching Bash — Bash classifier path (`feature('BASH_CLASSIFIER')`) has no PowerShell counterpart in this source.
- Subagent + SDK MCP server reconfiguration parallelization — MCP orchestrator internals in obfuscated source.
- Plugin pinned-by-other-plugin auto-update to highest satisfying tag — plugin subsystem internals.
- Vim-mode `Esc` queued-message restore + double-Esc interrupt; slash-command typeahead match-highlighting + multi-line description wrap; `owner/repo#N` shorthand using local git remote host — Ink/TUI rendering and input internals.
- Security: `blockedMarketplaces` `hostPattern`/`pathPattern` enforcement — plugin subsystem.
- CRLF/Windows clipboard double-newline; Kitty bracketed-paste newline loss; Glob/Grep disappearing on native macOS/Linux when Bash denied; fullscreen scrollback bottom-snap; MCP HTTP non-JSON OAuth body; Rewind "(no prompt)" image attachments; auto-mode overriding plan-mode; async PostToolUse empty-payload transcript; spinner orphan after subagent notification; `@-file` Tab in slash-command absolute path; Terminal.app stray `p` on Docker/SSH; HTTP/SSE/WebSocket MCP `${ENV_VAR}` header substitution; OAuth `--client-secret` `client_secret_post` exchange; `/skills` Enter pre-fill; `/agents` "Unrecognized" mislabeling; Windows plugin MCP cache spawn; `/export` model display; verbose persistence; `/usage` progress-bar overlap; plugin `${user_config.*}` optional fields; sentence-final number wrap; `/plan` and `/plan open` action; pre-compaction skill re-execution; `/reload-plugins` + `/doctor` disabled-plugin errors; Agent worktree-isolation stale reuse; disabled MCP "failed" in `/status`; `TaskList` ID sort; `gh` rate-limit hint false positive; SDK/bridge `read_file` size cap; PR linking under git worktree; `/doctor` MCP override warning; Windows `cmd /c` MCP false positive; VSCode voice dictation first-recording — terminal/UI/MCP/plugin/Windows internals below the faithful-mirror line.

---

## 2.1.118 — April 23, 2026

Applies the user-facing, tractable subset of the upstream 2.1.118 changelog.

### Applied in this local source tree

- **Added `DISABLE_UPDATES` env var** — stricter than `DISABLE_AUTOUPDATER`: also blocks the manual `claude update` path, not just the background auto-update. Wired into `getAutoUpdaterDisabledReason()` (returned with `envVar: 'DISABLE_UPDATES'` so `/doctor` shows the right reason); new `areManualUpdatesDisabled()` helper for any future manual-update command to consult. Added to `SAFE_ENV_VARS` so managed deployments can set it without the dangerous-env-var dialog (`src/utils/config.ts`, `src/utils/managedEnvConstants.ts`).
- **Added `wslInheritsWindowsSettings` policy key** — when set true in managed-settings.json, a Claude Code session running inside WSL inherits managed settings from the Windows-side managed-settings.json. Lets a single Windows managed deployment cover both native Windows and WSL sessions (`src/utils/settings/types.ts`). Schema only — actual WSL-side merge is a Windows runtime detail not present in this mirror.
- **Hooks can now invoke MCP tools directly via `type: "mcp_tool"`** — added `McpToolHookSchema` (server, tool, optional arguments record, plus the standard `if`/`timeout`/`statusMessage`/`once` fields), wired into the `HookCommandSchema` discriminated union, exported `McpToolHook` type, and extended `hooksSettings.ts` switch cases (`hookCommandsAreEqual` + `getHookDisplayText`) so the new variant is identity-comparable and renders as `${server}.${tool}` in /hooks. The actual hook executor still routes only the existing variants — adding the dispatch path is a follow-up; this lands the schema and identity surface so settings.json validation accepts the new shape and unknown executor variants don't trip exhaustive-switch fallthroughs (`src/schemas/hooks.ts`, `src/utils/hooks/hooksSettings.ts`).
- **Auto mode: `"$defaults"` sentinel in `autoMode.allow` / `soft_deny` / `environment` keeps the built-in list alongside custom rules** — `buildYoloSystemPrompt()` now splits each user-supplied array into a `keepDefault` flag (true iff `"$defaults"` is present) and the user-rules tail. Built-in rules are included when the user provided no list (preserving prior default-on behavior) OR when `"$defaults"` is present; a non-empty list without the sentinel now REPLACES built-ins, matching upstream documented semantics. The sentinel itself is stripped before rules go into the prompt so it never surfaces as a literal entry. Schema descriptions updated to document the new contract (`src/utils/permissions/yoloClassifier.ts`, `src/utils/settings/types.ts`).
- **Bumped local source version to `2.1.118`** (from `2.1.117`) — `package.json` and `preload.ts` MACRO.

### Not applied (upstream-only or out of scope)

- Vim visual-mode `v` / visual-line `V` (selection, operators, visual feedback) — input/TUI rendering work in obfuscated Ink components.
- Merge `/cost` and `/stats` into `/usage` tabs while keeping both as typing shortcuts — `/cost` is a `local` text command, `/stats` and `/usage` are `local-jsx`; merging them as tabs requires turning `/cost` into a JSX component and reshaping the Settings tabs UI which sits in obfuscated source.
- Named custom themes via `/theme create`/`switch` + `~/.claude/themes/` JSON files + plugin `themes/` directory — theme system + plugin scaffold restructure beyond the local mirror's surface.
- Auto-mode "Don't ask again" opt-in checkbox — auto-mode dialog UI in obfuscated Ink source.
- `claude plugin tag` for creating plugin release git tags with version validation — plugin CLI subcommand outside this mirror.
- `--continue`/`--resume` finding sessions added via `/add-dir` — session-discovery internals.
- `/color` syncing accent color to claude.ai/code over Remote Control — bridge feature.
- `/model` picker honoring `ANTHROPIC_DEFAULT_*_MODEL_NAME`/`_DESCRIPTION` overrides under custom `ANTHROPIC_BASE_URL` gateways — model picker UI internals.
- Auto-update plugin-skip surfacing in `/doctor` and `/plugin Errors` tab — plugin subsystem internals.
- Various MCP OAuth fixes (headersHelper menu, custom-headers stuck "needs auth", missing `expires_in`, step-up `insufficient_scope` re-consent, OAuth flow timeout/cancel unhandled rejection, refresh cross-process lock, macOS keychain race, server-revoked tokens, `~/.claude/.credentials.json` corruption on Linux/Windows) — auth client/MCP OAuth internals in obfuscated source.
- `/login` in CLAUDE_CODE_OAUTH_TOKEN-launched session not clearing the env token — auth bootstrap path.
- Unreadable text in "new messages" scroll pill / `/plugin` badges — Ink color theme internals.
- Plan-acceptance dialog "auto mode" vs "bypass permissions" labelling under `--dangerously-skip-permissions` — dialog UI in obfuscated source.
- Agent-type hooks "Messages are required for agent hooks" failure on non-Stop events; prompt hooks re-firing on agent-hook verifier subagent tool calls — hook executor internals.
- `/fork` writing full parent conversation per fork (now pointer + hydrate) — session storage internals.
- `Alt+K` / `Alt+X` / `Alt+^` / `Alt+_` keyboard freezes — Ink keypress edge cases.
- Remote-session connect overwriting local model setting; typeahead "No commands match" on pasted slash file paths; plugin install dep wrong-version re-resolve; file-watcher ENOENT/EMFILE unhandled errors; CCR transient blip session archival; SendMessage subagent `cwd` restore — Remote/plugin/session internals.

---

## 2.1.117 — April 22, 2026

Applies the user-facing, tractable subset of the upstream 2.1.117 changelog.

### Applied in this local source tree

- **Allowlisted `CLAUDE_CODE_FORK_SUBAGENT` in `SAFE_ENV_VARS`** — upstream enables forked subagents on external builds via this env var; managed settings can now set it without tripping the dangerous-env-var dialog (`src/utils/managedEnvConstants.ts`).
- **Default effort on Opus 4.6 / Sonnet 4.6 for Pro/Max subscribers is now high** — removed the `isProSubscriber() → 'medium'` override in `getDefaultEffortForModel()`. Pro/Max now fall through to `undefined` (= high in the API) alongside every other user type; ultrathink branch and the ant-side overrides are unchanged (`src/utils/effort.ts`).
- **Extended `cleanupPeriodDays` retention sweep to `~/.claude/tasks/`, `~/.claude/shell-snapshots/`, `~/.claude/backups/`** — added a shared `cleanupOldTopLevelEntries(dirName)` helper (mirrors `cleanupOldSessionEnvDirs`'s mtime-vs-cutoff pattern, but tolerates both files and directories) and three thin wrappers wired into `cleanupOldMessageFilesInBackground()`. These buckets previously grew unbounded because they match session lifetime, not user retention policy (`src/utils/cleanup.ts`).
- **WebFetch truncates HTML before Turndown** — added `MAX_HTML_LENGTH = 2 MiB`. On multi-megabyte HTML pages Turndown's DOM build + tree walk could spin for tens of seconds; truncating before conversion yields more than `MAX_MARKDOWN_LENGTH` of markdown anyway, so the tail we drop was destined for the post-conversion cap (`src/tools/WebFetchTool/utils.ts`).
- **OTEL `user_prompt` events now carry `command_name` and `command_source` on slash-command paths** — both the unknown-command fallthrough and the new known-command emission in `processSlashCommand.tsx` include these attributes. `command_name` is redacted to the existing `'custom'`/`'mcp'` sanitized form unless `OTEL_LOG_TOOL_DETAILS=1`. `command_source` is one of `'builtin'`, `'custom'`, `'mcp'`, or `'unknown'`. Previously valid `/slash` invocations emitted no `user_prompt` event at all (`src/utils/processUserInput/processSlashCommand.tsx`).
- **Bumped local source version to `2.1.117`** (from `2.1.116`) — `package.json` and `preload.ts` MACRO.

### Not applied (upstream-only or out of scope)

- Forked-subagent dispatch for `--agent` main-thread sessions, agent-frontmatter `mcpServers` loading — subagent runner + agent-frontmatter parser live in obfuscated code.
- `/model` pin-source indicator ("from project" / "from managed-settings" label in startup header) and persist-across-restarts-even-when-project-pins-different — requires reworking the model pin resolution + header render.
- `/resume` stale-large-session summarize-before-read prompt — internal `/resume` UX path in obfuscated source.
- Concurrent local + claude.ai MCP connect on startup — MCP orchestrator in obfuscated init code.
- `plugin install` resolve missing dependencies on already-installed; `claude plugin marketplace add` dep auto-resolution; managed `blockedMarketplaces`/`strictKnownMarketplaces` enforcement on install/update/refresh/autoupdate — plugin subsystem internals.
- Advisor Tool experimental-label + learn-more link + startup notification; Advisor stuck-on-every-prompt fix — Advisor UI + result processor in obfuscated source.
- OTEL `cost.usage`/`token.usage`/`api_request`/`api_error` `effort` attribute — OTEL metric emission sites in obfuscated instrumentation.
- Native macOS/Linux builds replacing Glob/Grep with bfs/ugrep via Bash; Windows `where.exe` cache — distribution/packaging + platform-specific path, N/A for this local source mirror.
- Plain-CLI OAuth reactive token refresh on 401; `/login` when `CLAUDE_CODE_OAUTH_TOKEN` token expires — Anthropic auth client wrapper, obfuscated.
- Proxy HTTP 204 No Content clear-error — already safely handled in `src/bridge/bridgeApi.ts`; no user-facing TypeError path in this mirror.
- `NO_PROXY` respect under Bun, `gcpAuthRefresh` crash fix — proxy/client internals.
- SDK `reload_plugins` serial-reconnect → parallel fix; MCP `elicitation/create` auto-cancel on mid-turn connect; subagent model malware-warning false positive; idle-render loop on Linux — SDK/MCP/render internals in obfuscated source.
- Bedrock application-inference-profile 400 on Opus 4.7 with thinking disabled — Bedrock adapter plumbing not in scope.
- Prompt-input Ctrl+_ undo, Kitty-protocol key coalescing edges, VSCode "Manage Plugins" large-marketplace break — TUI/input and VSCode-panel bugs below our faithful-mirror line.
- Opus 4.7 `/context` percentage computing against 200K window instead of 1M — requires the per-model context-window table we don't mirror in full.

---

## 2.1.116 — April 20, 2026

Applies the user-facing, tractable subset of the upstream 2.1.116 changelog. Upstream skipped `2.1.114` and `2.1.115`.

### Applied in this local source tree

- **Sandbox auto-allow no longer bypasses the dangerous-path safety check for rm/rmdir** — when `autoAllowBashIfSandboxed` is on, `checkSandboxAutoAllow()` now runs `checkDangerousRemovalInCommand()` on every subcommand before returning `allow`. Any `rm`/`rmdir` targeting `/`, `$HOME`, `/etc`, `/usr` etc. produces an `ask` decision with a specific "Dangerous … operation on critical path" message, instead of being silently allowed because no deny rule matched. The new helper in `pathValidation.ts` reuses the existing `checkDangerousRemovalPaths()` internals and `stripSafeWrappers()` so commands like `timeout 10 rm -rf /` are also caught (`src/tools/BashTool/pathValidation.ts`, `src/tools/BashTool/bashPermissions.ts`).
- **Bumped local source version to `2.1.116`** (from `2.1.113`) — `package.json` and `preload.ts` MACRO.

### Not applied (upstream-only or out of scope)

- `/resume` speedup on large sessions and dead-fork-heavy sessions — internal parser/loader optimization in obfuscated session-reading code; no tractable local touchpoint.
- Faster MCP stdio startup + deferred `resources/templates/list` — MCP client startup orchestration lives in obfuscated init code; the deferred-list behavior would require reworking the MCP registration path.
- Smoother fullscreen scrolling in VS Code / Cursor / Windsurf (`/terminal-setup` writes editor scroll sensitivity) — terminal-setup is a hosted configuration command; editor-specific config writing not mirrored.
- Inline thinking-spinner progress ("still thinking", "thinking more", "almost done thinking") — Ink spinner rendering in obfuscated TUI source.
- `/config` search matching option values — obfuscated settings UI.
- `/doctor` opening while Claude is responding — requires reworking the in-flight-turn dialog gate.
- `/reload-plugins` and background plugin auto-update auto-installing missing marketplace deps — plugin-subsystem internals beyond the simplified mirror.
- Bash tool `gh` GitHub API rate-limit hint — adds a specific post-exec hint path in the Bash tool result formatter; cosmetic, not security-critical.
- Settings Usage tab 5-hour/weekly immediate + rate-limit-tolerant — Settings UI in obfuscated source; depends on the rate-limited Usage endpoint client.
- Agent frontmatter hooks firing for `--agent` main-thread agents — agent-frontmatter hook dispatch lives in obfuscated agent-runner code.
- Slash-command menu "No commands match" empty-state — Ink menu rendering in obfuscated TUI source.
- Devanagari/Indic column alignment, Ctrl+- undo under Kitty protocol, Cmd+Left/Right under Kitty protocol, Ctrl+Z hang under wrapper, inline-mode scrollback duplication, modal search overflow at short heights, VS Code integrated terminal scattered blank cells — terminal/TUI input and rendering bugs in obfuscated Ink source.
- API 400 cache-control TTL ordering fix on parallel request setup — lives in the Anthropic API client wrapper, obfuscated.
- `/branch` 50MB transcript reject, `/resume` empty-load silent-success, `/plugin` Installed tab deduplication, `/update` and `/tui` not working after worktree mid-session — command handlers in obfuscated source with no direct local hook.

---

## 2.1.113 — April 17, 2026

Applies the user-facing, tractable subset of the upstream 2.1.113 changelog.

### Applied in this local source tree

- **Added `sandbox.network.deniedDomains` setting** — lets users block specific domains even when a broader `allowedDomains` wildcard would otherwise permit them. Wired into `SandboxNetworkConfigSchema` alongside `allowedDomains`, and merged into the runtime `deniedDomains` list in `convertToSandboxRuntimeConfig()` from both `settings.sandbox.network.deniedDomains` and `policySettings.sandbox.network.deniedDomains`. Always applies regardless of managed-only mode, since deny rules take precedence over allow wildcards (`src/entrypoints/sandboxTypes.ts`, `src/utils/sandbox/sandbox-adapter.ts`).
- **Bumped local source version to `2.1.113`** (from `2.1.111`) — `package.json` and `preload.ts` MACRO. Upstream skipped `2.1.112`.

### Not applied (upstream-only or out of scope)

- Native Claude Code binary distribution via per-platform optional dependencies — distribution/packaging change, N/A for a local source mirror.
- Fullscreen Shift+↑/↓ scroll-when-extending-selection, Ctrl+A/Ctrl+E logical-line navigation, Windows Ctrl+Backspace word-delete, Cmd-backspace/Ctrl+U line-kill restore, prompt cursor visibility under `NO_COLOR`, slash/@ completion menu flush rendering — input/TUI rendering details that live in obfuscated Ink components beyond the faithful-mirror line.
- OSC 8 long-URL clickability across wrapped lines — terminal-specific rendering.
- `/loop` Esc cancel + "resuming /loop wakeup" label, `/extra-usage` from Remote Control, Remote Control @-file autocomplete, Remote Control subagent streaming, Remote Control session archiving, "Refine with Ultraplan" remote URL — Remote Control/cloud bridge features not present in this mirror.
- `/ultrareview` launch polish (parallelized checks, diffstat, animated launching) — cloud multi-agent feature.
- Subagent 10-minute stall timeout, MCP concurrent-call watchdog disarm fix, SDK image content block crash → text-placeholder degrade — subagent/SDK internals in obfuscated source.
- Bash tool multi-line comment UI-spoofing fix, Bash `dangerouslyDisableSandbox` permission-prompt fix, `cd <current-directory> && git …` no-op permission-prompt skip, macOS `/private/{etc,var,tmp,home}` dangerous-removal rules, Bash deny-rule matching under `env/sudo/watch/ionice/setsid` wrappers, `Bash(find:*)` not auto-approving `-exec`/`-delete` — security/permission-prompt fixes that live in Bash tool scaffolding not fully mirrored here.
- Markdown table rendering with pipes in inline code spans, `/copy` "Full response" table column alignment, session recap not auto-firing while composing, "copied N chars" toast overcount under emoji, `/insights` EBUSY on Windows, exit-confirmation one-shot-vs-recurring label fix — Ink/TUI + Windows-platform fixes below our faithful-mirror line.
- `CLAUDE_CODE_EXTRA_BODY` `output_config.effort` 400 error on subagent calls to effort-unsupported models and on Vertex AI — the effort-propagation path in our mirror is simpler; upstream fix modifies the extra-body merge in the CCR/Vertex adapter layer.
- `thinking.type.enabled` Bedrock Application Inference Profile ARN 400 error on Opus 4.7 — Bedrock adapter plumbing not in scope.
- ToolSearch ranking on pasted MCP tool names, compacting resumed long-context session "Extra usage required" fix, plugin install version-range conflict reporting, subagent transcript message misattribution, messages-typed-while-viewing-subagent hidden — internal flows in obfuscated source with no tractable local touchpoint.
- `/effort auto` confirmation wording ("Effort level set to max" to match status bar) — the upstream change requires threading the current model into `unsetEffortLevel()` and computing the displayed level there; mechanically small but speculative without the exact status-bar-label function, and cosmetic.

---

## 2.1.111 — April 16, 2026

Applies the user-facing, tractable subset of the upstream 2.1.111 changelog.

### Applied in this local source tree

- **Added `xhigh` effort level for Opus 4.7** — sits between `high` and `max`. Available via `/effort`, `--effort`, and the model picker cycle; other models downgrade to `high` at resolve time. `modelSupportsXHighEffort()` gates it to Opus 4.7 (`opus-4-7` substring match), mirroring the `modelSupportsMaxEffort()` Opus-4.6 gate. Surfaces updated: `EFFORT_LEVELS`, `EffortLevel` type, `toPersistableEffort`, `resolveAppliedEffort`, numeric→level conversion band (95→xhigh), `getEffortLevelDescription`; settings Zod enum; `--effort` CLI arg validator; `/effort` help text + argument hint + invalid-arg message; SDK `coreSchemas` (`supportedEffortLevels`, agent `effort`) + `controlSchemas` (`applied.effort`); `ModelPicker` cycle adds xhigh when `modelSupportsXHighEffort` is true, downgrade-on-display mirrors the max path (`src/utils/effort.ts`, `src/utils/settings/types.ts`, `src/main.tsx`, `src/commands/effort/{effort.tsx,index.ts}`, `src/entrypoints/sdk/{coreSchemas.ts,controlSchemas.ts}`, `src/components/ModelPicker.tsx`, `src/utils/frontmatterParser.ts`).
- **Added `OTEL_LOG_RAW_API_BODIES` and `CLAUDE_CODE_USE_POWERSHELL_TOOL` to `SAFE_ENV_VARS`** — supports the upstream 2.1.111 "emit full API request/response bodies as OTEL log events for debugging" toggle and the progressively-rolled-out Windows PowerShell tool opt-in/out (`src/utils/managedEnvConstants.ts`).
- **Added near-miss subcommand typo suggestion** — `claude udpate` now prints `Did you mean claude update?` before falling through to the default prompt action. Implemented as a pre-parse check in `run()` since the default command accepts a positional prompt (commander wouldn't flag the typo as an unknown command). Uses Damerau-Levenshtein edit distance with a length-scaled threshold (1 for ≤4 chars, 2 otherwise), and only triggers on a single bare positional — multi-word prompts are left alone (`src/main.tsx`).
- **Plan files named after the user's prompt** — added `buildPromptPlanSlugPrefix()` (kebab-case, strip URLs/slash-commands, ≤4 words / ≤40 chars) and a session-keyed prompt-hint map. `handlePromptSubmit` registers the hint on the first user message; `getPlanSlug()` uses it as a prefix and appends a random word suffix for uniqueness (e.g. `fix-auth-race-snug-otter.md`). Purely-random slugs remain the fallback when no hint is registered (`src/utils/plans.ts`, `src/utils/handlePromptSubmit.ts`).
- **Enabled commander `showSuggestionAfterError(true)`** — explicit opt-in so unknown subcommand and option typos inside command groups (`claude mcp lsit`) get the built-in "(Did you mean …?)" hint (`src/main.tsx`).
- **Bumped local source version to `2.1.111`** (from `2.1.110`) — `package.json` and `preload.ts` MACRO.

### Not applied (upstream-only or out of scope)

- Auto mode no longer requiring `--enable-auto-mode` — the flag is gated behind `feature('TRANSCRIPT_CLASSIFIER')`, which is stubbed to false in this mirror, so the flag is effectively unreachable here already; the upstream change also removes the persistent opt-in dialog gate, which lives in setup screens we don't fully mirror.
- Auto mode availability for Max subscribers on Opus 4.7 — GrowthBook-gated; not a code change in our mirror.
- `/effort` interactive slider (arrow-key selector) when called without arguments — the command-scaffold change is UI-only and would require a new `LocalJSXCommand` picker component.
- `/ultrareview` cloud multi-agent code review command — cloud infra, CCR-side.
- "Auto (match terminal)" theme option — terminal-introspection plumbing (dark/light detection) not present in this mirror.
- `/less-permission-prompts` skill — already surfaced via the skills registry (listed in the skills reminder); no local scaffolding needed.
- `/skills` menu token-count sort (`t` toggle), transcript view shortcuts (`[`, `v`), full-width truncation rule, `/effort` interactive slider, `+N lines` rule change — all Ink/TUI rendering polish below the faithful-mirror line.
- PowerShell tool progressive rollout on Windows — the env var is now safe-env; the tool's Windows-specific rollout code is not mirrored.
- Read-only bash commands with glob patterns / `cd <project-dir> &&` prefix permission skip — requires extending the read-only classifier in `readOnlyCommandValidation.ts`; upstream change is nontrivial and security-sensitive.
- Plugin error propagation on headless init event, plugin dependency error distinction (conflicting/invalid/overly-complex version requirements), plugin update stale-version / interrupted-install recovery — plugin-subsystem internals beyond the simplified mirror.
- Reverted v2.1.110 non-streaming fallback retry cap — the cap was never applied in our mirror, so nothing to revert.
- `/setup-vertex` and `/setup-bedrock` improvements (show actual settings.json path when `CLAUDE_CONFIG_DIR` is set, seed candidates from existing pins, offer "with 1M context") — setup-command internals; local command scaffolds are minimal.
- Ctrl+U / Ctrl+Y / Ctrl+L keybinding semantics, iTerm2+tmux display tearing, `@` file suggestions scanning non-git directories, LSP diagnostic ordering, `/resume` tab-completion bypassing picker, `/context` grid blank lines, `/clear` dropping session_name, `/rename` persistence, feedback survey back-to-back dismissal, bare-URL wrapping clickability, Windows env-file propagation, Windows drive-letter permission path normalization — terminal/TUI/platform-specific patches below our faithful-mirror line.
- OTEL trace for 429 referencing the wrong status page on Bedrock/Vertex/Foundry, `Unknown skill: commit` misroute, plugin install recovery — internal fixes without a direct local touchpoint in this mirror.

---

## 2.1.110 — April 15, 2026

Applies the user-facing, tractable subset of the upstream 2.1.110 changelog.

### Applied in this local source tree

- **Added `/tui` command + `tui` setting** — switches the Ink renderer between `default` and `fullscreen` (alt-screen) rendering without restarting. The `/tui` command persists the choice via `updateSettingsForSource('userSettings', { tui })`, and `isFullscreenEnvEnabled()` now reads the setting after the env var precedence chain (`src/commands/tui/`, `src/utils/fullscreen.ts`, `src/utils/settings/types.ts`).
- **Added `/focus` command** — toggles the new `isFocusOnly` flag on `AppState`, decoupling focus view from the `ctrl+o` verbose-transcript toggle (`src/commands/focus/`, `src/state/AppStateStore.ts`). Transcript filtering wiring is intentionally deferred; this is the upstream command surface.
- **Added `PushNotificationTool` scaffolding** — full tool definition (inputs, prompt, UI render, `isEnabled` gated on `pushNotifications.enabled && pushWhenClaudeDecides` in settings) so the `require('./tools/PushNotificationTool/PushNotificationTool.js')` in `tools.ts` has a real target. Delivery is a logged stub — real delivery requires the Remote Control bridge, which is CCR-side.
- **Added `autoScrollEnabled`, `tui`, `pushNotifications`, and `showLastResponseInExternalEditor` to `SettingsSchema`** — surfacing the new 2.1.110 toggles via `/config` and managed settings (`src/utils/settings/types.ts`).
- **Bash tool now enforces the documented maximum timeout** — `BashTool.tsx` was using `timeout || getDefaultTimeoutMs()` without clamping, so a model-supplied `timeout` above `BASH_MAX_TIMEOUT_MS` slipped through and contradicted the tool's own prompt ("up to ${getMaxTimeoutMs()}ms"). Now `Math.min(...)` with `getMaxTimeoutMs()`, aligning with the PowerShellTool behavior (`src/tools/BashTool/BashTool.tsx`).
- **Added `TRACEPARENT` and `TRACESTATE` to `SAFE_ENV_VARS`** — so SDK/headless sessions launched via managed env propagation can join an existing distributed trace (`src/utils/managedEnvConstants.ts`).
- **Added `CLAUDE_CODE_ENABLE_AWAY_SUMMARY` opt-out env var** — `useAwaySummary` now short-circuits if the env var is falsy, bypasses GrowthBook if truthy (needed for telemetry-disabled users: Bedrock/Vertex/Foundry/`DISABLE_TELEMETRY`), and otherwise falls back to the existing GB gate. Env var is also now in `SAFE_ENV_VARS` so managed settings can set it (`src/hooks/useAwaySummary.ts`, `src/utils/managedEnvConstants.ts`).
- **Bumped local source version to `2.1.110`** (from `2.1.101`) — `package.json` and `preload.ts` MACRO.

### Not applied (upstream-only or out of scope)

- Remote Control message routing for `/context`, `/exit`, `/reload-plugins` (bridge is CCR-side, already stubbed locally).
- `--resume` / `--continue` resurrecting unexpired scheduled tasks — requires the CronCreate/scheduler persistence path we don't mirror.
- Write-tool IDE-diff "user edited content" notification — requires VSCode IDE extension diff-proposal plumbing not faithfully present in this source tree.
- `/doctor` duplicate-MCP-endpoint warning, `/plugin` Installed-tab pin/fold reordering, f-to-favorite, dependency-install listing.
- Ctrl+G external-editor "include last response as comment" option (UI plumbing for Ctrl+G editor round-trip).
- Rendering/focus/flicker/keystroke-drop/`/resume` title/session-cleanup/synchronized-output/ink-wide-line fixes — terminal-level patches below our faithful-mirror line.
- PermissionRequest hook `updatedInput` re-check against `permissions.deny` / `setMode:'bypassPermissions'` respect — upstream hook-engine fix, not surfaced in this mirror's simplified hook layer.
- `PreToolUse` hook `additionalContext` preservation on tool-call failure; `stdio` MCP stray-stdout tolerance; headless auto-title suppression under `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`; "Open in editor" untrusted-filename hardening — internal fixes without a direct local touchpoint.
- `--resume`/`--continue` auto-retitle-vs-prompt display precedence; queued-message double-render; Remote Control re-login prompt / rename-persistence; session-subdirectory cleanup — Remote/session-manager internals.

---

## 2.1.101 — April 10, 2026

### Applied
- **Fixed command injection vulnerability in POSIX `which` / Windows `where.exe` fallback** — `whichNodeAsync` and `whichNodeSync` passed the command name through a shell string unsanitized; now uses `execa` array-args (no shell) for async, and quotes/escapes for sync (`src/utils/which.ts`)
- **Fixed `permissions.deny` rules not overriding a PreToolUse hook's `permissionDecision: 'ask'`** — when a hook returned 'ask', the `forceDecision` path bypassed `hasPermissionsToUseTool` entirely, skipping deny-rule checks; now deny rules are checked before the forceDecision passthrough (`src/services/tools/toolHooks.ts`)
- **Added `CLAUDE_CODE_CERT_STORE` to `SAFE_ENV_VARS`** — supports the upstream OS CA certificate store trust feature; set to `bundled` to use only bundled CAs (`src/utils/managedEnvConstants.ts`)
- **Improved settings resilience: unrecognized hook event names no longer cause the entire settings file to be rejected** — `HooksSchema` now accepts any string key and silently strips unknown events during parsing (`src/schemas/hooks.ts`)

### Not applied (upstream-only)
Skipped: `/team-onboarding` command, OS CA cert auto-trust plumbing beyond env var, `/ultraplan` auto-create cloud env, brief mode structured retry, focus mode self-contained summaries, tool-not-available error messages, rate-limit retry messages, refusal error messages, `--resume` session title support, plugin hooks with `allowManagedHooksOnly`, `/plugin update` marketplace warning, plan mode Ultraplan visibility, OTEL tracing opt-in fields, SDK `query()` cleanup, memory leak in virtual scroller, `--resume`/`--continue` recovery fixes, hardcoded 5-minute timeout (already 600s in our source), `--setting-sources` cleanup period, Bedrock SigV4 auth header conflict, worktree stale directory, subagent MCP/worktree access, sandbox `mktemp`, MCP serve `outputSchema`, RemoteTrigger empty body, `/resume` picker fixes, Grep ENOENT fallback, `/btw` disk write, `/context` breakdown, plugin slash-command/cache/context fixes, `/mcp` OAuth menu, keybinding C0 bytes, `/login` OAuth URL, rendering/flicker fixes, in-app settings refresh, `--continue -p`, Remote Control fixes, `/insights` link, VSCode file-attachment clear.

---

## 2.1.96 — April 8, 2026

Version-only bump. The single upstream fix (Bedrock 403 "Authorization header is missing" regression with `AWS_BEARER_TOKEN_BEDROCK` / `CLAUDE_CODE_SKIP_BEDROCK_AUTH`) does not affect this source tree — we did not touch Bedrock auth code in our 2.1.94 sync.

---

## 2.1.94 — April 7, 2026

Applies the user-facing, tractable subset of the upstream 2.1.94 changelog.

### Applied in this local source tree

- Changed default effort level from `medium` to `high` (i.e. `undefined` in the API) for API-key, Bedrock/Vertex/Foundry, Team, and Enterprise users on Opus 4.6. Pro subscribers remain at `medium`.
- Added `sessionTitle` field to `UserPromptSubmit` hook specific output, allowing hooks to set the session title.
- `--resume` now resumes sessions from other worktrees of the same repo directly for all users (previously gated to internal users only).
- Fixed CJK and other multibyte text being corrupted with U+FFFD in `stream-json` stdout guard when chunk boundaries split a UTF-8 sequence — now uses `TextDecoder` with streaming mode.
- Added `FORCE_HYPERLINK` environment variable support in terminal hyperlink detection, so setting it via `settings.json` env is respected.
- Plugin skills declared via `"skills": ["./"]` now use the skill's frontmatter `name` for the invocation name instead of the directory basename, giving a stable name across install methods.

### Not applied (upstream-only internal fixes)

- `CLAUDE_CODE_USE_MANTLE` Bedrock Mantle provider support
- Slack MCP compact `#channel` header with clickable link
- `keep-coding-instructions` frontmatter field for plugin output styles
- 429 rate-limit Retry-After agent stuck fix
- Console login macOS keychain locked/out-of-sync fix
- Plugin hooks YAML frontmatter / `CLAUDE_PLUGIN_ROOT` resolution fixes
- SDK/print mode partial assistant response preservation on interrupt
- Scrollback repeated diff / blank pages in long sessions
- Multiline prompt indentation under `❯` caret
- Shift+Space inserting literal "space" in search inputs
- Hyperlinks opening two browser tabs in tmux + xterm.js terminals
- Alt-screen ghost lines from content height changes mid-scroll
- Native terminal cursor not tracking selected tab in dialogs
- Bedrock Sonnet 3.5 v2 inference profile ID fix
- VSCode cold-open subprocess reduction, dropdown menu fix, settings.json parse warning banner

---

## 2.1.92 — April 4, 2026

Applies the user-facing, tractable subset of the upstream 2.1.92 changelog.

### Applied in this local source tree

- Added `forceRemoteSettingsRefresh` policy setting: when true in managed/policy settings, the CLI blocks startup until remote managed settings are freshly fetched and exits fail-closed if the fetch fails. Useful for managed deployments where stale cached policy is unacceptable.
- Remote Control session names now use the machine hostname as the default prefix (e.g. `myhost-graceful-unicorn`) instead of the hardcoded `remote-control-` prefix. Overridable via the `CLAUDE_CODE_REMOTE_CONTROL_SESSION_NAME_PREFIX` environment variable.
- Removed `/tag` command (sessions are still tagged via session metadata but the interactive slash command is gone).
- Removed `/vim` command (toggle vim mode via `/config` → Editor mode instead).
- Bumped local source version to `2.1.92` (from `2.1.91`).

### Not applied (upstream-only internal fixes)

Skipped items that require forensic access to internals not faithfully present in the deobfuscated source, or are platform-specific infra fixes:

- Interactive Bedrock setup wizard from the login screen
- `/cost` per-model + cache-hit breakdown for subscription users
- `/release-notes` interactive version picker
- Pro-user prompt-cache-expired footer hint
- Subagent spawning tmux pane-count failure after window kills/renumbers
- Prompt-type Stop hooks with `ok:false` from small fast model, `preventContinuation:true` semantics
- Tool input validation for streamed JSON-encoded array/object fields
- API 400 on whitespace-only thinking text blocks
- Accidental feedback-survey submissions from auto-pilot keypresses
- Misleading "esc to interrupt" hint alongside "esc to clear" with selection active
- Homebrew update prompts (stable vs @latest channel)
- `ctrl+e` jumping past end-of-line in multiline prompts
- Duplicate message at two scroll positions (DEC 2026 terminals: iTerm2, Ghostty)
- Idle-return `/clear to save X tokens` showing cumulative instead of current-context tokens
- Plugin MCP servers stuck "connecting" when duplicating an unauthenticated claude.ai connector
- Write tool diff-computation 60% speedup for large files with tabs/`&`/`$`
- Linux sandbox `apply-seccomp` helper in npm + native builds (unix-socket blocking)

---

## 2.1.91 — April 2, 2026

Applies the user-facing, tractable subset of the upstream 2.1.90 and 2.1.91 changelogs in a single bump.

### Applied in this local source tree

From upstream 2.1.90:

- Added `CLAUDE_CODE_PLUGIN_KEEP_MARKETPLACE_ON_FAILURE`: when set, a failed `git pull` during marketplace refresh keeps the existing cache instead of wiping and re-cloning. Useful for offline/restricted environments.
- Added `.husky` to the protected-directories list for `acceptEdits` mode (same protection as `.git`, `.vscode`, `.idea`, `.claude`).
- Removed `Get-DnsClientCache` cmdlet and `ipconfig /displaydns` flag from the PowerShell tool's auto-allow list (DNS cache privacy). Users who need these can add an explicit allow rule.
- `/resume` picker now filters out sessions created by `claude -p` or SDK transports (`sdk-cli`, `sdk-ts`, `sdk-py`) based on the session's stored `entrypoint`.

From upstream 2.1.91:

- MCP tool-result persistence override via `_meta["anthropic/maxResultSizeChars"]`: servers can annotate individual tools (e.g. DB-schema inspectors) to allow results up to **500K** characters to pass through without being persisted to a preview file.
- Added `disableSkillShellExecution` setting to disable inline shell execution (```! blocks and `!\`…\`` inline) in skills, custom slash commands, and plugin commands.
- `claude-cli://open?q=` deep links now accept URL-encoded newlines (`%0A` / `%0D`) for multi-line prompts. cmd.exe and AppleScript escape boundaries were updated to handle newlines safely (cmd.exe strips LF/CR to a space, AppleScript escapes to `\n`/`\r`).
- `/feedback` (and its alias `/bug`) stays visible in the slash menu when disabled; invoking it now prints an explanation (third-party provider, env var, policy, etc.) instead of silently disappearing.
- Bumped local source version to `2.1.91` (from `2.1.89`).

### Not applied (upstream-only internal fixes)

Skipped items that require forensic access to internals not faithfully present in the deobfuscated source, or are platform-specific infra fixes:

- `/powerup` interactive lessons
- Rate-limit dialog auto-reopen loop
- `--resume` prompt-cache miss regression (v2.1.69+)
- Edit/Write race with PostToolUse format-on-save hooks
- PreToolUse hooks emitting JSON to stdout + exit code 2 not blocking
- Collapsed search/read summary duplicated in scrollback on CLAUDE.md auto-load
- Auto-mode boundary honor-ing ("don't push", "wait for X")
- Click-to-expand hover colors on light terminal themes
- UI crash on malformed tool input, header disappearance on scroll, PowerShell tool hardening (trailing `&`, `-ErrorAction Break`, archive TOCTOU, parse-fail fallback)
- JSON.stringify MCP schema per turn, SSE linear-time streaming, long-session transcript write quadratic, /resume all-projects parallel load
- Transcript chain breaks on `--resume` with silent write failures
- `cmd+delete` on iTerm2/kitty/WezTerm/Ghostty/Windows Terminal
- Plan mode container restart recovery, `permissions.defaultMode: "auto"` JSON-schema validation, Windows version cleanup protecting rollback copy
- Improved `/claude-api` skill guidance content, Bun.stripANSI perf, shorter `old_string` anchors in Edit tool output
- Plugins shipping executables under `bin/` (requires plugin-system changes beyond this pass)

See upstream Anthropic Claude Code 2.1.90 / 2.1.91 release notes for full details.

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
