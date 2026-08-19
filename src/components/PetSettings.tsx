import { useState, useEffect, useRef } from 'react';
import { PetSettings as PetSettingsType, PetSize, PetEdge, PetAutoCollapse, PetAnimationLevel } from '../lib/petSettings';
import { FinancePet, isNativePetAvailable, PetStatus, PetDebugInfo } from '../lib/petBridge';
import { createBackup, validateBackup, applyBackup, FinanceBackup, BackupValidation } from '../lib/backup';
import { CATEGORY_DEFS } from '../lib/categoryCatalog';
import { loadPinnedCategoryIds } from '../lib/quickCategories';
import { STORAGE_KEYS, saveJSON } from '../lib/storage';
import { cn } from '../lib/utils';

interface PetSettingsProps {
  settings: PetSettingsType;
  onChange: (settings: PetSettingsType) => void;
}

function OptionRow<T extends string>({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onSelect: (v: T) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 border-b border-black/5 last:border-b-0">
      <span className="text-sm font-bold text-[#5C5248] shrink-0">{label}</span>
      <div className="flex bg-[#EAE4DB]/50 p-1 rounded-xl border border-black/5">
        {options.map(opt => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onSelect(opt.value)}
            className={cn(
              'px-3 py-1.5 text-xs font-bold rounded-lg transition-all whitespace-nowrap',
              value === opt.value ? 'bg-white text-[#5C5248] shadow-sm' : 'text-[#82786D] hover:text-[#5C5248]',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass rounded-[24px] p-6">
      <h3 className="font-extrabold text-[#5C5248] mb-2">{title}</h3>
      {children}
    </div>
  );
}

export default function PetSettings({ settings, onChange }: PetSettingsProps) {
  const native = isNativePetAvailable();
  const [status, setStatus] = useState<PetStatus | null>(null);
  const [debugInfo, setDebugInfo] = useState<PetDebugInfo | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pinned, setPinned] = useState<string[]>(() => loadPinnedCategoryIds());
  const [importPreview, setImportPreview] = useState<{ backup: FinanceBackup; validation: BackupValidation } | null>(null);
  const [importError, setImportError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshStatus = async () => {
    try {
      setStatus(await FinancePet.getPetStatus());
      setDebugInfo(await FinancePet.getDebugInfo());
    } catch {
      setStatus(null);
    }
  };

  useEffect(() => {
    if (native) refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native]);

  const update = (patch: Partial<PetSettingsType>) => {
    const next = { ...settings, ...patch };
    onChange(next);
    if (native) FinancePet.setPetSettings({ settings: next }).catch(() => {});
  };

  const togglePinned = (id: string) => {
    const next = pinned.includes(id) ? pinned.filter(p => p !== id) : [...pinned, id].slice(0, 4);
    setPinned(next);
    saveJSON(STORAGE_KEYS.pinnedCategories, next);
  };

  const startPetFlow = async () => {
    setBusy(true);
    setError('');
    try {
      let { granted } = await FinancePet.canDrawOverlays();
      if (!granted) {
        ({ granted } = await FinancePet.requestOverlayPermission());
      }
      if (!granted) {
        setError('尚未取得懸浮視窗權限。FinTracker 本體仍可正常使用，隨時可以再試一次。');
        return;
      }
      const nextSettings = { ...settings, enabled: true };
      const result = await FinancePet.startPet({ settings: nextSettings });
      if (result.started) {
        onChange(nextSettings);
        setOnboardingStep(3); // 成功 → 教學步驟
      } else {
        setError(`桌寵啟動失敗（${result.reason ?? '未知原因'}），請再試一次。`);
      }
    } finally {
      setBusy(false);
      refreshStatus();
    }
  };

  const stopPetFlow = async () => {
    setBusy(true);
    try {
      await FinancePet.stopPet();
      onChange({ ...settings, enabled: false });
    } finally {
      setBusy(false);
      refreshStatus();
    }
  };

  // ---- backup / restore ----

  const exportData = () => {
    const backup = createBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fintracker-backup-${backup.exportedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImportFile = async (file: File) => {
    setImportError('');
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const validation = validateBackup(data);
      if (!validation.ok) {
        setImportError(`備份檔驗證失敗：${validation.errors.join('、')}`);
        return;
      }
      setImportPreview({ backup: data as FinanceBackup, validation });
    } catch {
      setImportError('無法讀取檔案：不是有效的 JSON');
    }
  };

  const doImport = (mode: 'merge' | 'replace') => {
    if (!importPreview) return;
    applyBackup(importPreview.backup, mode);
    setImportPreview(null);
    // 匯入前已自動寫入安全備份 (finance_backup_before_import)；重新載入讓所有狀態一致
    window.location.reload();
  };

  const onboardingSteps = [
    {
      title: `認識${settings.petName || '小財'} 🐣`,
      body: `${settings.petName || '小財'}是你的財務小夥伴。開啟後牠會浮在手機畫面上陪著你——切到 LINE、Chrome 都還在。`,
      action: '下一步',
    },
    {
      title: '為什麼需要權限？',
      body: '「顯示在其他應用程式上層」讓桌寵能浮在其他 App 上。FinTracker 只用這個權限顯示桌寵，不讀取其他 App 的內容。',
      action: '下一步',
    },
    {
      title: '開啟權限',
      body: '接下來會前往 Android 設定，允許 FinTracker 顯示在上層，回來後桌寵就會出現。',
      action: busy ? '啟動中…' : '開啟桌寵',
    },
    {
      title: '完成！試試看 ✨',
      body: '按住桌寵可以拖曳、放開會吸附螢幕邊緣。點一下桌寵，記下你的第一筆吧！',
      action: '開始使用',
    },
  ];

  return (
    <div className="max-w-xl mx-auto space-y-6">
      {/* 主開關 */}
      <div className="glass rounded-[24px] p-6 space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#FFE9A8] to-[#F7C873] flex items-center justify-center text-3xl shadow-inner border border-white/60">
            🐣
          </div>
          <div className="flex-1">
            <h2 className="font-extrabold text-[#5C5248] text-xl">{settings.petName || '小財'}桌寵</h2>
            <p className="text-sm text-[#82786D] font-bold">
              {native
                ? settings.enabled
                  ? `狀態：${status?.running ? '正在陪你' : '服務未執行（可重新開啟）'}`
                  : '浮在手機畫面上，點一下就能快速記帳'
                : '桌寵需要 Android App 版本（Capacitor），網頁版可先預覽設定'}
            </p>
          </div>
        </div>

        {settings.enabled ? (
          <button
            type="button"
            onClick={stopPetFlow}
            disabled={busy || !native}
            className="w-full py-3.5 rounded-2xl font-extrabold bg-white border border-black/5 text-[#CD7A70] hover:bg-[#CD7A70]/5 transition-all active:scale-[0.98] disabled:opacity-50"
          >
            關閉桌寵
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setOnboardingStep(0);
              setShowOnboarding(true);
            }}
            disabled={busy || !native}
            className="w-full py-3.5 rounded-2xl font-extrabold bg-[#87A2B4] text-white hover:bg-[#87A2B4]/90 transition-all active:scale-[0.98] disabled:opacity-50"
          >
            開啟桌寵
          </button>
        )}
        {error && <p className="text-sm font-bold text-[#CD7A70]">{error}</p>}
      </div>

      {/* 桌寵外觀 */}
      <Section title="桌寵">
        <OptionRow<PetSize>
          label="大小"
          value={settings.size}
          options={[
            { value: 'small', label: '小' },
            { value: 'medium', label: '中' },
            { value: 'large', label: '大' },
          ]}
          onSelect={v => update({ size: v })}
        />
        <OptionRow<PetEdge>
          label="停靠"
          value={settings.edge}
          options={[
            { value: 'left', label: '左' },
            { value: 'right', label: '右' },
            { value: 'auto', label: '自動' },
          ]}
          onSelect={v => update({ edge: v })}
        />
        <OptionRow<PetAutoCollapse>
          label="自動收邊"
          value={settings.autoCollapse}
          options={[
            { value: '5s', label: '5 秒' },
            { value: '15s', label: '15 秒' },
            { value: 'off', label: '永不' },
          ]}
          onSelect={v => update({ autoCollapse: v })}
        />
        <OptionRow<PetAnimationLevel>
          label="動畫"
          value={settings.animation}
          options={[
            { value: 'full', label: '完整' },
            { value: 'simple', label: '簡化' },
          ]}
          onSelect={v => update({ animation: v })}
        />
        <div className="flex items-center justify-between gap-3 py-3">
          <span className="text-sm font-bold text-[#5C5248] shrink-0">桌寵名稱</span>
          <input
            type="text"
            value={settings.petName}
            maxLength={8}
            onChange={e => update({ petName: e.target.value })}
            className="w-32 px-3 py-1.5 text-sm text-right bg-white/70 border border-black/5 text-[#5C5248] font-bold rounded-xl outline-none focus:ring-2 focus:ring-[#87A2B4]/40"
          />
        </div>
      </Section>

      {/* 快速記帳 */}
      <Section title="快速記帳">
        <OptionRow
          label="預設類型"
          value={settings.defaultType}
          options={[
            { value: 'expense', label: '支出' },
            { value: 'income', label: '收入' },
          ]}
          onSelect={v => update({ defaultType: v as 'expense' | 'income' })}
        />
        <OptionRow
          label="快速模式"
          value={settings.fastMode ? 'fast' : 'confirm'}
          options={[
            { value: 'confirm', label: '確認後新增' },
            { value: 'fast', label: '點分類直接新增' },
          ]}
          onSelect={v => update({ fastMode: v === 'fast' })}
        />
        <div className="py-3">
          <p className="text-sm font-bold text-[#5C5248] mb-2">釘選常用分類（最多 4 個，會排在最前面）</p>
          <div className="flex flex-wrap gap-2">
            {CATEGORY_DEFS.expense.map(def => (
              <button
                key={def.id}
                type="button"
                onClick={() => togglePinned(def.id)}
                className={cn(
                  'px-3 py-1.5 text-xs font-bold rounded-full border transition-all',
                  pinned.includes(def.id)
                    ? 'bg-[#87A2B4]/15 border-[#87A2B4] text-[#5C5248]'
                    : 'bg-white/60 border-black/5 text-[#82786D] hover:bg-white',
                )}
              >
                {def.emoji} {def.label}
              </button>
            ))}
          </div>
        </div>
      </Section>

      {/* 隱私 */}
      <Section title="隱私">
        <OptionRow
          label="桌寵訊息"
          value={settings.showAmounts ? 'show' : 'hide'}
          options={[
            { value: 'hide', label: '隱藏金額' },
            { value: 'show', label: '顯示今日支出' },
          ]}
          onSelect={v => update({ showAmounts: v === 'show' })}
        />
        <OptionRow
          label="App 鎖定"
          value={settings.appLock ? 'on' : 'off'}
          options={[
            { value: 'off', label: '關' },
            { value: 'on', label: '生物辨識 / 裝置密碼' },
          ]}
          onSelect={v => update({ appLock: v === 'on' })}
        />
        <p className="text-xs text-[#82786D] font-bold pt-2">
          App 鎖定只保護完整財務資料；點桌寵快速記帳不需要驗證。
        </p>
      </Section>

      {/* 資料 */}
      <Section title="資料">
        <div className="flex gap-3 py-2">
          <button
            type="button"
            onClick={exportData}
            className="flex-1 py-3 rounded-2xl font-bold bg-white border border-black/5 text-[#5C5248] hover:bg-[#FAF6F0] transition-all active:scale-[0.98]"
          >
            匯出財務資料
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 py-3 rounded-2xl font-bold bg-white border border-black/5 text-[#5C5248] hover:bg-[#FAF6F0] transition-all active:scale-[0.98]"
          >
            匯入財務資料
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) onImportFile(file);
              e.target.value = '';
            }}
          />
        </div>
        {importError && <p className="text-sm font-bold text-[#CD7A70]">{importError}</p>}
        <p className="text-xs text-[#82786D] font-bold">
          匯出為 JSON 檔（含交易、預算、目標、負債、定期與設定）。匯入取代前會自動建立安全備份。
        </p>
      </Section>

      {/* 進階：權限健康 + 診斷 */}
      {native && (
        <Section title="進階">
          <div className="space-y-2 py-2 text-sm font-bold text-[#5C5248]">
            <div className="flex justify-between">
              <span>懸浮視窗權限</span>
              <span>{status?.permissionGranted ? '✓ 已允許' : '✕ 未允許'}</span>
            </div>
            <div className="flex justify-between">
              <span>通知權限</span>
              <span>{status?.notificationsGranted === false ? '✕ 未允許' : '✓ 已允許'}</span>
            </div>
            <div className="flex justify-between">
              <span>桌寵服務</span>
              <span>{status?.running ? 'Running' : 'Stopped'}</span>
            </div>
            <div className="flex justify-between">
              <span>待同步筆數</span>
              <span>{status?.pendingCount ?? 0}</span>
            </div>
            {debugInfo && (
              <div className="flex justify-between text-[#82786D]">
                <span>上次同步</span>
                <span>{debugInfo.lastSyncAt ? new Date(debugInfo.lastSyncAt).toLocaleString() : '—'}</span>
              </div>
            )}
            {debugInfo && (
              <div className="flex justify-between text-[#82786D]">
                <span>位置</span>
                <span>
                  {debugInfo.edge} ({debugInfo.positionX.toFixed(2)}, {debugInfo.positionY.toFixed(2)})
                </span>
              </div>
            )}
          </div>
          {settings.enabled && status && !status.permissionGranted && (
            <button
              type="button"
              onClick={startPetFlow}
              className="w-full mt-2 py-3 rounded-2xl font-bold bg-[#87A2B4] text-white hover:bg-[#87A2B4]/90 transition-all active:scale-[0.98]"
            >
              重新開啟權限
            </button>
          )}
          <button
            type="button"
            onClick={refreshStatus}
            className="w-full mt-2 py-2 text-sm font-bold text-[#82786D] hover:text-[#5C5248] transition-colors"
          >
            重新整理狀態
          </button>
        </Section>
      )}

      {/* 匯入確認：合併 / 取代 / 取消 */}
      {importPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-[#FAF6F0] w-full max-w-sm rounded-[28px] shadow-2xl p-7 space-y-4 animate-in zoom-in-95 duration-200">
            <h3 className="font-extrabold text-[#5C5248] text-lg">匯入財務資料</h3>
            <p className="text-sm text-[#82786D] font-bold leading-relaxed">
              備份時間：{importPreview.backup.exportedAt?.slice(0, 19).replace('T', ' ') ?? '未知'}
              <br />
              交易 {importPreview.validation.counts.transactions} 筆、預算 {importPreview.validation.counts.budgets} 項、
              目標 {importPreview.validation.counts.goals} 個、負債 {importPreview.validation.counts.debts} 筆
            </p>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => doImport('merge')}
                className="w-full py-3 rounded-2xl font-extrabold bg-[#87A2B4] text-white hover:bg-[#87A2B4]/90 transition-all active:scale-[0.98]"
              >
                合併（保留現有資料）
              </button>
              <button
                type="button"
                onClick={() => doImport('replace')}
                className="w-full py-3 rounded-2xl font-extrabold bg-white border border-[#CD7A70]/40 text-[#CD7A70] hover:bg-[#CD7A70]/5 transition-all active:scale-[0.98]"
              >
                取代（會先自動備份現有資料）
              </button>
              <button
                type="button"
                onClick={() => setImportPreview(null)}
                className="w-full py-2 text-sm font-bold text-[#82786D] hover:text-[#5C5248] transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Overlay permission onboarding：分步說明，再導向系統設定 */}
      {showOnboarding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-[#FAF6F0] w-full max-w-sm rounded-[28px] shadow-2xl p-8 text-center space-y-5 animate-in zoom-in-95 duration-200">
            <div className="text-6xl">🐣</div>
            <h3 className="font-extrabold text-[#5C5248] text-xl">{onboardingSteps[onboardingStep].title}</h3>
            <p className="text-sm text-[#82786D] font-bold leading-relaxed whitespace-pre-line">
              {onboardingSteps[onboardingStep].body}
            </p>
            <div className="flex justify-center gap-1.5">
              {onboardingSteps.map((_, i) => (
                <span
                  key={i}
                  className={cn('w-2 h-2 rounded-full', i === onboardingStep ? 'bg-[#87A2B4]' : 'bg-[#E2D8C6]')}
                />
              ))}
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (onboardingStep === 2) startPetFlow();
                else if (onboardingStep === 3) setShowOnboarding(false);
                else setOnboardingStep(s => s + 1);
              }}
              className="w-full py-3.5 rounded-2xl font-extrabold bg-[#87A2B4] text-white hover:bg-[#87A2B4]/90 transition-all active:scale-[0.98] disabled:opacity-50"
            >
              {onboardingSteps[onboardingStep].action}
            </button>
            {onboardingStep < 3 && (
              <button
                type="button"
                onClick={() => setShowOnboarding(false)}
                className="w-full py-2 text-sm font-bold text-[#82786D] hover:text-[#5C5248] transition-colors"
              >
                先不要
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
