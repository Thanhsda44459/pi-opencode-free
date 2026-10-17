/**
 * Main entry point for pi-zen-free extension.
 */

import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
// The extension loader aliases both entrypoints to the bundled pi-ai/compat, so
// the api-registry instance here is the same one the host dispatches through.
import { registerApiProvider, streamSimple } from '@earendil-works/pi-ai/compat'
import { getCurrentTools } from '@earendil-works/pi-ai'
import type {
	Api,
	AssistantMessage,
	AssistantMessageEventStream,
	Model,
	SimpleStreamOptions,
	StreamOptions,
	TranscriptContext,
} from '@earendil-works/pi-ai'
import type { ExtensionAPI, ProviderModelConfig } from '@earendil-works/pi-coding-agent'

import type { ChatModelConfig } from './models.ts'

import { withGateTools } from './gate.ts'
import { classifyUpstreamFailure, formatFailure, statusFromMessage } from './errors.ts'
import { clientProjectID, PROCESS_SESSION, sessionForRequest, sessionHeaders } from './session.ts'
import {
	CATALOG_FACTORY_TIMEOUT_MS,
	MODELS_DEV_ENDPOINT,
	ZEN_MODELS_ENDPOINT,
	currentCatalog,
	refreshCatalog,
	type CatalogFetchers,
} from './catalog.ts'
import { runDoctor } from './doctor.ts'

export const PROVIDER = 'zen-free'
export const API_ID = 'openai-completions-zen-free'
export const SOURCE_ID = 'pi-zen-free'

export const ANONYMOUS_BASE = 'https://opencode.ai/inference/v1'
export const ANONYMOUS_KEY = 'public'

const PROJECT_ID = clientProjectID('pi:default-project')

/** `PI_ZEN_FREE_STATIC=1` pins the provider to the curated seeds (no network). */
const STATIC_CATALOG = process.env.PI_ZEN_FREE_STATIC === '1'

/** pi's `--offline` flag (PI_OFFLINE=1/true/yes) disables startup network work. */
function offlineAtStartup(): boolean {
	return /^(1|true|yes)$/i.test(process.env.PI_OFFLINE ?? '')
}

const DISGUISE_HEADERS: Record<string, string> = {
	'user-agent': 'opencode/latest/2.0.29/cli',
	'x-opencode-client': 'cli',
	'x-opencode-project': PROJECT_ID,
}

function explainFailure(modelId: string, message: AssistantMessage): AssistantMessage {
	const original = message.errorMessage ?? ''
	const classification = classifyUpstreamFailure(statusFromMessage(original), original)
	if (process.env.PI_ZEN_FREE_DEBUG) {
		console.error(`[${SOURCE_ID}] upstream error: ${original.slice(0, 500)}`)
	}
	return { ...message, errorMessage: formatFailure(modelId, classification) }
}

/**
 * Header names the OpenCode Zen gate rejects outright when present, regardless
 * of value (verified: HTTP 403 FreeTierError on every value tried).
 */
const GATE_REJECTED_HEADERS: readonly string[] = ['x-opencode-request']

/**
 * Rebuilds the outgoing header set: drops gate-rejected headers left behind by
 * other extensions, then re-asserts the disguise and session headers so they
 * win over the adapter's defaults and over `options.headers`.
 */
export function gateHeaders(
	incoming: Record<string, string | null> | undefined,
	sessionId: string,
): Record<string, string> {
	const ours = { ...DISGUISE_HEADERS, ...sessionHeaders(sessionId) }
	const oursLowered = new Set(Object.keys(ours).map((k) => k.toLowerCase()))

	const kept: Record<string, string> = {}
	for (const [key, value] of Object.entries(incoming ?? {})) {
		const lower = key.toLowerCase()
		// Drop gate-rejected names, and any casing variant of a header we own:
		// otherwise the adapter would emit both and the wrong one could win.
		if (GATE_REJECTED_HEADERS.includes(lower)) continue
		if (oursLowered.has(lower)) continue
		if (typeof value !== 'string') continue
		kept[key] = value
	}
	return { ...kept, ...ours }
}

let registered = false

/**
 * Builds a synthetic error AssistantMessage for failures raised outside the
 * upstream stream (adapter dispatch, network setup, ...).
 */
function failedMessage(model: Model<Api>, error: unknown): AssistantMessage {
	const raw = error instanceof Error ? error.message : String(error)
	const classification = classifyUpstreamFailure(statusFromMessage(raw), raw)
	return {
		role: 'assistant',
		content: [],
		api: model.api,
		provider: model.provider ?? PROVIDER,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: 'error',
		errorMessage: formatFailure(model.id, classification),
		timestamp: Date.now(),
	}
}

