import test from 'node:test'
import assert from 'node:assert/strict'

import { CANONICAL_SESSION, DESCENDING_TIME_PART, canonicalSessionID, descendingTimePart, sessionForRequest } from '../src/session.ts'
import { withGateTools } from '../src/gate.ts'
import { OPENCODE_TOOLS } from '../src/tools.ts'
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

test('withGateTools injects genuine tools when context has none', () => {
	const context = {
		messages: [{ role: 'user' as const, content: 'Hello' }],
	}
	const options = {}

	const result = withGateTools(context as any, options as any)
	assert.ok(result.context.tools, 'Tools array should be created')
	assert.equal(result.context.tools.length, 2, 'Should inject shell and read')
	assert.equal(result.options.toolChoice, 'none', 'Must set toolChoice to none when original had no tools')

	const shell = result.context.tools.find((t: any) => t.name === 'shell')
	assert.ok(shell, 'shell tool must be present')
	assert.equal(shell.description, OPENCODE_TOOLS.shell.description)
})

test('withGateTools preserves existing tools and avoids toolChoice none when tools were provided', () => {
	const customTool = {
		name: 'custom_search',
		description: 'Search things',
		parameters: { type: 'object', properties: {} },
	}
	const context = {
		tools: [customTool],
		messages: [{ role: 'user' as const, content: 'Search' }],
	}
	const options = { toolChoice: 'auto' }

	const result = withGateTools(context as any, options as any)
	assert.equal(result.context.tools.length, 3, 'Should preserve custom tool and append missing gate tools')
	assert.equal(result.options.toolChoice, 'auto', 'Should keep user-specified toolChoice')
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
	assert.equal(headers['authorization'], 'Bearer public')
	assert.equal(headers['x-opencode-client'], 'cli')
	assert.match(headers['x-opencode-session'], CANONICAL_SESSION)
	assert.equal(body.stream, true)
	assert.equal(body.tools.length, 2)
	assert.equal(body.tools[0].function.name, 'shell')
	assert.equal(body.tools[1].function.name, 'read')
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
