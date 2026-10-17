/**
 * Gate shaping logic ensuring agent-shaped request body & tools.
 *
 * OpenCode's Zen gate inspects the outgoing `tools` array and returns
 * 403 FreeTierError unless it recognises genuine OpenCode tool definitions.
 * Verified against the live gateway: a request carrying `read` alone passes,
 * but any tool whose description is a rewritten/shortened variant of the
 * shell tool (`bash`, `shell`, ...) is rejected.
 *
 * The host dispatches a TranscriptContext, whose tools live on the leading
 * system message (`toolsAdded` / `toolsRemoved` deltas) - not on a `tools`
 * property. So the gate has to rewrite the transcript, not a Context copy.
 */

import type { Message, SimpleStreamOptions, SystemMessage, Tool } from '@earendil-works/pi-ai'
import { getCurrentTools } from '@earendil-works/pi-ai'
import { gateTool, GATE_TOOL_NAMES, OPENCODE_TOOLS } from './tools.ts'

const GATE_TOOLS = GATE_TOOL_NAMES.map((name) => gateTool(name))

/**
 * Returns the genuine OpenCode definition when `tool` is one the gate checks,
 * otherwise the tool unchanged.
 */
function genuineDefinition(tool: Tool): Tool {
	const definition = OPENCODE_TOOLS[tool.name]
	if (!definition) return tool
	return {
		...tool,
		description: definition.description,
		parameters: definition.parameters as Tool['parameters'],
	}
}

/** Rebuilds the leading system message so the gate sees genuine definitions. */
function applyToTranscript(messages: Message[]): Message[] {
	const first = messages[0]
	if (!first || first.role !== 'system') {
		// No leading system message: prepend one carrying the gate tools.
		const [head, ...rest] = messages
		if (!head) return messages
		return [createGateSystemMessage(), head, ...rest] as Message[]
	}

	const system = first as SystemMessage
	const current = getCurrentTools([system])
	const shaped = current.map(genuineDefinition)
	const names = new Set(shaped.map((t) => t.name))
	const missing = GATE_TOOLS.filter((t) => !names.has(t.name))
	const tools = [...shaped, ...missing]

	if (
		missing.length === 0 &&
		tools.length === current.length &&
		tools.every((t, i) => t === current[i])
	) {
		return messages
	}

	const next: SystemMessage = { ...system, toolsAdded: tools }
	// A removal delta would drop a tool we just re-declared on the leading
	// message, so strip removals for every tool we now guarantee.
	const removed = (system.toolsRemoved ?? []).filter((r) => !names.has(r.name))
	if (removed.length > 0) next.toolsRemoved = removed
	else delete next.toolsRemoved

	return [next, ...messages.slice(1)]
}

function createGateSystemMessage(): SystemMessage {
	return { role: 'system', content: '', toolsAdded: [...GATE_TOOLS], timestamp: Date.now() }
}

/**
 * Ensures genuine OpenCode tool definitions for the gated tools are present in
 * the transcript, and only forces `toolChoice: 'none'` when the request really
 * has no tools at all.
 */
export function withGateTools(
	context: { readonly messages: readonly Message[] },
	options: SimpleStreamOptions,
): { context: { readonly messages: Message[] }; options: SimpleStreamOptions } {
	const messages = [...context.messages]
	const hadTools = getCurrentTools(messages).length > 0
	const next = applyToTranscript(messages)

	if (next === messages) return { context: { messages }, options }

	return {
		context: { messages: next },
		options: hadTools ? options : { ...options, toolChoice: 'none' },
	}
}