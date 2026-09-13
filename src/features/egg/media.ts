import type { EggMedia } from '../../../shared/egg';

export async function readMedia(blob: Blob, name: string): Promise<EggMedia> {
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { const result = String(reader.result); resolve(result.slice(result.lastIndexOf(',') + 1)); };
    reader.onerror = () => reject(new Error('无法读取文件，请重试'));
    reader.readAsDataURL(blob);
  });
  return { name, mime: blob.type, data };
}
export const mediaSource = (value: EggMedia) => `data:${value.mime};base64,${value.data}`;

// File providers may omit MIME metadata; inspect the bytes without changing GIF content.
export async function imageMime(file: Blob): Promise<string | null> {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  const header = String.fromCharCode(...bytes);
  if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) return 'image/gif';
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') return 'image/webp';
  return null;
}
