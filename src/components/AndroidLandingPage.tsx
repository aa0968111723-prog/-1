import AndroidDownloadCard from './AndroidDownloadCard';
import { DOWNLOAD_PAGE_PATH } from '../lib/appRelease';

/**
 * /app/android — the page a QR code or a shared link lands on.
 *
 * Standalone on purpose: it has to make sense to someone who has never opened
 * FinTracker, arriving from a phone, deciding whether to install something
 * that did not come from the Play Store. That means the permissions and the
 * "unknown sources" prompt get explained here, before they hit them, rather
 * than being discovered mid-install.
 */
export default function AndroidLandingPage() {
  return (
    <div className="min-h-screen bg-[#F5F1EA] px-4 py-10">
      <div className="max-w-xl mx-auto space-y-6">
        <header className="text-center space-y-2">
          <h1 className="text-2xl font-extrabold text-[#5C5248]">FinTracker · 小財桌寵</h1>
          <p className="text-sm font-bold text-[#82786D]">
            記帳最難的不是分析，是「記」這個動作本身。小財浮在你的手機畫面上，點一下就記完。
          </p>
        </header>

        <AndroidDownloadCard variant="page" />

        <section className="glass rounded-[24px] p-6 space-y-3">
          <h2 className="font-extrabold text-[#5C5248]">安裝之後會要求什麼權限</h2>
          <p className="text-xs font-bold text-[#82786D] leading-relaxed">
            只有兩個，而且都可以拒絕 —— 拒絕之後 App 本身照樣完整可用，只是沒有浮動桌寵。
          </p>
          <dl className="space-y-3 text-xs font-bold">
            <div>
              <dt className="text-[#5C5248]">顯示在其他應用程式上層</dt>
              <dd className="text-[#82786D] mt-0.5 leading-relaxed">
                這是桌寵能浮在其他 App 上的唯一方法。它只用來畫小財，不會讀取你在其他 App 裡的內容。
              </dd>
            </div>
            <div>
              <dt className="text-[#5C5248]">通知</dt>
              <dd className="text-[#82786D] mt-0.5 leading-relaxed">
                Android 規定常駐服務必須顯示一則通知。那則通知同時提供「記一筆」和「暫停桌寵」。
                不會有行銷推播，也不會催你記帳。
              </dd>
            </div>
            <div>
              <dt className="text-[#5C5248]">麥克風（選用）</dt>
              <dd className="text-[#82786D] mt-0.5 leading-relaxed">
                只有你按下語音記帳那一刻才會啟動，講完就關。不會在背景持續聽。
              </dd>
            </div>
          </dl>
        </section>

        <section className="glass rounded-[24px] p-6 space-y-3">
          <h2 className="font-extrabold text-[#5C5248]">你的錢在哪裡</h2>
          <ul className="space-y-2 text-xs font-bold text-[#82786D] leading-relaxed">
            <li>· 記帳先寫進手機本機，沒有網路照樣記得起來。</li>
            <li>· 登入之後才會同步到雲端；不登入就完全留在這台手機。</li>
            <li>· 同步失敗不等於記帳失敗 —— 帳已經在手機裡，之後會自己補傳。</li>
            <li>· 隨時可以匯出完整 JSON 備份，資料是你的。</li>
          </ul>
        </section>

        <footer className="text-center text-xs font-bold text-[#A79C90] pb-6">
          <a href="/" className="hover:text-[#5C5248] underline">回到 FinTracker</a>
          <span className="mx-2">·</span>
          <span className="font-mono">{DOWNLOAD_PAGE_PATH}</span>
        </footer>
      </div>
    </div>
  );
}
