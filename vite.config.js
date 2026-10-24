import { defineConfig } from 'vite';
import { cp, writeFile } from 'node:fs/promises';
import path from 'node:path';

let projectRoot;
let outputRoot;

// Relative assets work at both / and a GitHub Pages repository path.
export default defineConfig({
  base: './',
  plugins: [{
    name: 'preserve-arcade-release',
    apply: 'build',
    configResolved(config) {
      projectRoot = config.root;
      outputRoot = path.resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const release = 'releases/arcade-0.2.1';
      await cp(path.join(projectRoot, release), path.join(outputRoot, release), { recursive: true });
      await writeFile(path.join(outputRoot, '.nojekyll'), '');
    },
  }],
});
