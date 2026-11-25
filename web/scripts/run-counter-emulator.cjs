'use strict';

const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const webRoot = path.resolve(__dirname, '..');
const projectId = 'demo-intention-counters';

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, port: server.address().port };
}

function quoteArgument(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function javaEnvironment() {
  const homes = [
    process.env.JAVA_HOME,
    null,
    ...(process.platform === 'darwin' ? [
      '/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home',
      '/usr/local/opt/openjdk/libexec/openjdk.jdk/Contents/Home',
    ] : []),
  ];
  for (const home of homes) {
    if (home === undefined) continue;
    const binary = home ? path.join(home, 'bin', 'java') : 'java';
    const result = spawnSync(binary, ['-version'], { encoding: 'utf8', timeout: 10_000 });
    const version = `${result.stderr || ''}${result.stdout || ''}`.match(/version "(\d+)/);
    if (result.status === 0 && version && Number(version[1]) >= 21) {
      return home ? { JAVA_HOME: home, PATH: `${path.join(home, 'bin')}${path.delimiter}${process.env.PATH || ''}` } : {};
    }
  }
  throw new Error('Counter emulator tests require Java 21 or newer. Set JAVA_HOME to a supported JDK.');
}

async function main() {
  const java = javaEnvironment();
  const cli = process.env.FIREBASE_CLI_BIN || 'firebase';
  const version = spawnSync(cli, ['--version'], { encoding: 'utf8', timeout: 15_000 });
  if (version.status !== 0 || version.stdout.trim() !== '14.9.0') {
    throw new Error('Counter emulator tests require firebase-tools@14.9.0. Install that version or set FIREBASE_CLI_BIN to it.');
  }
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'intention-counter-emulator-'));
  const reservations = [];
  try {
    for (let index = 0; index < 5; index += 1) reservations.push(await reservePort());
    const [firestore, auth, hub, logging, websocket] = reservations.map(({ port }) => port);
    const config = JSON.parse(fs.readFileSync(path.join(webRoot, 'test-firestore-counter-emulator.config.json'), 'utf8'));
    config.firestore.rules = path.join(webRoot, 'firestore-counter-rollout.rules');
    config.emulators.firestore = { host: '127.0.0.1', port: firestore, websocketPort: websocket };
    config.emulators.auth = { host: '127.0.0.1', port: auth };
    config.emulators.hub = { host: '127.0.0.1', port: hub };
    config.emulators.logging = { host: '127.0.0.1', port: logging };
    const configPath = path.join(tempRoot, 'firebase.json');
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    await Promise.all(reservations.map(({ server }) => new Promise((resolve) => server.close(resolve))));
    const command = `${quoteArgument(process.execPath)} ${quoteArgument(path.join(__dirname, 'test-counter-emulator.cjs'))}`;
    const childEnv = {
      ...process.env,
      ...java,
      GCLOUD_PROJECT: projectId,
      GOOGLE_CLOUD_PROJECT: projectId,
      FIREBASE_PROJECT_ID: projectId,
      FIRESTORE_EMULATOR_HOST: `127.0.0.1:${firestore}`,
      FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${auth}`,
      XDG_CONFIG_HOME: path.join(tempRoot, 'config'),
      CI: 'true',
      FIREBASE_CLI_DISABLE_MOTD: 'true',
    };
    for (const credential of ['GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_KEYFILE_JSON', 'FIREBASE_TOKEN']) {
      delete childEnv[credential];
    }
    const child = spawn(cli, [
      'emulators:exec', '--project', projectId, '--only', 'firestore,auth',
      '--config', configPath, '--non-interactive', command,
    ], {
      cwd: tempRoot,
      stdio: 'inherit',
      env: childEnv,
    });
    const forward = (signal) => child.kill(signal);
    const onInterrupt = () => forward('SIGINT');
    const onTerminate = () => forward('SIGTERM');
    process.once('SIGINT', onInterrupt);
    process.once('SIGTERM', onTerminate);
    try {
      process.exitCode = await new Promise((resolve, reject) => {
        child.once('error', (error) => reject(new Error(`Could not start Firebase CLI (${cli}): ${error.message}`)));
        child.once('exit', (code) => resolve(code ?? 1));
      });
    } finally {
      process.removeListener('SIGINT', onInterrupt);
      process.removeListener('SIGTERM', onTerminate);
    }
  } finally {
    for (const { server } of reservations) if (server.listening) server.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
