import { useState, useEffect, useMemo, useRef, lazy, Suspense } from 'react';
import { Transaction, BudgetConfig, RecurringTransaction, Debt, Goal, SpreadsheetRecord } from './types';
import ErrorBoundary from './components/ErrorBoundary';
import HomeScreen from './components/HomeScreen';
import MoreScreen, { type MoreDestination } from './components/MoreScreen';
import TransactionList from './components/TransactionList';
import QuickTransactionForm from './components/QuickTransactionForm';
import { LayoutDashboard, ReceiptText, Calculator, Target, Plus, X, MoreHorizontal, ChevronLeft } from 'lucide-react';
import { cn } from './lib/utils';
import { useIsMobile } from './lib/useIsMobile';
import { loadPetSettings, savePetSettings, bubbleShowsAmounts, PetSettings as PetSettingsType } from './lib/petSettings';
import { FinancePet, isNativePetAvailable } from './lib/petBridge';
import { drainOutbox } from './lib/outboxSync';
import { computePetFinanceState, toPetDisplayState } from './lib/petFinanceState';
import { financeRepository } from './lib/financeRepository';
import { cloudSyncConfigured } from './lib/cloud/enabled';
import { getLocalDateKey } from './lib/datetime';
import { dueOccurrences } from './lib/recurrence';
import { getQuickCategories } from './lib/quickCategories';
import PetSprite from './components/pet/PetSprite';

/*
 * 低頻功能一律 lazy。
 *
 * 每天真的會用到的只有首頁、明細、快速記帳，那三個要立刻能用；試算表、負債攤還、
 * AI、圖表（recharts 本身就不小）沒有理由在開 App 的第一秒就下載並解析。
 */
const Dashboard = lazy(() => import('./components/Dashboard'));
const BudgetSettings = lazy(() => import('./components/BudgetSettings'));
const RecurringSettings = lazy(() => import('./components/RecurringSettings'));
const DebtManager = lazy(() => import('./components/DebtManager'));
const GoalPlanner = lazy(() => import('./components/GoalPlanner'));
const GoalSandbox = lazy(() => import('./components/GoalSandbox'));
const DebtAdvice = lazy(() => import('./components/DebtAdvice'));
const Spreadsheet = lazy(() => import('./components/Spreadsheet'));
const CashflowInference = lazy(() => import('./components/CashflowInference'));
const PetSettings = lazy(() => import('./components/PetSettings'));
const TransactionForm = lazy(() => import('./components/TransactionForm'));
const AndroidDownloadCard = lazy(() => import('./components/AndroidDownloadCard'));

/**
 * 手機主導覽只有前四個；其餘是「更多」底下的子頁面。
 * 桌機維持完整分頁列（這個 PR 不動桌機版）。
 */
type FinanceTabType =
  | 'home'
  | 'transactions'
  | 'pet'
  | 'more'
  | 'planning'
  | 'liabilities'
  | 'advisor'
  | 'spreadsheet'
  | 'download';

/** 從「更多」進去的子頁面：手機版標題列要顯示返回鍵。 */
const MORE_SUBPAGES: FinanceTabType[] = ['planning', 'liabilities', 'advisor', 'spreadsheet', 'download'];

const TAB_TITLES: Record<FinanceTabType, string> = {
  home: '小財記帳',
  transactions: '收支明細',
  pet: '小財',
  more: '更多',
  planning: '預算與循環記帳',
  liabilities: '負債與目標',
  advisor: 'AI 財務顧問',
  spreadsheet: '長期試算表',
  download: '下載 Android App',
};

/** lazy 分頁載入中的佔位：高度固定，避免載入完成時整頁跳動。 */
function PanelFallback() {
  return (
    <div className="glass rounded-[24px] p-6 min-h-[160px] flex items-center justify-center">
      <p className="text-sm font-bold text-[#A79C90]">載入中…</p>
    </div>
  );
}

