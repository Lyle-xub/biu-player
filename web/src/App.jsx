import React, { useEffect } from 'react';
import Shell from './shell.jsx';

export default function App() {
  useEffect(() => { if (!window.__biuControllerLoaded) { window.__biuControllerLoaded = true; import('./legacy/controller.js'); } }, []);
  return <Shell />;
}
