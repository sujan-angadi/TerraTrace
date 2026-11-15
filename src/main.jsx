import React, { StrictMode, useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import LandingPage from './LandingPage.jsx';

function normalizePath(pathname) {
  if (!pathname) return '/';
  const cleaned = pathname.replace(/\/+$/, '') || '/';
  return cleaned === '/dashboard' ? '/dashboard' : '/';
}

function TerraTraceRoot() {
  const [currentPath, setCurrentPath] = useState(() =>
    normalizePath(window.location.pathname)
  );

  useEffect(() => {
    const onPopState = () => {
      setCurrentPath(normalizePath(window.location.pathname));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (currentPath === '/dashboard') {
      const timer = setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [currentPath]);

  const navigate = useCallback((targetPath) => {
    const normalized = normalizePath(targetPath);
    if (normalizePath(window.location.pathname) !== normalized) {
      window.history.pushState({}, '', normalized);
    }
    setCurrentPath(normalized);
  }, []);

  if (currentPath === '/dashboard') {
    return <App onNavigateHome={() => navigate('/')} />;
  }

  return <LandingPage onLaunchDashboard={() => navigate('/dashboard')} />;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <TerraTraceRoot />
  </StrictMode>
);