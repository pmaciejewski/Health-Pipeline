import { build } from "esbuild";
import { writeFileSync, mkdirSync } from "node:fs";

const common = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: false,
  minify: true,
  logLevel: "info",
};

await build({
  ...common,
  entryPoints: ["src/parser/index.js"],
  outfile: "dist/parser/index.js",
});

await build({
  ...common,
  entryPoints: ["src/mcp/index.js"],
  outfile: "dist/mcp/index.js",
});

// The repo package.json sets "type": "module"; the bundles are CJS. Mark the
// dist dirs explicitly so Node (locally and in Lambda) always loads them as CJS.
for (const dir of ["dist/parser", "dist/mcp"]) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/package.json`, '{"type":"commonjs"}\n');
}
