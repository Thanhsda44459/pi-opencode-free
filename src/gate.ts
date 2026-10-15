/**
 * Gate shaping logic ensuring agent-shaped request body & tools.
 */

import type { Context, SimpleStreamOptions } from '@earendil-works/pi-ai'
import { gateTool, GATE_TOOL_NAMES, OPENCODE_TOOLS } from './tools.ts'

const GATE_TOOLS = GATE_TOOL_NAMES.map((name) => gateTool(name))

/**
 * Ensures genuine OpenCode tool definitions for 'shell' and 'read' are present.
 * If user request has no tools, appends them and sets toolChoice to 'none'.
 */
export function withGateTools(
	context: Context,
	options: SimpleStreamOptions,
): { context: Context; options: SimpleStreamOptions } {
	const existing = context.tools ?? []

	const upgraded = existing.map((tool) => {
		const definition = OPENCODE_TOOLS[tool.name]
		if (!definition) return tool
		return {
			...tool,
			description: definition.description,
			parameters: definition.parameters as Record<string, unknown>,
		}
	})

	const names = new Set(upgraded.map((t) => t.name))
	const missing = GATE_TOOLS.filter((t) => !names.has(t.name))

	if (missing.length === 0 && upgraded.every((t, i) => t === existing[i])) {
		return { context, options }
	}

	const tools = [...upgraded, ...missing]

	if (existing.length === 0 && missing.length > 0) {
		return { context: { ...context, tools }, options: { ...options, toolChoice: 'none' } }
	}

	return { context: { ...context, tools }, options }
}
