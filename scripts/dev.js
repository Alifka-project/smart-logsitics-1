/**
 * Local Development Server - Starts Everything with Docker
 * Run: npm run dev
 */

const { spawn, exec } = require('child_process');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
let processes = [];

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

function log(color, prefix, message) {
  console.log(`${colors[color]}${prefix}${colors.reset} ${message}`);
}

// Check if Docker is running
function checkDocker() {
  return new Promise((resolve, reject) => {
    exec('docker ps', (error) => {
      if (error) {
        log('red', '❌', 'Docker is not running!');
        log('yellow', '   ', 'Please start Docker Desktop and try again.');
        reject(error);
      } else {
        log('green', '✅', 'Docker is running');
        resolve();
      }
    });
  });
}

// Start database
function startDatabase() {
  return new Promise((resolve) => {
    log('cyan', '🐳', 'Starting PostgreSQL database...');
    const dbProcess = spawn('docker-compose', ['up', '-d', 'db'], {
      cwd: PROJECT_ROOT,
      stdio: 'inherit'
    });

    dbProcess.on('close', (code) => {
      if (code === 0) {
        log('green', '✅', 'Database container started');
        waitForDatabase().then(resolve);
      } else {
        log('red', '❌', 'Failed to start database');
        resolve();
      }
    });
  });
}

// Wait for database to be ready
function waitForDatabase() {
  return new Promise((resolve) => {
    log('cyan', '⏳', 'Waiting for database to be ready...');
    let attempts = 0;
    const maxAttempts = 30;

    const checkDb = setInterval(() => {
      attempts++;
      exec('docker-compose exec -T db pg_isready -U postgres', { cwd: PROJECT_ROOT }, (error) => {
        if (!error) {
          clearInterval(checkDb);
          log('green', '✅', 'Database is ready!');
          resolve();
        } else if (attempts >= maxAttempts) {
          clearInterval(checkDb);
          log('yellow', '⚠️', 'Database check timeout, continuing anyway...');
          resolve();
        }
      });
    }, 1000);
  });
}

// Create users if they don't exist
function createUsers() {
  return new Promise((resolve) => {
    log('cyan', '👤', 'Creating users...');
    const userProcess = spawn('node', ['src/server/seedUsers.js'], {
      cwd: PROJECT_ROOT,
      stdio: 'pipe'
    });

    let output = '';
    userProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    userProcess.stderr.on('data', (data) => {
      output += data.toString();
    });

    userProcess.on('close', () => {
      if (output.includes('Seeded user') || output.includes('already exists')) {
        log('green', '✅', 'Users ready');
      }
      resolve();
    });
  });
}

// Start backend server
function startBackend() {
  return new Promise((resolve) => {
    log('cyan', '🚀', 'Starting backend server...');
    const backendProcess = spawn('node', ['src/server/index.js'], {
      cwd: PROJECT_ROOT,
      stdio: 'pipe',
      env: { ...process.env, NODE_ENV: 'development' }
    });

    let backendOutput = '';
    backendProcess.stdout.on('data', (data) => {
      const line = data.toString();
      backendOutput += line;
      if (line.includes('Server listening')) {
        log('green', '✅', 'Backend server running on http://localhost:4000');
        resolve(backendProcess);
      }
    });

    backendProcess.stderr.on('data', (data) => {
      const line = data.toString();
      if (!line.includes('WARN') && !line.includes('Warning')) {
        process.stderr.write(data);
      }
    });

    processes.push(backendProcess);

    setTimeout(() => {
      if (!backendOutput.includes('Server listening')) {
        log('yellow', '⚠️', 'Backend may be starting... continuing...');
        resolve(backendProcess);
      }
    }, 5000);
  });
}

// Start frontend dev server
function startFrontend(backendProcess) {
  log('cyan', '⚛️', 'Starting frontend dev server...');
  
  const frontendProcess = spawn('npm', ['run', 'dev:frontend'], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, NODE_ENV: 'development' }
  });

  processes.push(frontendProcess);
  processes.push(backendProcess);

  // Handle cleanup on exit
  const cleanup = () => {
    log('yellow', '\n🛑', 'Stopping all servers...');
    processes.forEach(p => {
      try {
        p.kill('SIGTERM');
      } catch (e) {}
    });
    
    exec('docker-compose down', { cwd: PROJECT_ROOT }, () => {
      log('green', '✅', 'All servers stopped');
      setTimeout(() => process.exit(0), 1000);
    });
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  frontendProcess.on('close', cleanup);
}

// Main execution
async function main() {
  console.log('');
  log('blue', '🚀', 'Starting Dubai Logistics System (Local Development)');
  log('blue', '═══', '═══════════════════════════════════════════════════');
  console.log('');
  log('yellow', '⚠️', 'Database is REQUIRED for this system');
  log('green', '✅', 'Using PostgreSQL database via Docker');
  console.log('');

  try {
    await checkDocker();
    console.log('');

    await startDatabase();
    console.log('');

    await createUsers();
    console.log('');

    const backendProcess = await startBackend();
    console.log('');

    startFrontend(backendProcess);

    console.log('');
    log('green', '✅', 'Everything is running!');
    log('cyan', '🌐', 'Frontend: http://localhost:5173');
    log('cyan', '🔧', 'Backend:  http://localhost:4000');
    log('cyan', '📊', 'Database: localhost:5432 (Docker)');
    console.log('');
    log('yellow', '💡', 'Press Ctrl+C to stop everything');
    console.log('');
    log('blue', '🔐', 'Login: Admin / Admin123');
    console.log('');

  } catch (error) {
    log('red', '❌', 'Failed to start development environment');
    console.error(error);
    process.exit(1);
  }
}

main();

