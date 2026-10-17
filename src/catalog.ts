/**
 * Live free-model catalog for OpenCode Zen.
 *
 * The Zen listing endpoint reports every served model id but no metadata, so
 * new free ids are enriched from models.dev (provider `opencode`) and merged
 * over the curated {@link SEED_MODELS}:
 *
 * - ids already curated keep their verified seed values;
 * - new free ids are appended, with models.dev limits when available and
 *   conservative defaults otherwise;
 * - ids on the {@link UNAVAILABLE} denylist are never offered.
 *
 * Wiring: the host calls the provider `refreshModels(context)` hook during its
 * catalog refresh passes (interactive/RPC startup, model selector open) and
 * publishes the returned list as the provider's live models. Seeds absent from
 * the listing are kept: a listing miss is not proof the model stopped working,
 * and dropping a model under the user's cursor mid-session is hostile.
 */

import {
	SEED_MODELS,
	UNAVAILABLE,
	isFreeModelId,
	type ChatModelConfig,
} from './models.ts'

export const ZEN_MODELS_ENDPOINT = 'https://opencode.ai/inference/v1/models'
export const MODELS_DEV_ENDPOINT = 'https://models.dev/api.json'
export const MODELS_DEV_PROVIDER = 'opencode'

/** Conservative window for a live model that has no models.dev entry yet. */
export const DEFAULT_CONTEXT_WINDOW = 200_000
export const DEFAULT_MAX_TOKENS = 32_000

/** Reuse a successful live listing for this long before fetching again. */
export const LIVE_REFRESH_TTL_MS = 10 * 60_000
export const CATALOG_TIMEOUT_MS = 10_000

/** Metadata shape of one models.dev entry, kept structurally loose: every
 * field is validated before use because the payload is remote input. */
interface ModelsDevModel {
	readonly name?: unknown
	readonly reasoning?: unknown
	readonly limit?: { readonly context?: unknown; readonly output?: unknown } | null
	readonly modalities?: { readonly input?: unknown } | null
}

export type ModelsDevCatalog = Readonly<Record<string, ModelsDevModel>>

export interface LiveCatalog {
	readonly models: readonly ChatModelConfig[]
	/** `live` once a listing fetch succeeded; `seed` until then. */
	readonly source: 'live' | 'seed'
	/** Epoch milliseconds of the last successful listing fetch (0 when never). */
	readonly fetchedAt: number
	/** Failure of the most recent refresh attempt, if any. */
	readonly error?: string
}

export interface CatalogFetchers {
	fetchListing(signal: AbortSignal): Promise<unknown>
	fetchMetadata(signal: AbortSignal): Promise<unknown>
}

export interface CatalogRefreshOptions {
	readonly allowNetwork: boolean
	readonly force?: boolean
	readonly signal?: AbortSignal
	readonly fetchers: CatalogFetchers
	readonly now?: () => number
}

function positiveInt(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined
}

/** Extracts the served model ids from the Zen listing payload. */
export function parseListing(raw: unknown): string[] {
	if (typeof raw !== 'object' || raw === null) throw new Error('Zen listing: response is not a JSON object')
	const data = (raw as { data?: unknown }).data
	if (!Array.isArray(data)) throw new Error('Zen listing: missing "data" array')

	const ids: string[] = []
	for (const entry of data) {
		if (typeof entry !== 'object' || entry === null) continue
		const id = (entry as { id?: unknown }).id
		if (typeof id === 'string' && id.length > 0) ids.push(id)
	}
	return ids
}

/** Extracts the `opencode` provider block from a models.dev payload; a missing
 * or malformed block degrades to "no metadata" rather than failing the refresh. */
export function parseModelsDev(raw: unknown): ModelsDevCatalog {
	if (typeof raw !== 'object' || raw === null) return {}
	const provider = (raw as Record<string, unknown>)[MODELS_DEV_PROVIDER]
	if (typeof provider !== 'object' || provider === null) return {}
	const models = (provider as { models?: unknown }).models
	if (typeof models !== 'object' || models === null) return {}
	return models as ModelsDevCatalog
}

