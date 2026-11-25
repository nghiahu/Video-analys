import fs from 'node:fs';
import path from 'node:path';
import { METADATA_DIR, parseClipsMarkdown, parseYamlFrontmatter } from './utils.js';

export function searchClips(filters = {}) {
  if (!fs.existsSync(METADATA_DIR)) return [];

  const dirs = fs
    .readdirSync(METADATA_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const matches = [];
  const q = filters.query ? filters.query.toLowerCase() : null;
  const categoryFilter = filters.category ? filters.category.toLowerCase() : null;
  const tagFilter = filters.tag ? filters.tag.toLowerCase().replace(/^#/, '') : null;
  const topicFilter = filters.topic ? filters.topic.toLowerCase() : null;
  const roleFilter = filters.role ? filters.role.toLowerCase() : null;
  const typeFilter = filters.type ? filters.type.toLowerCase() : null;
  const usableFilter = filters.usable ? filters.usable.toLowerCase() : null;
  const standaloneFilter = filters.standalone ? filters.standalone.toLowerCase() : null;
  const priorityFilter = filters.priority ? filters.priority.toLowerCase() : null;
  const videoFilter = filters.video ? filters.video.toLowerCase() : null;

  for (const dirName of dirs) {
    if (videoFilter && dirName.toLowerCase() !== videoFilter) continue;
    const dirPath = path.join(METADATA_DIR, dirName);
    const summaryPath = path.join(dirPath, 'summary.md');
    const fm = fs.existsSync(summaryPath)
      ? parseYamlFrontmatter(fs.readFileSync(summaryPath, 'utf8')) || {}
      : {};

    const videoCategory = (fm.category || '').toLowerCase();
    const videoTags = Array.isArray(fm.video_tags) ? fm.video_tags.map((t) => t.toLowerCase()) : [];

    if (categoryFilter && videoCategory !== categoryFilter) continue;

    const clipFiles = fs
      .readdirSync(dirPath)
      .filter((f) => /^clips.*\.md$/i.test(f))
      .sort();

    for (const cf of clipFiles) {
      const segs = parseClipsMarkdown(fs.readFileSync(path.join(dirPath, cf), 'utf8'), cf);
      for (const s of segs) {
        if (tagFilter) {
          const allTags = [...videoTags, ...s.keywords.map((k) => k.toLowerCase()), ...s.topics.map((t) => t.toLowerCase())];
          if (!allTags.some((t) => t.includes(tagFilter))) continue;
        }
        if (topicFilter) {
          const allTopics = [...s.topics, ...s.concepts, ...s.keywords].map((x) => x.toLowerCase());
          if (!allTopics.some((t) => t.includes(topicFilter))) continue;
        }
        if (roleFilter && !s.roles.map((r) => r.toLowerCase()).includes(roleFilter)) continue;
        if (typeFilter && !s.types.map((t) => t.toLowerCase()).includes(typeFilter)) continue;
        if (usableFilter && s.usable !== usableFilter) continue;
        if (standaloneFilter && s.standalone !== standaloneFilter) continue;
        if (priorityFilter && s.priority !== priorityFilter) continue;
        if (q && !s.raw.toLowerCase().includes(q)) continue;

        matches.push({
          video_id: fm.video_id || dirName,
          category: fm.category || 'other',
          video_tags: fm.video_tags || [],
          source_path: fm.relative_path || '',
          file: `metadata/${dirName}/${cf}`,
          segment_id: s.segment_id,
          start_tc: s.start_tc,
          end_tc: s.end_tc,
          types: s.types,
          roles: s.roles,
          usable: s.usable,
          standalone: s.standalone,
          priority: s.priority,
          topics: s.topics,
          concepts: s.concepts,
          visual: s.visual,
          speech: s.speech,
        });
      }
    }
  }

  return matches;
}
