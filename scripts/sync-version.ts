import * as fs from "node:fs";
import * as path from "node:path";

export interface TargetResult {
  path: string;
  inSync: boolean;
  updated?: boolean;
}

export function parseVersionFromEnv(envContent: string): string {
  const match = envContent.match(/^\s*QURIODB_VERSION\s*=\s*(["']?)([^"'\r\n#]+)\1/m);
  if (!match || !match[2]?.trim()) {
    throw new Error("Missing QURIODB_VERSION in environment configuration");
  }
  return match[2].trim();
}

export function validateSemver(version: string): string {
  const semverRegex =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
  if (!semverRegex.test(version)) {
    throw new Error(`Invalid semantic version: '${version}'`);
  }
  return version;
}

function updateDesktopPackageJson(content: string, version: string): string {
  return content.replace(
    /("name"\s*:\s*"desktop",\r?\n\s*"version"\s*:\s*)"[^"]*"/,
    `$1"${version}"`,
  );
}

function updateTauriConfJson(content: string, version: string): string {
  return content.replace(
    /("productName"\s*:\s*"QurioDB",\r?\n\s*"version"\s*:\s*)"[^"]*"/,
    `$1"${version}"`,
  );
}

function updateCargoToml(content: string, version: string): string {
  // Update package version under [package] section
  return content.replace(
    /(\[package\][\s\S]*?^version\s*=\s*)"[^"]*"/m,
    `$1"${version}"`,
  );
}

function updateCargoLock(content: string, version: string): string {
  // Update version specifically for package name = "quriodb-desktop"
  return content.replace(
    /(\[\[package\]\]\r?\nname\s*=\s*"quriodb-desktop"\r?\nversion\s*=\s*)"[^"]*"/,
    `$1"${version}"`,
  );
}

function updateRootReadme(content: string, version: string): string {
  let updated = content;
  // Match links like - [Download Windows Installer (v0.1.0)](https://github.com/trungvinh2102/QurioDB/releases/download/v0.1.0/QurioDB_0.1.0_x64_en-US.msi)
  updated = updated.replace(
    /\[Download Windows Installer \(v[^)]+\)\]\(https:\/\/github\.com\/[^\/]+\/[^\/]+\/releases\/download\/v[^\/]+\/QurioDB_[^_]+_x64_en-US\.msi\)/g,
    `[Download Windows Installer (v${version})](https://github.com/trungvinh2102/QurioDB/releases/download/v${version}/QurioDB_${version}_x64_en-US.msi)`,
  );

  // Match links like - [Download Windows Setup (v0.1.0)](https://github.com/trungvinh2102/QurioDB/releases/download/v0.1.0/QurioDB_0.1.0_x64-setup.exe)
  updated = updated.replace(
    /\[Download Windows Setup \(v[^)]+\)\]\(https:\/\/github\.com\/[^\/]+\/[^\/]+\/releases\/download\/v[^\/]+\/QurioDB_[^_]+_x64-setup\.exe\)/g,
    `[Download Windows Setup (v${version})](https://github.com/trungvinh2102/QurioDB/releases/download/v${version}/QurioDB_${version}_x64-setup.exe)`,
  );

  // Match links like - [Download Linux Package (v0.1.0)](https://github.com/trungvinh2102/QurioDB/releases/download/v0.1.0/QurioDB_0.1.0_amd64.deb)
  updated = updated.replace(
    /\[Download Linux Package \(v[^)]+\)\]\(https:\/\/github\.com\/[^\/]+\/[^\/]+\/releases\/download\/v[^\/]+\/QurioDB_[^_]+_amd64\.deb\)/g,
    `[Download Linux Package (v${version})](https://github.com/trungvinh2102/QurioDB/releases/download/v${version}/QurioDB_${version}_amd64.deb)`,
  );

  // Match links like - [Download Linux AppImage (v0.1.0)](...QurioDB_0.1.0_amd64.AppImage)
  updated = updated.replace(
    /\[Download Linux AppImage \(v[^)]+\)\]\(https:\/\/github\.com\/[^\/]+\/[^\/]+\/releases\/download\/v[^\/]+\/QurioDB_[^_]+_amd64\.AppImage\)/g,
    `[Download Linux AppImage (v${version})](https://github.com/trungvinh2102/QurioDB/releases/download/v${version}/QurioDB_${version}_amd64.AppImage)`,
  );

  // Match footer "QurioDB - v0.1.0"
  updated = updated.replace(
    /^QurioDB\s*-\s*v.*$/m,
    `QurioDB - v${version}`,
  );

  return updated;
}