/**
 * Seam stream: receives a model carrying the custom API id, rewrites it to the
 * built-in `openai-completions` adapter and relays events back with classified
 * error messages. `model.api` never stays as API_ID, so the compat dispatcher
 * cannot recurse back into this handler.
 */
function seamStream(
	model: Model<Api>,
	context: TranscriptContext,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const incoming = options ?? {}
	const gated = withGateTools(context, incoming)
	const session = sessionForRequest(options as Record<string, unknown> | undefined)

	// The built-in openai-completions adapter merges `options.headers` LAST, so
	// anything another extension injected via `before_provider_headers` wins over
	// model.headers. OpenCode's gate rejects the request when it sees a foreign
	// `x-opencode-request` (403 FreeTierError), so sanitize and re-assert ours.
	const forwarded: SimpleStreamOptions = {
		...gated.options,
		headers: gateHeaders(gated.options.headers, session.id),
	}

	const builtin: Model<Api> = {
		...model,
		api: 'openai-completions',
		headers: { ...model.headers, ...DISGUISE_HEADERS, ...sessionHeaders(session.id) },
	}

	if (process.env.PI_ZEN_FREE_DEBUG) {
		console.error(`[${SOURCE_ID}] baseUrl ${builtin.baseUrl}`)
		console.error(`[${SOURCE_ID}] headers ${JSON.stringify(forwarded.headers)}`)
		console.error(`[${SOURCE_ID}] transcript tools ${JSON.stringify(getCurrentTools(gated.context.messages).map((t) => t.name))}`)
		console.error(`[${SOURCE_ID}] toolChoice ${forwarded.toolChoice}`)
	}

	const upstream = streamSimple(builtin as Model<Api>, gated.context as TranscriptContext, forwarded)
	const relayed = createAssistantMessageEventStream()

	void (async () => {
		try {
			for await (const event of upstream) {
				relayed.push(
					event.type === 'error'
						? { ...event, error: explainFailure(model.id, event.error) }
						: event,
				)
			}
			relayed.end(await upstream.result())
		} catch (error) {
			// AssistantMessageEventStream has no fail(): terminate it with an error event.
			relayed.push({
				type: 'error',
				reason: 'error',
				error: failedMessage(model, error),
			})
		}
	})()

	return relayed
}

/**
 * Registers the custom API id in the host api-registry so Pi dispatches every
 * `zen-free/*` model through {@link seamStream}.
 *
 * pi-ai has no `registerCustomApi`; the supported seam is
 * `registerApiProvider({ api, stream, streamSimple }, sourceId)` exported from
 * `@earendil-works/pi-ai/compat`, which the extension loader aliases
 * `@earendil-works/pi-ai` to.
 */
export function registerSeam(): void {
	if (registered) return
	registered = true

	registerApiProvider(
		{
			api: API_ID,
			stream: seamStream as unknown as (model: Model<Api>, context: TranscriptContext, options?: StreamOptions) => AssistantMessageEventStream,
			streamSimple: seamStream,
		},
		SOURCE_ID,
	)
}

function applyProvider(pi: ExtensionAPI, models: readonly ChatModelConfig[]): void {
	pi.registerProvider(PROVIDER, {
		baseUrl: ANONYMOUS_BASE,
		api: API_ID,
		apiKey: ANONYMOUS_KEY,
		authHeader: true,
		headers: DISGUISE_HEADERS,
		models: [...models],
		// Host-driven refresh: interactive/RPC startup and every model selector
		// open invoke this hook, then publish the returned list as the provider's
		// live models. `context.signal` is deliberately not forwarded: pi-ai
		// aborts the in-flight refresh whenever a newer pass supersedes it,
		// which used to cancel every live fetch (see catalog.ts). Merge policy
		// lives there too.
		refreshModels: async (context) => {
			const catalog = await refreshCatalog({
				allowNetwork: context.allowNetwork && !STATIC_CATALOG,
				force: context.force,
				fetchers: catalogFetchers(),
			})
			if (process.env.PI_ZEN_FREE_DEBUG) {
				const state = catalog.error ? `last error: ${catalog.error}` : 'ok'
				console.error(`[${SOURCE_ID}] catalog ${catalog.source} · ${catalog.models.length} models · ${state}`)
			}
			return [...catalog.models]
		},
	})
}

/** Headers for catalog fetches: same disguise the gate expects, plus the
 * anonymous bearer. Session headers are included for uniformity. */
