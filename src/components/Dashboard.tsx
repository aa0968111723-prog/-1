import { useMemo } from 'react';
import { Transaction, Debt, RecurringTransaction, BudgetConfig } from '../types';
import { formatCurrency } from '../lib/formatters';
import { FinanceAnalyticsEngine } from '../lib/financeAnalytics';
import { categoryIdForStored } from '../lib/categoryCatalog';
import { formatMoneyCompact } from '../lib/money';
import { ArrowDownRight, ArrowUpRight, Wallet, TrendingUp, TrendingDown, BellRing, CalendarClock, MailOpen, Activity } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';
import { cn } from '../lib/utils';

interface DashboardProps {
  transactions: Transaction[];
  budgets: Record<string, BudgetConfig>;
  debts: Debt[];
  recurring?: RecurringTransaction[];
}

const COLORS = ['#BAAC92', '#D1A066', '#7D9D81', '#A993A6', '#D28271', '#9DADAE', '#CBA39E', '#8C8276'];

export default function Dashboard({ transactions, budgets, debts = [], recurring = [] }: DashboardProps) {
  /**
   * All of it comes from FinanceAnalyticsEngine now.
   *
   * This used to be ~90 lines of inline filter/reduce here, a second
   * implementation in the pet's display state, and a third wherever the AI
   * decided to compute from raw rows. Three implementations of one calculation
   * is three chances to disagree — and the one that disagrees silently is the
   * AI, because nobody checks its arithmetic. This component now only decides
   * how numbers LOOK, never what they are.
   */
  const {
    balance, expenseData, currentMonthExpenses, trendData,
    totalDebt, netWorth, upcomingRecurring, avgDailySpend, topExpenses,
  } = useMemo(() => {
    const engine = new FinanceAnalyticsEngine({ transactions, budgets, debts, recurring });

    const allTime = engine.getAllTimeTotals();
    const debtSummary = engine.getDebtSummary();
    const monthBreakdown = engine.getCategoryBreakdown('month');

    return {
      balance: allTime.balance,
      expenseData: engine.getAllTimeCategoryTotals(),
      // Keyed by BOTH the canonical label and the stable category id.
      // Budget keys are whatever label the budget was created with, including
      // legacy English ones like 'Loan Repayments' that BudgetSettings still
      // offers; keying only by the engine's canonical label made those rows
      // report 已花 0 against a real spend.
      currentMonthExpenses: Object.fromEntries(
        monthBreakdown.flatMap(c => [[c.label, c.amount], [c.categoryId, c.amount]] as const),
      ) as Record<string, number>,
      trendData: engine.getMonthlyTrend(6),
      totalDebt: debtSummary.totalOutstanding,
      netWorth: allTime.balance - debtSummary.totalOutstanding,
      avgDailySpend: engine.getAverageDailySpend(),
      topExpenses: engine.getTopExpenses(3),
      upcomingRecurring: engine.getUpcomingRecurring(3),
    };
  }, [transactions, budgets, debts, recurring]);

  return (
    <div className="space-y-6">
      {/* Daily Digest (Upcoming Recurring Notifications) */}
      {upcomingRecurring.length > 0 && (
        <div className="bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 p-5 rounded-2xl animate-in fade-in slide-in-from-top-4 relative overflow-hidden backdrop-blur-md">
          <div className="absolute -top-4 -right-4 p-4 opacity-10 pointer-events-none rotate-12">
            <MailOpen size={120} className="text-indigo-400" />
          </div>
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-indigo-500/20 rounded-xl">
                <BellRing className="text-indigo-400 animate-pulse" size={20} />
              </div>
              <h4 className="text-[#A08BA6] font-bold text-sm tracking-widest uppercase">
                 每日摘要 Daily Digest
              </h4>
              <span className="text-xs text-[#A08BA6]/80 font-bold ml-auto">
                 3 天內即將發生的定期收支
              </span>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {upcomingRecurring.map(rt => (
                 <div key={rt.id} className="flex flex-col justify-between bg-[#EAE4DB]/50 p-4 rounded-xl border border-black/5 gap-2 hover:bg-[#EAE4DB]/80 transition-colors shadow-sm">
                    <div className="flex items-start justify-between mb-2">
                       <span className="text-[#5C5248] font-bold truncate" title={rt.note || rt.category}>{rt.note || rt.category}</span>
                       <span className={cn("text-[10px] px-2 py-1 rounded-md font-bold uppercase tracking-widest whitespace-nowrap ml-2", 
                         rt.daysLeft === 0 ? "bg-[#CD7A70] text-white shadow-sm animate-pulse" : "bg-[#A08BA6]/20 text-[#A08BA6]"
                       )}>
                         {rt.daysLeft === 0 ? '⚠️ 今天' : `${rt.daysLeft} 天後`}
                       </span>
                    </div>
                    <div className="flex items-end justify-between">
                       <span className="text-[#82786D]/60 font-bold text-[10px] uppercase">{rt.nextDate}</span>
                       <div className={cn("font-mono font-extrabold text-lg", rt.type === 'income' ? 'text-[#769C7C]' : 'text-[#CD7A70]')}>
                          {rt.type === 'income' ? '+' : '-'}{formatCurrency(rt.amount)}
                       </div>
                    </div>
                 </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Net Worth Card (Balance - Debts) */}
        <div className="glass p-8 flex flex-col justify-center relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-6 opacity-[0.03] group-hover:opacity-5 transition-opacity text-[#5C5248]">
            <Wallet size={120} />
          </div>
          <div className="relative z-10">
            <div className="flex items-center gap-2 text-[#82786D] mb-2 uppercase tracking-[0.15em] text-xs font-bold">
              <span>真實淨資產 (Net Worth)</span>
            </div>
            <div className={cn("text-[40px] md:text-[48px] font-extrabold tracking-tighter", netWorth < 0 ? "text-[#CD7A70]" : "text-[#769C7C]")}>
              {formatCurrency(netWorth)}
            </div>
            <div className="mt-2 flex items-center gap-6 text-sm font-bold">
               <div className="flex flex-col">
                  <span className="text-[#82786D]/60 text-[10px] uppercase">現金餘額</span>
                  <span className="text-[#5C5248] font-mono font-extrabold">{formatCurrency(balance)}</span>
               </div>
               <div className="flex flex-col">
                  <span className="text-[#CD7A70]/60 text-[10px] uppercase">總負債</span>
                  <span className="text-[#CD7A70] font-mono font-extrabold">-{formatCurrency(totalDebt)}</span>
               </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {/* Income Card */}
          <div className="glass p-5 flex flex-col justify-center flex-1 relative overflow-hidden">
             <div className="absolute top-4 right-4 text-[#769C7C]/20"><TrendingUp size={40} /></div>
             <div className="relative z-10">
               <div className="flex items-center gap-2 text-[#82786D] mb-2 text-[10px] font-bold uppercase tracking-wider">
                 <span>本月總收入</span>
               </div>
               <div className="text-2xl font-extrabold tracking-tight text-[#769C7C]">
                 +{formatCurrency(trendData[trendData.length-1].income)}
               </div>
             </div>
          </div>

          {/* Expense & Savings Rate Card */}
          <div className="flex gap-4 flex-1">
            <div className="glass p-5 flex flex-col justify-center flex-1 relative overflow-hidden">
               <div className="absolute top-4 right-4 text-[#CD7A70]/20"><TrendingDown size={40} /></div>
               <div className="relative z-10">
                 <div className="flex items-center gap-2 text-[#82786D] mb-2 text-[10px] font-bold uppercase tracking-wider">
                   <span>本月總支出</span>
                 </div>
                 <div className="text-xl md:text-2xl font-extrabold tracking-tight text-[#CD7A70]">
                   -{formatCurrency(trendData[trendData.length-1].expense)}
                 </div>
               </div>
            </div>
            
            <div className="glass p-5 flex flex-col justify-center flex-1 relative overflow-hidden bg-gradient-to-br from-[#A08BA6]/10 to-transparent">
               <div className="absolute top-4 right-4 text-[#A08BA6]/20"><Activity size={40} /></div>
               <div className="relative z-10">
                 <div className="flex items-center gap-2 text-[#A08BA6]/80 mb-2 text-[10px] font-bold uppercase tracking-wider">
                   <span>本月日均支出</span>
                 </div>
                 <div className="text-xl md:text-2xl font-extrabold tracking-tight text-[#A08BA6]">
                   {formatCurrency(avgDailySpend)}
                 </div>
               </div>
            </div>
          </div>
        </div>
      </div>

      {/* Top Expenses this month */}
      {topExpenses.length > 0 && (
        <div className="glass p-6">
          <h3 className="text-lg font-bold text-[#5C5248] mb-4 flex items-center gap-2">
            <TrendingDown className="text-[#CD7A70]" size={20} /> 本月最大筆花費
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {topExpenses.map((tx, idx) => (
              <div key={tx.id} className="bg-white/50 border border-black/5 rounded-2xl p-4 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-[#82786D] mb-1">
                    <span className="bg-[#CD7A70]/10 text-[#CD7A70] px-1.5 py-0.5 rounded mr-2">Top {idx + 1}</span>
                    {tx.category}
                  </div>
                  <div className="text-sm font-bold text-[#5C5248] truncate max-w-[120px]" title={tx.note || '無備註'}>{tx.note || '無備註'}</div>
                </div>
                <div className="text-[#CD7A70] font-extrabold whitespace-nowrap">
                  {formatCurrency(tx.amount)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trend Chart (Cashflow) */}
      <div className="glass p-6">
        <h3 className="text-lg font-bold text-[#5C5248] mb-6 flex items-center gap-2">
          <TrendingUp className="text-[#87A2B4]" size={20} /> 現金流趨勢 (近半年)
        </h3>
        <div className="h-[250px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trendData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }} barGap={2} barSize={20}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EAE4DB" vertical={false} />
              <XAxis dataKey="name" stroke="#82786D" fontSize={10} tickMargin={10} />
              <YAxis stroke="#82786D" fontSize={10} tickFormatter={(val) => formatMoneyCompact(val)} width={60} />
              <Tooltip 
                cursor={{ fill: 'rgba(180,170,160,0.05)' }}
                contentStyle={{ backgroundColor: 'rgba(255, 255, 255, 0.9)', backdropFilter: 'blur(10px)', border: '1px solid rgba(230, 225, 215, 0.8)', borderRadius: '12px' }}
                itemStyle={{ color: '#5C5248', fontSize: '12px', fontWeight: 'bold' }}
                formatter={(val: number) => formatCurrency(val)}
              />
              <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
              <Bar dataKey="income" name="收入" fill="#769C7C" radius={[4, 4, 0, 0]} />
              <Bar dataKey="expense" name="支出" fill="#CD7A70" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Budget Execution Details */}
      {Object.keys(budgets).length > 0 && (
        <div className="glass p-6">
          <h3 className="text-lg font-bold text-[#5C5248] mb-6 flex items-center gap-2">
            <Wallet className="text-[#87A2B4]" size={20} /> 本月預算執行細節
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Object.entries(budgets).map(([category, config]) => {
              // Resolve through the id too, so a budget on a legacy label
              // still finds the spend the engine folded into one category.
              const spent = currentMonthExpenses[category] ?? currentMonthExpenses[categoryIdForStored(category)] ?? 0;
              const amount = config.amount;
              const percentage = Math.min((spent / amount) * 100, 100);
              const isOver = spent > amount;
              const isNear = percentage > config.alertThreshold && !isOver;

              return (
                <div key={category} className="bg-white/40 p-4 rounded-2xl border border-black/5 shadow-sm space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-[#5C5248]">{category}</span>
                    <span className={cn(
                      "text-xs px-2 py-0.5 rounded-md font-bold tracking-wider",
                      isOver ? "bg-[#CD7A70]/10 text-[#CD7A70]" : 
                      isNear ? "bg-[#D1A066]/10 text-[#D1A066]" : "bg-[#769C7C]/10 text-[#769C7C]"
                    )}>
                      {isOver ? "超支" : isNear ? "快超支" : "健康"}
                    </span>
                  </div>
                  <div className="flex justify-between items-end text-sm">
                    <div className="flex flex-col">
                      <span className="text-[10px] text-[#82786D] uppercase">已花費</span>
                      <span className="font-mono font-extrabold text-[#5C5248]">{formatCurrency(spent)}</span>
                    </div>
                    <div className="text-[10px] text-[#82786D] font-mono">
                      / {formatCurrency(amount)}
                    </div>
                  </div>
                  <div className="h-2 w-full bg-[#EAE4DB] rounded-full overflow-hidden">
                    <div 
                      className={cn(
                        "h-full rounded-full transition-all duration-500",
                        isOver ? "bg-[#CD7A70]" : isNear ? "bg-[#D1A066]" : "bg-[#769C7C]"
                      )}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                  {isOver && (
                    <p className="text-[10px] font-bold text-[#CD7A70] mt-1">
                      超支 {formatCurrency(spent - amount)}
                    </p>
                  )}
                  {!isOver && (
                    <p className="text-[10px] font-bold text-[#769C7C] mt-1">
                      剩餘 {formatCurrency(amount - Math.max(spent, 0))}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {expenseData.length > 0 && (
        <div className="glass p-6">
          <h3 className="text-lg font-bold text-[#5C5248] mb-6">各項支出佔比</h3>
          <div className="h-[250px] w-full flex items-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={expenseData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={2}
                  dataKey="value"
                  stroke="none"
                >
                  {expenseData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip 
                  formatter={(value: number) => formatCurrency(value)}
                  contentStyle={{ backgroundColor: 'rgba(255, 255, 255, 0.9)', backdropFilter: 'blur(10px)', border: '1px solid rgba(230,225,215,0.8)', borderRadius: '12px', color: '#5C5248' }}
                  itemStyle={{ color: '#5C5248', fontWeight: 'bold' }}
                />
              </PieChart>
            </ResponsiveContainer>
            
            {/* Custom Legend */}
            <div className="w-1/2 flex flex-col justify-center space-y-3 px-4">
              {expenseData.slice(0, 5).map((entry, index) => (
                <div key={entry.name} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div 
                      className="w-3 h-3 rounded-full" 
                      style={{ backgroundColor: COLORS[index % COLORS.length] }} 
                    />
                    <span className="text-white/80">{entry.name}</span>
                  </div>
                  <span className="font-medium text-white">{formatCurrency(entry.value)}</span>
                </div>
              ))}
              {expenseData.length > 5 && (
                <div className="text-sm text-white/50 pl-5">
                  還有 {expenseData.length - 5} 個分類
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
