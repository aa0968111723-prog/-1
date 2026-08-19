import { useState, useEffect, useMemo, useRef } from 'react';
import { Transaction, BudgetConfig, RecurringTransaction, Debt, Goal, SpreadsheetRecord } from './types';
import Dashboard from './components/Dashboard';
import TransactionList from './components/TransactionList';
import BudgetSettings from './components/BudgetSettings';
import RecurringSettings from './components/RecurringSettings';
import DebtManager from './components/DebtManager';
import GoalPlanner from './components/GoalPlanner';
import GoalSandbox from './components/GoalSandbox';
import DebtAdvice from './components/DebtAdvice';
import Spreadsheet from './components/Spreadsheet';
import CashflowInference from './components/CashflowInference';
import TransactionForm from './components/TransactionForm';
import QuickTransactionForm from './components/QuickTransactionForm';
import PetSettings from './components/PetSettings';
import { Wallet, LayoutDashboard, ReceiptText, Calculator, Target, Plus, X, Menu } from 'lucide-react';
import { cn } from './lib/utils';
import { loadPetSettings, savePetSettings, bubbleShowsAmounts, PetSettings as PetSettingsType } from './lib/petSettings';
import { FinancePet, isNativePetAvailable, pendingToTransaction } from './lib/petBridge';
import { computePetFinanceState, toPetDisplayState } from './lib/petFinanceState';
import { financeRepository } from './lib/financeRepository';
import { getLocalDateKey, parseLocalDateKey } from './lib/datetime';
import { getQuickCategories } from './lib/quickCategories';

type FinanceTabType = 'overview' | 'transactions' | 'planning' | 'liabilities' | 'advisor' | 'spreadsheet' | 'pet';

