/**
 * Main entry point for pi-opencode-free extension.
 */

import { createAssistantMessageEventStream, registerCustomApi, streamSimple } from '@earendil-works/pi-ai'
import type { AssistantMessage, Context, Model, SimpleStreamOptions } from '@earendil-works/pi-ai'
import type { ExtensionAPI, ProviderModelConfig } from '@oh-my-pi/pi-coding-agent'

import { withGateTools } from './gate.ts'
import { classifyUpstreamFailure, formatFailure } from './errors.ts'
import { clientProjectID, PROCESS_SESSION, sessionForRequest, sessionHeaders } from './session.ts'
import { SEED_MODELS } from './models.ts'
import { runDoctor } from './doctor.ts'

export const PROVIDER = 'opencode-free'
export const API_ID = 'openai-completions-opencode-free'
export const SOURCE_ID = 'pi-opencode-free'

export const ANONYMOUS_BASE = 'https://opencode.ai/inference/v1'
export const ANONYMOUS_KEY = 'public'

const PROJECT_ID = clientProjectID('pi:default-project')

const DISGUISE_HEADERS: Record<string, string> = {
	'user-agent': 'opencode/latest/2.0.29/cli',
	'x-opencode-client': 'cli',
	'x-opencode-project': PROJECT_ID,
}

function explainFailure(modelId: string, message: AssistantMessage): AssistantMessage {
	const original = message.errorMessage ?? ''
	const classification = classifyUpstreamFailure(message.errorStatus, original)
	return {
		...message,
		errorMessage: formatFailure(modelId, classification),
		errorClassificationMessage: message.errorClassificationMessage ?? original,
	}
}

let registered = false

export function registerSeam(): void {
	if (registered) return
	registered = true

	registerCustomApi(API_ID, (model: Model, context: Context, options?: SimpleStreamOptions) => {
		const incoming = options ?? {}
		const gated = withGateTools(context, incoming)
		const session = sessionForRequest(options as Record<string, unknown> | undefined)

		const builtin: Model = {
			...model,
			api: 'openai-completions' as Model['api'],
			headers: { ...model.headers, ...sessionHeaders(session.id) },
		}
		const forwarded = gated.options

		const upstream = streamSimple(builtin, gated.context, forwarded)
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
				relayed.fail(error)
			}
		})()

		return relayed
	}, SOURCE_ID)
}

function applyProvider(pi: ExtensionAPI, models: readonly ProviderModelConfig[]): void {
	pi.registerProvider(PROVIDER, {
		baseUrl: ANONYMOUS_BASE,
		api: API_ID,
		apiKey: ANONYMOUS_KEY,
		authHeader: true,
		headers: DISGUISE_HEADERS,
		models: [...models],
	})
}

export default function (pi: ExtensionAPI): void {
	registerSeam()
	applyProvider(pi, SEED_MODELS)

	pi.registerCommand('opencode-free', {
		description: 'OpenCode Zen Free Models: doctor (chẩn đoán cổng), models (danh sách mô hình)',
		handler: async (args, ctx) => {
			const cmd = args.trim().split(/\s+/)[0]
			switch (cmd) {
				case 'doctor': {
					ctx.ui.notify('Đang kiểm tra kết nối với OpenCode Zen Gate...', 'info')
					const result = await runDoctor()
					if (result.ok) {
						ctx.ui.notify(`✅ [Doctor] ${result.details}`, 'info')
					} else {
						ctx.ui.notify(`❌ [Doctor] ${result.details}`, 'error')
					}
					break
				}
				case 'models': {
					const list = SEED_MODELS.map((m) => `- ${m.id} (${(m.contextWindow ?? 0).toLocaleString()} tokens)`).join('\n')
					ctx.ui.notify(`OpenCode Zen Free Models (${SEED_MODELS.length}):\n${list}`, 'info')
					break
				}
				default: {
					ctx.ui.notify('Sử dụng: /opencode-free doctor | /opencode-free models', 'info')
				}
			}
		},
	})

	pi.logger.info(
		`[${PROVIDER}] registered · session ${PROCESS_SESSION} · ${SEED_MODELS.length} free models loaded`,
	)
}
