declare module 'gifenc' {
  export function quantize(bytes: Uint8Array, colors: number): number[][];
  export function applyPalette(bytes: Uint8Array, palette: number[][]): Uint8Array;
  export function GIFEncoder(): { writeFrame(bytes: Uint8Array, width: number, height: number, options: { palette: number[][]; delay: number; repeat: number }): void; finish(): void; bytes(): Uint8Array };
}
