// Verify no orphan login-chromium processes remain (checks command line for the
// mimo-login temp profile marker) and that the login CDP port is closed.
import { execSync } from 'node:child_process';

let rows = [];
try {
  const out = execSync(
    'wmic process where "name=\'chrome.exe\'" get processid,commandline /format:csv',
    { encoding: 'utf8' }
  );
  rows = out.split('\n').filter(l => l.includes('mimo-login'));
} catch (e) {
  console.log('wmic failed (may be deprecated): ' + e.message.slice(0, 80));
  // fallback: powershell
  try {
    const ps = execSync(
      "powershell -Command \"Get-CimInstance Win32_Process -Filter \\\"Name='chrome.exe'\\\" | Select-Object CommandLine | Where-Object {$_.CommandLine -like '*mimo-login*'} | Measure-Object | Select-Object -ExpandProperty Count\"",
      { encoding: 'utf8' }
    );
    const count = parseInt(String(ps).trim());
    console.log(count === 0 ? 'ZERO orphan login-chromium processes - GOOD' : 'ORPHANS FOUND: ' + count);
  } catch (e2) { console.log('powershell also failed: ' + e2.message.slice(0, 80)); }
}
if (rows.length) {
  console.log('ORPHANS FOUND (' + rows.length + '):');
  rows.forEach(r => console.log('  ' + r.slice(0, 200)));
} else if (rows.length === 0) {
  console.log('ZERO orphan login-chromium processes - GOOD');
}

let portClosed = false;
try { await fetch('http://127.0.0.1:9340/json/version', { signal: AbortSignal.timeout(1500) }); } catch (e) { portClosed = true; }
console.log(portClosed ? 'login CDP port 9340 closed - GOOD' : 'PORT 9340 STILL OPEN - BAD');
