import fs from 'node:fs';
import path from 'node:path';
import { METADATA_DIR, parseYamlFrontmatter, parseClipsMarkdown } from './utils.js';

export function syncIndexes() {
  if (!fs.existsSync(METADATA_DIR)) {
    fs.mkdirSync(METADATA_DIR, { recursive: true });
  }

  const dirs = fs
    .readdirSync(METADATA_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const indexRows = [];
  const topicMap = new Map();
  const warnings = [];

  const addTopic = (topic, entry) => {
    const t = topic.trim().replace(/^`|`$/g, '').replace(/^#/, '');
    if (!t || t === 'TODO') return;
    if (!topicMap.has(t)) topicMap.set(t, new Set());
    topicMap.get(t).add(entry);
  };

  for (const dirName of dirs) {
    const dirPath = path.join(METADATA_DIR, dirName);
    const summaryPath = path.join(dirPath, 'summary.md');
    if (!fs.existsSync(summaryPath)) continue;

    const summaryText = fs.readFileSync(summaryPath, 'utf8');
    const fm = parseYamlFrontmatter(summaryText) || {};

    const vid = fm.video_id || dirName;
    const relPath = fm.relative_path || '';
    const durTc = fm.duration_tc || '?';
    const category = fm.category || 'other';
    const vType = fm.video_type || 'unknown';
    const status = fm.analysis_status || 'completed';

    const titleMatch = summaryText.match(/^#\s+(?:Tổng quan:\s*)?(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : vid;

    const tagsList = Array.isArray(fm.video_tags) ? fm.video_tags.filter((t) => t && t !== 'TODO') : [];
    const topicsList = Array.isArray(fm.topics) ? fm.topics.filter((t) => t && t !== 'TODO') : [];
    const tagsDisplay = tagsList.length > 0 ? tagsList.map((t) => `\`#${t}\``).join(' ') : '-';
    const topicsDisplay = topicsList.length > 0 ? topicsList.map((t) => `\`${t}\``).join(' ') : '-';

    indexRows.push(
      `| \`${vid}\` | \`${relPath}\` | \`${durTc}\` | \`${category}\` / \`${vType}\` | ${tagsDisplay} | ${topicsDisplay} | ${title} | [summary.md](${dirName}/summary.md) |`
    );

    for (const t of topicsList) {
      addTopic(t, `- \`${vid}\` ([summary.md](${dirName}/summary.md)) — ${title}`);
    }

    const clipFiles = fs
      .readdirSync(dirPath)
      .filter((f) => /^clips.*\.md$/i.test(f))
      .sort();

    if (clipFiles.length === 0) {
      warnings.push(`No clips*.md found in metadata/${dirName}`);
    }

    for (const cf of clipFiles) {
      const clipText = fs.readFileSync(path.join(dirPath, cf), 'utf8');
      const segs = parseClipsMarkdown(clipText, cf);
      for (const s of segs) {
        const rolesStr = s.roles.length > 0 ? ` · roles: ${s.roles.join(', ')}` : '';
        const entry = `- \`${vid}\` / \`${s.segment_id}\` (\`${s.start_tc} - ${s.end_tc}\`${rolesStr}) → [${cf}](${dirName}/${cf})`;
        for (const t of new Set([...s.topics, ...s.concepts])) {
          addTopic(t, entry);
        }
      }
    }
  }

  const indexContent = [
    '# Video Metadata Index',
    '',
    '> **[Derived Index]** File này được sinh tự động từ `metadata/*/summary.md` bằng `node src/cli.js sync`. Không sửa tay.',
    '',
    '| Video ID | File gốc | Thời lượng | Thể loại / Hình thức | Video Tags | Topics | Tiêu đề | Chi tiết |',
    '|---|---|---|---|---|---|---|---|',
    ...(indexRows.length > 0 ? indexRows : ['| *(Chưa có video nào được phân tích)* | | | | | | | |']),
    '',
  ].join('\n');

  fs.writeFileSync(path.join(METADATA_DIR, 'INDEX.md'), indexContent, 'utf8');

  const topicLines = [
    '# Topics & Concepts Index',
    '',
    '> **[Derived Index]** Chỉ mục ngược chủ đề & khái niệm xuyên suốt toàn kho video, sinh tự động bằng `node src/cli.js sync`.',
    '',
  ];

  if (topicMap.size === 0) {
    topicLines.push('*(Chưa có chủ đề nào được lập chỉ mục)*', '');
  } else {
    for (const key of [...topicMap.keys()].sort()) {
      topicLines.push(`## \`${key}\``);
      for (const entry of topicMap.get(key)) {
        topicLines.push(entry);
      }
      topicLines.push('');
    }
  }

  fs.writeFileSync(path.join(METADATA_DIR, 'TOPICS.md'), topicLines.join('\n'), 'utf8');

  return {
    status: 'synced',
    videos_indexed: indexRows.length,
    topics_indexed: topicMap.size,
    warnings,
  };
}
