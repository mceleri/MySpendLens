import { useState, useEffect, useCallback } from 'react';

export type ActiveView =
  | 'home'
  | 'charts'
  | 'distribution'
  | 'transactions'
  | 'settings'
  | 'upload'
  | 'categories'
  | 'export_import';

export function useAppNavigation() {
  const [activeView, setActiveView] = useState<ActiveView>('home');
  const [categoryFilterForTransactions, setCategoryFilterForTransactions] = useState<string | undefined>(undefined);

  // Android Hardware Back Button & Browser History Interception
  useEffect(() => {
    if (!window.history.state || !window.history.state.myspendlens) {
      window.history.replaceState({ myspendlens: true, view: 'home' }, '');
    }

    const handlePopState = (event: PopStateEvent) => {
      const state = event.state;
      if (state && state.myspendlens) {
        setActiveView(state.view || 'home');
        if (state.categoryFilter !== undefined) {
          setCategoryFilterForTransactions(state.categoryFilter);
        }
      } else {
        setActiveView('home');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  // Safe navigation handlers that push history
  const navigateToView = useCallback((targetView: ActiveView, categoryFilter?: string) => {
    setActiveView(targetView);
    setCategoryFilterForTransactions(categoryFilter);
    window.history.pushState(
      { myspendlens: true, view: targetView, categoryFilter },
      ''
    );
  }, []);

  const handleNavigateBack = useCallback(() => {
    if (window.history.state && window.history.state.myspendlens && window.history.state.view !== 'home') {
      window.history.back();
    } else {
      setActiveView('home');
    }
  }, []);

  const handleGoHome = useCallback(() => {
    setActiveView('home');
    setCategoryFilterForTransactions(undefined);
    window.history.pushState(
      { myspendlens: true, view: 'home' },
      ''
    );
  }, []);

  return {
    activeView,
    categoryFilterForTransactions,
    setCategoryFilterForTransactions,
    navigateToView,
    handleNavigateBack,
    handleGoHome,
  };
}
