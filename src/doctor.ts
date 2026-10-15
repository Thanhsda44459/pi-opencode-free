/**
 * Lightweight Doctor self-test for OpenCode Zen Gate verification.
 */

import { OPENCODE_TOOLS } from './tools.ts'
import { canonicalSessionID, clientProjectID, sessionHeaders } from './session.ts'

export const ANONYMOUS_BASE = 'https://opencode.ai/inference/v1'
export const ANONYMOUS_KEY = 'public'

export interface DoctorResult {
	readonly ok: boolean
	readonly status?: number
	readonly error?: string
	readonly details: string
}

export function buildDoctorPayload(model = 'big-pickle') {
	const sessionId = canonicalSessionID(`doctor:${Date.now()}`)
	const projectId = clientProjectID('pi:doctor')

	const headers = {
		'authorization': `Bearer ${ANONYMOUS_KEY}`,
		'content-type': 'application/json',
		'user-agent': 'opencode/latest/2.0.29/cli',
		'x-opencode-client': 'cli',
		'x-opencode-project': projectId,
		...sessionHeaders(sessionId),
	}

	const body = {
		model,
		messages: [
			{ role: 'user', content: 'Ping' },
		],
		stream: true,
		tools: [
			{
				type: 'function',
				function: {
					name: 'shell',
					description: OPENCODE_TOOLS.shell.description,
					parameters: OPENCODE_TOOLS.shell.parameters,
				},
			},
			{
				type: 'function',
				function: {
					name: 'read',
					description: OPENCODE_TOOLS.read.description,
					parameters: OPENCODE_TOOLS.read.parameters,
				},
			},
		],
	}

	return { headers, body }
}

export async function runDoctor(model = 'big-pickle', signal?: AbortSignal): Promise<DoctorResult> {
	const { headers, body } = buildDoctorPayload(model)
	const endpoint = `${ANONYMOUS_BASE}/chat/completions`

	try {
		const timeoutSignal = AbortSignal.timeout(15_000)
		const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal

		const response = await fetch(endpoint, {
			method: 'POST',
			headers,
			body: JSON.stringify(body),
			signal: combinedSignal,
		})

		if (response.ok) {
			await response.body?.cancel().catch(() => {})
			return {
				ok: true,
				status: response.status,
				details: `Cổng mở (HTTP 200 OK). OpenCode Zen chấp nhận cấu trúc request hiện tại với model ${model}.`,
			}
		}

		const errorText = await response.text().catch(() => '')
		return {
			ok: false,
			status: response.status,
			error: errorText,
			details: `Cổng từ chối (HTTP ${response.status}): ${errorText.slice(0, 200)}`,
		}
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err)
		return {
			ok: false,
			error: message,
			details: `Lỗi kết nối tới Gateway: ${message}`,
		}
	}
}
