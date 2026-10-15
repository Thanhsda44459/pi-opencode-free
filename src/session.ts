/**
 * Canonical session identity generation adhering to OpenCode Zen Gate rules.
 *
 * Requirements:
 * 1. Matching regex ^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$
 * 2. Low 12 bits of the 12-hex segment decode (after bitwise-NOT) to a per-ms counter in [1, 63].
 *    On the wire, this results in the hex segment ending in [0xFC0, 0xFFF] (e.g. '...ffe' for counter 1).
 * 3. Base62 tail of 14 characters.
 */

import { createHash } from 'node:crypto'

export const CANONICAL_SESSION = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/
export const DESCENDING_TIME_PART = /^[0-9a-f]{9}f[c-f][0-9a-f]$/
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

function base62Fixed(value: bigint, width: number): string {
	let out = ''
	let v = value
	for (let i = 0; i < width; i++) {
		out = BASE62[Number(v % 62n)] + out
		v /= 62n
	}
	return out
}

/**
 * Encodes 6 hash bytes into official client descending() layout:
 * 36-bit pseudo-clock shifted into top of 48-bit word, ORed with counter 1,
 * then bitwise-NOT-ed so the low 12 hex digits end in 'ffe'.
 */
export function descendingTimePart(hash: Uint8Array): string {
	const b0 = hash[0] ?? 0
	const b1 = hash[1] ?? 0
	const b2 = hash[2] ?? 0
	const b3 = hash[3] ?? 0
	const b4 = hash[4] ?? 0
	const current = (BigInt(b0) << 28n | BigInt(b1) << 20n | BigInt(b2) << 12n | BigInt(b3) << 4n | BigInt(b4) >> 4n) << 12n
	const inverted = ~(current | 1n) & 0xffffffffffffn
	return inverted.toString(16).padStart(12, '0')
}

/**
 * Re-encodes any signal into a canonical session ID matching OpenCode Zen rules.
 */
export function canonicalSessionID(signal: string): string {
	if (CANONICAL_SESSION.test(signal) && DESCENDING_TIME_PART.test(signal.slice(4, 16))) {
		return signal
	}

	const sum = createHash('sha256').update(`ses\0${signal}`).digest()
	return `ses_${descendingTimePart(sum.subarray(0, 6))}${base62Fixed(BigInt(`0x${sum.subarray(6, 16).toString('hex')}`), 14)}`
}

/** Process-level fallback session */
export const PROCESS_SESSION = canonicalSessionID(`pi:${process.pid}:${new Date().toISOString().slice(0, 10)}`)

/**
 * Creates canonical session ID for request options.
 */
export function sessionForRequest(options?: Record<string, unknown>): { readonly id: string; readonly derived: boolean } {
	if (!options) return { id: PROCESS_SESSION, derived: false }

	if ('sessionId' in options && typeof options.sessionId === 'string' && options.sessionId.length > 0) {
		return { id: canonicalSessionID(`pi:${options.sessionId}`), derived: true }
	}

	if ('metadata' in options && typeof options.metadata === 'object' && options.metadata !== null) {
		const metadata = options.metadata as Record<string, unknown>
		if ('user_id' in metadata && typeof metadata.user_id === 'string') {
			try {
				const parsed = JSON.parse(metadata.user_id) as Record<string, unknown>
				if ('session_id' in parsed && typeof parsed.session_id === 'string' && parsed.session_id.length > 0) {
					return { id: canonicalSessionID(`pi:${parsed.session_id}`), derived: true }
				}
			} catch {
				// Fall through
			}
		}
	}

	return { id: PROCESS_SESSION, derived: false }
}

/**
 * All session headers required by OpenCode Zen Gate.
 */
export function sessionHeaders(sessionId: string): Record<string, string> {
	return {
		'x-opencode-session': sessionId,
		'x-opencode-session-id': sessionId,
		'x-session-affinity': sessionId,
		'X-Session-Id': sessionId,
	}
}

/**
 * Bare 40-character SHA-256 lowercase hex project identifier.
 */
export function clientProjectID(project: string): string {
	return createHash('sha256').update(`opencode-project\x00${project}`).digest('hex').slice(0, 40)
}
