# Quy chuẩn cấu trúc phân tích nội dung Video (v2 — Thuần Markdown)

Tài liệu này định nghĩa chuẩn dữ liệu lưu trong `metadata/` theo nguyên tắc tách biệt 3 hệ thống:
1. **Video Analysis (`analyze-video`):** Quan sát trung thực video gốc và tạo metadata có thể tìm kiếm. *(Phạm vi của tài liệu này.)*
2. **Video Retrieval:** Tìm kiếm footage theo chủ đề, khái niệm, lời thoại, hình ảnh, cảm xúc.
3. **Video Editing (`plans/` → `outputs/`):** Chọn footage và dựng theo kịch bản cụ thể.

> **Nguyên tắc cốt lõi:** Không trộn lẫn dữ liệu **quan sát khách quan (`Observed`)** với **suy luận dựng phim (`Editorial`)**. Không suy đoán khi thiếu bằng chứng — luôn cho phép `unknown` hoặc gắn `confidence: low`.

---

## 1. Cấu trúc thư mục `metadata/`

Tách rõ **Nguồn chuẩn (Source of Truth)** và **Chỉ mục dẫn xuất (Derived Indexes — tự sinh lại bằng script)**:

```text
metadata/
├── INDEX.md                 # [Derived] Mục lục toàn bộ kho video (sinh từ summary.md)
├── TOPICS.md                # [Derived] Chỉ mục ngược Chủ đề/Concept → video & đoạn cắt (sinh từ summary.md + clips.md)
├── SUBJECTS.md              # [Optional / Hybrid] Danh bạ chủ thể (chỉ dùng khi kho có nhân vật lặp lại)
└── <video_id>/              # Tên chuẩn hóa: không dấu, gạch nối (vd: C7001-003, sua-mau-premiere)
    ├── processing.json      # [Manifest] Fingerprint (sha256), thông số extraction, pipeline version, trạng thái
    ├── summary.md           # [Source of Truth] Thông số kỹ thuật (YAML) + Analysis Coverage + Topic Map + Key Moments
    └── clips.md             # [Source of Truth] Các segment có thể tìm kiếm & tái sử dụng
                             # (Chỉ tách clips_p01.md, clips_p02.md theo Topic/Chapter nếu > 60 segments)
```

---

## 2. Quy chuẩn từng file

### 2.1. `metadata/<video_id>/processing.json` (Persistent Manifest)

Do `extract_media.ps1` tạo ra và giữ lại lâu dài (rất nhẹ, chỉ vài KB) để phát hiện trùng lặp, kiểm soát phiên bản pipeline và tái sử dụng tín hiệu kỹ thuật mà không cần xóa mất.

```json
{
  "pipeline_version": "2.0",
  "video_id": "sua-mau-premiere",
  "source_path": "videos/Sửa màu premiere.mp4",
  "fingerprints": {
    "sha256": "...",
    "file_size_bytes": 4198856,
    "duration_sec": 85.5,
    "resolution": "1920x1080",
    "fps": 23.98,
    "video_codec": "av1"
  },
  "extraction": {
    "extracted_at": "2026-11-20T10:25:00+07:00",
    "scene_detector": { "method": "scdet", "threshold": 10 },
    "silence_detector": { "noise_db": -35, "min_duration_sec": 0.7 },
    "chunk_strategy": "direct | boundary_with_3s_overlap",
    "scene_change_candidates": [
      { "timestamp": 12.4, "score": 18.5 }
    ],
    "silence_ranges": [
      { "start": 22.1, "end": 23.4, "duration": 1.3 }
    ]
  },
  "status": "extracted | completed"
}
```

---

### 2.2. `metadata/<video_id>/summary.md`

Chứa thông tin cấp video: thông số kỹ thuật (YAML Frontmatter), **Analysis Coverage** (xác nhận đã xem toàn bộ timeline), **Topic Map** (bản đồ chủ đề theo thời gian), **Key Moments**, và **Subjects** (tùy chọn).

