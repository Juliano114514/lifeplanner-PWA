import type { EggMedia } from '../../../shared/egg';

export async function readMedia(blob: Blob, name: string): Promise<EggMedia> {
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('无法读取文件，请重试'));
    reader.readAsDataURL(blob);
  });
  return { name, mime: blob.type, data };
}
export const mediaSource = (value: EggMedia) => `data:${value.mime};base64,${value.data}`;
