'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
test('DG-04 adversarial: skips a busy default CDP block', async () => {
  const { findFreePortBlock } = await import('./e2e/port-block.mjs');
  const busy = new Set([9223, 9224, 9225]);
  const selected = await findFreePortBlock(9223, 3, async (port) => !busy.has(port));
  assert.equal(selected, 9226);
});

test('DG-04 adversarial: skips an actually bound preferred port', async () => {
  const { findFreePortBlock, portAvailable } = await import('./e2e/port-block.mjs');
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const occupied = server.address().port;
  try {
    const selected = await findFreePortBlock(occupied, 3);
    assert.notEqual(selected, occupied);
    assert.ok(selected > occupied, 'selection must advance past the occupied port');
    for (let offset = 0; offset < 3; offset += 1) {
      assert.equal(await portAvailable(selected + offset), true);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
