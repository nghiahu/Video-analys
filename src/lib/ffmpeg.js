import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { formatTimecode } from './utils.js';

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

export function probeVideo(videoPath, videoId) {
  const res = spawnSync(
    'ffprobe',
    ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', '--', videoPath],
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
  );
  if (res.status !== 0 || !res.stdout) {
    throw new Error(`ffprobe failed on ${videoPath}: ${res.stderr || 'unknown error'}`);
  }

  const probe = JSON.parse(res.stdout);
  const vStream = (probe.streams || []).find((s) => s.codec_type === 'video') || {};
  const aStream = (probe.streams || []).find((s) => s.codec_type === 'audio') || null;
  const stat = fs.statSync(videoPath);

  const durationSec = probe.format?.duration ? Number(Number(probe.format.duration).toFixed(2)) : 0;
  const width = Number(vStream.width || 0);
  const height = Number(vStream.height || 0);

  let fps = 0;
  if (vStream.avg_frame_rate && /^\d+\/\d+$/.test(vStream.avg_frame_rate)) {
    const [num, den] = vStream.avg_frame_rate.split('/').map(Number);
    if (den > 0) fps = Number((num / den).toFixed(2));
  }

  let aspectRatio = vStream.display_aspect_ratio;
  if (!aspectRatio || aspectRatio === '0:1') {
    if (width > 0 && height > 0) {
      const g = gcd(width, height);
      aspectRatio = `${width / g}:${height / g}`;
    } else {
      aspectRatio = 'unknown';
    }
  }

  const colorParts = [...new Set([vStream.color_transfer, vStream.color_space].filter(Boolean))];
  const colorProfile = colorParts.length > 0 ? colorParts.join(' / ') : 'standard';

  return {
    video_id: videoId,
    filename: path.basename(videoPath),
    file_size_bytes: stat.size,
    file_size_mb: Number((stat.size / (1024 * 1024)).toFixed(2)),
    duration_sec: durationSec,
    duration_tc: formatTimecode(durationSec),
    resolution: `${width}x${height}`,
    aspect_ratio: aspectRatio,
    fps,
    video_codec: vStream.codec_name || 'unknown',
    color_profile: colorProfile,
    has_audio: Boolean(aStream),
    audio_codec: aStream?.codec_name || 'none',
  };
}

