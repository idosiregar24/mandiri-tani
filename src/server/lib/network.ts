import { networkInterfaces } from 'node:os';

export function getLocalIps(): string[] {
  const nets = networkInterfaces();
  const results: string[] = [];
  for (const name of Object.keys(nets)) {
    const netList = nets[name];
    if (!netList) continue;
    for (const net of netList) {
      if (net.family === 'IPv4' && !net.internal) {
        results.push(net.address);
      }
    }
  }
  return results.length > 0 ? results : ['127.0.0.1'];
}

export function getPrimaryHubUrl(port = 3000): string {
  const ips = getLocalIps();
  return `http://${ips[0]}:${port}`;
}

