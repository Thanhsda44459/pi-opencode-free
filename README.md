# pi-zen-free

Extension dành cho **Pi** (`@earendil-works/pi-coding-agent`) kết nối trực tiếp tới các mô hình AI miễn phí của **OpenCode Zen** mà **không cần API key, không cần tài khoản, và không cần cài đặt OpenCode CLI**.

Tên provider trong Pi: **`zen-free`** (ví dụ `zen-free/big-pickle`). Biến môi trường debug: `PI_ZEN_FREE_DEBUG=1`.

---

## 1. Tính năng nổi bật

- **Không cần cấu hình**: Dùng trực tiếp kênh ẩn danh (`Bearer public`), không cần tài khoản trả phí.
- **Vượt qua Shape Gate của OpenCode Zen**: Tự động đáp ứng toàn bộ các kiểm tra hình thái nghiêm ngặt của Gateway (Header giả lập CLI, Session EID thuật toán counter 12-bit kết thúc `ffe`, chèn tự động các công cụ chuẩn `shell`/`read` với nguyên văn definition gốc).
- **Chống nhiễu header từ extension khác**: Loại bỏ `x-opencode-request` (header mà Gateway trả 403 `FreeTierError` dù chỉ có mặt, bất kể giá trị) và ép lại header của chính nó sau mọi sửa đổi của extension khác.
- **Tối giản & Độc lập**: 0 dependencies thời gian chạy (zero runtime npm dependencies), tương thích 100% trên cả Windows và Linux.
- **Tự động cập nhật model**: Provider đăng ký hook `refreshModels` của host — Pi tự làm mới danh sách model khi khởi động và mỗi lần mở `/model`. Model miễn phí mới của OpenCode Zen xuất hiện mà không cần sửa code.
- **Có công cụ Doctor chẩn đoán**: Tự kiểm tra xem Gateway có thay đổi cấu trúc cổng hay không chỉ với một lệnh.

---

## 2. Danh sách Model miễn phí hỗ trợ

