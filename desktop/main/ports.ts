// The server's port: the preferred one when it is free, so stored /__mock/ URLs
// and a registered OAuth redirect URI survive relaunches, else any free one
// (the guard rewrites stored URLs to the live origin).
import net from 'node:net';

const PREFERRED_PORT = 47821;

function bind(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen({ port, host: '127.0.0.1', exclusive: true }, () => {
      const address = probe.address();
      const bound = typeof address === 'object' && address ? address.port : port;
      probe.close(() => resolve(bound));
    });
  });
}

export async function pickPort(preferred = Number(process.env['RTF_PREFERRED_PORT'] ?? PREFERRED_PORT)): Promise<number> {
  try {
    return await bind(preferred);
  } catch {
    return bind(0);
  }
}
