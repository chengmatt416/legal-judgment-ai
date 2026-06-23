const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const DIST_DIR = path.resolve(__dirname, 'dist');
const BUILD_DIR = path.resolve(DIST_DIR, 'build');
const CHROME_DIR = path.resolve(DIST_DIR, 'chrome-edge');
const FIREFOX_DIR = path.resolve(DIST_DIR, 'firefox');

function runCommand(command) {
  return new Promise((resolve, reject) => {
    console.log(`Executing: ${command}`);
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error executing ${command}:`, stderr);
        reject(error);
      } else {
        console.log(stdout);
        resolve();
      }
    });
  });
}

function zipDirectory(sourceDir, outPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      console.log(`Created zip archive: ${outPath} (${archive.pointer()} total bytes)`);
      resolve();
    });

    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') {
        console.warn(err);
      } else {
        reject(err);
      }
    });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

async function build() {
  try {
    console.log('--- Starting Extension Build & Packaging Pipeline ---');

    // 1. Clean previous builds
    console.log('Cleaning old build directories...');
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
    fs.mkdirSync(DIST_DIR, { recursive: true });

    // 2. Run Webpack to bundle and minify JavaScript
    console.log('Running Webpack bundling & minification (Terser)...');
    await runCommand('npx webpack --config webpack.config.js');

    if (!fs.existsSync(BUILD_DIR)) {
      throw new Error('Webpack build directory does not exist! Compilation failed.');
    }

    // 3. Prepare target directories
    console.log('Setting up deployment packages for Chrome/Edge and Firefox...');
    fs.mkdirSync(CHROME_DIR, { recursive: true });
    fs.mkdirSync(FIREFOX_DIR, { recursive: true });

    // Copy Webpack build outputs into Chrome/Edge and Firefox folders
    fs.cpSync(BUILD_DIR, CHROME_DIR, { recursive: true });
    fs.cpSync(BUILD_DIR, FIREFOX_DIR, { recursive: true });

    // 4. Read source manifest.json
    const manifestPath = path.resolve(__dirname, 'manifest.json');
    const manifestRaw = fs.readFileSync(manifestPath, 'utf8');
    const baseManifest = JSON.parse(manifestRaw);

    // 5. Build Chrome/Edge Manifest V3
    console.log('Generating Chrome/Edge Manifest V3...');
    const chromeManifest = { ...baseManifest };
    
    // Configure Chrome/Edge background service worker
    chromeManifest.background = {
      service_worker: 'background.js',
      type: 'module'
    };

    // Update content script paths to point to unified bundle
    chromeManifest.content_scripts = baseManifest.content_scripts.map(cs => {
      const newCs = { ...cs };
      if (newCs.js && newCs.js.includes('src/content/content-script.js')) {
        newCs.js = ['content-script.js'];
      }
      return newCs;
    });

    // Update web_accessible_resources (exclude bundled JS files, only keep css)
    chromeManifest.web_accessible_resources = baseManifest.web_accessible_resources.map(war => {
      const newWar = { ...war };
      if (newWar.resources) {
        newWar.resources = newWar.resources.filter(res => res.endsWith('.css'));
      }
      return newWar;
    });

    fs.writeFileSync(
      path.resolve(CHROME_DIR, 'manifest.json'),
      JSON.stringify(chromeManifest, null, 2),
      'utf8'
    );

    // 6. Build Firefox Manifest V3
    console.log('Generating Firefox Manifest V3...');
    const firefoxManifest = { ...baseManifest };

    // Configure Firefox background scripts (MV3 requires array of scripts)
    firefoxManifest.background = {
      scripts: ['background.js']
    };

    // Update content scripts & web accessible resources (same as Chrome/Edge)
    firefoxManifest.content_scripts = chromeManifest.content_scripts;
    firefoxManifest.web_accessible_resources = chromeManifest.web_accessible_resources;

    // Add Firefox Specific Settings
    firefoxManifest.browser_specific_settings = {
      gecko: {
        id: 'legal-judgment-ai@chengmatt.projects',
        strict_min_version: '140.0',
        data_collection_permissions: {
          required: ['none']
        }
      }
    };

    fs.writeFileSync(
      path.resolve(FIREFOX_DIR, 'manifest.json'),
      JSON.stringify(firefoxManifest, null, 2),
      'utf8'
    );

    // 7. Cleanup temp build directory
    console.log('Removing temporary files...');
    fs.rmSync(BUILD_DIR, { recursive: true, force: true });

    // 8. Pack folders into .zip files for store submissions
    console.log('Zipping Chrome/Edge package...');
    await zipDirectory(CHROME_DIR, path.resolve(DIST_DIR, 'chrome-edge.zip'));

    console.log('Zipping Firefox package...');
    await zipDirectory(FIREFOX_DIR, path.resolve(DIST_DIR, 'firefox.zip'));

    console.log('--- Packaging Pipeline Completed Successfully! ---');
    console.log(`Chrome/Edge Package: ${path.resolve(DIST_DIR, 'chrome-edge.zip')}`);
    console.log(`Firefox Package:     ${path.resolve(DIST_DIR, 'firefox.zip')}`);

  } catch (error) {
    console.error('Build process failed:', error);
    process.exit(1);
  }
}

build();
