import test from 'node:test'
import assert from 'node:assert/strict'

import { CANONICAL_SESSION, DESCENDING_TIME_PART, canonicalSessionID, descendingTimePart, sessionForRequest } from '../src/session.ts'
import { getCurrentTools } from '@earendil-works/pi-ai'
import { withGateTools } from '../src/gate.ts'
import { OPENCODE_TOOLS, gateTool } from '../src/tools.ts'
import { classifyUpstreamFailure } from '../src/errors.ts'
import { buildDoctorPayload } from '../src/doctor.ts'
import { SEED_MODELS } from '../src/models.ts'

test('canonicalSessionID produces valid OpenCode EID with counter [1, 63]', () => {
	const id1 = canonicalSessionID('uuid-session-1')
	assert.match(id1, CANONICAL_SESSION, 'Must match EID pattern')
	assert.match(id1.slice(4, 16), DESCENDING_TIME_PART, 'Hex segment must satisfy descending time layout')
	assert.ok(id1.slice(4, 16).endsWith('ffe'), 'Hex segment should end with ffe for counter 1')

	const id2 = canonicalSessionID('uuid-session-1')
	assert.equal(id1, id2, 'Same input must produce identical session ID deterministically')

	const id3 = canonicalSessionID('uuid-session-2')
	assert.notEqual(id1, id3, 'Different sessions must have distinct session IDs')
})

const userMessage = { role: 'user' as const, content: 'Hello', timestamp: 0 }

type TestTool = { name: string; description: string; parameters: Record<string, unknown> }

function systemMessage(tools: TestTool[]) {
	return { role: 'system' as const, content: '', toolsAdded: tools, timestamp: 0 }
}

test('withGateTools prepends a system message with genuine gate tools when the transcript has none', () => {
	const result = withGateTools({ messages: [userMessage] }, {})

	assert.equal(result.context.messages[0]?.role, 'system')
	assert.equal(result.options.toolChoice, 'none', 'No tools means the model must not be asked to call any')

	const tools = getCurrentTools(result.context.messages)
	assert.equal(tools.length, 2, 'Should inject shell and read')
	assert.equal(tools[0]?.description, gateTool('shell').description)
	assert.equal(tools[1]?.description, gateTool('read').description)
})

test('withGateTools keeps existing tools and does not force toolChoice none', () => {
	const custom = { name: 'custom_search', description: 'Search things', parameters: { type: 'object', properties: {} } }
	const result = withGateTools({ messages: [systemMessage([custom]), userMessage] }, { toolChoice: 'auto' })

	assert.equal(result.options.toolChoice, 'auto', 'Real tools present: tool calling must stay enabled')

	const tools = getCurrentTools(result.context.messages)
	const names = tools.map((t) => t.name)
	assert.ok(names.includes('custom_search'), 'custom tool must survive')
	assert.ok(names.includes('shell') && names.includes('read'), 'gate tools must be appended')
})

test('withGateTools replaces a rewritten shell description with the genuine one', () => {
	// The gate returns 403 FreeTierError for a shell tool that carries a
	// shortened/rewritten description, so the seam must restore it.
	const rewritten = { name: 'shell', description: 'Execute a shell command', parameters: { type: 'object', properties: {} } }
	const result = withGateTools({ messages: [systemMessage([rewritten]), userMessage] }, {})

	const shell = getCurrentTools(result.context.messages).find((t) => t.name === 'shell')
	assert.equal(shell?.description, gateTool('shell').description)
})

test('withGateTools honours a later removal delta for tools it does not own', () => {
	const custom = { name: 'custom_search', description: 'Search things', parameters: { type: 'object', properties: {} } }
	const removal = { role: 'system' as const, content: '', toolsRemoved: [{ name: 'custom_search' }], timestamp: 1 }

	const result = withGateTools({ messages: [systemMessage([custom]), removal, userMessage] }, {})

	const names = getCurrentTools(result.context.messages).map((t) => t.name)
	assert.equal(names.includes('custom_search'), false, 'the removal delta must still take effect')
	assert.ok(names.includes('shell') && names.includes('read'))
})

test('classifyUpstreamFailure accurately distinguishes error kinds', () => {
	const regionErr = classifyUpstreamFailure(403, 'RegionError: not available in your country')
	assert.equal(regionErr.kind, 'REGION_BLOCKED')

	const shapeErr = classifyUpstreamFailure(403, 'FreeTierError: OpenCode free tier can only be used from within OpenCode')
	assert.equal(shapeErr.kind, 'SHAPE_REJECTED')

	const modelErr = classifyUpstreamFailure(400, 'Model is unavailable')
	assert.equal(modelErr.kind, 'MODEL_GONE')

	const rateErr = classifyUpstreamFailure(429, 'Too many requests')
	assert.equal(rateErr.kind, 'RATE_LIMIT')
})

test('doctor payload contains required headers and agent tools', () => {
	const { headers, body } = buildDoctorPayload('big-pickle')
	const doctorHeaders = headers as Record<string, string>
	assert.equal(doctorHeaders['authorization'], 'Bearer public')
	assert.equal(doctorHeaders['x-opencode-client'], 'cli')
	assert.match(doctorHeaders['x-opencode-session'] as string, CANONICAL_SESSION)
	assert.equal(body.stream, true)
	assert.equal(body.tools.length, 2)
	assert.equal(body.tools[0]?.function.name, 'shell')
	assert.equal(body.tools[1]?.function.name, 'read')
})

test('SEED_MODELS metadata is flat and contextWindow is valid', () => {
	assert.ok(SEED_MODELS.length >= 6)
	for (const m of SEED_MODELS) {
		assert.ok(typeof m.contextWindow === 'number' && m.contextWindow > 0)
		assert.ok(typeof m.maxTokens === 'number' && m.maxTokens > 0)
		assert.ok(m.maxTokens <= m.contextWindow)
		assert.equal(m.cost?.input, 0)
		assert.equal(m.cost?.output, 0)
	}
})
