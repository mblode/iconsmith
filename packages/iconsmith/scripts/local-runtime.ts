/** A checker packet and command read boundary for the native local author. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { z } from "zod";

const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const packageSchema = z.object({
  dependencies: z.record(z.string()).optional(),
  name: z.string(),
  optionalDependencies: z.record(z.string()).optional(),
  version: z.string(),
});

/** Resolve installed optional native modules by their manifests, even when
 * package exports deliberately have no ordinary JS entry point. */
export const runtimePackages = (names: readonly string[], from: string) => {
  const packages = new Map<
    string,
    { directory: string; name: string; version: string }
  >();
  const visit = (name: string, parent: string, optional = false) => {
    const require = createRequire(path.join(parent, "package.json"));
    const manifest = (require.resolve.paths(name) ?? [])
      .map((directory) => path.join(directory, name, "package.json"))
      .find(existsSync);
    if (!manifest) {
      if (optional) {
        return;
      }
      throw new Error(`Missing checker dependency: ${name}`);
    }
    const directory = realpathSync(path.dirname(manifest));
    if (packages.has(directory)) {
      return;
    }
    const data = packageSchema.parse(
      JSON.parse(readFileSync(manifest, "utf-8"))
    );
    if (data.name !== name) {
      throw new Error(`Unexpected checker dependency: ${name}`);
    }
    packages.set(directory, { directory, name, version: data.version });
    for (const dependency of Object.keys(data.dependencies ?? {})) {
      visit(dependency, directory);
    }
    for (const dependency of Object.keys(data.optionalDependencies ?? {})) {
      visit(dependency, directory, true);
    }
  };
  for (const name of names) {
    visit(name, from);
  }
  return [...packages.values()];
};

const denied = z.enum(["EPERM", "EACCES"]);
const probeSchema = z
  .object({
    insideRead: z.literal("allowed"),
    insideWrite: z.literal("allowed"),
    network: denied,
    outsideRead: denied,
    outsideWrite: denied,
    sourceRead: denied,
    symlinkRead: denied,
  })
  .strict();
export const validateRuntimeProbe = (input: unknown) =>
  probeSchema.parse(input);

export interface LocalRuntime {
  checker: string;
  node: string;
  permissionArgs: string[];
  protectedFiles: string[];
  protectedLinks?: Record<string, string>;
}