export default function App() {
  const [financeTab, setFinanceTab] = useState<FinanceTabType>('home');
  const isMobile = useIsMobile();
  const [isGlobalAddOpen, setIsGlobalAddOpen] = useState(false);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [petSettings, setPetSettings] = useState<PetSettingsType>(() => loadPetSettings());
  // 快速記帳誤按保險：短暫顯示可復原的提示
  const [undoInfo, setUndoInfo] = useState<{ id: string; label: string } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // App Lock：進完整財務資料前的裝置驗證（快速記帳不受影響）
  const [locked, setLocked] = useState<boolean>(() => isNativePetAvailable() && loadPetSettings().appLock);
  
  const [monthlyIncome, setMonthlyIncome] = useState<number>(() => {
    const saved = localStorage.getItem('finance_monthly_income');
    return saved ? Number(saved) : 0;
  });

  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    const saved = localStorage.getItem('finance_transactions');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse transactions');
      }
    }
    return [];
  });

  const [budgets, setBudgets] = useState<Record<string, BudgetConfig>>(() => {
    const saved = localStorage.getItem('finance_budgets');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse budgets');
      }
    }
    return {};
  });

  const [recurring, setRecurring] = useState<RecurringTransaction[]>(() => {
    const saved = localStorage.getItem('finance_recurring');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse recurring');
      }
    }
    return [];
  });

  const [debts, setDebts] = useState<Debt[]>(() => {
    const saved = localStorage.getItem('finance_debts');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse debts');
      }
    }
    return [];
  });

  const [goals, setGoals] = useState<Goal[]>(() => {
    const saved = localStorage.getItem('finance_goals');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse goals');
      }
    }
    return [];
  });

  const [spreadsheetRecords, setSpreadsheetRecords] = useState<SpreadsheetRecord[]>(() => {
    const saved = localStorage.getItem('finance_spreadsheet_records');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse spreadsheet records');
      }
    }
    return [];
  });

  // Save to local storage
  useEffect(() => {
    localStorage.setItem('finance_monthly_income', monthlyIncome.toString());
  }, [monthlyIncome]);

  useEffect(() => {
    localStorage.setItem('finance_transactions', JSON.stringify(transactions));
  }, [transactions]);

  useEffect(() => {
    localStorage.setItem('finance_budgets', JSON.stringify(budgets));
  }, [budgets]);

  useEffect(() => {
    localStorage.setItem('finance_recurring', JSON.stringify(recurring));
  }, [recurring]);

  useEffect(() => {
    localStorage.setItem('finance_debts', JSON.stringify(debts));
  }, [debts]);

  useEffect(() => {
    localStorage.setItem('finance_goals', JSON.stringify(goals));
  }, [goals]);

  useEffect(() => {
    localStorage.setItem('finance_spreadsheet_records', JSON.stringify(spreadsheetRecords));
  }, [spreadsheetRecords]);

  useEffect(() => {
    savePetSettings(petSettings);
  }, [petSettings]);

  /**
   * Re-reads the ledger from storage into React state.
   *
   * The repository is authoritative for transactions/debts/goals: every
   * mutation writes storage first and then mirrors it here, so the UI can
   * never hold a version that storage does not have (and a crash can never
   * land between the two).
   */
  const syncFromRepository = () => {
    setTransactions(financeRepository.getTransactions());
    setDebts(financeRepository.getDebts());
    setGoals(financeRepository.getGoals());
  };

  /**
   * Materialises due recurring transactions.
   *
   * Ids are DETERMINISTIC (`recurring:<ruleId>:<dateKey>`) and writes go
   * through the repository, which is idempotent on id — so a re-run (React
   * StrictMode double-invoke, a remount, or a migration replay) can never
   * generate the same instalment twice. Dates are local calendar dates.
   */
  useEffect(() => {
    const todayStr = getLocalDateKey();
    let hasUpdates = false;

    const nextRecurring = recurring.map(rt => {
      // Date arithmetic lives in lib/recurrence.ts, where it is tested. Doing
      // it inline here is how a rule set for the 31st ended up posting on the
      // 3rd forever, with February skipped.
      const { dates, nextDate } = dueOccurrences(rt, todayStr);
      for (const dateKey of dates) {
        financeRepository.addTransaction({
          id: `recurring:${rt.id}:${dateKey}`,
          type: rt.type,
          amount: rt.amount,
          category: rt.category,
          date: dateKey,
          note: `${rt.note}${rt.note ? ' ' : ''}(自動記帳)`,
          source: 'recurring',
        });
        hasUpdates = true;
      }
      return nextDate === rt.nextDate ? rt : { ...rt, nextDate };
    });

    if (hasUpdates) {
      syncFromRepository();
      setRecurring(nextRecurring);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recurring]);

  const addTransaction = (newTx: Omit<Transaction, 'id'>): Transaction => {
    const transaction = financeRepository.addTransaction({
      ...newTx,
      source: newTx.source ?? 'web',
      createdAt: newTx.createdAt ?? new Date().toISOString(),
    });
    syncFromRepository();
    return transaction;
  };

  /** Quick-add entry point: same addTransaction plus a short undo window. */
  const addQuickTransaction = (newTx: Omit<Transaction, 'id'>) => {
    const tx = addTransaction(newTx);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoInfo({ id: tx.id, label: `NT$${tx.amount.toLocaleString()} ${tx.category}` });
    undoTimerRef.current = setTimeout(() => setUndoInfo(null), 5000);
  };

  const undoQuickTransaction = () => {
    if (!undoInfo) return;
    deleteTransaction(undoInfo.id);
    setUndoInfo(null);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
  };

  /**
   * Drains the native outbox into the ledger.
   *
   * Ordering is the whole point: each entry is written to persistent storage
   * FIRST (idempotently, keyed by the id the native side generated), the UI
   * is refreshed from storage, and only then is the entry acked away from the
   * outbox. A crash at any point can therefore only cause a replay — which
   * the id-keyed insert absorbs — never a lost entry.
   */
  const drainNativeOutbox = async () => {
    const result = await drainOutbox(FinancePet, financeRepository);
    if (result.importedIds.length > 0 || result.failedIds.length > 0) {
      syncFromRepository();
    }
    if (result.failedIds.length > 0) {
      console.error('[FinancePet.Sync] entries kept in the outbox for retry', result.failedIds.length);
    }
  };

  /*
   * Cloud sync lives here, not in the account panel.
   *
   * Two defects in one: the engine was constructed inside AccountPanel, so
   * syncing only ran while that settings screen was mounted; and nothing ever
   * told React that a pull had happened, so rows arriving from another device
   * stayed invisible until the user reloaded the page.
   *
   * Triggers are sign-in, returning to the foreground, and the network coming
   * back — no polling, which would cost battery to discover nothing changed.
   */
  useEffect(() => {
    // Nothing cloud-related is even loaded without a key — see lib/cloud/enabled.ts.
    if (!cloudSyncConfigured) return;

    let dispose: (() => void) | null = null;
    let cancelled = false;

    void Promise.all([import('./lib/cloud/financeSync'), import('./lib/cloud/auth')]).then(
      ([{ financeSync }, { authController }]) => {
        if (cancelled) return;

        const runIfSignedIn = () => {
          const { mode, user } = authController.getState();
          if (mode === 'signed-in' && user) void financeSync.sync(user.id);
        };

        const unsubscribeAuth = authController.subscribe(runIfSignedIn);
        const unsubscribeSync = financeSync.subscribe(status => {
          // Only on a completed cycle that actually changed the ledger; a
          // status tick for "syncing" would re-render the whole app for
          // nothing.
          if (status.phase === 'idle' && status.lastPulled > 0) syncFromRepository();
        });

        const onVisible = () => {
          if (document.visibilityState === 'visible') runIfSignedIn();
        };
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('online', runIfSignedIn);

        dispose = () => {
          unsubscribeAuth();
          unsubscribeSync();
          document.removeEventListener('visibilitychange', onVisible);
          window.removeEventListener('online', runIfSignedIn);
        };
      },
    );

    return () => {
      cancelled = true;
      dispose?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pull transactions queued by the native pet whenever the app becomes visible
  // or the pet notifies us that a new one was saved.
  useEffect(() => {
    if (!isNativePetAvailable()) return;

    let cancelled = false;
    const drainPending = async () => {
      if (cancelled) return;
      try {
        await drainNativeOutbox();
      } catch (e) {
        console.error('[FinancePet.Sync] drain failed', e);
      }
    };

    drainPending();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') drainPending();
    };
    document.addEventListener('visibilitychange', onVisibility);

    let listenerHandle: { remove: () => Promise<void> } | undefined;
    FinancePet.addListener('petEvent', event => {
      // petTapped / quickExpense / quickIncome are handled natively by
      // QuickAddActivity (it works even when the WebView is dead), so the
      // web layer only reacts to sync + navigation events.
      if (event.kind === 'transactionQueued') drainPending();
      else if (event.kind === 'transactionUndone' && event.id) {
        // The user undid a native quick add within its undo window; if we had
        // already drained it, roll it back here too (debt/goal linkage included).
        financeRepository.deleteTransaction(event.id);
        syncFromRepository();
      } else if (event.kind === 'openDashboardRequested') {
        setFinanceTab('home');
      } else if (event.kind === 'openPetSettingsRequested') {
        setFinanceTab('pet');
      } else if (event.kind === 'petStopped') {
        setPetSettings(prev => ({ ...prev, enabled: false }));
      }
    }).then(h => {
      listenerHandle = h;
    });

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      listenerHandle?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push the computed pet display state to the native overlay (debounced).
  // Native never recomputes finance logic and never receives raw finance
  // data — only the trimmed, non-sensitive PetDisplayState plus the
  // usage-ranked quick chips for its Quick Add sheet.
  useEffect(() => {
    if (!isNativePetAvailable()) return;
    const timer = setTimeout(() => {
      const state = computePetFinanceState({
        transactions,
        budgets,
        goals,
        monthlyIncome,
        showAmounts: bubbleShowsAmounts(petSettings),
      });
      FinancePet.updatePetState({
        state: toPetDisplayState(state, {
          showAmounts: bubbleShowsAmounts(petSettings),
          petName: petSettings.petName,
        }),
      }).catch(() => {});
      FinancePet.syncQuickCategories({
        chips: {
          expense: getQuickCategories(transactions, 'expense'),
          income: getQuickCategories(transactions, 'income'),
        },
      }).catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [transactions, budgets, goals, monthlyIncome, petSettings.bubbleDisplay, petSettings.petName]);

  // App Lock：驗證通過才顯示完整財務資料（快速記帳流程不受影響）
  useEffect(() => {
    if (!locked) return;
    let cancelled = false;
    FinancePet.authenticate()
      .then(r => {
        if (!cancelled && r.success) setLocked(false);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Deletes through the repository so the debt/goal reversal uses the exact
   * applied deltas recorded at write time (a balance that clamped at zero is
   * restored to what it was, not over-credited).
   */
  const deleteTransaction = (id: string) => {
    financeRepository.deleteTransaction(id);
    syncFromRepository();
  };

  const updateBudget = (category: string, config: BudgetConfig) => {
    setBudgets(prev => ({
      ...prev,
      [category]: config
    }));
  };

  const deleteBudget = (category: string) => {
    setBudgets(prev => {
      const newBudgets = { ...prev };
      delete newBudgets[category];
      return newBudgets;
    });
  };

  const addRecurring = (rt: Omit<RecurringTransaction, 'id' | 'nextDate'>) => {
    const newRt: RecurringTransaction = {
      ...rt,
      id: crypto.randomUUID(),
      nextDate: rt.startDate,
    };
    setRecurring(prev => [...prev, newRt]);
  };

  const deleteRecurring = (id: string) => {
    setRecurring(prev => prev.filter(r => r.id !== id));
  };

  // Debts and goals also go through the repository (storage first, then
  // mirror into state) so a background outbox drain can never read a stale
  // snapshot and write it back over a fresh edit.
  const addDebt = (debt: Omit<Debt, 'id'>) => {
    financeRepository.saveDebts([{ ...debt, id: crypto.randomUUID() }, ...financeRepository.getDebts()]);
    syncFromRepository();
  };

  const deleteDebt = (id: string) => {
    financeRepository.saveDebts(financeRepository.getDebts().filter(d => d.id !== id));
    syncFromRepository();
  };

  const updateDebt = (id: string, updates: Partial<Debt>) => {
    financeRepository.saveDebts(
      financeRepository.getDebts().map(d => (d.id === id ? { ...d, ...updates } : d)),
    );
    syncFromRepository();
  };

  const addGoal = (goal: Omit<Goal, 'id'>) => {
    financeRepository.saveGoals([{ ...goal, id: crypto.randomUUID() }, ...financeRepository.getGoals()]);
    syncFromRepository();
  };

  const deleteGoal = (id: string) => {
    financeRepository.saveGoals(financeRepository.getGoals().filter(g => g.id !== id));
    syncFromRepository();
  };

  const updateGoal = (id: string, updates: Partial<Goal>) => {
    financeRepository.saveGoals(
      financeRepository.getGoals().map(g => (g.id === id ? { ...g, ...updates } : g)),
    );
    syncFromRepository();
  };

  const addSpreadsheetRecord = (record: Omit<SpreadsheetRecord, 'id'>) => {
    setSpreadsheetRecords(prev => [...prev, { ...record, id: crypto.randomUUID() }]);
  };

  const updateSpreadsheetRecord = (id: string, updates: Partial<SpreadsheetRecord>) => {
    setSpreadsheetRecords(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
  };

  const deleteSpreadsheetRecord = (id: string) => {
    setSpreadsheetRecords(prev => prev.filter(r => r.id !== id));
  };

  const timeGreeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 5) return '夜深了，早點休息哦 🌙';
    if (hour < 11) return '早安，今天也要好好照顧自己哦 ☀️';
    if (hour < 14) return '午安，記得吃頓好吃的 ☕️';
    if (hour < 18) return '午後好，喝杯水伸個懶腰吧 🌿';
    if (hour < 22) return '晚安，今天辛苦了，好好放鬆 🍷';
    return '夜深了，早點休息哦 🌙';
  }, []);

  const isSubPage = MORE_SUBPAGES.includes(financeTab);

  const desktopTabs: Array<{ tab: FinanceTabType; icon: React.ReactNode; label: string; accent?: boolean }> = [
    { tab: 'home', icon: <LayoutDashboard size={18} />, label: '財務總覽' },
    { tab: 'transactions', icon: <ReceiptText size={18} />, label: '收支明細' },
    { tab: 'planning', icon: <Calculator size={18} />, label: '預算規劃' },
    { tab: 'liabilities', icon: <Target size={18} />, label: '負債與目標' },
    { tab: 'advisor', icon: <span className="text-xl">✨</span>, label: 'AI 財務顧問', accent: true },
    { tab: 'spreadsheet', icon: <span className="text-xl">📝</span>, label: '長期試算表' },
    { tab: 'pet', icon: <PetSprite size={22} animated={false} />, label: '桌寵' },
  ];

  /* 手機主導覽：四個。中央 ＋ 拿掉了 —— 記一筆在首頁與小財頁都是整頁最大的按鈕。 */
  const mobileTabs: Array<{ tab: FinanceTabType; icon: React.ReactNode; label: string; match: FinanceTabType[] }> = [
    { tab: 'home', icon: <span className="text-xl">🏠</span>, label: '首頁', match: ['home'] },
    { tab: 'transactions', icon: <span className="text-xl">🧾</span>, label: '明細', match: ['transactions'] },
    { tab: 'pet', icon: <PetSprite size={24} animated={false} />, label: '小財', match: ['pet'] },
    { tab: 'more', icon: <MoreHorizontal size={20} />, label: '更多', match: ['more', ...MORE_SUBPAGES] },
  ];

  const goFromMore = (destination: MoreDestination) => setFinanceTab(destination);

  const renderPage = () => {
    switch (financeTab) {
      case 'home':
        // 手機首頁刻意不是 Dashboard：三秒看完今天，然後記一筆。
        return isMobile ? (
          <HomeScreen
            transactions={transactions}
            budgets={budgets}
            petName={petSettings.petName || '小財'}
            greeting={timeGreeting}
            onQuickAdd={() => setIsQuickAddOpen(true)}
            onOpenTransactions={() => setFinanceTab('transactions')}
            onOpenPet={() => setFinanceTab('pet')}
          />
        ) : (
          <div className="space-y-8">
            <Dashboard transactions={transactions} budgets={budgets} debts={debts} recurring={recurring} />
            <CashflowInference transactions={transactions} debts={debts} goals={goals} />
          </div>
        );

      case 'transactions':
        return (
          <TransactionList
            transactions={transactions}
            onDelete={deleteTransaction}
            debts={debts}
            goals={goals}
            onOpenAdd={() => setIsGlobalAddOpen(true)}
          />
        );

      case 'pet':
        return (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => setIsQuickAddOpen(true)}
              className="w-full min-h-[64px] rounded-[24px] bg-[#87A2B4] text-white font-extrabold text-lg shadow-[0_8px_24px_rgba(135,162,180,0.4)] active:scale-[0.98] transition-transform"
            >
              ＋ 記一筆
            </button>
            <PetSettings settings={petSettings} onChange={setPetSettings} />
          </div>
        );

      case 'more':
        return <MoreScreen onNavigate={goFromMore} build={__BUILD_STAMP__} />;

      case 'planning':
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <BudgetSettings
              budgets={budgets}
              onUpdateBudget={updateBudget}
              onDeleteBudget={deleteBudget}
              monthlyIncome={monthlyIncome}
              onUpdateMonthlyIncome={setMonthlyIncome}
            />
            <RecurringSettings recurring={recurring} onAdd={addRecurring} onDelete={deleteRecurring} />
          </div>
        );

      case 'liabilities':
        return (
          <div className="space-y-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <DebtManager debts={debts} onAdd={addDebt} onDelete={deleteDebt} onUpdate={updateDebt} onAddTransaction={addTransaction} />
              <GoalPlanner goals={goals} debts={debts} transactions={transactions} monthlyIncome={monthlyIncome} budgets={budgets} onAdd={addGoal} onDelete={deleteGoal} onUpdate={updateGoal} onAddTransaction={addTransaction} />
            </div>
            {/* 目標沙盒是桌機上的長期規劃工具，手機上不顯示（資料完全沒有變動） */}
            {!isMobile && (
              <GoalSandbox goals={goals} debts={debts} transactions={transactions} monthlyIncome={monthlyIncome} />
            )}
          </div>
        );

      case 'advisor':
        return (
          <DebtAdvice
            debts={debts}
            monthlyIncome={monthlyIncome}
            transactions={transactions}
            budgets={budgets}
            recurring={recurring}
            goals={goals}
          />
        );

      case 'spreadsheet':
        return (
          <Spreadsheet
            records={spreadsheetRecords}
            onAdd={addSpreadsheetRecord}
            onUpdate={updateSpreadsheetRecord}
            onDelete={deleteSpreadsheetRecord}
          />
        );

      case 'download':
        return <AndroidDownloadCard variant="page" />;

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen font-sans pb-24 sm:pb-0">
      <nav className="glass border-none rounded-none sticky top-0 z-10 p-0 shadow-[0_2px_20px_rgba(180,170,160,0.1)] border-b border-t-0 border-x-0 border-black/5" style={{ borderRadius: 0 }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* 手機標題列：一行，只說現在在哪一頁 */}
          <div className="sm:hidden flex items-center gap-1 h-14">
            {isSubPage && (
              <button
                type="button"
                onClick={() => setFinanceTab('more')}
                aria-label="返回更多"
                className="-ml-2 w-10 h-10 flex items-center justify-center rounded-full text-[#5C5248] active:bg-black/5"
              >
                <ChevronLeft size={22} />
              </button>
            )}
            <span className="font-extrabold text-[#5C5248] text-lg truncate">
              {TAB_TITLES[financeTab]}
            </span>
          </div>

          {/* 桌機：完整分頁列（這個 PR 不改桌機版） */}
          <div className="hidden sm:flex sm:items-center justify-between h-20 gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-[#FFE9A8] to-[#F7C873] rounded-xl flex items-center justify-center shadow-sm border border-white/50 overflow-hidden">
                <PetSprite size={34} animated={false} />
              </div>
              <div className="flex flex-col">
                <span className="font-extrabold text-[#5C5248] tracking-wide text-lg leading-tight">小財記帳</span>
                <span className="text-[10px] text-[#82786D] hidden md:block font-bold mt-0.5">{timeGreeting}</span>
              </div>
            </div>

            <div className="flex items-center bg-[#F5EFEB]/50 p-1.5 rounded-2xl border border-black/5 shadow-inner overflow-x-auto scrollbar-hide">
              {desktopTabs.map(item => (
                <button
                  key={item.tab}
                  onClick={() => setFinanceTab(item.tab)}
                  className={cn(
                    'whitespace-nowrap px-4 sm:px-5 py-2.5 text-sm font-bold rounded-xl flex items-center gap-2 transition-all',
                    financeTab === item.tab
                      ? 'bg-white text-[#5C5248] shadow-sm border border-black/5'
                      : cn(item.accent ? 'text-[#D1A066]' : 'text-[#82786D]', 'hover:text-[#5C5248] hover:bg-white/60'),
                  )}
                >
                  {item.icon} <span className="hidden sm:inline">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-8">
        {/*
          每一頁自己一個 ErrorBoundary，key 綁在分頁上。
          邊界放在 main 裡面而不是包住整個 App，所以就算某一頁炸了，底部導覽還在，
          使用者可以直接切到別頁 —— 而不是整個畫面變成一張錯誤卡片。
          換分頁時 key 改變，上一頁的錯誤狀態不會跟著留下來。
        */}
        <ErrorBoundary key={financeTab} fallbackTitle={`${TAB_TITLES[financeTab]}出了點狀況`}>
          <Suspense fallback={<PanelFallback />}>{renderPage()}</Suspense>
        </ErrorBoundary>
      </main>

      {/* 桌機浮動按鈕 */}
      <button
        onClick={() => setIsQuickAddOpen(true)}
        aria-label="快速記帳"
        className="hidden sm:flex fixed bottom-[5.5rem] right-6 w-12 h-12 bg-[#E2D8C6] hover:bg-[#d8cbb4] text-[#5C5248] rounded-full items-center justify-center shadow-[0_6px_20px_rgba(180,170,160,0.4)] transition-all duration-300 hover:scale-105 active:scale-95 z-40"
      >
        <PetSprite size={38} animated={false} />
      </button>

      <button
        onClick={() => setIsGlobalAddOpen(true)}
        aria-label="新增交易"
        className="hidden sm:flex fixed bottom-6 right-6 w-14 h-14 bg-[#87A2B4] hover:bg-[#87A2B4]/90 text-white rounded-full items-center justify-center shadow-[0_8px_30px_rgba(135,162,180,0.5)] transition-all duration-300 hover:scale-105 active:scale-95 z-40 group"
      >
        <span className="absolute inset-0 rounded-full bg-white opacity-0 group-hover:opacity-20 transition-opacity"></span>
        <Plus size={26} />
      </button>

      {/* 手機底部導覽：四個分頁，就這樣 */}
      <nav
        aria-label="主要導覽"
        className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-[#FAF6F0]/95 backdrop-blur border-t border-black/5 pb-[env(safe-area-inset-bottom)]"
      >
        <div className="flex items-stretch justify-around px-2 py-1">
          {mobileTabs.map(item => {
            const active = item.match.includes(financeTab);
            return (
              <button
                key={item.tab}
                onClick={() => setFinanceTab(item.tab)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center gap-0.5 flex-1 min-h-[52px] justify-center rounded-xl transition-colors',
                  active ? 'text-[#5C5248]' : 'text-[#A79C90]',
                )}
              >
                {item.icon}
                <span className="text-[10px] font-bold">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Quick Add：手機從底部升起，桌機置中 */}
      {isQuickAddOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-md animate-in fade-in duration-200">
          <div className="absolute inset-0" onClick={() => setIsQuickAddOpen(false)} />
          <div className="bg-[#FAF6F0] w-full max-w-md rounded-t-[24px] sm:rounded-[24px] shadow-2xl relative overflow-hidden animate-in slide-in-from-bottom-4 duration-200">
            <div className="flex items-center justify-between p-4 border-b border-black/5 bg-white/50">
              <h2 className="font-extrabold text-[#5C5248] text-lg flex items-center gap-2">
                <PetSprite size={28} mood="thinking" animated={false} /> 記一筆
              </h2>
              <button
                onClick={() => setIsQuickAddOpen(false)}
                aria-label="關閉"
                className="p-2 text-[#82786D] hover:text-[#5C5248] hover:bg-white rounded-full transition-all"
              >
                <X size={18} />
              </button>
            </div>
            <QuickTransactionForm
              transactions={transactions}
              fastMode={petSettings.fastMode}
              defaultType={petSettings.defaultType}
              onAddTransaction={addQuickTransaction}
              onSaved={() => setIsQuickAddOpen(false)}
            />
          </div>
        </div>
      )}

      {/* 快速記帳復原提示 */}
      {undoInfo && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 bg-[#5C5248]/95 text-[#FAF6F0] px-5 py-2.5 rounded-full shadow-xl animate-in fade-in slide-in-from-bottom-2 duration-200">
          <span className="text-sm font-bold flex items-center gap-1.5"><PetSprite size={20} mood="happy" animated={false} /> 已記錄 {undoInfo.label}</span>
          <button
            onClick={undoQuickTransaction}
            className="text-sm font-extrabold text-[#A8C3D4] hover:text-white transition-colors py-1 px-2"
          >
            復原
          </button>
        </div>
      )}

      {/* App Lock 覆蓋層：驗證通過前不顯示財務資料 */}
      {locked && (
        <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-5 bg-[#FAF6F0]">
          <div className="text-6xl">🔒</div>
          <p className="font-extrabold text-[#5C5248] text-lg">小財記帳已鎖定</p>
          <p className="text-sm text-[#82786D] font-bold">驗證後查看完整財務資料</p>
          <button
            onClick={() => {
              FinancePet.authenticate()
                .then(r => {
                  if (r.success) setLocked(false);
                })
                .catch(() => {});
            }}
            className="px-8 py-3 rounded-2xl font-extrabold bg-[#87A2B4] text-white hover:bg-[#87A2B4]/90 transition-all active:scale-[0.98]"
          >
            解鎖
          </button>
        </div>
      )}

      {/* 完整新增表單（桌機的 ＋，以及明細頁的「新增」） */}
      {isGlobalAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-md animate-in fade-in duration-200">
          <div className="absolute inset-0 pointer-events-none" onClick={() => setIsGlobalAddOpen(false)} />
          <div className="bg-[#FAF6F0] w-full max-w-md rounded-[24px] shadow-2xl relative overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-5 border-b border-black/5 bg-white/50">
              <h2 className="font-extrabold text-[#5C5248] text-lg flex items-center gap-2">
                記一筆（完整）
              </h2>
              <button
                onClick={() => setIsGlobalAddOpen(false)}
                aria-label="關閉"
                className="p-2 text-[#82786D] hover:text-[#5C5248] hover:bg-white rounded-full transition-all"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-2 pb-4 max-h-[80vh] overflow-y-auto scrollbar-hide">
              <Suspense fallback={<PanelFallback />}>
                <TransactionForm
                  debts={debts}
                  goals={goals}
                  onAddTransaction={t => {
                    addTransaction(t);
                    setIsGlobalAddOpen(false);
                  }}
                />
              </Suspense>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
