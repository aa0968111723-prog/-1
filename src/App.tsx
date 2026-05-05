import { useState, useEffect, useMemo } from 'react';
import { Transaction, BudgetConfig, RecurringTransaction, Debt, Goal } from './types';
import Dashboard from './components/Dashboard';
import TransactionList from './components/TransactionList';
import BudgetSettings from './components/BudgetSettings';
import RecurringSettings from './components/RecurringSettings';
import DebtManager from './components/DebtManager';
import GoalPlanner from './components/GoalPlanner';
import CashflowInference from './components/CashflowInference';
import TransactionForm from './components/TransactionForm';
import { Wallet, LayoutDashboard, ReceiptText, Calculator, Target, Plus, X } from 'lucide-react';
import { cn } from './lib/utils';

type FinanceTabType = 'overview' | 'transactions' | 'planning' | 'liabilities';

export default function App() {
  const [financeTab, setFinanceTab] = useState<FinanceTabType>('overview');
  const [isGlobalAddOpen, setIsGlobalAddOpen] = useState(false);
  
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

  // Save to local storage
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

  // Process recurring transactions
  useEffect(() => {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    
    let hasUpdates = false;
    const nextRecurring = [...recurring];
    const newTransactions: Transaction[] = [];

    nextRecurring.forEach(rt => {
      while (rt.nextDate <= todayStr) {
        // Add transaction
        newTransactions.push({
          id: crypto.randomUUID(),
          type: rt.type,
          amount: rt.amount,
          category: rt.category,
          date: rt.nextDate,
          note: `${rt.note}${rt.note ? ' ' : ''}(自動記帳)`,
        });

        // Calculate next date
        const nextDateObj = new Date(rt.nextDate);
        if (rt.frequency === 'daily') nextDateObj.setDate(nextDateObj.getDate() + 1);
        else if (rt.frequency === 'weekly') nextDateObj.setDate(nextDateObj.getDate() + 7);
        else if (rt.frequency === 'monthly') nextDateObj.setMonth(nextDateObj.getMonth() + 1);
        else if (rt.frequency === 'yearly') nextDateObj.setFullYear(nextDateObj.getFullYear() + 1);

        rt.nextDate = nextDateObj.toISOString().split('T')[0];
        hasUpdates = true;
      }
    });

    if (hasUpdates) {
      setTransactions(prev => [...newTransactions, ...prev]);
      setRecurring(nextRecurring);
    }
  }, [recurring]);

  const addTransaction = (newTx: Omit<Transaction, 'id'>) => {
    const transaction = {
      ...newTx,
      id: crypto.randomUUID(),
    };
    setTransactions(prev => [transaction, ...prev]);

    // Handle Deep Integration: Deduct from linked debt
    if (newTx.linkedDebtId && newTx.amount > 0) {
      setDebts(prev => prev.map(debt => 
        debt.id === newTx.linkedDebtId 
          ? { ...debt, amount: Math.max(0, debt.amount - newTx.amount) } 
          : debt
      ));
    }

    // Handle Deep Integration: Add to linked goal
    if (newTx.linkedGoalId && newTx.amount > 0) {
      setGoals(prev => prev.map(goal => 
        goal.id === newTx.linkedGoalId 
          ? { ...goal, currentAmount: goal.currentAmount + newTx.amount } 
          : goal
      ));
    }
  };

  const deleteTransaction = (id: string) => {
    // Handle Deep Integration Reversal before deleting
    const txToDelete = transactions.find(t => t.id === id);
    if (txToDelete) {
      if (txToDelete.linkedDebtId && txToDelete.amount > 0) {
        setDebts(prev => prev.map(debt => 
          debt.id === txToDelete.linkedDebtId 
            ? { ...debt, amount: debt.amount + txToDelete.amount } 
            : debt
        ));
      }
      if (txToDelete.linkedGoalId && txToDelete.amount > 0) {
        setGoals(prev => prev.map(goal => 
          goal.id === txToDelete.linkedGoalId 
            ? { ...goal, currentAmount: Math.max(0, goal.currentAmount - txToDelete.amount) } 
            : goal
        ));
      }
    }

    setTransactions(prev => prev.filter(t => t.id !== id));
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

  const addDebt = (debt: Omit<Debt, 'id'>) => {
    setDebts(prev => [{ ...debt, id: crypto.randomUUID() }, ...prev]);
  };

  const deleteDebt = (id: string) => {
    setDebts(prev => prev.filter(d => d.id !== id));
  };

  const addGoal = (goal: Omit<Goal, 'id'>) => {
    setGoals(prev => [{ ...goal, id: crypto.randomUUID() }, ...prev]);
  };

  const deleteGoal = (id: string) => {
    setGoals(prev => prev.filter(g => g.id !== id));
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

  return (
    <div className="min-h-screen font-sans pb-20 lg:pb-0">
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
            <div className="flex items-center bg-[#F5EFEB]/50 p-1.5 rounded-2xl border border-black/5 shadow-inner overflow-x-auto scrollbar-hide w-full sm:w-auto">
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
                <BudgetSettings budgets={budgets} onUpdateBudget={updateBudget} onDeleteBudget={deleteBudget} />
                <RecurringSettings recurring={recurring} onAdd={addRecurring} onDelete={deleteRecurring} />
              </div>
            )}
            {financeTab === 'liabilities' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <DebtManager debts={debts} onAdd={addDebt} onDelete={deleteDebt} onAddTransaction={addTransaction} />
                <GoalPlanner goals={goals} onAdd={addGoal} onDelete={deleteGoal} onAddTransaction={addTransaction} />
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Global Floating Action Button */}
      <button 
        onClick={() => setIsGlobalAddOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-[#87A2B4] hover:bg-[#87A2B4]/90 text-white rounded-full flex items-center justify-center shadow-[0_8px_30px_rgba(135,162,180,0.5)] transition-all duration-300 hover:scale-105 active:scale-95 z-40 group"
      >
        <span className="absolute inset-0 rounded-full bg-white opacity-0 group-hover:opacity-20 transition-opacity"></span>
        <Plus size={26} />
      </button>

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