```markdown
---
schema_version: "2.0"
video_id: sua-mau-premiere
filename: Sửa màu premiere.mp4
relative_path: videos/Sửa màu premiere.mp4
source_sha256: "..."
file_size_mb: 4.0
duration_sec: 85.5
duration_tc: "00:01:25"
resolution: 1920x1080
aspect_ratio: "16:9"
fps: 23.98
video_codec: av1
color_profile: bt709
has_audio: true
language: vi
category: tutorial          # product | event | tutorial | interview | podcast | vlog | behind_the_scenes | commercial | documentary | b_roll_pack | other
video_type: screen_recording # talking_head | b_roll | screen_recording | multi_cam | run_and_gun | mixed
video_tags: [premiere_pro, color_grading, tutorial, desktop]
overall_mood: informative   # informative | energetic | calm | cinematic | casual
analysis_status: completed  # completed | partial | uncertain
analysis_coverage: "00:00:00 - 00:01:25"
topics: [color_grading, premiere_pro, lumetri_color]
analyzed_at: 2026-11-20
---

# Tổng quan: Sửa màu nhanh trong Premiere Pro

## Tóm tắt
Tóm tắt khách quan 2–3 câu về nội dung thực tế trong video.

## Topic Map (Bản đồ chủ đề theo timeline)
- `00:00:00 - 00:00:18` | **Vấn đề màu gốc** (`color_grading`, `before_after`) — Giới thiệu cảnh quay gốc bị nhạt màu.
- `00:00:18 - 00:01:10` | **Thao tác Lumetri Color** (`premiere_pro`, `lumetri_color`, `workflow`) — Chỉnh Exposure, Contrast, Saturation.
- `00:01:10 - 00:01:25` | **So sánh kết quả** (`before_after`, `color_grading`) — Bật/tắt hiệu ứng để đối chiếu.

## Key Moments
- `00:01:12` (`seg_005`): Khoảnh khắc bật/tắt Lumetri so sánh trực quan trước và sau khi chỉnh màu.

## Subjects (Tùy chọn — dùng quy tắc Chủ thể theo tiêu điểm)
- **Cá nhân nổi bật** (nói chính / được quay cận / hành động chính): `person_01` (confidence: `medium`) — mô tả ngắn *(chỉ thêm `look_01`, `look_02` khi cần theo dõi continuity trang phục)*.
- **Đám đông / tập thể** (lớp học, khán giả, nhóm đông): gom chung thành `group:<loại>` (vd: `group:students`, `group:audience`) — **không đánh số từng cá nhân trong đám đông**.
- **Sản phẩm / màn hình / không gian**: dùng `object:<tên>`, `screen:<app>`, hoặc `environment` / `none`.

## Ghi chú kỹ thuật & Độ bao phủ
- **Analysis coverage:** Đã quan sát toàn bộ `00:00:00 - 00:01:25` (100%).
- **Indexed segments:** 5 đoạn có giá trị sử dụng (các khoảng lặng/thao tác chờ không tạo segment).
- **Kỹ thuật:** Hình ảnh rõ nét, âm thanh sạch.

## Chi tiết đoạn cắt
- [clips.md](clips.md)
```

---

### 2.3. `metadata/<video_id>/clips.md`

**Đơn vị phân tích:** Không ép độ dài cố định (bỏ giới hạn 5–30s). Mỗi segment là một **đơn vị có ý nghĩa để tìm kiếm và tái sử dụng khi dựng**, có thể mang nhiều loại (`types`):
`speech` | `shot` | `event` | `reaction` | `sequence` | `outtake`

**Cho phép overlap có chủ đích:** Hai segment có thể giao nhau về thời gian nếu phục vụ mục đích khác nhau (ví dụ `seg_002` là câu nói `speech`, còn `seg_003` là biểu cảm `reaction` ở 3 giây cuối), liên kết qua `related_segments`.

**Cấu trúc mỗi block segment** (tách rõ 4 tầng: `Observed` → `Semantic` → `Editorial` → `Confidence`):

