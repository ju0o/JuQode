import net from 'node:net';

export function portAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE' || error.code === 'EACCES') resolve(false);
      else reject(error);
    });
    server.listen(port, '127.0.0.1', () => {
      server.close((error) => error ? reject(error) : resolve(true));
    });
  });
}

export async function findFreePortBlock(preferred = 9223, width = 3, canBind = portAvailable) {
  if (!Number.isInteger(preferred) || preferred < 1024 || preferred > 65535) {
    throw new RangeError('preferred port must be an integer from 1024 to 65535');
  }
  if (!Number.isInteger(width) || width < 1 || width > 16) {
    throw new RangeError('port block width must be from 1 to 16');
  }

  for (let base = preferred; base + width - 1 <= 65535; base += 1) {
    let available = true;
    for (let port = base; port < base + width; port += 1) {
      if (!(await canBind(port))) { available = false; break; }
    }
    if (available) return base;
  }
  throw new Error('no free consecutive port block found');
}