export default function App() {
  const [financeTab, setFinanceTab] = useState<FinanceTabType>('overview');
  const [isGlobalAddOpen, setIsGlobalAddOpen] = useState(false);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [isMoreNavOpen, setIsMoreNavOpen] = useState(false);
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
      let cursor = rt.nextDate;
      let guard = 0;
      while (cursor <= todayStr && guard < 1000) {
        guard += 1;
        financeRepository.addTransaction({
          id: `recurring:${rt.id}:${cursor}`,
          type: rt.type,
          amount: rt.amount,
          category: rt.category,
          date: cursor,
          note: `${rt.note}${rt.note ? ' ' : ''}(自動記帳)`,
          source: 'recurring',
        });
        const next = parseLocalDateKey(cursor);
        if (rt.frequency === 'daily') next.setDate(next.getDate() + 1);
        else if (rt.frequency === 'weekly') next.setDate(next.getDate() + 7);
        else if (rt.frequency === 'monthly') next.setMonth(next.getMonth() + 1);
        else if (rt.frequency === 'yearly') next.setFullYear(next.getFullYear() + 1);
        cursor = getLocalDateKey(next);
        hasUpdates = true;
      }
      return cursor === rt.nextDate ? rt : { ...rt, nextDate: cursor };
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
    const { transactions: pending } = await FinancePet.getPendingTransactions();
    if (pending.length === 0) return;

    const persistedIds: string[] = [];
    for (const entry of pending) {
      const tx = pendingToTransaction(entry);
      try {
        financeRepository.addTransaction(tx);
        // Confirm it really is on disk before we allow the outbox to forget it.
        if (financeRepository.hasTransaction(tx.id)) persistedIds.push(tx.id);
      } catch (e) {
        console.error('[FinancePet.Sync] failed to persist pet transaction', e);
      }
    }
    syncFromRepository();
    if (persistedIds.length > 0) {
      await FinancePet.ackPendingTransactions({ ids: persistedIds });
    }
  };

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
        setFinanceTab('overview');
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

  /** One non-sensitive line for the home card: how today is going. */
  const petStatusLine = useMemo(() => {
    const today = getLocalDateKey();
    const count = transactions.filter(t => t.date === today).length;
    const name = petSettings.petName || '小財';
    if (count === 0) return `${name}正在陪你 · 今天還沒記帳`;
    return `${name}正在陪你 · 今天已記 ${count} 筆`;
  }, [transactions, petSettings.petName]);

  const timeGreeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 5) return '夜深了，早點休息哦 🌙';
    if (hour < 11) return '早安，今天也要好好照顧自己哦 ☀️';
    if (hour < 14) return '午安，記得吃頓好吃的 ☕️';
    if (hour < 18) return '午後好，喝杯水伸個懶腰吧 🌿';
    if (hour < 22) return '晚安，今天辛苦了，好好放鬆 🍷';
    return '夜深了，早點休息哦 🌙';
  }, []);

  return (
    <div className="min-h-screen font-sans pb-28 sm:pb-0">
      {/* Navbar */}
      <nav className="glass border-none rounded-none sticky top-0 z-10 p-0 shadow-[0_2px_20px_rgba(180,170,160,0.1)] border-b border-t-0 border-x-0 border-black/5" style={{ borderRadius: 0 }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between h-auto sm:h-20 py-4 sm:py-0 gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-[#E2D8C6] to-[#C9B9A6] text-[#5C5248] rounded-xl flex items-center justify-center font-extrabold text-xl shadow-sm border border-white/50">
                F
              </div>
              <div className="flex flex-col">
                <span className="font-extrabold text-[#5C5248] tracking-wide text-lg leading-tight">FinTracker Pro</span>
                <span className="text-[10px] text-[#82786D] hidden md:block font-bold mt-0.5">{timeGreeting}</span>
              </div>
            </div>
            
            {/* Primary Navigation */}
            {/* 桌機／平板：完整分頁列。手機改用底部導覽（見頁面底部） */}
            <div className="hidden sm:flex items-center bg-[#F5EFEB]/50 p-1.5 rounded-2xl border border-black/5 shadow-inner overflow-x-auto scrollbar-hide w-full sm:w-auto">
              <button
                onClick={() => setFinanceTab('overview')}
                className={cn("whitespace-nowrap px-4 sm:px-5 py-2.5 text-sm font-bold rounded-xl flex items-center gap-2 transition-all", 
                  financeTab === 'overview' ? "bg-white text-[#5C5248] shadow-sm border border-black/5" : "text-[#82786D] hover:text-[#5C5248] hover:bg-white/60")}
              >
                <LayoutDashboard size={18} /> <span className="hidden sm:inline">財務總覽</span>
              </button>
              <button
                onClick={() => setFinanceTab('transactions')}
                className={cn("whitespace-nowrap px-4 sm:px-5 py-2.5 text-sm font-bold rounded-xl flex items-center gap-2 transition-all", 
                  financeTab === 'transactions' ? "bg-white text-[#5C5248] shadow-sm border border-black/5" : "text-[#82786D] hover:text-[#5C5248] hover:bg-white/60")}
              >
                <ReceiptText size={18} /> <span className="hidden sm:inline">收支明細</span>
              </button>
              <button
                onClick={() => setFinanceTab('planning')}
                className={cn("whitespace-nowrap px-4 sm:px-5 py-2.5 text-sm font-bold rounded-xl flex items-center gap-2 transition-all", 
                  financeTab === 'planning' ? "bg-white text-[#5C5248] shadow-sm border border-black/5" : "text-[#82786D] hover:text-[#5C5248] hover:bg-white/60")}
              >
                <Calculator size={18} /> <span className="hidden sm:inline">預算規劃</span>
              </button>
              <button
                onClick={() => setFinanceTab('liabilities')}
                className={cn("whitespace-nowrap px-4 sm:px-5 py-2.5 text-sm font-bold rounded-xl flex items-center gap-2 transition-all", 
                  financeTab === 'liabilities' ? "bg-white text-[#5C5248] shadow-sm border border-black/5" : "text-[#82786D] hover:text-[#5C5248] hover:bg-white/60")}
              >
                <Target size={18} /> <span className="hidden sm:inline">負債與目標</span>
              </button>
              <button
                onClick={() => setFinanceTab('advisor')}
                className={cn("whitespace-nowrap px-4 sm:px-5 py-2.5 text-sm font-bold rounded-xl flex items-center gap-2 transition-all", 
                  financeTab === 'advisor' ? "bg-white text-[#5C5248] shadow-sm border border-black/5" : "text-[#D1A066] hover:text-[#5C5248] hover:bg-white/60")}
              >
                <span className="text-xl">✨</span> <span className="hidden sm:inline">AI 財務顧問</span>
              </button>
              <button
                onClick={() => setFinanceTab('spreadsheet')}
                className={cn("whitespace-nowrap px-4 sm:px-5 py-2.5 text-sm font-bold rounded-xl flex items-center gap-2 transition-all", 
                  financeTab === 'spreadsheet' ? "bg-white text-[#5C5248] shadow-sm border border-black/5" : "text-[#82786D] hover:text-[#5C5248] hover:bg-white/60")}
              >
                <span className="text-xl">📝</span> <span className="hidden sm:inline">長期試算表</span>
              </button>
              <button
                onClick={() => setFinanceTab('pet')}
                className={cn("whitespace-nowrap px-4 sm:px-5 py-2.5 text-sm font-bold rounded-xl flex items-center gap-2 transition-all",
                  financeTab === 'pet' ? "bg-white text-[#5C5248] shadow-sm border border-black/5" : "text-[#82786D] hover:text-[#5C5248] hover:bg-white/60")}
              >
                <span className="text-xl">🐣</span> <span className="hidden sm:inline">桌寵</span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-in fade-in duration-500">
        <div className="space-y-6">
          {/* Finance Tab Content */}
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            {financeTab === 'overview' && (
              <div className="space-y-8">
                {/* 小財入口卡：桌寵是最快的記帳路徑，但 Dashboard 本身不卡通化 */}
                <div className="glass rounded-[24px] p-4 flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#FFE9A8] to-[#F7C873] flex items-center justify-center text-2xl shadow-inner border border-white/60 shrink-0">
                    🐣
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-extrabold text-[#5C5248] truncate">{timeGreeting}</p>
                    <p className="text-xs text-[#82786D] font-bold truncate">{petStatusLine}</p>
                  </div>
                  <button
                    onClick={() => setIsQuickAddOpen(true)}
                    className="px-4 min-h-[44px] rounded-2xl font-bold text-sm bg-[#87A2B4] text-white hover:bg-[#87A2B4]/90 active:scale-95 transition-all shrink-0"
                  >
                    快速記帳
                  </button>
                </div>
                <Dashboard transactions={transactions} budgets={budgets} debts={debts} recurring={recurring} />
                <CashflowInference transactions={transactions} debts={debts} goals={goals} />
              </div>
            )}
            {financeTab === 'transactions' && (
              <TransactionList 
                transactions={transactions} 
                onDelete={deleteTransaction} 
                debts={debts}
                goals={goals} 
                onOpenAdd={() => setIsGlobalAddOpen(true)}
              />
            )}
            {financeTab === 'planning' && (
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
            )}
            {financeTab === 'liabilities' && (
              <div className="space-y-8">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <DebtManager debts={debts} onAdd={addDebt} onDelete={deleteDebt} onUpdate={updateDebt} onAddTransaction={addTransaction} />
                  <GoalPlanner goals={goals} debts={debts} transactions={transactions} monthlyIncome={monthlyIncome} budgets={budgets} onAdd={addGoal} onDelete={deleteGoal} onUpdate={updateGoal} onAddTransaction={addTransaction} />
                </div>
                <GoalSandbox goals={goals} debts={debts} transactions={transactions} monthlyIncome={monthlyIncome} />
              </div>
            )}
            {financeTab === 'advisor' && (
              <DebtAdvice 
                debts={debts} 
                monthlyIncome={monthlyIncome} 
                transactions={transactions} 
                budgets={budgets} 
                recurring={recurring} 
                goals={goals} 
              />
            )}
            {financeTab === 'spreadsheet' && (
              <Spreadsheet
                records={spreadsheetRecords}
                onAdd={addSpreadsheetRecord}
                onUpdate={updateSpreadsheetRecord}
                onDelete={deleteSpreadsheetRecord}
              />
            )}
            {financeTab === 'pet' && (
              <PetSettings settings={petSettings} onChange={setPetSettings} />
            )}
          </div>
        </div>
      </main>

      {/* 桌機／平板的浮動按鈕；手機改用底部導覽中央的 ＋ */}
      <button
        onClick={() => setIsQuickAddOpen(true)}
        aria-label="快速記帳"
        className="hidden sm:flex fixed bottom-[5.5rem] right-6 w-12 h-12 bg-[#E2D8C6] hover:bg-[#d8cbb4] text-[#5C5248] rounded-full items-center justify-center shadow-[0_6px_20px_rgba(180,170,160,0.4)] transition-all duration-300 hover:scale-105 active:scale-95 z-40 text-xl"
      >
        🐣
      </button>

      <button
        onClick={() => setIsGlobalAddOpen(true)}
        aria-label="新增交易"
        className="hidden sm:flex fixed bottom-6 right-6 w-14 h-14 bg-[#87A2B4] hover:bg-[#87A2B4]/90 text-white rounded-full items-center justify-center shadow-[0_8px_30px_rgba(135,162,180,0.5)] transition-all duration-300 hover:scale-105 active:scale-95 z-40 group"
      >
        <span className="absolute inset-0 rounded-full bg-white opacity-0 group-hover:opacity-20 transition-opacity"></span>
        <Plus size={26} />
      </button>

      {/* 手機底部導覽：中央 ＋ 讓桌寵停用時 App 本身依然好用 */}
      <nav
        aria-label="主要導覽"
        className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-[#FAF6F0]/95 backdrop-blur border-t border-black/5 pb-[env(safe-area-inset-bottom)]"
      >
        <div className="flex items-end justify-around px-2 pt-1.5">
          {([
            { tab: 'overview' as FinanceTabType, icon: <LayoutDashboard size={20} />, label: '總覽' },
            { tab: 'transactions' as FinanceTabType, icon: <ReceiptText size={20} />, label: '明細' },
          ]).map(item => (
            <button
              key={item.tab}
              onClick={() => setFinanceTab(item.tab)}
              aria-current={financeTab === item.tab ? 'page' : undefined}
              className={cn(
                'flex flex-col items-center gap-0.5 min-w-[64px] min-h-[48px] justify-center rounded-xl transition-colors',
                financeTab === item.tab ? 'text-[#5C5248]' : 'text-[#A79C90]',
              )}
            >
              {item.icon}
              <span className="text-[10px] font-bold">{item.label}</span>
            </button>
          ))}

          <button
            onClick={() => setIsQuickAddOpen(true)}
            aria-label="快速記帳"
            className="-mt-6 w-14 h-14 rounded-full bg-[#87A2B4] text-white flex items-center justify-center shadow-[0_8px_24px_rgba(135,162,180,0.5)] active:scale-95 transition-transform shrink-0"
          >
            <Plus size={26} />
          </button>

          {([
            { tab: 'liabilities' as FinanceTabType, icon: <Target size={20} />, label: '目標' },
          ]).map(item => (
            <button
              key={item.tab}
              onClick={() => setFinanceTab(item.tab)}
              aria-current={financeTab === item.tab ? 'page' : undefined}
              className={cn(
                'flex flex-col items-center gap-0.5 min-w-[64px] min-h-[48px] justify-center rounded-xl transition-colors',
                financeTab === item.tab ? 'text-[#5C5248]' : 'text-[#A79C90]',
              )}
            >
              {item.icon}
              <span className="text-[10px] font-bold">{item.label}</span>
            </button>
          ))}

          <button
            onClick={() => setIsMoreNavOpen(true)}
            aria-label="更多分頁"
            aria-expanded={isMoreNavOpen}
            className={cn(
              'flex flex-col items-center gap-0.5 min-w-[64px] min-h-[48px] justify-center rounded-xl transition-colors',
              ['planning', 'advisor', 'spreadsheet', 'pet'].includes(financeTab) ? 'text-[#5C5248]' : 'text-[#A79C90]',
            )}
          >
            <Menu size={20} />
            <span className="text-[10px] font-bold">更多</span>
          </button>
        </div>
      </nav>

      {/* 手機「更多」分頁選單 */}
      {isMoreNavOpen && (
        <div className="sm:hidden fixed inset-0 z-50 flex items-end bg-black/40 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="absolute inset-0" onClick={() => setIsMoreNavOpen(false)} />
          <div className="relative w-full bg-[#FAF6F0] rounded-t-[24px] p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] space-y-1 animate-in slide-in-from-bottom-4 duration-200">
            {([
              { tab: 'planning' as FinanceTabType, label: '📊 預算規劃' },
              { tab: 'advisor' as FinanceTabType, label: '✨ AI 財務顧問' },
              { tab: 'spreadsheet' as FinanceTabType, label: '📝 長期試算表' },
              { tab: 'pet' as FinanceTabType, label: '🐣 桌寵設定' },
            ]).map(item => (
              <button
                key={item.tab}
                onClick={() => {
                  setFinanceTab(item.tab);
                  setIsMoreNavOpen(false);
                }}
                className="w-full text-left px-4 min-h-[48px] rounded-2xl font-bold text-[#5C5248] hover:bg-white/70 active:bg-white transition-colors"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Quick Add Modal（桌寵 / 極速記帳）：簡化版，仍走同一個 addTransaction */}
      {isQuickAddOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-md animate-in fade-in duration-200">
          <div
            className="absolute inset-0"
            onClick={() => setIsQuickAddOpen(false)}
          />
          <div className="bg-[#FAF6F0] w-full max-w-md rounded-t-[24px] sm:rounded-[24px] shadow-2xl relative overflow-hidden animate-in slide-in-from-bottom-4 duration-200">
            <div className="flex items-center justify-between p-4 border-b border-black/5 bg-white/50">
              <h2 className="font-extrabold text-[#5C5248] text-lg flex items-center gap-2">
                🐣 今天花多少？
              </h2>
              <button
                onClick={() => setIsQuickAddOpen(false)}
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
          <span className="text-sm font-bold">🐣 已記錄 {undoInfo.label}</span>
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
          <p className="font-extrabold text-[#5C5248] text-lg">FinTracker 已鎖定</p>
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

      {/* Global Add Modal */}
      {isGlobalAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-md animate-in fade-in duration-200">
          <div 
            className="absolute inset-0 pointer-events-none" 
            onClick={() => setIsGlobalAddOpen(false)}
          />
          <div className="bg-[#FAF6F0] w-full max-w-md rounded-[24px] shadow-2xl relative overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-5 border-b border-black/5 bg-white/50">
               <h2 className="font-extrabold text-[#5C5248] text-lg flex items-center gap-2">
                 快速記一筆
               </h2>
               <button 
                 onClick={() => setIsGlobalAddOpen(false)} 
                 className="p-2 text-[#82786D] hover:text-[#5C5248] hover:bg-white rounded-full transition-all"
               >
                 <X size={18} />
               </button>
            </div>
            <div className="p-2 pb-4 max-h-[80vh] overflow-y-auto scrollbar-hide">
               <TransactionForm 
                  debts={debts}
                  goals={goals}
                  onAddTransaction={(t) => {
                    addTransaction(t);
                    setIsGlobalAddOpen(false);
                  }} 
                />
             </div>
          </div>
        </div>
      )}
    </div>
  );
}
