import React, { useState, useMemo, useEffect } from 'react';
import { Goal, Debt, Transaction } from '../types';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Area, AreaChart } from 'recharts';
import { formatCurrency } from '../lib/formatters';
import { Zap, Target, ArrowRight, Plus, Trash2, Calendar, GitCompare, Landmark } from 'lucide-react';
import { cn } from '../lib/utils';

interface Props {
  goals: Goal[];
  debts: Debt[];
  transactions?: Transaction[];
  monthlyIncome?: number;
}

interface SandboxEvent {
  id: string;
  month: number;
  amount: number;
  name: string;
  type?: 'cashflow' | 'repayment'; // defaults to cashflow for legacy
  targetDebtId?: string; // used if type is 'repayment'
}

interface Scenario {
  id: string;
  name: string;
  initialAssets: number;
  initialDebts: number;
  monthlyIncome: number;
  monthlyExpense: number;
  extraRepayment: number;
  assetAnnualRate: number;
  color: string;
  events: SandboxEvent[];
}

const DEFAULT_COLORS = ['#D1A066', '#87A2B4', '#8E7CC3', '#E6C229', '#F17105', '#769C7C'];

export default function GoalSandbox({ goals, debts, transactions = [], monthlyIncome = 50000 }: Props) {
  const initialAssets = useMemo(() => goals.reduce((sum, g) => sum + g.currentAmount, 0), [goals]);
  const initialDebtsAmount = useMemo(() => debts.reduce((sum, d) => sum + d.amount, 0), [debts]);

  const [months, setMonths] = useState<number>(36); // 3 years
  const [scenarios, setScenarios] = useState<Scenario[]>([
    {
      id: 's1',
      name: '穩健情境',
      initialAssets: initialAssets,
      initialDebts: initialDebtsAmount,
      monthlyIncome: monthlyIncome > 0 ? monthlyIncome : 50000,
      monthlyExpense: 30000,
      extraRepayment: 2000,
      assetAnnualRate: 5,
      color: '#D1A066',
      events: []
    }
  ]);
  const [activeScenarioId, setActiveScenarioId] = useState<string>('s1');

  // Auto-calculate from transactions
  useEffect(() => {
    if (transactions.length === 0) return;
    
    // Get unique months in transactions to find average
    const monthsSet = new Set<string>();
    let totalInc = 0;
    let totalExp = 0;
    
    transactions.forEach(t => {
      const monthKey = t.date.substring(0, 7); // YYYY-MM
      monthsSet.add(monthKey);
      if (t.type === 'income') totalInc += t.amount;
      if (t.type === 'expense') totalExp += t.amount;
    });

    const monthCount = Math.max(1, monthsSet.size);
    const avgInc = Math.round(totalInc / monthCount);
    const avgExp = Math.round(totalExp / monthCount);
    
    const suggestedExtraRepayment = Math.max(0, Math.round((avgInc - avgExp) * 0.2)); // Suggest 20% of net income for extra repayment

    setScenarios(prev => {
      const s1 = prev.find(s => s.id === 's1');
      const defaultIncome = monthlyIncome && monthlyIncome > 0 ? monthlyIncome : 50000;
      if (s1 && s1.monthlyIncome === defaultIncome && s1.monthlyExpense === 30000) {
        return prev.map(s => 
          s.id === 's1' 
            ? { ...s, monthlyIncome: monthlyIncome > 0 ? monthlyIncome : avgInc, monthlyExpense: avgExp, extraRepayment: suggestedExtraRepayment, name: '記帳平均情境' } 
            : s
        );
      }
      return prev;
    });
  }, [transactions]);

  // Event form state
  const [newEventMonth, setNewEventMonth] = useState<string>('');
  const [newEventType, setNewEventType] = useState<'cashflow'|'repayment'>('cashflow');
  const [newEventName, setNewEventName] = useState<string>('');
  const [newEventAmount, setNewEventAmount] = useState<string>('');
  const [newEventDebtId, setNewEventDebtId] = useState<string>('');

  const activeScenario = scenarios.find(s => s.id === activeScenarioId) || scenarios[0];

  const updateActiveScenario = (updates: Partial<Scenario>) => {
    setScenarios(prev => prev.map(s => s.id === activeScenarioId ? { ...s, ...updates } : s));
  };

  const handleAddScenario = () => {
    const newId = `s${Date.now()}`;
    const newColor = DEFAULT_COLORS[scenarios.length % DEFAULT_COLORS.length];
    setScenarios([
      ...scenarios,
      {
        ...activeScenario,
        id: newId,
        name: `情境 ${scenarios.length + 1}`,
        color: newColor,
        events: [...activeScenario.events]
      }
    ]);
    setActiveScenarioId(newId);
  };

  const handleDeleteScenario = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (scenarios.length <= 1) return;
    const newScenarios = scenarios.filter(s => s.id !== id);
    setScenarios(newScenarios);
    if (activeScenarioId === id) {
      setActiveScenarioId(newScenarios[newScenarios.length - 1].id);
    }
  };

  const handleAddEvent = () => {
    if (!newEventMonth || !newEventAmount) return; // name is optional for repayment
    const month = parseInt(newEventMonth, 10);
    const amount = parseInt(newEventAmount, 10);
    if (isNaN(month) || isNaN(amount) || month < 1 || month > 120) return;
    
    // For repayment, it should be positive reduction of debt, which means negative cash effect.
    // So if user types "50000" for repayment, we'll store it as 50000.
    const isRepayment = newEventType === 'repayment';
    const finalAmount = isRepayment ? Math.abs(amount) : amount;
    const finalName = isRepayment && !newEventName ? '提早還款' : newEventName;

    const newEvent: SandboxEvent = {
      id: Date.now().toString(),
      month,
      amount: finalAmount,
      name: finalName,
      type: newEventType,
      targetDebtId: newEventType === 'repayment' ? (newEventDebtId || 'all') : undefined,
    };

    updateActiveScenario({ events: [...activeScenario.events, newEvent].sort((a, b) => a.month - b.month) });
    setNewEventMonth('');
    setNewEventName('');
    setNewEventAmount('');
  };

  const handleDeleteEvent = (eventId: string) => {
    updateActiveScenario({ events: activeScenario.events.filter(e => e.id !== eventId) });
  };

  const { chartData, activeScenarioDetails } = useMemo(() => {
    const projection = [];
    
    // Simulate each scenario
    const scenariosData = scenarios.map(sc => {
      let currentAssets = sc.initialAssets !== undefined ? sc.initialAssets : initialAssets;
      let currentDebts = debts.map(d => ({ ...d }));
      
      const originalDebtSum = currentDebts.reduce((sum, d) => sum + d.amount, 0);
      const targetInitialDebt = sc.initialDebts !== undefined ? sc.initialDebts : initialDebtsAmount;
      
      // If scenario has a different initialDebts than actual, we scale the amounts
      if (originalDebtSum > 0 && targetInitialDebt !== originalDebtSum) {
          const ratio = targetInitialDebt / originalDebtSum;
          currentDebts.forEach(d => {
               d.amount *= ratio;
               if (d.monthlyPayment) d.monthlyPayment *= ratio;
          });
      } else if (originalDebtSum === 0 && targetInitialDebt > 0) {
          currentDebts = [{ id: 'mock', name: '預設負債', amount: targetInitialDebt, interestRate: 5, dueDate: '', note: '' } as any];
      }

      const assetMonthlyRate = sc.assetAnnualRate / 100 / 12;
      const monthlyHistory = [];

      for (let i = 0; i <= months; i++) {
        let startingAssets = currentAssets;
        let startingDebts = currentDebts.reduce((sum, d) => sum + d.amount, 0);
        let totalDebtThisMonth = startingDebts;
        let eventsCashflow = 0;
        let eventsRepayment = 0;
        let totalInterestThisMonth = 0;
        let totalDebtPaymentThisMonth = 0;

        if (i > 0) {
          // 1. Asset Growth
          currentAssets = currentAssets * (1 + assetMonthlyRate);
          
          // 2. Net Income
          let availableCash = sc.monthlyIncome - sc.monthlyExpense;
          
          // 3. Apply custom events for this month
          const eventsThisMonth = sc.events.filter(e => e.month === i);
          eventsThisMonth.forEach(e => {
            if (e.type === 'repayment') {
              let amountLeftToRepay = e.amount;
              eventsRepayment += e.amount;
              // Target specific debt
              if (e.targetDebtId && e.targetDebtId !== 'all') {
                const target = currentDebts.find(d => d.id === e.targetDebtId);
                if (target && target.amount > 0) {
                  const payment = Math.min(target.amount, amountLeftToRepay);
                  target.amount -= payment;
                  amountLeftToRepay -= payment;
                  totalDebtPaymentThisMonth += payment;
                }
              }
              // Apply leftover to highest interest debts
              if (amountLeftToRepay > 0) {
                currentDebts.sort((a, b) => (b.interestRate||0) - (a.interestRate||0));
                currentDebts.forEach(d => {
                  if (d.amount > 0 && amountLeftToRepay > 0) {
                    const payment = Math.min(d.amount, amountLeftToRepay);
                    d.amount -= payment;
                    amountLeftToRepay -= payment;
                    totalDebtPaymentThisMonth += payment;
                  }
                });
              }
            } else {
              availableCash += e.amount;
              eventsCashflow += e.amount;
            }
          });
          
          // 4. Interest
          currentDebts.forEach(d => {
            if (d.amount > 0) {
              const interest = d.amount * ((d.interestRate||0) / 100 / 12);
              d.amount += interest;
              totalInterestThisMonth += interest;
            }
          });
          
          // 5. Minimum payments
          currentDebts.forEach(d => {
             if (d.amount > 0 && (d.monthlyPayment || 0) > 0) {
                const payment = Math.min(d.amount, d.monthlyPayment || 0);
                d.amount -= payment;
                totalDebtPaymentThisMonth += payment;
             }
          });

          // 6. Extra repayment
          let remainingExtra = sc.extraRepayment;
          currentDebts.sort((a, b) => (b.interestRate||0) - (a.interestRate||0));
          currentDebts.forEach(d => {
             if (d.amount > 0 && remainingExtra > 0) {
                const payment = Math.min(d.amount, remainingExtra);
                d.amount -= payment;
                remainingExtra -= payment;
                totalDebtPaymentThisMonth += payment;
             }
          });
          
          // 7. Update cash pool
          availableCash -= totalDebtPaymentThisMonth;
          currentAssets += availableCash;
        }
        
        totalDebtThisMonth = currentDebts.reduce((sum, d) => sum + d.amount, 0);
        
        monthlyHistory.push({
          month: i,
          startingAssets: Math.round(startingAssets),
          startingDebts: Math.round(startingDebts),
          income: i > 0 ? Math.round(sc.monthlyIncome) : 0,
          expense: i > 0 ? Math.round(sc.monthlyExpense) : 0,
          eventsCashflow: Math.round(eventsCashflow),
          eventsRepayment: Math.round(eventsRepayment),
          regularDebtPayment: i > 0 ? Math.round(totalDebtPaymentThisMonth - eventsRepayment) : 0,
          interestAdded: Math.round(totalInterestThisMonth),
          assets: Math.round(currentAssets),
          debt: Math.round(totalDebtThisMonth),
          netWorth: Math.round(currentAssets - totalDebtThisMonth),
        });
      }
      return monthlyHistory;
    });

    // Combine into recharts format
    for (let i = 0; i <= months; i++) {
      const date = new Date();
      date.setMonth(date.getMonth() + i);
      
      const dataPoint: any = {
        monthLabel: i === 0 ? '現在' : `第 ${i} 個月`,
        dateLabel: `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}`,
      };
      
      scenarios.forEach((sc, idx) => {
        dataPoint[`assets_${sc.id}`] = scenariosData[idx][i].assets;
        dataPoint[`debt_${sc.id}`] = scenariosData[idx][i].debt;
        dataPoint[`netWorth_${sc.id}`] = scenariosData[idx][i].netWorth;
      });
      
      projection.push(dataPoint);
    }
    
    // Get active scenario details
    const activeIdx = scenarios.findIndex(s => s.id === activeScenarioId);
    const activeScenarioDetails = scenariosData[activeIdx >= 0 ? activeIdx : 0];

    return { chartData: projection, activeScenarioDetails };
  }, [initialAssets, debts, scenarios, months, activeScenarioId]);

  return (
    <div className="glass p-6 mt-6 bg-[#FAF6F0]/80">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-2 text-[#D1A066] shrink-0">
          <GitCompare />
          <h2 className="text-xl font-bold text-[#5C5248]">進階多情境沙盒模擬</h2>
        </div>
        
        {/* Scenario Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 sm:pb-0 w-full sm:w-auto">
          {scenarios.map(sc => (
            <div 
              key={sc.id}
              onClick={() => setActiveScenarioId(sc.id)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold cursor-pointer transition-all border whitespace-nowrap",
                activeScenarioId === sc.id 
                  ? "bg-white text-[#5C5248] shadow-sm border-black/5" 
                  : "bg-white/40 text-[#82786D] hover:bg-white/60 border-transparent"
              )}
              style={activeScenarioId === sc.id ? { borderBottom: `3px solid ${sc.color}` } : {}}
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: sc.color }} />
              <input 
                type="text" 
                value={sc.name}
                onChange={e => {
                  if (activeScenarioId === sc.id) {
                    updateActiveScenario({ name: e.target.value });
                  }
                }}
                className={cn("bg-transparent outline-none w-20 sm:w-24 pointer-events-auto text-inherit focus:ring-0 p-0 m-0", activeScenarioId !== sc.id && "pointer-events-none")}
                onClick={e => activeScenarioId === sc.id && e.stopPropagation()}
              />
              {scenarios.length > 1 && activeScenarioId === sc.id && (
                <button onClick={(e) => handleDeleteScenario(sc.id, e)} className="text-[#82786D]/50 hover:text-[#CD7A70] ml-1 shrink-0 bg-white/50 p-1 rounded-full">
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          ))}
          <button 
            onClick={handleAddScenario}
            className="flex items-center gap-1 px-3 py-2 rounded-xl text-sm font-bold bg-[#87A2B4] hover:bg-[#87A2B4]/90 text-white transition-all shadow-sm shrink-0"
          >
            <Plus size={16} /> 新增情境
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8 animate-in fade-in duration-300 relative" key={activeScenarioId}>
        
        {/* Settings Column 1 */}
        <div className="space-y-4 bg-white/60 p-5 rounded-2xl border border-black/5 shadow-sm border-l-4" style={{ borderLeftColor: activeScenario.color }}>
          <h3 className="font-bold text-[#5C5248] text-sm flex items-center gap-2 mb-4"><Target size={16} className="text-[#87A2B4]" /> 收支與資產設定 ({activeScenario.name})</h3>
          
          <div className="grid grid-cols-2 gap-4">
             <div>
               <label className="block text-xs font-bold text-[#82786D] mb-1">初始現金資產</label>
               <div className="relative">
                 <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#82786D] text-sm">NT$</span>
                 <input 
                   type="number" 
                   value={activeScenario.initialAssets} 
                   onChange={e => updateActiveScenario({ initialAssets: Number(e.target.value) })} 
                   className="w-full pl-10 pr-4 py-2 bg-[#769C7C]/5 border border-[#769C7C]/20 text-[#769C7C] font-bold rounded-xl focus:ring-2 focus:ring-[#769C7C]/50 focus:outline-none transition-all shadow-sm"
                 />
               </div>
             </div>
             <div>
               <label className="block text-xs font-bold text-[#82786D] mb-1">初始總負債</label>
               <div className="relative">
                 <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#82786D] text-sm">NT$</span>
                 <input 
                   type="number" 
                   value={activeScenario.initialDebts} 
                   onChange={e => updateActiveScenario({ initialDebts: Number(e.target.value) })} 
                   className="w-full pl-10 pr-4 py-2 bg-[#CD7A70]/5 border border-[#CD7A70]/20 text-[#CD7A70] font-bold rounded-xl focus:ring-2 focus:ring-[#CD7A70]/50 focus:outline-none transition-all shadow-sm"
                 />
               </div>
             </div>
          </div>
          
          <div>
             <label className="block text-xs font-bold text-[#82786D] mb-1">預計每月收入</label>
             <div className="relative">
               <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#82786D] text-sm">NT$</span>
               <input 
                 type="number" 
                 value={activeScenario.monthlyIncome} 
                 onChange={e => updateActiveScenario({ monthlyIncome: Number(e.target.value) })} 
                 className="w-full pl-10 pr-4 py-2 bg-white border border-black/5 text-[#5C5248] font-bold rounded-xl focus:ring-2 focus:ring-[#87A2B4]/50 focus:outline-none transition-all shadow-sm"
               />
             </div>
          </div>
          
          <div>
             <label className="block text-xs font-bold text-[#82786D] mb-1">預計每月生活支出</label>
             <div className="relative">
               <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#82786D] text-sm">NT$</span>
               <input 
                 type="number" 
                 value={activeScenario.monthlyExpense} 
                 onChange={e => updateActiveScenario({ monthlyExpense: Number(e.target.value) })} 
                 className="w-full pl-10 pr-4 py-2 bg-white border border-black/5 text-[#5C5248] font-bold rounded-xl focus:ring-2 focus:ring-[#87A2B4]/50 focus:outline-none transition-all shadow-sm"
               />
             </div>
          </div>

          <div>
             <label className="block text-xs font-bold text-[#82786D] mb-1">額外債務還款 (優先處理高利息)</label>
             <div className="relative">
               <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#82786D] text-sm">NT$</span>
               <input 
                 type="number" 
                 value={activeScenario.extraRepayment} 
                 onChange={e => updateActiveScenario({ extraRepayment: Number(e.target.value) })} 
                 className="w-full pl-10 pr-4 py-2 bg-white border border-black/5 text-[#5C5248] font-bold rounded-xl focus:ring-2 focus:ring-[#87A2B4]/50 focus:outline-none transition-all shadow-sm"
               />
             </div>
             <p className="text-[10px] text-[#82786D]/70 mt-1">* 將在強制最低還款後，自動分配給最高利息的負債</p>
          </div>
          
          <div className="pt-2">
            <label className="block text-[10px] font-bold text-[#82786D]/80 uppercase tracking-widest mb-2 flex items-center justify-between">
              <span>預期資產年化報酬率</span>
              <span className="text-[#5C5248] font-mono text-sm">{activeScenario.assetAnnualRate}%</span>
            </label>
            <input 
              type="range" 
              min="0" 
              max="20" 
              step="0.5" 
              value={activeScenario.assetAnnualRate} 
              onChange={e => updateActiveScenario({ assetAnnualRate: Number(e.target.value) })} 
              className="w-full"
              style={{ accentColor: activeScenario.color }}
            />
          </div>
        </div>

        {/* Settings Column 2 */}
        <div className="space-y-4 bg-white/60 p-5 rounded-2xl border border-black/5 shadow-sm overflow-hidden flex flex-col min-h-[300px]">
           <div>
             <h3 className="font-bold text-[#5C5248] text-sm flex items-center gap-2"><Calendar size={16} className="text-[#D1A066]" /> 特定月份單次大額收支 / 提早還款</h3>
             <p className="text-[10px] text-[#82786D] mt-1 mb-3">加入年終、買房、大筆意外支出，或設定某個月進行「大額提早還款」。</p>
           </div>
           
           <div className="flex flex-col gap-2">
             <div className="flex gap-2">
               <select 
                 value={newEventType} 
                 onChange={e => setNewEventType(e.target.value as 'cashflow' | 'repayment')}
                 className="w-24 px-2 py-2 bg-white border border-black/5 text-[#5C5248] font-bold rounded-lg text-xs outline-none focus:border-[#87A2B4]"
               >
                 <option value="cashflow">單筆收支</option>
                 <option value="repayment">提早還款</option>
               </select>
               <input 
                 type="number" 
                 placeholder="第幾個月" 
                 className="w-20 px-2 py-2 bg-white border border-black/5 text-[#5C5248] font-bold rounded-lg text-xs outline-none focus:border-[#87A2B4]"
                 value={newEventMonth}
                 onChange={e => setNewEventMonth(e.target.value)}
               />
               <input 
                 type="number" 
                 placeholder={newEventType === 'repayment' ? "提早還款額" : "金額 (+/-)"} 
                 className="flex-1 px-2 py-2 bg-white border border-black/5 text-[#5C5248] font-bold rounded-lg text-xs outline-none focus:border-[#87A2B4]"
                 value={newEventAmount}
                 onChange={e => setNewEventAmount(e.target.value)}
               />
             </div>
             
             <div className="flex gap-2">
               {newEventType === 'repayment' ? (
                 <select
                   className="flex-1 px-2 py-2 bg-white border border-black/5 text-[#5C5248] font-bold rounded-lg text-xs outline-none focus:border-[#87A2B4]"
                   value={newEventDebtId}
                   onChange={e => setNewEventDebtId(e.target.value)}
                 >
                   <option value="all">預設分配 (最高利率優先)</option>
                   {debts.map(d => (
                     <option key={d.id} value={d.id}>{d.name}</option>
                   ))}
                 </select>
               ) : (
                 <input 
                   type="text" 
                   placeholder="事件稱呼 (選填)" 
                   className="flex-1 px-2 py-2 bg-white border border-black/5 text-[#5C5248] font-bold rounded-lg text-xs outline-none focus:border-[#87A2B4]"
                   value={newEventName}
                   onChange={e => setNewEventName(e.target.value)}
                 />
               )}
               <button 
                 onClick={handleAddEvent}
                 className="w-16 bg-[#EAE4DB] text-[#5C5248] hover:bg-[#D1A066]/20 hover:text-[#D1A066] rounded-lg transition-colors font-bold shrink-0 flex items-center justify-center"
               >
                 加入
               </button>
             </div>
           </div>
           
           <div className="flex-1 overflow-y-auto pr-1 scrollbar-hide space-y-2 mt-2">
             {activeScenario.events.length > 0 ? (
               activeScenario.events.map(ev => (
                 <div key={ev.id} className="flex items-center justify-between text-xs bg-white p-2.5 rounded-lg border border-black/5 shadow-sm hover:border-[#87A2B4]/30 transition-colors">
                   <div className="flex items-center gap-2">
                     <span className="font-bold text-[#82786D] bg-[#FAF6F0] px-1.5 sm:px-2 py-0.5 rounded text-[10px] whitespace-nowrap">第 {ev.month} 個月</span>
                     <span className="font-bold flex items-center gap-1">
                       {ev.type === 'repayment' ? (
                         <span className="text-[#CD7A70] bg-[#CD7A70]/10 px-1.5 py-0.5 rounded">
                           提早還款 {ev.targetDebtId && ev.targetDebtId !== 'all' ? `(${debts.find(d => d.id === ev.targetDebtId)?.name || '指定'})` : ''}
                         </span>
                       ) : (
                         <span className="text-[#5C5248] truncate max-w-[80px] sm:max-w-none">{ev.name || '未命名收支'}</span>
                       )}
                     </span>
                   </div>
                   <div className="flex items-center gap-3">
                     <span className={cn("font-bold font-mono tracking-tighter whitespace-nowrap text-right", ev.type === 'repayment' ? "text-[#CD7A70]" : (ev.amount >= 0 ? "text-[#769C7C]" : "text-[#CD7A70]"))}>
                       {ev.type === 'repayment' ? '-' : (ev.amount >= 0 ? '+' : '')}{ev.amount >= 10000 || ev.amount <= -10000 ? `${(ev.amount / 10000).toFixed(1).replace('.0','')}萬` : formatCurrency(ev.amount)}
                     </span>
                     <button onClick={() => handleDeleteEvent(ev.id)} className="text-[#82786D]/50 hover:text-[#CD7A70] p-1 bg-black/5 rounded">
                       <Trash2 size={12} />
                     </button>
                   </div>
                 </div>
               ))
             ) : (
               <div className="text-center py-6 text-[#82786D]/60 text-xs font-bold bg-white/40 rounded-xl border border-black/5 border-dashed h-full flex items-center justify-center">
                 此情境目前無特定事件
               </div>
             )}
           </div>

           <div className="pt-3 border-t border-black/5 mt-auto">
              <label className="block text-[10px] font-bold text-[#82786D]/80 uppercase tracking-widest mb-2 flex items-center justify-between">
                <span>全局模擬期間 (月)</span>
                <span className="text-[#5C5248] font-mono text-sm">{months} 個月</span>
              </label>
              <input 
                type="range" 
                min="6" 
                max="120" 
                step="6" 
                value={months} 
                onChange={e => setMonths(Number(e.target.value))} 
                className="w-full accent-[#5C5248]"
              />
           </div>
        </div>

      </div>

      <div className="h-80 w-full mb-6">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="colorAssets" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#769C7C" stopOpacity={0.15}/>
                <stop offset="95%" stopColor="#769C7C" stopOpacity={0}/>
              </linearGradient>
              <linearGradient id="colorDebt" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#CD7A70" stopOpacity={0.15}/>
                <stop offset="95%" stopColor="#CD7A70" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EAE4DB" />
            <XAxis 
              dataKey="dateLabel" 
              axisLine={false} 
              tickLine={false} 
              tick={{ fontSize: 10, fill: '#82786D' }} 
              minTickGap={30} 
            />
            <YAxis 
              axisLine={false} 
              tickLine={false} 
              tick={{ fontSize: 10, fill: '#82786D' }} 
              tickFormatter={(value) => value >= 10000 ? `${(value / 10000).toFixed(0)}萬` : value <= -10000 ? `${(value / 10000).toFixed(0)}萬` : value}
              width={55}
            />
            <Tooltip 
              contentStyle={{ backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: '16px', border: '1px solid rgba(0,0,0,0.05)', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', padding: '16px' }}
              itemStyle={{ fontWeight: 'bold', fontSize: '13px', paddingTop: '4px' }}
              labelStyle={{ color: '#82786D', fontSize: '12px', marginBottom: '8px', borderBottom: '1px solid rgba(0,0,0,0.05)', paddingBottom: '4px' }}
              formatter={(value: number, name: string) => {
                if (name === `assets_${activeScenario.id}`) return [`NT$${value.toLocaleString()}`, '🏦 當前情境 預估資產'];
                if (name === `debt_${activeScenario.id}`) return [`NT$${value.toLocaleString()}`, '💳 當前情境 預估負債'];
                
                // For Net Worth lines
                const sc = scenarios.find(s => `netWorth_${s.id}` === name);
                if (sc) {
                  return [`NT$${value.toLocaleString()}`, `✨ [${sc.name}] 淨資產預估`];
                }
                
                return [value, name];
              }}
              labelFormatter={(label) => `時間: ${label}`}
            />
            
            <ReferenceLine y={0} stroke="#82786D" strokeOpacity={0.4} />
            
            {/* Show background active areas */}
            <Area 
              type="monotone" 
              dataKey={`assets_${activeScenario.id}`}
              name={`assets_${activeScenario.id}`}
              stroke="#769C7C" 
              strokeWidth={1}
              strokeDasharray="4 4"
              fillOpacity={1} 
              fill="url(#colorAssets)" 
              activeDot={{ r: 4, strokeWidth: 0 }}
            />
            <Area 
              type="monotone" 
              dataKey={`debt_${activeScenario.id}`}
              name={`debt_${activeScenario.id}`}
              stroke="#CD7A70" 
              strokeWidth={1}
              strokeDasharray="4 4"
              fillOpacity={1} 
              fill="url(#colorDebt)" 
              activeDot={{ r: 4, strokeWidth: 0 }}
            />

            {/* Show all Net Worth curves for comparison */}
            {scenarios.map(sc => (
              <Line 
                key={`line_${sc.id}`}
                type="monotone" 
                dataKey={`netWorth_${sc.id}`}
                name={`netWorth_${sc.id}`}
                stroke={sc.color} 
                strokeWidth={sc.id === activeScenarioId ? 4 : 2}
                strokeOpacity={sc.id === activeScenarioId ? 1 : 0.4}
                dot={false}
                activeDot={{ r: 6, fill: sc.color, strokeWidth: 0 }}
                style={{ zIndex: sc.id === activeScenarioId ? 10 : 1 }}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Comparative Summary */}
      <div className="bg-white/40 p-4 rounded-xl border border-black/5 mb-6">
        <h3 className="text-xs font-bold text-[#82786D] mb-4 flex items-center gap-1.5"><Landmark size={14}/> 各情境 {months} 個月後狀況比較總覽</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {scenarios.map((sc, idx) => {
             const finalNetWorth = chartData[chartData.length - 1][`netWorth_${sc.id}`];
             const finalAssets = chartData[chartData.length - 1][`assets_${sc.id}`];
             const finalDebt = chartData[chartData.length - 1][`debt_${sc.id}`];
             const maxNetWorth = Math.max(...scenarios.map(s => chartData[chartData.length - 1][`netWorth_${s.id}`]));
             const isHighest = scenarios.length > 1 && finalNetWorth === maxNetWorth;
             
             return (
              <div 
                key={sc.id} 
                onClick={() => setActiveScenarioId(sc.id)}
                className={cn(
                  "p-4 rounded-[16px] border transition-all cursor-pointer relative overflow-hidden group",
                  activeScenarioId === sc.id ? "bg-white shadow-[0_4px_20px_rgba(0,0,0,0.04)] border-black/10 scale-[1.02]" : "bg-white/50 border-black/5 hover:bg-white"
                )}
              >
                <div className="absolute top-0 left-0 w-1.5 h-full transition-all group-hover:w-2" style={{ backgroundColor: sc.color }}></div>
                <div className="pl-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-[#5C5248] truncate pr-2" style={{ color: activeScenarioId === sc.id ? sc.color : '#5C5248' }}>{sc.name}</span>
                    {isHighest && <span className="text-[9px] bg-[#D1A066]/10 border border-[#D1A066]/20 text-[#D1A066] px-1.5 py-0.5 rounded font-extrabold whitespace-nowrap">最高淨資產</span>}
                  </div>
                  
                  <div className="space-y-1 mb-2">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] text-[#82786D]">期末資產</span>
                      <span className="font-mono text-xs font-bold text-[#769C7C]">{formatCurrency(finalAssets)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] text-[#82786D]">期末負債</span>
                      <span className="font-mono text-xs font-bold text-[#CD7A70]">{formatCurrency(finalDebt)}</span>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-black/5 flex justify-between items-end">
                    <span className="text-[10px] font-bold text-[#82786D]">期末淨資產預估</span>
                    <span className="text-lg font-mono font-extrabold" style={{ color: sc.color }}>
                      {formatCurrency(finalNetWorth)}
                    </span>
                  </div>
                </div>
              </div>
             )
          })}
        </div>
      </div>

      {/* Detailed Table (Active Scenario) */}
      <div className="bg-white/60 p-4 sm:p-5 rounded-2xl border border-black/5 overflow-hidden shadow-sm">
        <h3 className="text-sm font-bold text-[#5C5248] flex items-center gap-2 mb-4">
          <Calendar size={16} className="text-[#87A2B4]" />
          <span>「{activeScenario.name}」每月現金流明細</span>
        </h3>
        <div className="overflow-x-auto scrollbar-hide">
          <table className="w-full text-left min-w-[800px] border-collapse">
            <thead>
              <tr className="border-b border-black/10 text-[10px] uppercase tracking-widest text-[#82786D]">
                <th className="py-2 px-2 font-bold whitespace-nowrap">月份</th>
                <th className="py-2 px-2 font-bold whitespace-nowrap text-right">期初淨現金</th>
                <th className="py-2 px-2 font-bold whitespace-nowrap text-right">月收支餘裕</th>
                <th className="py-2 px-2 font-bold whitespace-nowrap text-right">特殊收支</th>
                <th className="py-2 px-2 font-bold whitespace-nowrap text-right text-[#CD7A70]">還款總額</th>
                <th className="py-2 px-2 font-bold whitespace-nowrap text-right text-[#CD7A70]">產生利息</th>
                <th className="py-2 px-2 font-bold whitespace-nowrap text-right">期末淨資產</th>
              </tr>
            </thead>
            <tbody>
              {activeScenarioDetails && activeScenarioDetails.slice(1).map((row, i) => { // slice(1) to skip Month 0 (Current State initial prep)
                const surplus = row.income - row.expense;
                const totalRepay = row.regularDebtPayment + row.eventsRepayment;
                return (
                  <tr key={i} className="border-b border-black/5 hover:bg-white/50 transition-colors text-xs font-mono text-[#5C5248]">
                    <td className="py-2 px-2 whitespace-nowrap font-sans text-[11px] font-bold text-[#82786D]">第 {row.month} 個月</td>
                    <td className="py-2 px-2 text-right">{formatCurrency(row.startingAssets)}</td>
                    <td className={cn("py-2 px-2 text-right", surplus >= 0 ? "text-[#769C7C]" : "text-[#CD7A70]")}>
                      {surplus > 0 ? '+' : ''}{formatCurrency(surplus)}
                    </td>
                    <td className={cn("py-2 px-2 text-right", row.eventsCashflow > 0 ? "text-[#769C7C] font-bold" : row.eventsCashflow < 0 ? "text-[#CD7A70] font-bold" : "text-[#82786D]/40")}>
                      {row.eventsCashflow !== 0 ? formatCurrency(row.eventsCashflow) : '-'}
                    </td>
                    <td className={cn("py-2 px-2 text-right", totalRepay > 0 ? "text-[#CD7A70] font-bold" : "text-[#82786D]/40")}>
                      {totalRepay > 0 ? `-${formatCurrency(totalRepay)}` : '-'}
                      {row.eventsRepayment > 0 && <span className="font-sans text-[9px] ml-1 bg-[#CD7A70]/10 px-1 rounded">(含提早)</span>}
                    </td>
                    <td className={cn("py-2 px-2 text-right", row.interestAdded > 0 ? "text-[#D1A066]" : "text-[#82786D]/40")}>
                      {row.interestAdded > 0 ? formatCurrency(row.interestAdded) : '-'}
                    </td>
                    <td className="py-2 px-2 text-right font-bold text-[13px]">{formatCurrency(row.netWorth)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