Danh sách model là **động**: extension fetch danh mục hiện hành từ OpenCode Zen (`/inference/v1/models`) rồi làm giàu metadata (context window, max output, modalities) từ [models.dev](https://models.dev) provider `opencode`. Các model trong bảng dưới đây là **seed tĩnh đã kiểm chứng**, được giữ làm nền tảng và fallback khi mạng không khả dụng:

| Model ID | Tên hiển thị | Cửa sổ ngữ cảnh (Context) | Đầu ra tối đa (Max Output) | Phương thức (Modalities) |
| :--- | :--- | :--- | :--- | :--- |
| `big-pickle` | Big Pickle | 200,000 | 32,000 | Text (Reasoning) |
| `mimo-v2.6-flash-free` | MiMo v2.6 Flash | 1,048,576 (1M) | 32,000 | Text, Image (Reasoning) |
| `ling-3.1-flash-free` | Ling 3.1 Flash | 262,144 | 32,768 | Text (Reasoning) |
| `nemotron-3.5-lightning-free` | Nemotron 3.5 Lightning | 262,144 | 262,144 | Text (Reasoning) |
| `space-bunny-free` | Space Bunny | 1,048,576 (1M) | 524,288 | Text, Image (Reasoning) |
| `fledge-alpha-free` | Fledge Alpha | 1,048,576 (1M) | 131,072 | Text, Image (Reasoning) |
| `longcat-2.5-preview-free` | LongCat 2.5 Preview | 1,000,000 (1M) | 131,072 | Text, Image (Reasoning) |

Quy tắc gộp danh mục (xem `src/catalog.ts`):

- Id miễn phí = kết thúc bằng `-free`, cộng thêm `big-pickle`; id nằm trong denylist `UNAVAILABLE` không bao giờ được đưa vào.
- Model đã có trong seed giữ nguyên giá trị đã kiểm chứng; model mới thêm vào kèm metadata từ models.dev, hoặc mặc định thận trọng (200K context / 32K output) khi models.dev chưa có.
- Seed vắng mặt trong danh mục live vẫn được giữ lại: đang chọn dở một model mà nó biến mất khỏi picker giữa phiên là trải nghiệm tệ hơn một thông báo lỗi rõ ràng.

---

## 3. Cài đặt & Sử dụng

### 3.1 Cài đặt cục bộ (Dành cho nhà phát triển)

Trong thư mục dự án `pi-zen-free`:

```bash
pi install .
```

### 3.2 Chọn Model

Trong phiên làm việc của Pi, gõ lệnh `/model` và chọn các mô hình thuộc provider `zen-free`, ví dụ:
- `zen-free/big-pickle`
- `zen-free/mimo-v2.6-flash-free`

Hoặc chạy trực tiếp từ dòng lệnh:

```bash
pi -p --model zen-free/big-pickle "Xin chào"
```

### 3.3 Lệnh chẩn đoán

Trong phiên làm việc, extension cung cấp slash command `/zen-free`:

- `/zen-free doctor [model]`: Gửi request kiểm tra probe tới OpenCode Zen Gateway để báo cáo trạng thái cổng (Cổng mở 200 OK hay bị chặn). Kèm `model` để probe một model cụ thể, ví dụ `/zen-free doctor beam-free`.
- `/zen-free models`: Liệt kê các model miễn phí hiện có kèm kích thước context window, nguồn danh sách (live hay tĩnh) và thời điểm cập nhật.
- `/zen-free models refresh`: Bắt buộc làm mới danh mục ngay lập tức (bỏ qua cache TTL 10 phút).

---

## 4. Kiểm thử

Dự án sử dụng bộ test runner tích hợp sẵn của Node.js:

```bash
npm test        # unit test
npm run typecheck
```

Tất cả unit test sẽ kiểm chứng:
1. Thuật toán sinh mã EID theo đúng chuẩn OpenCode.
2. Cơ chế bổ sung và chuẩn hóa công cụ `shell` và `read` trên transcript.
3. Phân loại lỗi chính xác khi Gateway có sự cố.
4. Đăng ký custom API id vào api-registry của host (`registerApiProvider`) và vệ sinh header.
5. Danh mục model động: parse payload Zen listing/models.dev, chính sách gộp (lọc paid/denylist, giữ seed), TTL/`force`/dedupe của refresh và fallback khi mạng lỗi.

---

## 5. Ghi chú kỹ thuật

### 5.1 Seam đăng ký API

`@earendil-works/pi-ai` **không có** `registerCustomApi`. Extension loader map
`@earendil-works/pi-ai` và `@earendil-works/pi-ai/compat` về cùng một module
instance của `pi-ai/compat`, nên seam đúng là:

```ts
import { registerApiProvider } from '@earendil-works/pi-ai/compat'

registerApiProvider({ api: API_ID, stream: seamStream, streamSimple: seamStream }, SOURCE_ID)
```

Host dispatch theo thứ tự `extension.streamSimple → base provider → getApiProvider(model.api)`.
Provider `zen-free` không phải builtin nên rơi xuống nhánh cuối — tức là chỉ cần
đăng ký api id là model được dispatch đúng, không cần tự viết lại adapter.

### 5.2 Transcript tools, không phải `context.tools`

Host truyền vào seam một `TranscriptContext`, chỉ có `messages`; tool nằm trong system
message đầu tiên dưới dạng delta `toolsAdded` / `toolsRemoved`. Code cũ đọc
`context.tools` — luôn `undefined` — nên mọi request đều bị ép `toolChoice: 'none'`,
tức là **mất toàn bộ khả năng gọi tool**. `withGateTools` giờ dựng lại transcript qua
`getCurrentTools()` và chỉ ép `toolChoice: 'none'` khi transcript thật sự rỗng tool.

### 5.3 Header nào khiến Gateway trả 403

Đã kiểm chứng trực tiếp với Gateway:

| Thay đổi | Kết quả |
| :--- | :--- |
| `stream: false` | 403 FreeTierError |
| Không kèm tool nào | 403 FreeTierError |
| Có `x-opencode-request` (bất kỳ giá trị) | 403 FreeTierError |
| Tool `bash`/`shell` mang description rút gọn | 403 FreeTierError |
| `User-Agent` / `x-opencode-project` / session lạ | 200 OK |
| `tool_choice: "none"` | 200 OK |
| `shell` + `read` nguyên văn definition | 200 OK |

### 5.4 Seam cập nhật model động

Host Pi hỗ trợ `ProviderConfig.refreshModels(context)` cho form
`pi.registerProvider(name, config)` — legacy form mà extension này dùng:

```ts
pi.registerProvider(PROVIDER, {
  // ...
  models: [...seedModels],           // danh sách khởi động tức thời
  refreshModels: async (context) => {
    // context.allowNetwork=false khi offline/cache-only initialization
    // context.force=true khi refresh thủ công
    // context.signal phải được truyền vào mọi I/O
    return [...liveModels]            // thay thế danh sách model của provider
  },
})
```

Host gọi hook này trong các pass refresh của nó — khởi động interactive/RPC và
mỗi lần mở model selector — rồi tự publish danh sách trả về; không cần
`/reload`. `/zen-free models refresh` chủ động gọi
`ctx.modelRegistry.refresh({ providers: ['zen-free'], force: true })` để đi
đúng pipeline đó.

Hai nguồn dữ liệu, fetch song song:

- `GET https://opencode.ai/inference/v1/models` — danh sách id đang phục vụ
  (bắt buộc; nguồn này lỗi thì giữ nguyên danh mục cũ, không hạ cấp).
- `GET https://models.dev/api.json` → provider `opencode` — metadata context
  window / max output / modalities (best-effort; thiếu thì dùng mặc định
  200K/32K).

Cache: danh mục live được dùng lại trong 10 phút (`LIVE_REFRESH_TTL_MS`) trừ
khi `force`; các lần gọi đồng thời chia sẻ một request đang bay. Đặt
`PI_ZEN_FREE_STATIC=1` để khóa extension ở danh sách seed, không chạm mạng
(debug/offline).
