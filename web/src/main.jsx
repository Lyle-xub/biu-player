import React from 'react';
import { createRoot } from 'react-dom/client';
// 视觉层单一来源：直接复用桌面样式与移动端断点层，保证重构前后像素级一致
import '../../renderer/styles.css';
import '../../mobile/mobile.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(<App />);
