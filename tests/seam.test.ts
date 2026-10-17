/**
 * Seam registration contract: the host dispatches `zen-free/*` models
 * through the pi-ai api-registry, so the custom API id must be registered there
 * with both a `stream` and a `streamSimple` handler.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { getApiProvider, getApiProviders } from '@earendil-works/pi-ai/compat'

import { API_ID, PROVIDER, SOURCE_ID, gateHeaders, registerSeam } from '../src/index.ts'
import { clientProjectID } from '../src/session.ts'

const PROJECT_ID = clientProjectID('pi:default-project')

test('registerSeam registers the custom API id in the host api-registry', () => {
	registerSeam()

	const provider = getApiProvider(API_ID)
	assert.ok(provider, `${API_ID} must be registered so Pi can dispatch zen-free models`)
	assert.equal(provider.api, API_ID)
	assert.equal(typeof provider.stream, 'function')
	assert.equal(typeof provider.streamSimple, 'function')
})

test('registerSeam is idempotent and keeps a single API entry', () => {
	registerSeam()
	const before = getApiProviders().filter((p) => p.api === API_ID).length
	registerSeam()
	const after = getApiProviders().filter((p) => p.api === API_ID).length

	assert.equal(before, 1)
	assert.equal(after, 1, 'repeated extension loads must not stack duplicate API providers')
})

test('seam handler rejects a model whose api does not match the registration', () => {
	registerSeam()
	const provider = getApiProvider(API_ID)

	assert.throws(
		() => provider!.streamSimple({ api: 'openai-completions' } as never, {} as never),
		/Mismatched api/,
		'the registry guards against dispatching a foreign api into the seam',
	)
})

test('gateHeaders drops x-opencode-request, which the Zen gate rejects with 403', () => {
	const headers = gateHeaders(
		{
			Authorization: 'Bearer public',
			'x-opencode-request': 'prt_13e70f2ad01bXyopxVJK7Ax9nB',
			'X-OpenCode-Request': 'prt_uppercase_variant',
		},
		'ses_000549579ffe3NJNuhFlyimStm',
	)

	assert.equal('x-opencode-request' in headers, false)
	assert.equal('X-OpenCode-Request' in headers, false)
	assert.equal(headers.Authorization, 'Bearer public')
})

test('gateHeaders re-asserts disguise and session headers over foreign values', () => {
	const foreignSession = 'ses_ec18f0d52ffeLXHy02bayqpbzL'
	const headers = gateHeaders(
		{
			'User-Agent': 'opencode/1.18.18',
			'user-agent': 'opencode/1.18.18',
			'x-opencode-project': 'global',
			'x-opencode-session': foreignSession,
		},
		'ses_bf017f0e5ffe4eLIReDJGQ2gez',
	)

	assert.equal(headers['user-agent'], 'opencode/latest/2.0.29/cli')
	assert.equal(headers['User-Agent'], undefined, 'only our casing may survive')
	assert.equal(headers['x-opencode-project'], PROJECT_ID)
	assert.equal(headers['x-opencode-session'], 'ses_bf017f0e5ffe4eLIReDJGQ2gez')
	assert.equal(headers['x-opencode-client'], 'cli')
	assert.equal(headers['X-Session-Id'], 'ses_bf017f0e5ffe4eLIReDJGQ2gez')
})

test('gateHeaders tolerates missing and null-valued input headers', () => {
	const inputs: (Record<string, string | null> | undefined)[] = [
		undefined,
		{},
		{ 'x-opencode-project': null },
	]
	for (const incoming of inputs) {
		const headers = gateHeaders(incoming, 'ses_bf017f0e5ffe4eLIReDJGQ2gez')
		assert.equal(headers['x-opencode-client'], 'cli')
		assert.equal(headers['x-opencode-project']?.length, 40)
	}
})

test('PROVIDER and SOURCE_ID match what the extension registers', () => {
	assert.equal(PROVIDER, 'zen-free')
	assert.equal(SOURCE_ID, 'pi-zen-free')
	assert.equal(API_ID, 'openai-completions-zen-free')
})