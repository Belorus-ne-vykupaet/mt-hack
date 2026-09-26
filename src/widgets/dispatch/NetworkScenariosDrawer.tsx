import { useEffect } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Bot, ClipboardList, X } from "lucide-react";
import type { DispatchRecommendation } from "../../entities/dispatch-recommendations";
import type { Route } from "../../entities/models";
import { RouteBadge } from "../../shared/ui/primitives";

export function NetworkScenariosDrawer({ routes, items, onClose, onOpenAdvice, onPrepare }: {
  routes: Route[];
  items: DispatchRecommendation[];
  onClose: () => void;
  onOpenAdvice: (routeId: string) => void;
  onPrepare: (item: DispatchRecommendation) => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  const byRoute = new Map(items.map((item) => [item.routeId, item]));
  const orderedRoutes = [
    ...items.flatMap((item) => routes.filter((route) => route.id === item.routeId)),
    ...routes.filter((route) => !byRoute.has(route.id)),
  ];
  return createPortal(<div className="network-drawer-layer" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <aside className="network-drawer" role="dialog" aria-modal="true" aria-label="Обзор маршрутов и сценариев">
      <header className="network-drawer-header">
        <div><span className="dispatch-eyebrow">ВСЯ СЕТЬ · {routes.length} МАРШРУТОВ</span><h3>Маршруты и действия</h3></div>
        <button aria-label="Закрыть обзор маршрутов" onClick={onClose}><X size={18}/></button>
      </header>
      <p className="network-drawer-guide">Сначала откройте маршрут: GigaChat сформирует совет по его автобусам. Расчётный план можно подставить в форму, проверить и отдельно отправить.</p>
      <div className="network-drawer-list">{orderedRoutes.map((route) => {
        const item = byRoute.get(route.id);
        const delay = item?.predictedDelaySec ?? null;
        return <article key={route.id} className="network-drawer-card" data-recommendation-route={route.id}>
          <div className="network-drawer-card-top"><RouteBadge number={route.number} risk={route.riskLevel}/><strong>{delay === null ? "Нет прогноза" : `${delay > 0 ? "+" : ""}${(delay / 60).toFixed(1)} мин`}</strong></div>
          <p>{item?.decisions?.[0]?.title || (item ? "Для действия пока недостаточно свежих данных." : "Ожидаем расчёт по маршруту.")}</p>
          {item?.status === "suggested" && <small>Автобусы {item.currentFleet} → {item.targetFleet}{item.currentDwellSec !== item.targetDwellSec ? ` · стоянка ${item.currentDwellSec ?? "—"} → ${item.targetDwellSec ?? "—"} с` : ""}</small>}
          <div className="network-drawer-actions">
            <button onClick={() => onOpenAdvice(route.id)}><Bot size={14}/> Совет GigaChat <ArrowRight size={13}/></button>
            {item?.status === "suggested" && <button onClick={() => onPrepare(item)}><ClipboardList size={14}/> Подготовить план</button>}
          </div>
        </article>;
      })}</div>
    </aside>
  </div>, document.body);
}
