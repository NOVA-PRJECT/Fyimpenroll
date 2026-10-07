/**
 * Automated Mobile -> Backend Connectivity Diagnostic Tool
 * Validates that the local NestJS backend is up and reachable
 * via both localhost and the LAN IP specified in mobile/.env.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

// Read mobile/.env to extract EXPO_PUBLIC_API_BASE_URL
const envPath = path.resolve(__dirname, '../.env');
let configuredUrl = 'http://192.168.220.108:4000';

if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  const match = content.match(/EXPO_PUBLIC_API_BASE_URL\s*=\s*(.+)/);
  if (match && match[1]) {
    configuredUrl = match[1].trim();
  }
}

function testEndpoint(urlStr, label) {
  return new Promise((resolve) => {
    const url = new URL(urlStr);
    const startTime = Date.now();

    const req = http.get(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname + (url.search || ''),
        timeout: 4000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          const latency = Date.now() - startTime;
          try {
            const json = JSON.parse(body);
            resolve({
              label,
              url: urlStr,
              ok: res.statusCode === 200 && json.status === 'ok',
              statusCode: res.statusCode,
              latency,
              payload: json,
            });
          } catch {
            resolve({
              label,
              url: urlStr,
              ok: res.statusCode === 200,
              statusCode: res.statusCode,
              latency,
              payload: body.substring(0, 100),
            });
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({
        label,
        url: urlStr,
        ok: false,
        error: 'Connection timed out (4000ms). Check firewall or network interface.',
      });
    });

    req.on('error', (err) => {
      resolve({
        label,
        url: urlStr,
        ok: false,
        error: err.message,
      });
    });
  });
}

async function run() {
  console.log('\n======================================================');
  console.log('   FYIMP Mobile <-> Backend Connectivity Verifier    ');
  console.log('======================================================\n');
  console.log(`Configured API Base URL: ${configuredUrl}`);

  const healthPath = '/api/health';
  const targets = [
    { label: 'Local Loopback (127.0.0.1)', url: `http://127.0.0.1:4000${healthPath}` },
    { label: 'Configured LAN IP (.env)', url: `${configuredUrl.replace(/\/$/, '')}${healthPath}` },
  ];

  let allOk = true;

  for (const target of targets) {
    process.stdout.write(`Testing [${target.label}] (${target.url})... `);
    const result = await testEndpoint(target.url, target.label);

    if (result.ok) {
      console.log(`\x1b[32mSUCCESS (200 OK, ${result.latency}ms)\x1b[0m`);
      console.log(`  Payload: status="${result.payload.status}", uptime=${Math.round(result.payload.uptime || 0)}s`);
    } else {
      allOk = false;
      console.log(`\x1b[31mFAILED\x1b[0m`);
      console.log(`  Error: ${result.error || `HTTP ${result.statusCode}: ${JSON.stringify(result.payload)}`}`);
    }
  }

  console.log('\n------------------------------------------------------');
  if (allOk) {
    console.log('\x1b[32m✔ ALL CONNECTIVITY CHECKS PASSED!\x1b[0m');
    console.log('Mobile app in Expo Go can connect to the NestJS backend.\n');
    process.exit(0);
  } else {
    console.log('\x1b[31m✖ CONNECTIVITY CHECK FAILED!\x1b[0m');
    console.log('Ensure the NestJS backend is running:');
    console.log('  npm run dev:backend');
    console.log('Ensure Windows Firewall permits incoming TCP on port 4000.\n');
    process.exit(1);
  }
}

run();
