/**
 * Upstream failure classification and human-facing advice.
 */

export type UpstreamFailure =
	| 'SHAPE_REJECTED'
	| 'REGION_BLOCKED'
	| 'MODEL_GONE'
	| 'RATE_LIMIT'
	| 'REQUEST_REJECTED'
	| 'UPSTREAM'
	| 'AUTH'
	| 'UNKNOWN'

export interface Classification {
	readonly kind: UpstreamFailure
	readonly summary: string
}

const ADVICE: Readonly<Record<UpstreamFailure, string>> = {
	SHAPE_REJECTED: 'OpenCode Zen Gate từ chối hình thái request (FreeTierError). Yêu cầu Bearer public + canonical session EID + tools shell/read với genuine OpenCode definitions.',
	REGION_BLOCKED: 'Mô hình bị giới hạn khu vực (RegionError). Đây là chặn theo IP địa lý, không phải lỗi API key. Vui lòng đổi node mạng hoặc model khác.',
	MODEL_GONE: 'Mô hình không còn khả dụng trên kênh miễn phí (ModelError/Unavailable). Vui lòng chọn mô hình khác.',
	RATE_LIMIT: 'Đạt giới hạn tần suất theo địa chỉ IP (HTTP 429). Vui lòng đợi trong giây lát hoặc đổi IP xuất.',
	REQUEST_REJECTED: 'Yêu cầu bị từ chối (HTTP 400). Thường do định dạng nội dung không tương thích (ví dụ gửi ảnh vào model chỉ hỗ trợ văn bản).',
	UPSTREAM: 'Máy chủ OpenCode tạm thời không phản hồi (HTTP 5xx). Vui lòng thử lại sau.',
	AUTH: 'Chứng thực bị từ chối (HTTP 401). Kênh miễn phí không cần API key cá nhân, vui lòng kiểm tra trạng thái upstream.',
	UNKNOWN: 'Lỗi không xác định từ upstream.',
}

/**
 * pi-ai reports HTTP failures only as text (`401: {...}`, `Provider error (429): ...`),
 * so the status has to be recovered from the message before classifying.
 */
export function statusFromMessage(message: string): number | undefined {
	const match = /\b([45]\d\d)\b/.exec(message)
	return match ? Number(match[1]) : undefined
}

export function classifyUpstreamFailure(status: number | undefined, message: string): Classification {
	const text = message.toLowerCase()

	if (text.includes('regionerror') || text.includes('not available in your country') || text.includes('geo-block')) {
		return { kind: 'REGION_BLOCKED', summary: ADVICE.REGION_BLOCKED }
	}
	if (text.includes('freetiererror') || text.includes('free tier') || text.includes('missingsessionid')) {
		return { kind: 'SHAPE_REJECTED', summary: ADVICE.SHAPE_REJECTED }
	}
	if (text.includes('modelerror') || text.includes('model is unavailable') || text.includes('not supported')) {
		return { kind: 'MODEL_GONE', summary: ADVICE.MODEL_GONE }
	}
	if (status === 429 || text.includes('rate limit') || text.includes('too many requests')) {
		return { kind: 'RATE_LIMIT', summary: ADVICE.RATE_LIMIT }
	}
	if (status === 401) return { kind: 'AUTH', summary: ADVICE.AUTH }
	if (status !== undefined && status >= 500) return { kind: 'UPSTREAM', summary: ADVICE.UPSTREAM }
	if (status === 403) return { kind: 'SHAPE_REJECTED', summary: ADVICE.SHAPE_REJECTED }
	if (status === 400) return { kind: 'REQUEST_REJECTED', summary: ADVICE.REQUEST_REJECTED }

	if (text.includes('endpoint is unavailable') || text.includes('service unavailable') || text.includes('bad gateway')) {
		return { kind: 'UPSTREAM', summary: ADVICE.UPSTREAM }
	}

	return { kind: 'UNKNOWN', summary: `${ADVICE.UNKNOWN} ${message}` }
}

export function formatFailure(modelId: string, classification: Classification): string {
	return `[pi-zen-free/${modelId}] ${classification.summary}`
}
