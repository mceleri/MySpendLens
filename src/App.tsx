import React, { useState, useCallback, Suspense, lazy } from 'react';
import { Header } from './components/Header';
import { HomeHeroOverview } from './components/HomeHeroOverview';
import { ActionGrid } from './components/ActionGrid';
import { MySpendLensTier1Engine } from './engine/tier1_browser_engine';
import { DEFAULT_CATEGORY_DEFINITIONS } from './utils/categories';
import { saveCustomTier1ModelToDB } from './db/transactionDb';
import { useAppNavigation } from './hooks/useAppNavigation';
import { useClassificationEngines } from './hooks/useClassificationEngines';
import { useTransactionData } from './hooks/useTransactionData';
import { Loader2 } from 'lucide-react';

// Code-split heavy view components for instant initial page loads
const UploadView = lazy(() => import('./components/UploadView').then((m) => ({ default: m.UploadView })));
const ChartsView = lazy(() => import('./components/ChartsView').then((m) => ({ default: m.ChartsView })));
const ExpensesDistributionView = lazy(() => import('./components/ExpensesDistributionView').then((m) => ({ default: m.ExpensesDistributionView })));
const TransactionsTable = lazy(() => import('./components/TransactionsTable').then((m) => ({ default: m.TransactionsTable })));
const CategoriesView = lazy(() => import('./components/CategoriesView').then((m) => ({ default: m.CategoriesView })));
const ExportImportView = lazy(() => import('./components/ExportImportView').then((m) => ({ default: m.ExportImportView })));
const SettingsView = lazy(() => import('./components/SettingsView').then((m) => ({ default: m.SettingsView })));
const Tier1TrainingModal = lazy(() => import('./components/Tier1TrainingModal').then((m) => ({ default: m.Tier1TrainingModal })));

