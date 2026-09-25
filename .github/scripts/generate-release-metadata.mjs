import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const { BUNDLE, ANDROID_BUNDLE, OUTPUT_DIR = process.cwd(), REPO, TAG } = process.env;

for (const [name, value] of Object.entries({ BUNDLE, REPO, TAG })) {
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
}

const TEXT = {
  changes: "\u66f4\u65b0\u5185\u5bb9",
  download: "\u4e0b\u8f7d",
  fallback: "- \u672c\u6b21\u4e3a\u6784\u5efa\u4e0e\u53d1\u5e03\u66f4\u65b0\u3002",
  fullChanges: "\u67e5\u770b\u5b8c\u6574\u53d8\u66f4",
  groups: {
    feat: "\u65b0\u529f\u80fd",
    fix: "\u95ee\u9898\u4fee\u590d",
    perf: "\u6027\u80fd\u4f18\u5316",
    refactor: "\u4ee3\u7801\u4f18\u5316",
    maintenance: "\u5de5\u7a0b\u7ef4\u62a4",
    other: "\u5176\u4ed6\u8c03\u6574",
  },
  androidUnavailable:
    "\u76ee\u524d\u6ca1\u6709\u66f4\u65b0\u5305\uff0c\u5f85\u684c\u9762\u7aef\u57fa\u7840\u529f\u80fd\u5b8c\u5584\u540e\u6301\u7eed\u63a8\u8fdb\u3002\u6b64\u524d\u5728\u7fa4\u5185\u53d1\u5e03\u7684 APK \u53ef\u81ea\u884c\u67e5\u627e\u3002",
  assetsHint: "\u4e5f\u53ef\u5728\u4e0b\u65b9 Assets \u4e2d\u4e0b\u8f7d",
};

const version = TAG.replace(/^v/, "");
const releaseBaseUrl = `https://github.com/${REPO}/releases/download/${TAG}`;

function walk(directory) {
  if (!directory || !existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function assetUrl(file) {
  return `${releaseBaseUrl}/${encodeURIComponent(path.basename(file))}`;
}

function readSignature(file) {
  const signaturePath = `${file}.sig`;
  if (!existsSync(signaturePath)) {
    throw new Error(`Missing updater signature: ${signaturePath}`);
  }
  return readFileSync(signaturePath, "utf8").trim();
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function previousTag() {
  const tags = git(["tag", "--merged", "HEAD", "--sort=-version:refname"])
    .split(/\r?\n/)
    .filter((tag) => tag && tag !== TAG);
  return tags[0] ?? null;
}

function collectChanges(previous) {
  const range = previous ? `${previous}..HEAD` : "HEAD";
  const output = git(["log", range, "--no-merges", "--pretty=format:%s"]);
  const groups = new Map([
    [TEXT.groups.feat, []],
    [TEXT.groups.fix, []],
    [TEXT.groups.perf, []],
    [TEXT.groups.refactor, []],
    [TEXT.groups.maintenance, []],
    [TEXT.groups.other, []],
  ]);
  const prefixes = {
    feat: TEXT.groups.feat,
    fix: TEXT.groups.fix,
    perf: TEXT.groups.perf,
    refactor: TEXT.groups.refactor,
    build: TEXT.groups.maintenance,
    chore: TEXT.groups.maintenance,
    ci: TEXT.groups.maintenance,
    docs: TEXT.groups.maintenance,
  };

  for (const subject of output.split(/\r?\n/).filter(Boolean)) {
    const match = subject.match(/^(\w+)(?:\([^)]*\))?!?:\s*(.+)$/);
    const group = prefixes[match?.[1]] ?? TEXT.groups.other;
    groups.get(group).push(match?.[2] ?? subject);
  }

  const lines = [];
  for (const [group, entries] of groups) {
    if (entries.length === 0) continue;
    lines.push(`#### ${group}`, ...entries.map((entry) => `- ${entry}`), "");
  }
  return lines.length > 0 ? lines.join("\n").trim() : TEXT.fallback;
}

const windowsFiles = walk(BUNDLE).sort();
const setupExe =
  windowsFiles.find((file) => /-setup\.exe$/i.test(file)) ??
  windowsFiles.find((file) => /\.exe$/i.test(file));
if (!setupExe) {
  throw new Error(`No Windows installer found under ${BUNDLE}`);
}

const msi = windowsFiles.find((file) => /\.msi$/i.test(file));
const androidApks = walk(ANDROID_BUNDLE).filter((file) => /\.apk$/i.test(file)).sort();
const previous = previousTag();
const changes = collectChanges(previous);

const downloads = [
  `- **Windows x64**: [\`${path.basename(setupExe)}\`](${assetUrl(setupExe)})\uff08${TEXT.assetsHint}\uff09`,
];
if (msi) {
  downloads.push(`- **Windows x64 (MSI)**: [\`${path.basename(msi)}\`](${assetUrl(msi)})`);
}
if (androidApks.length > 0) {
  downloads.push(
    ...androidApks.map(
      (apk) => `- **Android**: [\`${path.basename(apk)}\`](${assetUrl(apk)})`,
    ),
  );
} else {
  downloads.push(`- **Android**: ${TEXT.androidUnavailable}`);
}

const comparison = previous
  ? `\n\n[${TEXT.fullChanges}](https://github.com/${REPO}/compare/${previous}...${TAG})`
  : "";
const releaseBody = [
  `# DeepEr ${TAG}`,
  "",
  `## ${TEXT.download}`,
  ...downloads,
  "",
  `## ${TEXT.changes}`,
  changes,
  comparison,
  "",
].join("\n");
writeFileSync(path.join(OUTPUT_DIR, "release-body.md"), releaseBody, "utf8");

const platforms = {
  "windows-x86_64": {
    url: assetUrl(setupExe),
    signature: readSignature(setupExe),
  },
};
if (msi && existsSync(`${msi}.sig`)) {
  platforms["windows-x86_64-msi"] = {
    url: assetUrl(msi),
    signature: readFileSync(`${msi}.sig`, "utf8").trim(),
  };
}

writeFileSync(
  path.join(OUTPUT_DIR, "latest.json"),
  `${JSON.stringify(
    {
      version,
      notes: changes,
      pub_date: new Date().toISOString(),
      platforms,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
