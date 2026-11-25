import fs from 'node:fs';
import path from 'node:path';
import {
  WORKSPACE_ROOT,
  METADATA_DIR,
  TMP_DIR,
  slugifyVideoId,
  sha256File,
  loadAllManifests,
} from './utils.js';
import { probeVideo, extractSignals, createSmartChunks } from './ffmpeg.js';

function buildSummaryScaffold(technical, relPath, sha256) {
  const today = new Date().toISOString().slice(0, 10);
  return `---
schema_version: "2.0"
video_id: ${technical.video_id}
filename: ${technical.filename}
relative_path: ${relPath}
source_sha256: "${sha256}"
file_size_mb: ${technical.file_size_mb}
duration_sec: ${technical.duration_sec}
duration_tc: "${technical.duration_tc}"
resolution: ${technical.resolution}
aspect_ratio: "${technical.aspect_ratio}"
fps: ${technical.fps}
video_codec: ${technical.video_codec}
color_profile: ${technical.color_profile}
has_audio: ${technical.has_audio}
language: TODO
category: TODO
video_type: TODO
video_tags: [TODO]
overall_mood: TODO
analysis_status: in_progress
analysis_coverage: "00:00:00 - ${technical.duration_tc}"
topics: [TODO]
analyzed_at: ${today}
---

# Tổng quan: TODO

## Tóm tắt
TODO: Tóm tắt khách quan 2-3 câu về nội dung thực tế trong video.

## Topic Map (Bản đồ chủ đề theo timeline)
- \`00:00:00 - ${technical.duration_tc}\` | **TODO** (\`topic_1\`) — TODO

## Key Moments
- *(Chưa điền)*

## Subjects (Tùy chọn)
- \`unknown\`

## Ghi chú kỹ thuật & Độ bao phủ
- **Analysis coverage:** 00:00:00 - ${technical.duration_tc}
- **Indexed segments:** TODO
- **Kỹ thuật:** TODO

## Chi tiết đoạn cắt
- [clips.md](clips.md)
`;
}

function buildClipsScaffold(videoId) {
  return `# Clips — ${videoId}

<!-- Điền từng segment theo chuẩn knowledges/video-analysis-schema.md rồi chạy: node src/cli.js finalize ${videoId} -->
`;
}

export async function prepareVideo(videoPathArg, options = {}) {
  const resolved = path.resolve(WORKSPACE_ROOT, videoPathArg);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Video file not found: ${videoPathArg}`);
  }

  const videoId = options.videoId || slugifyVideoId(path.basename(resolved));
  const relPath = path.relative(WORKSPACE_ROOT, resolved).replace(/\\/g, '/');

  const sha256 = await sha256File(resolved);
  const existingManifests = loadAllManifests();
  const duplicate = existingManifests.find(
    (m) => m.data.fingerprints?.sha256 === sha256 && m.data.video_id !== videoId
  );

  if (duplicate && !options.force) {
    return {
      duplicate_detected: true,
      duplicate_of: {
        video_id: duplicate.data.video_id,
        source_path: duplicate.data.source_path,
        status: duplicate.data.status,
      },
      sha256,
      message: 'Exact duplicate already exists in metadata. Pass --force to override.',
    };
  }

  const technical = probeVideo(resolved, videoId);
  const sceneThreshold = options.sceneThreshold ?? 10;
  const silenceNoiseDb = options.silenceNoiseDb ?? -35;
  const silenceMinDurSec = options.silenceMinDurSec ?? 0.7;
  const sizeThresholdMB = options.sizeThresholdMB ?? 20;
  const maxDirectDurationSec = options.maxDirectDurationSec ?? 600;
  const overlapSec = options.overlapSec ?? 3;

  const { sceneCandidates, silenceRanges } = extractSignals(resolved, technical.has_audio, {
    sceneThreshold,
    silenceNoiseDb,
    silenceMinDurSec,
  });

  const needsProxy = technical.file_size_mb > sizeThresholdMB || technical.duration_sec > maxDirectDurationSec;
  let chunks = [];
  let tempDir = null;
  let chunkStrategy = 'direct';

  if (!needsProxy) {
    chunks = [
      {
        index: 1,
        path: resolved,
        offset_sec: 0,
        offset_tc: '00:00:00',
        end_sec: technical.duration_sec,
        overlap_lead_sec: 0,
        boundary_reason: 'direct',
        size_mb: technical.file_size_mb,
      },
    ];
  } else {
    chunkStrategy = `boundary_with_${overlapSec}s_overlap`;
    tempDir = path.join(TMP_DIR, videoId);
    chunks = createSmartChunks(resolved, tempDir, technical, sceneCandidates, silenceRanges, {
      overlapSec,
    });
  }

  const videoMetaDir = path.join(METADATA_DIR, videoId);
  fs.mkdirSync(videoMetaDir, { recursive: true });

  const manifest = {
    pipeline_version: '2.0',
    video_id: videoId,
    source_path: relPath,
    fingerprints: {
      sha256,
      file_size_bytes: technical.file_size_bytes,
      duration_sec: technical.duration_sec,
      resolution: technical.resolution,
      fps: technical.fps,
      video_codec: technical.video_codec,
    },
    extraction: {
      extracted_at: new Date().toISOString(),
      scene_detector: { method: 'scdet', threshold: sceneThreshold },
      silence_detector: { noise_db: silenceNoiseDb, min_duration_sec: silenceMinDurSec },
      chunk_strategy: chunkStrategy,
      scene_change_candidates: sceneCandidates,
      silence_ranges: silenceRanges,
    },
    status: 'extracted',
  };

  const manifestPath = path.join(videoMetaDir, 'processing.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  // Scaffold summary.md & clips.md if missing or --overwrite-scaffold
  const summaryPath = path.join(videoMetaDir, 'summary.md');
  const clipsPath = path.join(videoMetaDir, 'clips.md');
  let scaffolded = [];

  if (!fs.existsSync(summaryPath) || options.overwriteScaffold) {
    fs.writeFileSync(summaryPath, buildSummaryScaffold(technical, relPath, sha256), 'utf8');
    scaffolded.push(summaryPath);
  }
  if (!fs.existsSync(clipsPath) || options.overwriteScaffold) {
    fs.writeFileSync(clipsPath, buildClipsScaffold(videoId), 'utf8');
    scaffolded.push(clipsPath);
  }

  return {
    duplicate_detected: false,
    video_id: videoId,
    mode: needsProxy ? 'chunks' : 'direct',
    manifest_path: manifestPath,
    summary_path: summaryPath,
    clips_path: clipsPath,
    scaffolded,
    temp_dir: tempDir,
    technical,
    sha256,
    scene_candidates_count: sceneCandidates.length,
    scene_change_candidates: sceneCandidates,
    silence_ranges_count: silenceRanges.length,
    silence_ranges: silenceRanges,
    chunks,
  };
}
