import { useState } from 'react';
import Icon from './Icon';

/**
 * 可切换明文的密码框。
 *
 * 这类字段填错的后果与登录密码不同:云房间口令、外链网盘加密口令填错时
 * **不会有任何报错** —— 照样加密、照样上传成功,等换台设备拉取时才发现
 * 解不开,而且没有找回通道。恰恰是最需要核对的字段被圆点遮住了,
 * 所以一律给一个看一眼的机会。
 */
export default function SecretInput({
  value, placeholder, autoComplete, onChange,
}: {
  value: string;
  placeholder?: string;
  autoComplete?: string;
  onChange: (v: string) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="secret-input">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className="ghost icon-btn"
        title={show ? '隐藏' : '显示'}
        aria-label={show ? '隐藏' : '显示'}
        onClick={() => setShow((v) => !v)}
      ><Icon name="eye" size={14} style={show ? undefined : { opacity: 0.45 }} /></button>
    </div>
  );
}
