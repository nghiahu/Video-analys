#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  WORKSPACE_ROOT,
  METADATA_DIR,
  TMP_DIR,
  listVideoFiles,
  slugifyVideoId,
  loadAllManifests,
} from './lib/utils.js';
import { prepareVideo } from './lib/prepare.js';
import { validateVideo } from './lib/validate.js';
import { syncIndexes } from './lib/sync.js';
import { searchClips } from './lib/search.js';

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function printHelp() {
  console.log(`storage-edit CLI (v2.0) — Video Analysis & Retrieval Tool

Usage:
  node src/cli.js <command> [options]

Commands:
  status                             Scan videos/ and show analysis status for every file
  prepare <video_path> [options]     Extract ffprobe/scdet/silence, smart chunks & scaffold summary.md/clips.md
    --id <video_id>                  Custom video_id (default: auto-slugified filename)
    --force                          Re-extract even if duplicate sha256 exists
    --overwrite-scaffold             Overwrite existing summary.md/clips.md scaffolds
  validate <video_id>                Validate summary.md & clips.md (structure, timecodes, overlaps, fields)
  finalize <video_id>                Run validate -> mark processing.json completed -> sync indexes -> clean tmp
  sync                               Rebuild metadata/INDEX.md & metadata/TOPICS.md from source files
  search [filters]                   Search analyzed clips across metadata/
    --category <cat>                 Filter by video category (product, event, tutorial, interview...)
    --tag <tag>                      Filter by video_tags or clip keywords/topics
    --query <text>                   Full-text search inside clip blocks
    --topic <name>                   Filter by topic/concept/keyword
    --role <role>                    Filter by editorial role (hook, b_roll, key_quote, demo...)
    --type <type>                    Filter by segment type (speech, shot, event, reaction...)
    --usable <yes|partial|no>        Filter by usability
    --standalone <yes|no>            Filter by standalone flag
    --priority <high|normal|low>     Filter by priority
    --video <video_id>               Restrict to one video
    --json                           Output raw JSON
  clean [video_id]                   Remove temporary proxy/chunk files in .tmp/analyze/
`);
}

function cmdStatus() {
  const videos = listVideoFiles();
  const manifests = loadAllManifests();
  const bySource = new Map(manifests.map((m) => [m.data.source_path, m.data]));
  const byId = new Map(manifests.map((m) => [m.data.video_id, m.data]));

  const rows = videos.map((absPath) => {
    const rel = path.relative(WORKSPACE_ROOT, absPath).replace(/\\/g, '/');
    const suggestedId = slugifyVideoId(path.basename(absPath));
    const manifest = bySource.get(rel) || byId.get(suggestedId) || null;
    const stat = fs.statSync(absPath);
    return {
      video_id: manifest?.video_id || suggestedId,
      relative_path: rel,
      size_mb: Number((stat.size / (1024 * 1024)).toFixed(2)),
      status: manifest?.status || 'pending',
    };
  });

  console.log(JSON.stringify({ total: rows.length, videos: rows }, null, 2));
}

function cmdClean(videoId) {
  const target = videoId ? path.join(TMP_DIR, videoId) : TMP_DIR;
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
    console.log(JSON.stringify({ cleaned: target }, null, 2));
  } else {
    console.log(JSON.stringify({ cleaned: null, message: 'Nothing to clean.' }, null, 2));
  }
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const cmd = positional[0];

  if (!cmd || cmd === 'help' || flags.help) {
    printHelp();
    process.exit(0);
  }

  try {
    switch (cmd) {
      case 'status':
        cmdStatus();
        break;

      case 'prepare': {
        const videoPath = positional[1];
        if (!videoPath) throw new Error('Usage: node src/cli.js prepare <video_path>');
        const result = await prepareVideo(videoPath, {
          videoId: flags.id,
          force: Boolean(flags.force),
          overwriteScaffold: Boolean(flags['overwrite-scaffold']),
        });
        console.log(JSON.stringify(result, null, 2));
        if (result.duplicate_detected) process.exit(2);
        break;
      }

      case 'validate': {
        const videoId = positional[1];
        if (!videoId) throw new Error('Usage: node src/cli.js validate <video_id>');
        const result = validateVideo(videoId);
        console.log(JSON.stringify(result, null, 2));
        if (!result.valid) process.exit(1);
        break;
      }

      case 'finalize': {
        const videoId = positional[1];
        if (!videoId) throw new Error('Usage: node src/cli.js finalize <video_id>');
        const validation = validateVideo(videoId);
        if (!validation.valid) {
          console.log(JSON.stringify({ finalized: false, validation }, null, 2));
          process.exit(1);
        }

        const manifestPath = path.join(METADATA_DIR, videoId, 'processing.json');
        if (fs.existsSync(manifestPath)) {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
          manifest.status = 'completed';
          manifest.completed_at = new Date().toISOString();
          fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
        }

        const syncResult = syncIndexes();
        const tmpTarget = path.join(TMP_DIR, videoId);
        let cleanedTmp = false;
        if (fs.existsSync(tmpTarget)) {
          fs.rmSync(tmpTarget, { recursive: true, force: true });
          cleanedTmp = true;
        }

        console.log(JSON.stringify({ finalized: true, validation, sync: syncResult, cleaned_tmp: cleanedTmp }, null, 2));
        break;
      }

      case 'sync': {
        const result = syncIndexes();
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case 'search': {
        const results = searchClips({
          category: flags.category,
          tag: flags.tag,
          query: flags.query,
          topic: flags.topic,
          role: flags.role,
          type: flags.type,
          usable: flags.usable,
          standalone: flags.standalone,
          priority: flags.priority,
          video: flags.video,
        });
        if (flags.json) {
          console.log(JSON.stringify({ count: results.length, results }, null, 2));
        } else if (results.length === 0) {
          console.log('No matching clips found.');
        } else {
          console.log(`Found ${results.length} clip(s):\n`);
          for (const r of results) {
            console.log(`- [${r.video_id} / ${r.segment_id}] ${r.start_tc} - ${r.end_tc} | roles: ${r.roles.join(', ') || '-'} | usable: ${r.usable} | standalone: ${r.standalone}`);
            if (r.speech) console.log(`  Speech: ${r.speech}`);
            if (r.visual) console.log(`  Visual: ${r.visual}`);
            console.log(`  File: ${r.file}`);
          }
        }
        break;
      }

      case 'clean':
        cmdClean(positional[1]);
        break;

      default:
        console.error(`Unknown command: ${cmd}`);
        printHelp();
        process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
