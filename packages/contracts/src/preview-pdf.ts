import type { PathRequest } from './index';

export interface PreviewPdfRequest extends PathRequest { html: string }
export const maxPreviewPdfLength = 32 * 1024 * 1024;
