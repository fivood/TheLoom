import { alertDialog, confirmDialog } from './dialog';
import { useLoom } from './store';

export async function offerClearCurrentBrowserCache(folder: string): Promise<boolean> {
  const confirmed = await confirmDialog({
    title: '释放应用内空间',
    message: `项目已完整保存到本地文件夹:\n${folder}\n\n是否清除这个项目的浏览器镜像，以及已落盘且未被其他项目引用的资源缓存?\n\n清除后以该文件夹为唯一内容来源；版本历史仍会保留。`,
    confirmText: '清除浏览器缓存',
    cancelText: '保留双份',
  });
  if (!confirmed) return false;
  const result = await useLoom.getState().clearCurrentBrowserCache();
  if (!result.cleared) {
    await alertDialog(result.error || '浏览器空间清理失败，项目文件夹不受影响。');
    return false;
  }
  await alertDialog(result.error
    ? result.error
    : `浏览器镜像已清理${result.removedAssets > 0 ? `，同时释放 ${result.removedAssets} 个资源缓存` : ''}。`);
  return true;
}
