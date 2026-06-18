import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { theme } from './theme';
import App from './App';

// Self-hosted fonts — bundled into the build so the GUI works fully offline,
// cross-platform, and without the (often blocked/slow in China) Google Fonts CDN.
// CJK is left to system fonts (PingFang SC / 微软雅黑 / Noto). Latin display + mono
// are bundled for the distinctive look.
import '@fontsource-variable/fraunces/index.css';
import '@fontsource-variable/hanken-grotesk/index.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';

import './styles/global.css';
import './styles/components.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider theme={theme} locale={zhCN}>
      <AntApp>
        <App />
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
);
