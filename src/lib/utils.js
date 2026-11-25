import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const WORKSPACE_ROOT = process.cwd();
export const VIDEOS_DIR = path.join(WORKSPACE_ROOT, 'videos');
export const METADATA_DIR = path.join(WORKSPACE_ROOT, 'metadata');
export const TMP_DIR = path.join(WORKSPACE_ROOT, '.tmp', 'analyze');
export const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v', '.mts', '.mxf']);

export function slugifyVideoId(filename) {
  const base = path.parse(filename).name;
  // Preserve camera-style uppercase IDs like C7001-003 if ASCII-only and no spaces
  if (/^[A-Za-z0-9_-]+$/.test(base)) {
    return base;
  }
  return base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'video';
}

export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

export function formatTimecode(sec, withMs = false) {
  const safe = Math.max(0, Number(sec) || 0);
  const totalSec = Math.floor(safe);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const base = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  if (!withMs) return base;
  const ms = Math.round((safe - totalSec) * 1000);
  return `${base}.${String(Math.min(999, ms)).padStart(3, '0')}`;
}

export function parseTimecode(tc) {
  if (!tc || typeof tc !== 'string') return null;
  const match = tc.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  const s = Number(match[3]);
  const ms = match[4] ? Number(match[4].padEnd(3, '0')) : 0;
  return h * 3600 + m * 60 + s + ms / 1000;
}

export function parseYamlFrontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^\s*([a-zA-Z0-9_]+)\s*:\s*(.+?)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].replace(/\s+#.*$/, '').trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      data[key] = val
        .slice(1, -1)
        .split(',')
        .map((item) => item.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    } else {
      data[key] = val.replace(/^["']|["']$/g, '');
    }
  }
  return data;
}

export function parseClipsMarkdown(markdown, fileName = 'clips.md') {
  const blocks = markdown.split(/(?=^### \[seg_)/m).filter((b) => /^### \[seg_/.test(b));
  const segments = [];

  for (const block of blocks) {
    const header = block.match(/^### \[(seg_[^\]]+)\]\s+([0-9:\.]+)\s*-\s*([0-9:\.]+)/);
    if (!header) continue;

    const extractInline = (label) => {
      const m = block.match(new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+)$`, 'm'));
      return m ? m[1].trim() : '';
    };

    const parseTagList = (raw) =>
      raw
        .split(',')
        .map((s) => s.trim().replace(/^`|`$/g, '').replace(/^#/, ''))
        .filter((s) => s && s.toLowerCase() !== 'none');

    const rolesRaw = extractInline('roles');
    const usableMatch = block.match(/\*\*usable:\*\*\s*`?([a-z_]+)`?/i);
    const standaloneMatch = block.match(/\*\*standalone:\*\*\s*`?([a-z_]+)`?/i);
    const priorityMatch = block.match(/\*\*priority:\*\*\s*`?([a-z_]+)`?/i);

    segments.push({
      segment_id: header[1],
      start_tc: header[2],
      end_tc: header[3],
      start_sec: parseTimecode(header[2]),
      end_sec: parseTimecode(header[3]),
      file: fileName,
      types: parseTagList(extractInline('types')),
      visual: extractInline('visual'),
      speech: extractInline('speech'),
      audio: extractInline('audio'),
      topics: parseTagList(extractInline('topics')),
      concepts: parseTagList(extractInline('concepts')),
      keywords: parseTagList(extractInline('keywords')),
      roles: parseTagList(rolesRaw),
      usable: usableMatch ? usableMatch[1].toLowerCase() : '',
      standalone: standaloneMatch ? standaloneMatch[1].toLowerCase() : '',
      priority: priorityMatch ? priorityMatch[1].toLowerCase() : '',
      confidence: extractInline('confidence'),
      raw: block.trim(),
    });
  }

  return segments;
}

export function listVideoFiles() {
  if (!fs.existsSync(VIDEOS_DIR)) return [];
  const results = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        results.push(full);
      }
    }
  };
  walk(VIDEOS_DIR);
  return results.sort();
}

export function loadAllManifests() {
  if (!fs.existsSync(METADATA_DIR)) return [];
  const manifests = [];
  for (const entry of fs.readdirSync(METADATA_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const mPath = path.join(METADATA_DIR, entry.name, 'processing.json');
    if (!fs.existsSync(mPath)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(mPath, 'utf8'));
      manifests.push({ dir: path.join(METADATA_DIR, entry.name), path: mPath, data });
    } catch {
      // ignore corrupted manifest
    }
  }
  return manifests;
}