export const prepareLocalRuntime = async (
  out: string,
  command: string,
  env: NodeJS.ProcessEnv
): Promise<LocalRuntime> => {
  const directory = realpathSync(out);
  const checker = path.join(directory, "checker.mjs");
  const source = fileURLToPath(new URL("style-check.ts", import.meta.url));
  const bundled = await build({
    bundle: true,
    entryPoints: [source],
    format: "esm",
    metafile: true,
    outfile: checker,
    packages: "external",
    platform: "node",
  });
  const imported = Object.values(bundled.metafile.outputs)
    .flatMap((output) => output.imports)
    .filter((item) => item.external && !item.path.startsWith("node:"))
    .map((item) =>
      item.path.startsWith("@")
        ? item.path.split("/").slice(0, 2).join("/")
        : item.path.split("/")[0]
    );
  // PathKit is loaded through createRequire with a separate WASM asset.
  const packages = runtimePackages(
    [...new Set([...imported, "pathkit-wasm"])],
    path.dirname(source)
  );
  const protectedLinks: Record<string, string> = {};
  for (const pkg of packages) {
    const link = path.join(directory, "node_modules", pkg.name);
    mkdirSync(path.dirname(link), { recursive: true });
    symlinkSync(pkg.directory, link, "dir");
    protectedLinks[link] = pkg.directory;
  }
  const node = realpathSync(process.execPath);
  const filesystem: Record<string, string> = {
    ":minimal": "read",
    ":root": "deny",
    ":slash_tmp": "deny",
    ":tmpdir": "deny",
    [directory]: "write",
    [node]: "read",
    ...Object.fromEntries(packages.map((pkg) => [pkg.directory, "read"])),
  };
  for (const systemPath of [
    "/System/Library/OpenSSL/openssl.cnf",
    "/System/Library/Fonts",
  ]) {
    if (existsSync(systemPath)) {
      filesystem[systemPath] = "read";
    }
  }
  const profile = `{${Object.entries(filesystem)
    .map(([key, value]) => `${JSON.stringify(key)}=${JSON.stringify(value)}`)
    .join(",")}}`;
  const configArgs = [
    "-c",
    `permissions.iconsmith-author.filesystem=${profile}`,
    "-c",
    "permissions.iconsmith-author.network.enabled=false",
  ];
  const sentinel = mkdtempSync(path.join(tmpdir(), "iconsmith-excluded-"));
  const outside = path.join(sentinel, "outside.txt");
  const link = path.join(directory, "runtime-excluded-link");
  const probe = path.join(directory, "runtime-probe.mjs");
  let evidence: z.infer<typeof probeSchema>;
  try {
    writeFileSync(outside, "Synthetic excluded fixture, not artwork.");
    symlinkSync(outside, link);
    writeFileSync(
      probe,
      `import fs from 'node:fs'; import net from 'node:net';
const probe=(operation)=>{try{operation();return 'allowed';}catch(e){return e.code;}};
const read=p=>probe(()=>{const fd=fs.openSync(p,'r');fs.closeSync(fd);});
const results={insideRead:read(${JSON.stringify(checker)}),insideWrite:probe(()=>fs.writeFileSync(${JSON.stringify(path.join(directory, "runtime-write.txt"))},'ok')),outsideRead:read(${JSON.stringify(outside)}),outsideWrite:probe(()=>fs.writeFileSync(${JSON.stringify(outside)},'changed')),symlinkRead:read(${JSON.stringify(link)}),sourceRead:read(${JSON.stringify(source)})};
results.network=await new Promise(resolve=>{const socket=net.connect({host:'127.0.0.1',port:9});socket.once('connect',()=>{socket.destroy();resolve('allowed');});socket.once('error',e=>resolve(e.code));socket.setTimeout(1500,()=>{socket.destroy();resolve('timeout');});});
console.log(JSON.stringify(results));`
    );
    const result = spawnSync(
      command,
      ["sandbox", "-P", "iconsmith-author", ...configArgs, "--", node, probe],
      {
        cwd: directory,
        encoding: "utf-8",
        env,
        timeout: 10_000,
      }
    );
    writeFileSync(
      path.join(directory, "runtime-preflight.json"),
      JSON.stringify(
        {
          error: result.error?.message,
          status: result.status,
          stderr: result.stderr,
          stdout: result.stdout,
        },
        null,
        2
      )
    );
    if (result.status !== 0) {
      throw new Error("Native author read-boundary preflight failed");
    }
    evidence = validateRuntimeProbe(JSON.parse(result.stdout));
  } finally {
    rmSync(sentinel, { force: true, recursive: true });
    for (const filename of [
      link,
      probe,
      path.join(directory, "runtime-write.txt"),
    ]) {
      rmSync(filename, { force: true });
    }
  }
  writeFileSync(
    path.join(directory, "runtime.json"),
    JSON.stringify(
      {
        checkerSha256: digest(readFileSync(checker)),
        evidence,
        filesystem,
        inputs: Object.keys(bundled.metafile.inputs),
        packages,
        protectedLinks,
        scope:
          "Command filesystem/network enforcement; not a sealed holdout qualification",
      },
      null,
      2
    )
  );
  return {
    checker,
    node,
    permissionArgs: [
      "-c",
      'default_permissions="iconsmith-author"',
      ...configArgs,
    ],
    protectedFiles: ["checker.mjs", "runtime.json", "runtime-preflight.json"],
    protectedLinks,
  };
};
