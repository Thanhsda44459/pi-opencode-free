# pi-opencode-free

Extension dành cho **Pi** (`omp` / `@oh-my-pi/pi-coding-agent`) kết nối trực tiếp tới các mô hình AI miễn phí của **OpenCode Zen** mà **không cần API key, không cần tài khoản, và không cần cài đặt OpenCode CLI**.

---

## 1. Tính năng nổi bật

- **Không cần cấu hình**: Dùng trực tiếp kênh ẩn danh (`Bearer public`), không cần tài khoản trả phí.
- **Vượt qua Shape Gate của OpenCode Zen**: Tự động đáp ứng toàn bộ các kiểm tra hình thái nghiêm ngặt của Gateway (Header giả lập CLI, Session EID thuật toán counter 12-bit kết thúc `ffe`, chèn tự động các công cụ chuẩn `shell`/`read`).
- **Tối giản & Độc lập**: 0 dependencies thời gian chạy (zero runtime npm dependencies), tương thích 100% trên cả Windows và Linux.
- **Có công cụ Doctor chẩn đoán**: Tự kiểm tra xem Gateway có thay đổi cấu trúc cổng hay không chỉ với một lệnh.

---

## 2. Danh sách Model miễn phí hỗ trợ

| Model ID | Tên hiển thị | Cửa sổ ngữ cảnh (Context) | Đầu ra tối đa (Max Output) | Phương thức (Modalities) |
| :--- | :--- | :--- | :--- | :--- |
| `big-pickle` | Big Pickle | 200,000 | 32,000 | Text (Reasoning) |
| `mimo-v2.6-flash-free` | MiMo v2.6 Flash | 1,048,576 (1M) | 32,000 | Text, Image (Reasoning) |
| `ling-3.1-flash-free` | Ling 3.1 Flash | 262,144 | 32,768 | Text (Reasoning) |
| `nemotron-3.5-lightning-free` | Nemotron 3.5 Lightning | 262,144 | 262,144 | Text (Reasoning) |
| `space-bunny-free` | Space Bunny | 1,048,576 (1M) | 524,288 | Text, Image (Reasoning) |
| `fledge-alpha-free` | Fledge Alpha | 1,048,576 (1M) | 131,072 | Text, Image (Reasoning) |
| `longcat-2.5-preview-free` | LongCat 2.5 Preview | 1,000,000 (1M) | 131,072 | Text, Image (Reasoning) |

---

## 3. Cài đặt & Sử dụng

### 3.1 Cài đặt cục bộ (Dành cho nhà phát triển)

Trong thư mục dự án `pi-opencode-free`:

```bash
omp install .
# Hoặc với pi
pi install .
```

### 3.2 Chọn Model

Trong phiên làm việc của Pi/omp, gõ lệnh `/model` và chọn các mô hình thuộc provider `opencode-free`, ví dụ:
- `opencode-free/big-pickle`
- `opencode-free/mimo-v2.6-flash-free`

Hoặc chạy trực tiếp từ dòng lệnh:

```bash
omp --model opencode-free/big-pickle "Xin chào"
```

### 3.3 Lệnh chẩn đoán

Trong phiên làm việc, extension cung cấp slash command `/opencode-free`:

- `/opencode-free doctor`: Gửi request kiểm tra probe tới OpenCode Zen Gateway để báo cáo trạng thái cổng (Cổng mở 200 OK hay bị chặn).
- `/opencode-free models`: Liệt kê các model miễn phí hiện có kèm kích thước context window.

---

## 4. Kiểm thử

Dự án sử dụng bộ test runner tích hợp sẵn của Node.js:

```bash
npm test
```

Tất cả unit test sẽ kiểm chứng:
1. Thuật toán sinh mã EID theo đúng chuẩn OpenCode.
2. Cơ chế bổ sung và chuẩn hóa công cụ `shell` và `read`.
3. Phân loại lỗi chính xác khi Gateway có sự cố.
