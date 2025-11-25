import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);

try {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} catch (e: any) {
  console.error("Mount Error:", e);
  root.render(
    <div style={{ color: 'red', padding: '20px', fontFamily: 'monospace' }}>
      <h1>Application Crashed</h1>
      <pre>{e.toString()}</pre>
      <p>Please check the console for more details.</p>
    </div>
  );
}