```markdown
# Clips — sua-mau-premiere

### [seg_001] 00:00:00.000 - 00:00:14.500
- **types:** `speech`, `event`
- **observed:**
  - **visual:** Màn hình giao diện Premiere Pro hiển thị timeline có 1 clip phỏng vấn màu phẳng; con trỏ chuột di chuyển vào bảng Lumetri Color. (`shot_type`: `screen_recording`, `camera`: `static`, `on_screen_text`: `Lumetri Color`)
  - **speech:** "Đây là cảnh quay gốc màu khá nhạt, mình sẽ sửa nhanh trong 30 giây." (`speaker`: `person_01`, `visibility`: `voice_only`, `emotion`: `neutral`)
  - **audio:** `clean_speech`, `music: none`
- **semantic:**
  - **topics:** `color_grading`, `premiere_pro`
  - **concepts:** `before_after_setup`, `quick_workflow`
  - **keywords:** `lumetri`, `màu nhạt`, `timeline`, `chỉnh màu`
- **editorial:**
  - **roles:** `intro`, `demo`
  - **usable:** `yes` · **standalone:** `yes` · **requires_context:** `no`
  - **quality:** `visual: good`, `audio: good` · **priority:** `normal`
  - **edit_points:** *(tùy chọn — ghi khi cần cắt gọn đầu/đuôi, vd: `in: 00:00:01.200`, `out: 00:00:14.000`)*
  - **issues:** `none`
- **confidence:** `visual: high`, `speech: high`, `subject: medium`, `editorial: high`
```

*(Các trường không áp dụng — ví dụ `speech` trong cảnh B-roll không lời, hoặc `edit_points` khi chưa cần — có thể bỏ gọn hoặc ghi `none` thay vì điền thừa.)*

---

## 3. Bộ nhãn chuẩn (Vocabulary)

- **`category` (thể loại video):** `product` | `event` | `tutorial` | `interview` | `podcast` | `vlog` | `behind_the_scenes` | `commercial` | `documentary` | `b_roll_pack` | `other`
- **`video_type` (hình thức quay):** `talking_head` | `b_roll` | `screen_recording` | `multi_cam` | `run_and_gun` | `mixed`
- **`types` (loại segment):** `speech` | `shot` | `event` | `reaction` | `sequence` | `outtake`
- **`shot_type`:** `wide` | `medium_shot` | `medium_close_up` | `close_up` | `screen_recording` | `over_the_shoulder` | `unknown`
- **`camera`:** `static` | `pan` | `tilt` | `handheld` | `zoom` | `dolly` | `unknown`
- **`visibility`:** `on_camera` | `voice_only` | `background`
- **`editorial.roles`:** `hook` | `key_quote` | `talking_head` | `b_roll` | `demo` | `reaction` | `narrative` | `transition` | `conclusion` | `outtake`
- **`usable`:** `yes` | `partial` (cần cắt đầu/đuôi) | `no`
- **`standalone`:** `yes` (cắt riêng vẫn đủ nghĩa) | `no` (cần ngữ cảnh đoạn trước/sau)
- **`quality`:** `good` | `ok` | `poor`
- **`priority`:** `high` (đắt giá, ưu tiên tìm thấy trước) | `normal` (dùng tốt) | `low` (chỉ dùng khi cần lấp cảnh)
- **`confidence`:** `high` | `medium` | `low` | `unknown`
- **`issues`:** `none` | `blur` | `shaky` | `bad_lighting` | `bad_audio` | `retake` | `filler` | `dead_air`

---

## 4. Quy tắc Chỉ mục dẫn xuất (Derived Indexes)

`metadata/INDEX.md` và `metadata/TOPICS.md` **không cập nhật thủ công từng dòng rời rạc** — luôn được **sinh lại toàn bộ** từ `metadata/<video_id>/summary.md` và `clips*.md` thông qua script `sync_indexes.ps1` ở cuối quy trình phân tích để đảm bảo đồng bộ 100% kể cả khi video được phân tích lại hoặc sửa đổi.
