/**
 * Live catalog: parsing of both remote payloads, the merge policy over the
 * curated seeds, and the refresh state machine (TTL, force, dedupe, fallback).
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
	DEFAULT_CONTEXT_WINDOW,
	DEFAULT_MAX_TOKENS,
	LIVE_REFRESH_TTL_MS,
	currentCatalog,
	dynamicEntry,
	fetchLiveCatalog,
	mergeCatalog,
	parseListing,
	parseModelsDev,
	refreshCatalog,
	resetCatalogState,
	type CatalogFetchers,
} from '../src/catalog.ts'
import { SEED_MODELS, UNAVAILABLE, isFreeModelId } from '../src/models.ts'

test('isFreeModelId recognises the free-channel convention', () => {
	assert.equal(isFreeModelId('big-pickle'), true)
	assert.equal(isFreeModelId('beam-free'), true)
	assert.equal(isFreeModelId('claude-opus-5'), false)
	assert.equal(isFreeModelId('test'), false)
})

test('parseListing extracts string ids and rejects malformed payloads', () => {
	const ids = parseListing({
		object: 'list',
		data: [{ id: 'beam-free' }, { id: 7 }, { nope: true }, null, { id: 'test' }],
	})
	assert.deepEqual(ids, ['beam-free', 'test'])

	assert.throws(() => parseListing(null), /not a JSON object/)
	assert.throws(() => parseListing({}), /missing "data" array/)
})

test('parseModelsDev extracts the opencode block and degrades to empty', () => {
	const catalog = parseModelsDev({ opencode: { models: { 'beam-free': { name: 'Beam Free' } } } })
	assert.equal(catalog['beam-free']?.name, 'Beam Free')

	assert.deepEqual(parseModelsDev('nonsense'), {})
	assert.deepEqual(parseModelsDev({}), {})
	assert.deepEqual(parseModelsDev({ opencode: 42 }), {})
})

test('mergeCatalog appends new free ids, skips paid/denylisted ones, keeps every seed', () => {
	const metadata = {
		'beam-free': {
			name: 'Beam Free',
			reasoning: true,
			limit: { context: 1_048_576, output: 131_072 },
			modalities: { input: ['text', 'image'] },
		},
	}

	const merged = mergeCatalog(
		['claude-opus-5', 'beam-free', 'jev-1.13-free', 'test', 'big-pickle', 'sparkly-new-free'],
		metadata,
	)
	const byId = new Map(merged.map((model) => [model.id, model]))

	assert.ok(byId.has('beam-free'), 'new free model must be added')
	assert.ok(byId.has('sparkly-new-free'), 'metadata-less free model must be added with defaults')
	assert.equal(byId.has('claude-opus-5'), false, 'paid models must never leak in')
	assert.equal(byId.has('test'), false)
	assert.equal(byId.has('jev-1.13-free'), false, 'denylisted ids must stay out')
	assert.ok(Object.hasOwn(UNAVAILABLE, 'jev-1.13-free'), 'sanity: the denylist entry exists')

	for (const seed of SEED_MODELS) {
		assert.ok(byId.has(seed.id), `${seed.id} must survive the merge even when absent from the listing`)
	}

	assert.deepEqual(byId.get('beam-free'), {
		id: 'beam-free',
		name: 'Beam Free',
		reasoning: true,
		input: ['text', 'image'],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1_048_576,
		maxTokens: 131_072,
	})

	const fallback = byId.get('sparkly-new-free')
	assert.equal(fallback?.contextWindow, DEFAULT_CONTEXT_WINDOW)
	assert.equal(fallback?.maxTokens, DEFAULT_MAX_TOKENS)
	assert.deepEqual(fallback?.input, ['text'])
})

test('dynamicEntry clamps output to the window and humanizes unknown ids', () => {
	const clamped = dynamicEntry('tiny-free', { limit: { context: 8_192, output: 32_000 } })
	assert.equal(clamped.contextWindow, 8_192)
	assert.equal(clamped.maxTokens, 8_192, 'maxTokens must never exceed the context window')

	const humanized = dynamicEntry('some-cool-model-free', undefined)
	assert.equal(humanized.name, 'Some Cool Model (free)')
})

function fetchers(listing: unknown, metadata: unknown): CatalogFetchers {
	return {
		fetchListing: async () => {
			if (listing instanceof Error) throw listing
			return listing
		},
		fetchMetadata: async () => {
			if (metadata instanceof Error) throw metadata
			return metadata
		},
	}
}

test('fetchLiveCatalog merges the listing with models.dev metadata', async () => {
	const models = await fetchLiveCatalog(
		fetchers(
			{ data: [{ id: 'beam-free' }, { id: 'big-pickle' }] },
			{ opencode: { models: { 'beam-free': { limit: { context: 500_000, output: 10_000 } } } } },
		),
		new AbortController().signal,
	)

	const beam = models.find((model) => model.id === 'beam-free')
	assert.equal(beam?.contextWindow, 500_000)
	assert.equal(beam?.maxTokens, 10_000)
})

test('fetchLiveCatalog fails when the listing fails but tolerates metadata failure', async () => {
	await assert.rejects(
		fetchLiveCatalog(fetchers(new Error('HTTP 503'), {}), new AbortController().signal),
		/HTTP 503/,
	)

	const models = await fetchLiveCatalog(
		fetchers({ data: [{ id: 'beam-free' }] }, new Error('models.dev unreachable')),
		new AbortController().signal,
	)
	assert.ok(models.some((model) => model.id === 'beam-free'))
})

test('refreshCatalog honours allowNetwork, the TTL and force', async () => {
	resetCatalogState()
	let calls = 0
	const clock = { value: 1_000_000 }
	const counting: CatalogFetchers = {
		fetchListing: async () => {
			calls += 1
			return { data: [{ id: 'beam-free' }] }
		},
		fetchMetadata: async () => ({ opencode: { models: {} } }),
	}
	const options = { allowNetwork: true, fetchers: counting, now: () => clock.value }

	const offline = await refreshCatalog({ ...options, allowNetwork: false })
	assert.equal(offline.source, 'seed')
	assert.equal(calls, 0, 'offline refresh must not touch the network')

	const first = await refreshCatalog(options)
	assert.equal(first.source, 'live')
	assert.ok(first.models.some((model) => model.id === 'beam-free'))
	assert.equal(calls, 1)

	clock.value += LIVE_REFRESH_TTL_MS - 1
	const cached = await refreshCatalog(options)
	assert.equal(calls, 1, 'a fresh live catalog must be reused')
	assert.equal(cached.fetchedAt, first.fetchedAt)

	clock.value += 2
	await refreshCatalog(options)
	assert.equal(calls, 2, 'past the TTL the catalog must be refetched')

	await refreshCatalog({ ...options, force: true })
	assert.equal(calls, 3, 'force must bypass the TTL')

	resetCatalogState()
})

test('refreshCatalog keeps the last good list and records the failure', async () => {
	resetCatalogState()
	let healthy = true
	const flaky: CatalogFetchers = {
		fetchListing: async () => {
			if (!healthy) throw new Error('HTTP 503')
			return { data: [{ id: 'beam-free' }] }
		},
		fetchMetadata: async () => ({}),
	}
	const options = { allowNetwork: true, fetchers: flaky }

	await refreshCatalog(options)
	healthy = false
	const failed = await refreshCatalog({ ...options, force: true })

	assert.equal(failed.source, 'live', 'a failed refresh must keep the last good catalog')
	assert.ok(failed.models.some((model) => model.id === 'beam-free'))
	assert.match(failed.error ?? '', /HTTP 503/)

	resetCatalogState()
})

test('refreshCatalog shares one fetch between concurrent callers', async () => {
	resetCatalogState()
	let calls = 0
	const slow: CatalogFetchers = {
		fetchListing: async () => {
			calls += 1
			await new Promise((resolve) => setTimeout(resolve, 10))
			return { data: [{ id: 'beam-free' }] }
		},
		fetchMetadata: async () => ({}),
	}

	const [a, b] = await Promise.all([
		refreshCatalog({ allowNetwork: true, force: true, fetchers: slow }),
		refreshCatalog({ allowNetwork: true, force: true, fetchers: slow }),
	])

	assert.equal(calls, 1, 'concurrent refreshes must share the in-flight fetch')
	assert.equal(a, b)

	resetCatalogState()
	assert.equal(currentCatalog().source, 'seed')
})

test('refreshCatalog bounds the fetch with its own timeout and records it', async () => {
	resetCatalogState()
	const hung: CatalogFetchers = {
		fetchListing: (signal) =>
			new Promise((_, reject) => {
				signal.addEventListener('abort', () => reject(signal.reason), { once: true })
			}),
		fetchMetadata: (signal) =>
			new Promise((_, reject) => {
				signal.addEventListener('abort', () => reject(signal.reason), { once: true })
			}),
	}

	const timedOut = await refreshCatalog({ allowNetwork: true, force: true, fetchers: hung, timeoutMs: 25 })
	assert.equal(timedOut.source, 'seed', 'a hung fetch must fall back to the previous catalog')
	assert.ok(timedOut.error, 'the timeout must be recorded as the last error')

	const recovered = await refreshCatalog({
		allowNetwork: true,
		force: true,
		fetchers: fetchers({ data: [{ id: 'beam-free' }] }, {}),
	})
	assert.equal(recovered.source, 'live', 'a later healthy fetch must recover')
	assert.equal(recovered.error, undefined)

	resetCatalogState()
})
