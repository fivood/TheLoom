import { useEffect, useRef, useState } from 'react';
import { useLoom } from '../../store';
import { useEscape } from '../../hooks/useEscape';
import { blocksToText, textToBlocks } from '../../immersive';
import type { Document } from '../../types';

/**
 * 沉浸写作:一整块纯文本,没有逐块控件。
 *
 * 文本不从 blocks 反推(那样每次提交都会重算 value,光标会跳)——只在换场景时播种,
 * 之后以本地 state 为准,每次输入回写成块。`textToBlocks` 拿上一版 blocks 按次序
 * 保住 id / unitId / 说话人,所以批注与流程联动不会因为在这里写字而断掉。
 */
export default function ImmersiveEditor({ doc, onExit }: { doc: Document; onExit?: () => void }) {
  const entities = useLoom((s) => s.project.entities);
  const updateDocument = useLoom((s) => s.updateDocument);
  const [text, setText] = useState(() => blocksToText(doc.blocks, entities));
  const ref = useRef<HTMLTextAreaElement>(null);
  useEscape(!!onExit, () => onExit?.());

  // 换场景才重新播种;同一场景内不受回写影响
  useEffect(() => {
    setText(blocksToText(useLoom.getState().project.documents.find((d) => d.id === doc.id)?.blocks ?? [], entities));
    ref.current?.focus();
  }, [doc.id]);

  const onChange = (value: string) => {
    setText(value);
    updateDocument(doc.id, (d) => { d.blocks = textToBlocks(value, d.blocks, entities); });
  };

  return (
    <textarea
      ref={ref}
      className="immersive-text"
      value={text}
      spellCheck={false}
      placeholder={'就在这里写。\n\n空行分段;# 标题、> 引用、- 列表、**粗** *斜* 都按 Markdown 生效。'}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
