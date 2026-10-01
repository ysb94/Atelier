import { readFile } from 'node:fs/promises';
const fixture = JSON.parse(await readFile(new URL('../../.tmp/cursor-connection-fixture.json', import.meta.url), 'utf8'));
if (fixture.status !== 'connected' || fixture.untouched !== 'KEEP' || fixture.taskId !== 'CURSOR_CONNECT_01') {
  throw new Error('Connection fixture failed: expected connected status and unchanged protected fields');
}
console.log('PASS: Cursor changed the authorized field and preserved both other fields.');
