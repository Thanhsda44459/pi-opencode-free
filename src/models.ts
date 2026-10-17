/**
 * Curated model seeds (offline fallback for the live catalog, see
 * `catalog.ts`) & known rejected denylist.
 */

import type { ProviderModelConfig } from '@earendil-works/pi-coding-agent'

/**
 * Chat-only view of the provider model config: the exported union also covers
 * image/classifier entries, which have no contextWindow/maxTokens.
 */
export type ChatModelConfig = Extract<ProviderModelConfig, { reasoning: boolean }> & {
	readonly contextWindow: number
	readonly maxTokens: number
}

export const SEED_MODELS: readonly ChatModelConfig[] = [
	{
		id: 'big-pickle',
		name: 'big-pickle (free)',
		reasoning: true,
		input: ['text'],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 32_000,
	},
	{
		id: 'mimo-v2.6-flash-free',
		name: 'MiMo v2.6 Flash (free)',
		reasoning: true,
		input: ['text', 'image'],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1_048_576,
		maxTokens: 32_000,
	},
	{
		id: 'ling-3.1-flash-free',
		name: 'Ling 3.1 Flash (free)',
		reasoning: true,
		input: ['text'],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 262_144,
		maxTokens: 32_768,
	},
	{
		id: 'nemotron-3.5-lightning-free',
		name: 'Nemotron 3.5 Lightning (free)',
		reasoning: true,
		input: ['text'],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 262_144,
		maxTokens: 262_144,
	},
	{
		id: 'space-bunny-free',
		name: 'Space Bunny (free)',
		reasoning: true,
		input: ['text', 'image'],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1_048_576,
		maxTokens: 524_288,
	},
	{
		id: 'fledge-alpha-free',
		name: 'Fledge Alpha (free)',
		reasoning: true,
		input: ['text', 'image'],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1_048_576,
		maxTokens: 131_072,
	},
	{
		id: 'longcat-2.5-preview-free',
		name: 'LongCat 2.5 Preview (free)',
		reasoning: true,
		input: ['text', 'image'],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1_000_000,
		maxTokens: 131_072,
	},
]

/**
 * Free-channel ids: OpenCode marks them with a `-free` suffix; `big-pickle`
 * is the flagship free model that predates the convention.
 */
export function isFreeModelId(id: string): boolean {
	return id === 'big-pickle' || id.endsWith('-free')
}

export const VERIFIED_FREE: Readonly<Record<string, true>> = {
	'big-pickle': true,
	'mimo-v2.6-flash-free': true,
	'ling-3.1-flash-free': true,
	'nemotron-3.5-lightning-free': true,
	'space-bunny-free': true,
	'fledge-alpha-free': true,
	'longcat-2.5-preview-free': true,
}

export const UNAVAILABLE: Readonly<Record<string, string>> = {
	'mimo-v2.5-free': '401 ModelError: not supported upstream',
	'exo-free': '410 ModelDeprecated: deprecated upstream',
	'jev-1.13-free': '400 ModelProtocolUnsupported: not served on this protocol',
	'ling-3.0-flash-fin-free': '400 Model is unavailable',
	'nemotron-3-ultra-free': '401 ModelError: not supported upstream',
	'muse-spark-1.2-contributor-free': '403 RegionError: blocked in this region',
	'muse-spark-1.3-contributor-free': '403 RegionError: blocked in this region',
}
