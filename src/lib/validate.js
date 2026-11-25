import fs from 'node:fs';
import path from 'node:path';
import { METADATA_DIR, parseYamlFrontmatter, parseClipsMarkdown } from './utils.js';

export function validateVideo(videoId) {
  const videoDir = path.join(METADATA_DIR, videoId);
  const errors = [];
  const warnings = [];

  if (!fs.existsSync(videoDir)) {
    return { valid: false, video_id: videoId, errors: [`Metadata folder not found: metadata/${videoId}`], warnings };
  }

  const manifestPath = path.join(videoDir, 'processing.json');
  const summaryPath = path.join(videoDir, 'summary.md');

  let manifest = null;
  if (!fs.existsSync(manifestPath)) {
    warnings.push('Missing processing.json manifest.');
  } else {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (e) {
      errors.push(`Invalid JSON in processing.json: ${e.message}`);
    }
  }

  if (!fs.existsSync(summaryPath)) {
    errors.push('Missing summary.md');
  }

  let durationSec = manifest?.fingerprints?.duration_sec ?? null;
  let fm = null;

  if (fs.existsSync(summaryPath)) {
    const summaryText = fs.readFileSync(summaryPath, 'utf8');
    fm = parseYamlFrontmatter(summaryText);
    if (!fm) {
      errors.push('summary.md is missing YAML frontmatter (--- ... ---).');
    } else {
      const requiredKeys = ['video_id', 'relative_path', 'duration_sec', 'duration_tc', 'category', 'video_type', 'video_tags', 'analysis_status', 'analysis_coverage', 'topics'];
      for (const k of requiredKeys) {
        const val = fm[k];
        if (!val || val === 'TODO' || (Array.isArray(val) && (val.length === 0 || val.includes('TODO')))) {
          errors.push(`summary.md YAML field "${k}" is missing or still TODO.`);
        }
      }
      if (durationSec === null && fm.duration_sec) {
        durationSec = Number(fm.duration_sec);
      }
    }

    if (/\bTODO\b/.test(summaryText)) {
      errors.push('summary.md still contains unfilled TODO placeholders.');
    }
    if (!/##\s+Topic Map/i.test(summaryText)) {
      warnings.push('summary.md is missing a "## Topic Map" section.');
    }
  }

  const clipFiles = fs
    .readdirSync(videoDir)
    .filter((f) => /^clips.*\.md$/i.test(f))
    .sort();

  if (clipFiles.length === 0) {
    errors.push('No clips.md (or clips_pXX.md) file found.');
  }

  const allSegments = [];
  const seenIds = new Set();

  for (const cf of clipFiles) {
    const text = fs.readFileSync(path.join(videoDir, cf), 'utf8');
    const segs = parseClipsMarkdown(text, cf);

    for (const s of segs) {
      if (seenIds.has(s.segment_id)) {
        errors.push(`Duplicate segment_id "${s.segment_id}" in ${cf}.`);
      }
      seenIds.add(s.segment_id);

      if (s.start_sec === null || s.end_sec === null) {
        errors.push(`${s.segment_id}: invalid timecode format (${s.start_tc} - ${s.end_tc}).`);
      } else {
        if (s.end_sec <= s.start_sec) {
          errors.push(`${s.segment_id}: end_tc (${s.end_tc}) must be greater than start_tc (${s.start_tc}).`);
        }
        if (durationSec !== null && s.end_sec > durationSec + 1.5) {
          errors.push(`${s.segment_id}: end_sec (${s.end_sec}s) exceeds video duration (${durationSec}s).`);
        }
      }

      if (s.types.length === 0) {
        errors.push(`${s.segment_id}: missing **types:**.`);
      }
      if (!s.visual && !s.speech) {
        errors.push(`${s.segment_id}: must include observed **visual:** or **speech:**.`);
      }
      if (s.topics.length === 0 && s.concepts.length === 0 && s.keywords.length === 0) {
        warnings.push(`${s.segment_id}: has no semantic topics/concepts/keywords (hard to retrieve).`);
      }
      if (!s.usable) {
        errors.push(`${s.segment_id}: missing editorial **usable:** field.`);
      }
      if (!s.confidence) {
        warnings.push(`${s.segment_id}: missing **confidence:** field.`);
      }

      allSegments.push(s);
    }
  }

  if (allSegments.length === 0) {
    errors.push('No valid ### [seg_XXX] segments found in clips*.md.');
  }

  // Check accidental identical/duplicate overlaps (same time range & same primary type)
  for (let i = 0; i < allSegments.length; i++) {
    for (let j = i + 1; j < allSegments.length; j++) {
      const a = allSegments[i];
      const b = allSegments[j];
      if (a.start_sec === null || b.start_sec === null) continue;
      const nearlySameStart = Math.abs(a.start_sec - b.start_sec) <= 1.0;
      const nearlySameEnd = Math.abs(a.end_sec - b.end_sec) <= 1.0;
      const sameType = a.types.some((t) => b.types.includes(t));
      if (nearlySameStart && nearlySameEnd && sameType) {
        errors.push(
          `Likely duplicate segment overlap: ${a.segment_id} (${a.start_tc}-${a.end_tc}) and ${b.segment_id} (${b.start_tc}-${b.end_tc}).`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    video_id: videoId,
    segments_count: allSegments.length,
    clip_files: clipFiles,
    errors,
    warnings,
  };
}
