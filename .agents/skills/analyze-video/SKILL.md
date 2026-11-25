---
name: analyze-video
description: >-
  Use this skill when the user wants to analyze one or more video files in `videos/`
  using the project's `node src/cli.js` tool to build retrieval-ready Markdown metadata
  in `metadata/` (processing.json, summary.md, clips.md, INDEX.md, TOPICS.md).
---

# Quy trình phân tích Video (Powered by `node src/cli.js`)

Mọi bước kỹ thuật (quét kho, fingerprint chống trùng, `ffprobe`, `scdet`, `silencedetect`, cắt chunk thông minh có overlap 3s, dựng khung `summary.md`/`clips.md`, kiểm tra hợp lệ, đồng bộ `INDEX.md`/`TOPICS.md`, và dọn dẹp) đều do **công cụ CLI `node src/cli.js`** thực thi xác định (deterministic). Agent chỉ tập trung vào bước **quan sát nội dung đa phương thức** và điền ngữ nghĩa trung thực.

---

## Bước 1 — Kiểm tra kho video (`status`)

```powershell
node src/cli.js status
```

Xem danh sách file `pending` hoặc xác định file người dùng chỉ định.

---

## Bước 2 — Chuẩn bị & trích tín hiệu kỹ thuật (`prepare`)

```powershell
node src/cli.js prepare "videos/<ten-file>"
```

Công cụ sẽ tự động:
1. Tính `sha256` và chặn nếu phát hiện bản sao trùng lặp trong `metadata/*/processing.json` (exit code `2`).
2. Chạy `ffprobe` + `scdet` (`scene_change_candidates`) + `silencedetect` (`silence_ranges`) làm **tín hiệu hỗ trợ** (không phải Ground Truth).
3. Chọn `direct` (≤ 20 MB & ≤ 10 phút) hoặc tự cắt proxy 480p theo biên thông minh + **3 giây overlap** vào `.tmp/analyze/<video_id>/`.
4. Lưu `metadata/<video_id>/processing.json` và sinh sẵn khung `metadata/<video_id>/summary.md` (đã điền chính xác toàn bộ YAML kỹ thuật) + `metadata/<video_id>/clips.md`.

---

## Bước 3 — Quan sát video & điền nội dung chuẩn hóa

1. Đọc [video-analysis-schema.md](../../../knowledges/video-analysis-schema.md) (nếu chưa có trong ngữ cảnh).
2. Dùng `read_file` xem lần lượt từng file trong danh sách `chunks` từ Bước 2, kết hợp `scene_change_candidates` và `silence_ranges` để khóa chặt timecode tuyệt đối (nhớ cộng `offset_sec` nếu đọc từ chunk).
3. Điền đầy đủ **`metadata/<video_id>/clips.md`** (tách rõ `observed` → `semantic` → `editorial` → `confidence` theo từng nhóm; khử trùng ở vùng overlap 3s; cho phép overlap có chủ đích nếu khác lớp/mục đích; cho phép `unknown` và `confidence: low` khi chưa chắc chắn).
4. Hoàn thiện **`metadata/<video_id>/summary.md`** (điền `language`, `video_type`, `overall_mood`, `analysis_status: completed`, `topics`, `Tóm tắt`, `Topic Map`, `Key Moments`, `Subjects` nếu cần; xóa sạch mọi `TODO`).

---

## Bước 4 — Kiểm tra, đồng bộ chỉ mục & dọn dẹp (`finalize`)

```powershell
node src/cli.js finalize <video_id>
```

Công cụ sẽ tự động:
1. Chạy **`validate`**: kiểm tra YAML, không còn `TODO`, timecode hợp lệ không vượt `duration_sec`, không trùng segment ở vùng overlap, đầy đủ các nhóm bắt buộc (`types`, `observed`, `usable`). Nếu có lỗi (exit code `1`), sửa dứt điểm theo danh sách lỗi trả về rồi chạy lại `finalize`.
2. Đánh dấu `"status": "completed"` trong `metadata/<video_id>/processing.json`.
3. Chạy **`sync`**: tái tạo toàn bộ `metadata/INDEX.md` và `metadata/TOPICS.md` từ file nguồn.
4. Xóa thư mục proxy tạm `.tmp/analyze/<video_id>/` (giữ lại `processing.json`).

---

## Truy xuất nhanh sau khi phân tích (`search`)

Cả người dùng lẫn Agent đều có thể gọi trực tiếp công cụ tìm kiếm footage:

```powershell
node src/cli.js search --topic color_grading --role hook --usable yes --standalone yes
```
