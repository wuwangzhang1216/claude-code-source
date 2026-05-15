/**
 * Shared utilities for expanding environment variables in MCP server configurations
 */

/**
 * Expand environment variables in a string value
 * Handles ${VAR} and ${VAR:-default} syntax. POSIX shell parameter
 * expansions like ${var%pattern}, ${var##prefix}, ${var/old/new}, etc. are
 * left intact and NOT reported as missing — the downstream shell that
 * actually runs the MCP command will perform that expansion itself.
 *
 * @returns Object with expanded string and list of missing variables
 */
export function expandEnvVarsInString(value: string): {
  expanded: string
  missingVars: string[]
} {
  const missingVars: string[] = []

  const expanded = value.replace(/\$\{([^}]+)\}/g, (match, varContent) => {
    // Recognize only the two shapes we own:
    //   ${NAME}                — simple lookup
    //   ${NAME:-default}       — lookup with default
    // Anything else (e.g. ${var%pattern}, ${var##prefix}, ${var/a/b},
    // ${var^^}) is a POSIX shell parameter expansion we don't try to
    // emulate. Leave the literal token in place so the spawning shell
    // sees it and don't flag it as a missing env var.
    const m = /^([A-Za-z_][A-Za-z0-9_]*)(?::-(.*))?$/.exec(varContent)
    if (!m) {
      return match
    }
    const varName = m[1]!
    const defaultValue = m[2]
    const envValue = process.env[varName]

    if (envValue !== undefined) {
      return envValue
    }
    if (defaultValue !== undefined) {
      return defaultValue
    }

    // Track missing variable for error reporting
    missingVars.push(varName)
    // Return original if not found (allows debugging but will be reported as error)
    return match
  })

  return {
    expanded,
    missingVars,
  }
}