function updateDesktopReadme(content: string, version: string): string {
  // Match footer "_QurioDB Team - v0.1.0_"
  return content.replace(
    /^_QurioDB Team\s*-\s*v[^_]+_$/m,
    `_QurioDB Team - v${version}_`,
  );
}

interface TargetHandler {
  relPath: string;
  transform: (content: string, version: string) => string;
}

const TARGETS: TargetHandler[] = [
  {
    relPath: "apps/desktop/package.json",
    transform: updateDesktopPackageJson,
  },
  {
    relPath: "apps/desktop/src-tauri/tauri.conf.json",
    transform: updateTauriConfJson,
  },
  {
    relPath: "apps/desktop/src-tauri/Cargo.toml",
    transform: updateCargoToml,
  },
  {
    relPath: "apps/desktop/src-tauri/Cargo.lock",
    transform: updateCargoLock,
  },
  {
    relPath: "README.md",
    transform: updateRootReadme,
  },
  {
    relPath: "apps/desktop/README.md",
    transform: updateDesktopReadme,
  },
];

export function checkVersion(targetVersion: string, workspaceRoot: string = process.cwd()): TargetResult[] {
  const version = validateSemver(targetVersion);
  const results: TargetResult[] = [];

  for (const target of TARGETS) {
    const fullPath = path.join(workspaceRoot, target.relPath);
    if (!fs.existsSync(fullPath)) {
      results.push({ path: target.relPath, inSync: false });
      continue;
    }

    const currentContent = fs.readFileSync(fullPath, "utf-8");
    const transformed = target.transform(currentContent, version);
    const inSync = currentContent === transformed;
    results.push({ path: target.relPath, inSync });
  }

  return results;
}

export function syncVersion(targetVersion: string, workspaceRoot: string = process.cwd()): TargetResult[] {
  const version = validateSemver(targetVersion);
  const results: TargetResult[] = [];

  for (const target of TARGETS) {
    const fullPath = path.join(workspaceRoot, target.relPath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Target file not found: ${target.relPath}`);
    }

    const currentContent = fs.readFileSync(fullPath, "utf-8");
    const transformed = target.transform(currentContent, version);
    const inSync = currentContent === transformed;

    if (!inSync) {
      fs.writeFileSync(fullPath, transformed, "utf-8");
    }

    results.push({ path: target.relPath, inSync: true, updated: !inSync });
  }

  return results;
}

function resolveEnvVersion(workspaceRoot: string): string {
  const envPath = path.join(workspaceRoot, ".env");
  if (!fs.existsSync(envPath)) {
    throw new Error(
      `Canonical environment file not found at ${envPath}. Create .env with QURIODB_VERSION=<version>`,
    );
  }

  const envContent = fs.readFileSync(envPath, "utf-8");
  return parseVersionFromEnv(envContent);
}

function runCli(): void {
  const args = process.argv.slice(2);
  const isCheck = args.includes("--check");
  const workspaceRoot = process.cwd();

  try {
    const rawVersion = resolveEnvVersion(workspaceRoot);
    const version = validateSemver(rawVersion);

    if (isCheck) {
      const results = checkVersion(version, workspaceRoot);
      const stale = results.filter((r) => !r.inSync);

      if (stale.length > 0) {
        console.error(`Version mismatch detected! Canonical QURIODB_VERSION=${version}`);
        console.error("The following managed targets are out of sync:");
        for (const item of stale) {
          console.error(`  - ${item.path}`);
        }
        console.error("\nRun 'bun run version:sync' to synchronize targets.");
        process.exit(1);
      }

      console.log(`All managed targets match QURIODB_VERSION=${version}`);
      process.exit(0);
    } else {
      const results = syncVersion(version, workspaceRoot);
      const updated = results.filter((r) => r.updated);

      if (updated.length > 0) {
        console.log(`Synchronized QURIODB_VERSION=${version} to:`);
        for (const item of updated) {
          console.log(`  - ${item.path}`);
        }
      } else {
        console.log(`All targets already up to date with QURIODB_VERSION=${version}`);
      }
      process.exit(0);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (import.meta.main) {
  runCli();
}
