import { _electron } from 'playwright';
import path from 'node:path';
import { withTestCacheCleanup } from './test-cache-cleanup.mjs';

export const electron = withTestCacheCleanup(_electron, path.resolve(import.meta.dirname, '..'));