function displayName(id: string, metadata: ModelsDevModel | undefined): string {
	const provided = metadata?.name
	if (typeof provided === 'string' && provided.trim().length > 0) return provided

	const words = id.replace(/-free$/, '').split('-').filter(Boolean)
	const base = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
	return `${base} (free)`
}

/** Builds a config for a live id that has no curated seed. */
export function dynamicEntry(id: string, metadata: ModelsDevModel | undefined): ChatModelConfig {
	const contextWindow = positiveInt(metadata?.limit?.context) ?? DEFAULT_CONTEXT_WINDOW
	const requestedOutput = positiveInt(metadata?.limit?.output) ?? DEFAULT_MAX_TOKENS
	const modalities = metadata?.modalities?.input
	const image = Array.isArray(modalities) && modalities.includes('image')
	const input: ('text' | 'image')[] = image ? ['text', 'image'] : ['text']

	return {
		id,
		name: displayName(id, metadata),
		reasoning: typeof metadata?.reasoning === 'boolean' ? metadata.reasoning : true,
		input,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow,
		maxTokens: Math.min(requestedOutput, contextWindow),
	}
}

/** Curated seeds first, then every new free id the listing reports. */
export function mergeCatalog(listingIds: Iterable<string>, metadata: ModelsDevCatalog): ChatModelConfig[] {
	const merged = [...SEED_MODELS]
	const seen = new Set(merged.map((model) => model.id))

	for (const id of listingIds) {
		if (!isFreeModelId(id)) continue
		if (Object.hasOwn(UNAVAILABLE, id)) continue
		if (seen.has(id)) continue
		seen.add(id)
		merged.push(dynamicEntry(id, metadata[id]))
	}
	return merged
}

/**
 * Fetches both sources and returns the merged list. The listing is required —
 * without it the live catalog cannot be trusted, so the error propagates and
 * the caller keeps its previous list. models.dev is best-effort.
 */
export async function fetchLiveCatalog(
	fetchers: CatalogFetchers,
	signal: AbortSignal,
): Promise<ChatModelConfig[]> {
	const [listing, metadata] = await Promise.allSettled([
		fetchers.fetchListing(signal),
		fetchers.fetchMetadata(signal),
	])

	if (listing.status === 'rejected') {
		throw listing.reason instanceof Error ? listing.reason : new Error(String(listing.reason))
	}

	const catalog = metadata.status === 'fulfilled' ? parseModelsDev(metadata.value) : {}
	return mergeCatalog(parseListing(listing.value), catalog)
}

let activeCatalog: LiveCatalog = { models: SEED_MODELS, source: 'seed', fetchedAt: 0 }
let inflightRefresh: Promise<LiveCatalog> | undefined

/** The catalog the provider is currently registered with. */
export function currentCatalog(): LiveCatalog {
	return activeCatalog
}

/** Restores the module to its initial state. Test helper. */
export function resetCatalogState(): void {
	activeCatalog = { models: SEED_MODELS, source: 'seed', fetchedAt: 0 }
	inflightRefresh = undefined
}

/**
 * Refreshes the live catalog and updates the module state. Never throws: a
 * failed fetch keeps the previous list and records the failure in `error`, so
 * the host can report it without losing the working catalog.
 *
 * Concurrent callers share one in-flight fetch; a `live` catalog younger than
 * {@link LIVE_REFRESH_TTL_MS} is reused unless `force` is set.
 */
export async function refreshCatalog(options: CatalogRefreshOptions): Promise<LiveCatalog> {
	const now = options.now ?? Date.now
	const fresh = activeCatalog.source === 'live' && now() - activeCatalog.fetchedAt < LIVE_REFRESH_TTL_MS
	if (!options.allowNetwork || (!options.force && fresh)) return activeCatalog
	if (inflightRefresh) return inflightRefresh

	const run = (async (): Promise<LiveCatalog> => {
		const timeout = AbortSignal.timeout(CATALOG_TIMEOUT_MS)
		const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
		try {
			const models = await fetchLiveCatalog(options.fetchers, signal)
			activeCatalog = { models, source: 'live', fetchedAt: now() }
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			activeCatalog = { ...activeCatalog, error: message }
		}
		return activeCatalog
	})()

	inflightRefresh = run
	try {
		return await run
	} finally {
		if (inflightRefresh === run) inflightRefresh = undefined
	}
}
