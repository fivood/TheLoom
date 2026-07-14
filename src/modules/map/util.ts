/** 读取图片文件为 dataURL,并返回自然宽高 */
export function fileToDataUrl(file: File): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const img = new Image();
      img.onload = () => resolve({ dataUrl, width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error('图片解码失败'));
      img.src = dataUrl;
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