export const App: React.FC = () => {
  const [isTrainingModalOpen, setIsTrainingModalOpen] = useState<boolean>(false);

  // 1. Navigation & Routing
  const {
    activeView,
    categoryFilterForTransactions,
    navigateToView,
    handleNavigateBack,
    handleGoHome,
  } = useAppNavigation();

  // 2. Transaction & Category Persistence
  const {
    transactions,
    categories,
    loadedFileName,
    isProcessing,
    processingProgress,
    hasPendingTraining,
    existingFingerprints,
    financialOverview,
    updatePendingTraining,
    handleConfirmImport,
    handleReclassify,
    handleDeleteTransaction,
    handleUpdateTransactionCategory,
    handleSaveCategory,
    handleRenameCategory,
    handleDeleteCategory,
    handleReassignCategory,
    handleClearDatabase,
    handleFactoryReset,
    handleRestoreAll,
  } = useTransactionData({
    onSettingsLoaded: (settings) => {
      if (typeof settings.useTier1 === 'boolean') setUseTier1(settings.useTier1);
      if (typeof settings.tier1Threshold === 'number') setTier1Threshold(settings.tier1Threshold);
    },
  });

  // 3. AI Classification Engines (Tier 1 & Tier 2 Cascade)
  const {
    useTier1,
    setUseTier1,
    tier1Threshold,
    setTier1Threshold,
    isLoadingModel,
    modelStats,
    setModelStats,
    modelError,
    tier2LoadingState,
    engineTier1Ref,
    engineTier2Ref,
    ensureTier1Engine,
    ensureTier2Engine,
    classifyRows,
    handleToggleTier1,
    handleChangeThreshold,
  } = useClassificationEngines(categories, transactions);

  // Save trained Tier 1 model to IndexedDB and update status
  const handleTrainingComplete = useCallback(async () => {
    if (engineTier1Ref.current) {
      const artifact = engineTier1Ref.current.getArtifact();
      await saveCustomTier1ModelToDB(artifact);
      setModelStats({
        version: artifact.version,
        featuresCount: artifact.metrics.num_features,
        classesCount: artifact.metrics.num_classes,
        validationAccuracy: artifact.metrics.validation_accuracy,
        countries: artifact.config.countries,
      });
    }
    await updatePendingTraining(false);
  }, [engineTier1Ref, setModelStats, updatePendingTraining]);

  return (
    <div className="mobile-app-layout">
      {/* Responsive Header with Desktop Navbar */}
      <Header
        isLoadingModel={isLoadingModel}
        modelError={modelError}
        isProcessing={isProcessing}
        onGoHome={handleGoHome}
        hasPendingTraining={hasPendingTraining}
        onOpenTrainingModal={() => setIsTrainingModalOpen(true)}
        activeView={activeView}
        onNavigate={(view) => navigateToView(view)}
      />

      {/* Main Viewport */}
      <main className="mobile-main-viewport">
        <Suspense
          fallback={
            <div className="mobile-processing-overlay">
              <div className="mobile-processing-card">
                <Loader2 size={24} className="spinner text-primary" />
                <span>Caricamento vista...</span>
              </div>
            </div>
          }
        >
        {/* Dashboard / Home View */}
        {activeView === 'home' && (
          <div className="mobile-home-content">
            <HomeHeroOverview
              overview={financialOverview}
              onOpenDistribution={() => navigateToView('distribution')}
            />

            <ActionGrid
              onOpenUpload={() => navigateToView('upload')}
              onOpenCharts={() => navigateToView('charts')}
              onOpenDistribution={() => navigateToView('distribution')}
              onOpenTransactions={() => navigateToView('transactions')}
              onOpenCategories={() => navigateToView('categories')}
              onOpenSettings={() => navigateToView('settings')}
              onOpenExportImport={() => navigateToView('export_import')}
              totalTransactions={transactions.length}
              categoriesCount={categories.filter((c) => c.isActive).length}
            />
          </div>
        )}

        {/* Upload Statement View */}
        {activeView === 'upload' && (
          <UploadView
            onConfirmImport={(newRows, fileName, total, skipped) =>
              handleConfirmImport(
                newRows,
                fileName,
                total,
                skipped,
                (rows, onProg) => classifyRows(rows, useTier1, tier1Threshold, onProg),
                () => navigateToView('transactions')
              )
            }
            existingFingerprints={existingFingerprints}
            disabled={isProcessing}
            totalLoaded={transactions.length}
            onCancel={handleNavigateBack}
          />
        )}

        {/* Charts View */}
        {activeView === 'charts' && (
          <ChartsView
            transactions={transactions}
            onOpenUpload={() => navigateToView('upload')}
            onFilterByCategory={(cat) => navigateToView('transactions', cat)}
          />
        )}

        {/* Expense Distribution View */}
        {activeView === 'distribution' && (
          <ExpensesDistributionView
            overview={financialOverview}
            transactions={transactions}
            onFilterByCategory={(cat) => navigateToView('transactions', cat)}
          />
        )}

        {/* Transactions Table View */}
        {activeView === 'transactions' && (
          <TransactionsTable
            transactions={transactions}
            categories={categories}
            fileName={loadedFileName}
            initialCategory={categoryFilterForTransactions}
            onDeleteTransaction={handleDeleteTransaction}
            onUpdateTransactionCategory={handleUpdateTransactionCategory}
          />
        )}

        {/* Categories Customization View */}
        {activeView === 'categories' && (
          <CategoriesView
            categories={categories}
            transactions={transactions}
            onSaveCategory={(cat) =>
              handleSaveCategory(cat, (cats) =>
                engineTier2Ref.current?.syncDynamicCategories(cats) ?? Promise.resolve()
              )
            }
            onRenameCategory={(oldName, cat) =>
              handleRenameCategory(oldName, cat, (cats) =>
                engineTier2Ref.current?.syncDynamicCategories(cats) ?? Promise.resolve()
              )
            }
            onDeleteCategory={(id) =>
              handleDeleteCategory(id, (cats) =>
                engineTier2Ref.current?.syncDynamicCategories(cats) ?? Promise.resolve()
              )
            }
            onReassignCategory={(oldCat, newCat, id) =>
              handleReassignCategory(oldCat, newCat, id, (cats) =>
                engineTier2Ref.current?.syncDynamicCategories(cats) ?? Promise.resolve()
              )
            }
          />
        )}

        {/* Backup & Restore View */}
        {activeView === 'export_import' && (
          <ExportImportView
            transactions={transactions}
            categories={categories}
            useTier1={useTier1}
            tier1Threshold={tier1Threshold}
            tier1Artifact={engineTier1Ref.current ? engineTier1Ref.current.getArtifact() : null}
            onRestoreAll={(data) =>
              handleRestoreAll(data, (artifact) => {
                const newEngine = new MySpendLensTier1Engine(artifact);
                engineTier1Ref.current = newEngine;
                setModelStats({
                  version: artifact.version,
                  featuresCount: artifact.metrics.num_features,
                  classesCount: artifact.metrics.num_classes,
                  validationAccuracy: artifact.metrics.validation_accuracy,
                  countries: artifact.config.countries,
                });
              })
            }
          />
        )}

        {/* Settings View */}
        {activeView === 'settings' && (
          <SettingsView
            useTier1={useTier1}
            onToggleTier1={handleToggleTier1}
            tier1Threshold={tier1Threshold}
            onChangeThreshold={handleChangeThreshold}
            tier1Stats={modelStats}
            tier2State={
              engineTier2Ref.current?.isReady
                ? { status: 'ready', progress: 100, message: 'Model loaded in memory.' }
                : tier2LoadingState
            }
            isProcessing={isProcessing}
            onReclassify={() =>
              handleReclassify((rows, onProg) => classifyRows(rows, useTier1, tier1Threshold, onProg))
            }
            hasTransactions={transactions.length > 0}
            totalTransactions={transactions.length}
            onClearDatabase={handleClearDatabase}
            onPreloadTier2={async () => {
              try {
                await ensureTier2Engine();
              } catch (e) {
                console.warn('Preload Tier 2 failed:', e);
              }
            }}
            onFactoryReset={() =>
              handleFactoryReset(async () => {
                setUseTier1(true);
                setTier1Threshold(0.85);
                try {
                  const res = await fetch(`${import.meta.env.BASE_URL}myspendlens_tier1_base_model.json`);
                  if (res.ok) {
                    const artifact = await res.json();
                    engineTier1Ref.current = new MySpendLensTier1Engine(artifact);
                    setModelStats({
                      version: artifact.version,
                      featuresCount: artifact.metrics.num_features,
                      classesCount: artifact.metrics.num_classes,
                      validationAccuracy: artifact.metrics.validation_accuracy,
                      countries: artifact.config.countries,
                    });
                  }
                } catch (e) {
                  console.warn('Could not reload base tier 1 model JSON:', e);
                }

                if (engineTier2Ref.current?.isReady) {
                  await engineTier2Ref.current.syncDynamicCategories(DEFAULT_CATEGORY_DEFINITIONS);
                }
              })
            }
          />
        )}
        </Suspense>

        {/* Processing Indicator Overlay */}
        {isProcessing && (
          <div className="mobile-processing-overlay">
            <div className="mobile-processing-card">
              <Loader2 size={24} className="spinner text-primary" />
              <span>{processingProgress || 'Classifying transactions...'}</span>
            </div>
          </div>
        )}
      </main>

      {/* Tier 1 Personal Training Modal */}
      {isTrainingModalOpen && (
        <Suspense fallback={null}>
          <Tier1TrainingModal
            isOpen={isTrainingModalOpen}
            onClose={() => setIsTrainingModalOpen(false)}
            transactions={transactions}
            categories={categories}
            tier1Engine={engineTier1Ref.current}
            tier2Engine={engineTier2Ref.current}
            ensureTier1Engine={ensureTier1Engine}
            ensureTier2Engine={ensureTier2Engine}
            onTrainingComplete={handleTrainingComplete}
          />
        </Suspense>
      )}
    </div>
  );
};
