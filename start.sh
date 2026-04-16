#!/usr/bin/env bash
#
# Start Claude Code - one-command launcher
#
# Authentication (pick one):
#   1. OAuth subscription (Pro/Max/Team/Enterprise):
#      ./start.sh login          # First-time login via browser
#      ./start.sh                # Then just run normally
#
#   2. API key:
#      export ANTHROPIC_API_KEY="sk-ant-xxx"
#      ./start.sh
#
#   3. Third-party proxy:
#      export ANTHROPIC_BASE_URL="https://your-proxy.com"
#      export ANTHROPIC_API_KEY="your-key"
#      ./start.sh
#
#   4. ChatGPT subscription (use GPT-5.4 as agent model):
#      ./start.sh chatgpt-login  # First-time login via browser
#      ./start.sh --model gpt5.4 # Then use GPT models
#
#   5. OpenAI API key:
#      export OPENAI_API_KEY="sk-xxx"
#      ./start.sh --model openai:gpt-5.4
#
# Usage:
#   ./start.sh                     # Interactive mode (Claude models)
#   ./start.sh login               # Login with Claude.ai subscription
#   ./start.sh chatgpt-login       # Login with ChatGPT subscription
#   ./start.sh logout              # Logout
#   ./start.sh --model gpt5.4      # Use GPT-5.4 via ChatGPT subscription
#   ./start.sh -p "your prompt"    # Non-interactive mode
#   ./start.sh --help              # Show help
#

set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# Ensure bun is in PATH
export PATH="$HOME/.bun/bin:$PATH"

# Clear bun's transpiler cache to prevent stale bytecode from causing hangs.
# Bun caches compiled modules by absolute path; running the same source from
# different directories can leave corrupt entries that deadlock module loading.
case "$(uname -s)" in
  Darwin)
    rm -rf "$HOME/Library/Caches/bun" 2>/dev/null
    ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    rm -rf "$LOCALAPPDATA/bun" 2>/dev/null
    rm -rf "$HOME/.bun/install/cache" 2>/dev/null
    rm -rf "$TEMP/bun-"* 2>/dev/null
    ;;
  Linux)
    rm -rf "$HOME/.cache/bun" 2>/dev/null
    ;;
esac

# Check if setup has been done
if [ ! -d "node_modules/@anthropic-ai/sdk" ]; then
  echo "First run detected. Running setup..."
  node scripts/setup.mjs
  echo ""
fi

# Handle "login" and "logout" subcommands
if [ "$1" = "login" ]; then
  shift
  exec bun src/entrypoints/cli.tsx auth login --claudeai "$@"
fi

if [ "$1" = "logout" ]; then
  shift
  exec bun src/entrypoints/cli.tsx auth logout "$@"
fi

# Handle "chatgpt-login" subcommand — authenticate with ChatGPT subscription
if [ "$1" = "chatgpt-login" ]; then
  shift
  exec bun -e "
    // Enable config reading before any provider code touches getGlobalConfig/saveGlobalConfig
    import { enableConfigs } from './src/utils/config.js';
    enableConfigs();

    import { generateAuthUrl, startCallbackListener, OAUTH_REDIRECT_URI } from './src/services/api/providers/chatgptOAuth.js';
    const { authUrl } = generateAuthUrl(OAUTH_REDIRECT_URI);
    console.log('Opening browser for ChatGPT login...');
    console.log('If the browser does not open, visit:', authUrl);
    startCallbackListener((result) => {
      if (result.tokens) {
        console.log('✓ ChatGPT login successful! Signed in as', result.tokens.email);
        console.log('  You can now use GPT models: ./start.sh --model gpt5.4');
        process.exit(0);
      } else {
        console.error('✗ ChatGPT login failed:', result.error);
        process.exit(1);
      }
    });
    import('child_process').then(cp => cp.exec('open \"' + authUrl + '\"' ));
  " "$@"
fi

# Auto-detect third-party proxy and disable incompatible features
if [ -n "$ANTHROPIC_BASE_URL" ] && ! echo "$ANTHROPIC_BASE_URL" | grep -q "anthropic.com"; then
  export DISABLE_PROMPT_CACHING="${DISABLE_PROMPT_CACHING:-1}"
  export DISABLE_INTERLEAVED_THINKING="${DISABLE_INTERLEAVED_THINKING:-1}"
  export CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS="${CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS:-1}"
fi

# Check if any auth method is available:
#   1. ANTHROPIC_API_KEY env var
#   2. OAuth credentials from previous login (~/.claude/.credentials.json or Keychain)
#   3. Third-party services (Bedrock/Vertex/Foundry)
#   4. OAuth token env var
#   5. OpenAI API key (for openai:* models)
#   6. ChatGPT subscription tokens (for chatgpt:* / gpt* models)
has_auth=false

if [ -n "$ANTHROPIC_API_KEY" ]; then
  has_auth=true
elif [ -n "$CLAUDE_CODE_OAUTH_TOKEN" ]; then
  has_auth=true
elif [ -n "$CLAUDE_CODE_USE_BEDROCK" ] || [ -n "$CLAUDE_CODE_USE_VERTEX" ] || [ -n "$CLAUDE_CODE_USE_FOUNDRY" ]; then
  has_auth=true
elif [ -n "$OPENAI_API_KEY" ]; then
  has_auth=true
elif [ -f "$HOME/.claude/.credentials.json" ] && [ -s "$HOME/.claude/.credentials.json" ]; then
  has_auth=true
else
  # Check macOS Keychain for OAuth credentials (silent, won't prompt)
  if security find-generic-password -s "Claude Code-credentials" -w >/dev/null 2>&1; then
    has_auth=true
  elif security find-generic-password -s "Claude Code" -w >/dev/null 2>&1; then
    has_auth=true
  fi
  # Check for ChatGPT subscription tokens in global config
  if [ "$has_auth" = false ]; then
    config_file="$HOME/.claude/config.json"
    if [ -f "$config_file" ] && grep -q "chatgpt_access_token" "$config_file" 2>/dev/null; then
      has_auth=true
    fi
  fi
fi

if [ "$has_auth" = false ]; then
  echo "No authentication found."
  echo ""
  echo "  Option 1 - Claude Pro/Max subscription (recommended):"
  echo "    ./start.sh login"
  echo ""
  echo "  Option 2 - Anthropic API key:"
  echo "    export ANTHROPIC_API_KEY=\"sk-ant-xxx\""
  echo "    ./start.sh"
  echo ""
  echo "  Option 3 - ChatGPT subscription (use GPT-5.4):"
  echo "    ./start.sh chatgpt-login"
  echo "    ./start.sh --model gpt5.4"
  echo ""
  echo "  Option 4 - OpenAI API key:"
  echo "    export OPENAI_API_KEY=\"sk-xxx\""
  echo "    ./start.sh --model openai:gpt-5.4"
  echo ""
  exit 1
fi

echo "✓ Authentication detected, starting Claude Code..."

exec bun src/entrypoints/cli.tsx "$@"