export function extractSignals(videoPath, hasAudio, { sceneThreshold = 10, silenceNoiseDb = -35, silenceMinDurSec = 0.7 } = {}) {
  const args = ['-hide_banner', '-i', videoPath, '-vf', `scale=320:-2,scdet=t=${sceneThreshold}`];
  if (hasAudio) {
    args.push('-af', `silencedetect=n=${silenceNoiseDb}dB:d=${silenceMinDurSec}`);
  } else {
    args.push('-an');
  }
  args.push('-f', 'null', '-');

  const res = spawnSync('ffmpeg', args, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
  if (res.status !== 0) {
    throw new Error(`ffmpeg signal extraction failed (exit ${res.status})`);
  }

  const combined = `${res.stdout || ''}\n${res.stderr || ''}`;
  const sceneCandidates = [];
  const silenceRanges = [];
  let currentSilenceStart = null;

  for (const line of combined.split(/\r?\n/)) {
    const scMatch = line.match(/lavfi\.scd\.score:\s*([\d.]+),\s*lavfi\.scd\.time:\s*([\d.]+)/);
    if (scMatch) {
      const ts = Number(Number(scMatch[2]).toFixed(2));
      sceneCandidates.push({
        timestamp: ts,
        timecode: formatTimecode(ts),
        score: Number(Number(scMatch[1]).toFixed(2)),
        type: 'scene_change_candidate',
      });
      continue;
    }

    const ssMatch = line.match(/silence_start:\s*([\d.]+)/);
    if (ssMatch) {
      currentSilenceStart = Number(Number(ssMatch[1]).toFixed(2));
      continue;
    }

    const seMatch = line.match(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/);
    if (seMatch) {
      const end = Number(Number(seMatch[1]).toFixed(2));
      const dur = Number(Number(seMatch[2]).toFixed(2));
      const start = currentSilenceStart !== null ? currentSilenceStart : Number((end - dur).toFixed(2));
      silenceRanges.push({ start, end, duration: dur });
      currentSilenceStart = null;
    }
  }

  return { sceneCandidates, silenceRanges };
}

export function createSmartChunks(
  videoPath,
  tempDir,
  technical,
  sceneCandidates,
  silenceRanges,
  { targetChunkSec = 300, windowHalfSec = 30, overlapSec = 3 } = {}
) {
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tempDir, { recursive: true });

  const durationSec = technical.duration_sec;
  const cutPoints = [0];
  const cutReasons = ['start'];
  let cursor = 0;

  while (cursor + targetChunkSec + windowHalfSec < durationSec) {
    const target = cursor + targetChunkSec;
    const winMin = target - windowHalfSec;
    const winMax = Math.min(target + windowHalfSec, durationSec - 10);

    const bestScene = sceneCandidates
      .filter((s) => s.timestamp >= winMin && s.timestamp <= winMax)
      .sort((a, b) => Math.abs(a.timestamp - target) - Math.abs(b.timestamp - target))[0];

    if (bestScene) {
      cursor = bestScene.timestamp;
      cutPoints.push(cursor);
      cutReasons.push('scene_candidate');
      continue;
    }

    const bestSilence = silenceRanges
      .map((s) => ({ mid: Number(((s.start + s.end) / 2).toFixed(2)), dur: s.duration }))
      .filter((s) => s.mid >= winMin && s.mid <= winMax)
      .sort((a, b) => Math.abs(a.mid - target) - Math.abs(b.mid - target))[0];

    if (bestSilence) {
      cursor = bestSilence.mid;
      cutPoints.push(cursor);
      cutReasons.push('silence');
      continue;
    }

    cursor = target;
    cutPoints.push(cursor);
    cutReasons.push('fallback_hard_cut');
  }
  cutPoints.push(durationSec);
  cutReasons.push('end');

  const chunks = [];
  for (let i = 0; i < cutPoints.length - 1; i++) {
    const logicalStart = cutPoints[i];
    const logicalEnd = cutPoints[i + 1];
    const actualStart = i > 0 ? Math.max(0, Number((logicalStart - overlapSec).toFixed(2))) : 0;
    const actualEnd = i < cutPoints.length - 2 ? Math.min(durationSec, Number((logicalEnd + overlapSec).toFixed(2))) : durationSec;
    const segDur = Number((actualEnd - actualStart).toFixed(2));

    const chunkIdx = i + 1;
    const chunkPath = path.join(tempDir, `chunk_${String(chunkIdx).padStart(3, '0')}.mp4`);

    const args = [
      '-y', '-v', 'error',
      '-ss', String(actualStart),
      '-i', videoPath,
      '-t', String(segDur),
      '-vf', 'scale=-2:480,fps=8',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30',
      '-pix_fmt', 'yuv420p',
    ];
    if (technical.has_audio) {
      args.push('-c:a', 'aac', '-b:a', '48k', '-ac', '1');
    } else {
      args.push('-an');
    }
    args.push(chunkPath);

    const res = spawnSync('ffmpeg', args, { encoding: 'utf8' });
    if (res.status !== 0) {
      throw new Error(`ffmpeg failed creating chunk ${chunkIdx}: ${res.stderr || ''}`);
    }

    const cStat = fs.statSync(chunkPath);
    chunks.push({
      index: chunkIdx,
      path: chunkPath,
      offset_sec: actualStart,
      offset_tc: formatTimecode(actualStart),
      logical_start: logicalStart,
      logical_end: logicalEnd,
      end_sec: actualEnd,
      overlap_lead_sec: Number((logicalStart - actualStart).toFixed(2)),
      boundary_reason: cutReasons[i + 1],
      duration_sec: segDur,
      size_mb: Number((cStat.size / (1024 * 1024)).toFixed(2)),
    });
  }

  return chunks;
}
