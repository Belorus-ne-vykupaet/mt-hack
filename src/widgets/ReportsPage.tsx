import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight, Bot, CalendarDays, Clock3, FileText, RefreshCw } from "lucide-react";
import { integrationRequest } from "../shared/api/integrations";
import type { DailyReport, DailyReportList } from "../entities/daily-report";
import "../styles/reports.css";

const fetchReports = () => integrationRequest<DailyReportList>("/dispatch/reports");
const dayLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("ru-RU", {
  timeZone: "UTC", day: "numeric", month: "long", year: "numeric",
});
const delayLabel = (seconds: number | null) => seconds === null ? "—" : `${(seconds / 60).toFixed(1)} мин`;

function ReportCard({ report, configured, model, onGenerate, generating }: {
  report: DailyReport;
  configured: boolean;
  model: string;
  onGenerate: () => void;
  generating: boolean;
}) {
  return <article className="daily-report" data-report-date={report.date}>
    <header className="daily-report-heading">
      <div><span className="report-eyebrow">ОПЕРАТИВНАЯ СВОДКА / {report.archive ? "АРХИВ" : "ПОТОК"}</span>
        <h3>{dayLabel(report.date)}</h3>
        <p><Clock3 size={14} /> Наблюдалось с {report.firstAsOf.slice(11, 16)} до {report.lastAsOf.slice(11, 16)} · {report.samples} срезов</p>
      </div>
      <span className={`report-source ${report.source}`}>{report.source === "gigachat" ? report.model : "Сводка по данным"}</span>
    </header>
    <div className="report-metrics">
      <div><strong>{report.metrics.vehiclesObserved}</strong><span>автобусов наблюдалось</span></div>
      <div><strong>{report.metrics.vehiclesWithForecast}</strong><span>с прогнозом</span></div>
      <div><strong>{report.metrics.peakDelayedVehicles}</strong><span>максимум с риском ≥ 2 мин</span></div>
      <div><strong>{delayLabel(report.metrics.meanPredictedDelaySec)}</strong><span>средний прогноз в срезах</span></div>
    </div>
    <div className="report-narrative">
      <span className="report-eyebrow">КРАТКИЙ ОТЧЁТ</span>
      <p>{report.summary}</p>
      <ul>{report.highlights.map((highlight, index) => <li key={index}>{highlight}</li>)}</ul>
    </div>
    <p className="report-coverage">{report.coverageNote}</p>
    {report.needsRefresh && <p className="report-update">После генерации GigaChat появились новые срезы. Обновите текст отчёта, чтобы учесть их.</p>}
    <div className="report-actions">
      <span>{report.source === "gigachat" ? `Сформировано ${new Date(report.generatedAt).toLocaleString("ru-RU")}` : `Для текста GigaChat доступна модель ${model}`}</span>
      <button onClick={onGenerate} disabled={!configured || generating || (report.source === "gigachat" && !report.needsRefresh)}><Bot size={16} />{generating ? "Формируем…" : report.source === "gigachat" ? report.needsRefresh ? "Обновить с GigaChat" : "Отчёт актуален" : "Сформировать с GigaChat"}</button>
    </div>
    {!configured && <small className="report-key-note">GigaChat не подключён: расчётная сводка доступна без модели.</small>}
  </article>;
}

export default function ReportsPage() {
  const [tab, setTab] = useState<"latest" | "history">("latest");
  const [selectedDate, setSelectedDate] = useState("");
  const [generatingDate, setGeneratingDate] = useState("");
  const [error, setError] = useState("");
  const query = useQuery({ queryKey: ["daily-reports"], queryFn: fetchReports,
    retry: false, refetchInterval: 60_000 });
  const items = query.data?.items || [];
  const report = items.find((item) => item.date === selectedDate) || items[0];
  const activeReport = tab === "latest" ? items[0] : report;
  const generate = async () => {
    if (!activeReport) return;
    setGeneratingDate(activeReport.date); setError("");
    try {
      await integrationRequest<DailyReport>(`/dispatch/reports/${activeReport.date}/generate`, {
        method: "POST", body: "{}", signal: AbortSignal.timeout(45_000),
      });
      await query.refetch();
    } catch (cause) { setError((cause as Error).message); }
    finally { setGeneratingDate(""); }
  };
  return <section className="reports-page" aria-label="Ежедневные отчёты">
    <div className="reports-intro"><div><span className="report-eyebrow">GIGACHAT / АНАЛИТИКА ДНЯ</span><h2>Ежедневные отчёты</h2>
      <p>Краткие выводы по сохранённым срезам автобусного потока. Отчёты остаются после перезапуска сервера.</p></div>
      <Link to="/dispatch">Вернуться к диспетчеру <ArrowRight size={16} /></Link>
    </div>
    <div className="reports-tabs" role="tablist" aria-label="Разделы отчётов">
      <button role="tab" aria-selected={tab === "latest"} onClick={() => setTab("latest")}><FileText size={16} /> Последний день данных</button>
      <button role="tab" aria-selected={tab === "history"} onClick={() => setTab("history")}><CalendarDays size={16} /> Прошлые дни <span>{items.length}</span></button>
    </div>
    {query.isPending ? <div className="reports-empty"><RefreshCw size={20} /> Загружаем отчёты…</div>
      : query.isError ? <div className="reports-empty" role="alert">Не удалось получить отчёты: {query.error.message} <button onClick={() => void query.refetch()}>Повторить</button></div>
      : !items.length ? <div className="reports-empty">Срезы потока ещё не получены. Когда поступит телеметрия, здесь появится первый отчёт.</div>
      : tab === "latest" ? <ReportCard report={items[0]} configured={query.data!.modelConfigured} model={query.data!.model} onGenerate={() => void generate()} generating={generatingDate === items[0].date} />
      : <div className="reports-history">
          <aside aria-label="Даты отчётов"><span className="report-eyebrow">СОХРАНЁННЫЕ ДНИ</span>
            {items.map((item) => <button key={item.date} className={report?.date === item.date ? "selected" : ""} onClick={() => setSelectedDate(item.date)}>
              <strong>{dayLabel(item.date)}</strong><small>{item.samples} срезов · {item.source === "gigachat" ? "GigaChat" : "По данным"}</small>
            </button>)}
          </aside>
          {report && <ReportCard report={report} configured={query.data!.modelConfigured} model={query.data!.model} onGenerate={() => void generate()} generating={generatingDate === report.date} />}
        </div>}
    {error && <p className="reports-error" role="alert">{error}</p>}
  </section>;
}
