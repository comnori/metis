import path from 'node:path';

/** Separate Electron runtime switches from Metis's strict document CLI. */
export function launchArguments(argv: string[], defaultApp: boolean, appPath: string) {
  const appArgument = defaultApp ? argv.findIndex((value, index) => index > 0 && !value.startsWith('-') && path.resolve(value) === path.resolve(appPath)) : 0;
  const args = argv.slice(appArgument > 0 ? appArgument + 1 : 1);
  // These switches are already consumed by Electron. This does not enable them.
  while (args[0]?.match(/^(?:--(?:inspect(?:-brk)?|remote-debugging-port)=|--no-sandbox$)/)) args.shift();
  return args;
}