function catalogHeaders(): Record<string, string> {
	return {
		...DISGUISE_HEADERS,
		...sessionHeaders(PROCESS_SESSION),
		authorization: `Bearer ${ANONYMOUS_KEY}`,
		accept: 'application/json',
	}
}

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
	const response = await fetch(url, { headers: catalogHeaders(), signal })
	if (!response.ok) throw new Error(`HTTP ${response.status} từ ${url}`)
	return (await response.json()) as unknown
}

function catalogFetchers(): CatalogFetchers {
	return {
		fetchListing: (signal) => fetchJson(ZEN_MODELS_ENDPOINT, signal),
		fetchMetadata: (signal) => fetchJson(MODELS_DEV_ENDPOINT, signal),
	}
}

export default async function (pi: ExtensionAPI): Promise<void> {
	registerSeam()

	// Prefetch before registering. The host awaits async factories, so startup
	// modes that never run a network refresh pass — `pi --list-models`, print
	// mode — see the live list immediately; the host's own refresh passes then
	// hit the TTL cache instead of racing their abort signal.
	const catalog = await refreshCatalog({
		allowNetwork: !STATIC_CATALOG && !offlineAtStartup(),
		fetchers: catalogFetchers(),
		timeoutMs: CATALOG_FACTORY_TIMEOUT_MS,
	})
	applyProvider(pi, catalog.models)

	pi.registerCommand('zen-free', {
		description: 'OpenCode Zen Free Models: doctor [model], models [refresh]',
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter(Boolean)
			const cmd = parts[0]
			switch (cmd) {
				case 'doctor': {
					const model = parts[1]
					if (model !== undefined && !/^[A-Za-z0-9._-]{1,64}$/.test(model)) {
						ctx.ui.notify('Tên model không hợp lệ. Ví dụ: /zen-free doctor beam-free', 'error')
						break
					}
					ctx.ui.notify(`Đang kiểm tra kết nối với OpenCode Zen Gate${model ? ` (model ${model})` : ''}...`, 'info')
					const result = await runDoctor(model)
					if (result.ok) {
						ctx.ui.notify(`✅ [Doctor] ${result.details}`, 'info')
					} else {
						ctx.ui.notify(`❌ [Doctor] ${result.details}`, 'error')
					}
					break
				}
				case 'models': {
					if (parts[1] === 'refresh') {
						if (STATIC_CATALOG) {
							ctx.ui.notify('Đang ở chế độ tĩnh (PI_ZEN_FREE_STATIC=1), bỏ qua làm mới.', 'info')
							break
						}
						ctx.ui.notify('Đang làm mới danh sách model từ OpenCode Zen...', 'info')
						const refreshed = await ctx.modelRegistry.refresh({
							providers: [PROVIDER],
							force: true,
							allowNetwork: true,
						})
						const failure = refreshed.errors.get(PROVIDER)
						const catalog = currentCatalog()
						if (failure) {
							ctx.ui.notify(
								`❌ Làm mới thất bại: ${failure.message}. Vẫn dùng ${catalog.models.length} model (${catalog.source}).`,
								'error',
							)
						} else if (refreshed.aborted) {
							ctx.ui.notify(
								`⚠️ Làm mới bị hủy trước khi hoàn tất. Vẫn dùng ${catalog.models.length} model (${catalog.source}).`,
								'error',
							)
						} else {
							ctx.ui.notify(`✅ Đã làm mới: ${catalog.models.length} model miễn phí (${catalog.source}).`, 'info')
						}
						break
					}

					const catalog = currentCatalog()
					const status =
						catalog.source === 'live'
							? `live · cập nhật ${new Date(catalog.fetchedAt).toLocaleString()}`
							: `tĩnh (SEED_MODELS${catalog.error ? ` · lỗi: ${catalog.error}` : ''})`
					const list = catalog.models
						.map((m) => `- ${m.id} (${m.contextWindow.toLocaleString()} tokens)`)
						.join('\n')
					ctx.ui.notify(`OpenCode Zen Free Models (${catalog.models.length}) · ${status}\n${list}`, 'info')
					break
				}
				default: {
					ctx.ui.notify(
						'Sử dụng: /zen-free doctor [model] | /zen-free models [refresh]',
						'info',
					)
				}
			}
		},
	})

	// pi 1.2.0's ExtensionAPI has no logger; keep startup info opt-in on stderr.
	if (process.env.PI_ZEN_FREE_DEBUG) {
		const state = catalog.error ? ` · last error: ${catalog.error}` : ''
		console.error(
			`[${PROVIDER}] registered · session ${PROCESS_SESSION} · ${catalog.models.length} models · catalog ${catalog.source}${state}`,
		)
	}
}
