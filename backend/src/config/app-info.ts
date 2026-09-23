import packageJson from '../../package.json' with { type: 'json' };
import type { Env } from './env';

export interface AppInfo {
  version: string;
  commit: string | null;
}

export function getAppInfo(env: Pick<Env, 'RENDER_GIT_COMMIT'>): AppInfo {
  return {
    version: packageJson.version,
    commit: env.RENDER_GIT_COMMIT?.slice(0, 7) ?? null,
  };
}
