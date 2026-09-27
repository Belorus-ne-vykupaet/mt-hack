import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  ArrowDown,
  ArrowRight,
  Pause,
  Play,
  RotateCcw,
  X,
  Radio,
  ScanLine,
  Waypoints,
} from "lucide-react";
import { welcomeChapters, welcomeNodes } from "./welcome-model";
import "../styles/intro.css";
const IntroScene = lazy(() => import("./IntroScene"));

export default function Intro() {
  const [chapter, setChapter] = useState(0);
  const [horizon, setHorizon] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [reset, setReset] = useState(0);
  const root = useRef<HTMLElement>(null);
  const detailClose = useRef<HTMLButtonElement>(null);
  const selectionTrigger = useRef<HTMLElement | null>(null);
  const loaded = useCallback(() => undefined, []);
  const failed = useCallback(() => setUnavailable(true), []);
  const chooseNode = useCallback((index: number) => {
    selectionTrigger.current = document.activeElement as HTMLElement;
    setSelected(index);
  }, []);
  const closeNode = useCallback(() => {
    setSelected(null);
    selectionTrigger.current?.focus();
  }, []);
  useEffect(() => {
    const oldTitle = document.title;
    document.title = "Transit Hub — город на шаг вперёд";
    return () => {
      document.title = oldTitle;
    };
  }, []);
  useEffect(() => {
    if (selected !== null) detailClose.current?.focus({ preventScroll: true });
  }, [selected]);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
      },
      { threshold: 0.12 },
    );
    el.querySelectorAll("[data-reveal]").forEach((item) =>
      observer.observe(item),
    );
    return () => observer.disconnect();
  }, []);
  const changeChapter = (index: number) => {
    setChapter(index);
    setHorizon(index === 0 ? 0 : 10);
    setSelected(null);
  };
  const current = welcomeChapters[chapter];
  const node = selected === null ? null : welcomeNodes[selected];
  return (
    <main
      className="welcome"
      data-chapter={chapter}
      ref={root}
      style={{ "--chapter-color": current.color } as React.CSSProperties}
    >
      <a className="welcome-skip" href="#welcome-story">
        К описанию проекта
      </a>
      <section
        className="welcome-hero"
        aria-label="Интерактивная презентация Transit Hub"
      >
        <header className="welcome-header">
          <Link
            to="/welcome"
            className="welcome-brand"
            aria-label="Transit Hub — о проекте"
          >
            <svg viewBox="0 0 34 34" aria-hidden="true">
              <path
                d="M5 25V9h12v16h12V9"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
              />
              <circle cx="5" cy="25" r="3" fill="currentColor" />
              <circle cx="29" cy="9" r="3" fill="currentColor" />
            </svg>
            <span>
              transit<span className="brand-slash">/</span>hub
            </span>
          </Link>
          <a className="welcome-header-about" href="#welcome-story">
            Система городского движения
          </a>
          <Link to="/overview" className="welcome-header-link">
            В систему <ArrowUpRight size={17} />
          </Link>
        </header>

        <div className="welcome-stage" id="welcome-experience">
          <div className="welcome-scene-backdrop" aria-hidden="true" />
          {!unavailable && (
            <Suspense fallback={null}>
              <IntroScene
                onReady={loaded}
                onUnavailable={failed}
                paused={paused}
                chapter={chapter}
                horizon={horizon}
                selected={selected}
                onSelect={chooseNode}
                reset={reset}
              />
            </Suspense>
          )}
          {unavailable && (
            <div className="welcome-fallback">
              <Waypoints size={72} />
              <strong>Сеть связана. Город движется.</strong>
              <span>
                3D недоступно в этом браузере. Презентация и диспетчерская
                доступны ниже.
              </span>
            </div>
          )}
          <div className="welcome-copy" key={chapter}>
            <div className="welcome-eyebrow">
              <span /> {current.kicker}
            </div>
            <h1>
              {current.title.map((line, index) => (
                <span
                  key={line}
                  className={index === 2 ? "welcome-title-accent" : ""}
                >
                  {line}
                </span>
              ))}
            </h1>
            <p>{current.description}</p>
            <Link className="welcome-enter" to="/overview">
              <span>Открыть диспетчерскую</span>
              <ArrowUpRight size={21} />
            </Link>
          </div>
          <div className="welcome-location">
            <span>МОСКВА</span>
            <span>55°45′ N · 37°37′ E</span>
          </div>
          <div className="welcome-scene-controls">
            <button
              aria-label="Сбросить ракурс"
              title="Сбросить ракурс"
              onClick={() => setReset((v) => v + 1)}
              disabled={unavailable}
            >
              <RotateCcw size={16} />
            </button>
            <button
              aria-label={
                paused ? "Продолжить 3D-анимацию" : "Остановить 3D-анимацию"
              }
              title={paused ? "Продолжить движение" : "Приостановить движение"}
              aria-pressed={paused}
              onClick={() => setPaused((v) => !v)}
              disabled={unavailable}
            >
              {paused ? <Play size={16} /> : <Pause size={16} />}
            </button>
          </div>
          {node && (
            <aside
              className="welcome-node-card"
              role="dialog"
              aria-label={`Узел ${node.name}`}
              onKeyDown={(e) => {
                if (e.key === "Escape") closeNode();
              }}
            >
              <div className="welcome-node-card-top">
                <span>ДЕМО-СОБЫТИЕ / {node.route}</span>
                <button
                  ref={detailClose}
                  onClick={closeNode}
                  aria-label="Закрыть карточку узла"
                >
                  <X size={18} />
                </button>
              </div>
              <h2>{node.name}</h2>
              <p>{node.description}</p>
              <div className="welcome-node-stat">
                <span>
                  {horizon === 0
                    ? "Текущая задержка"
                    : `Прогноз через ${horizon} мин`}
                </span>
                <strong>
                  +
                  {node.delay +
                    Math.round(horizon * (selected === 1 ? 0.4 : 0.2))}{" "}
                  мин
                </strong>
              </div>
              <Link to={chapter === 2 ? "/dispatch" : "/overview"}>
                {chapter === 2 ? "К сценариям управления" : "Перейти к карте"}
                <ArrowUpRight size={16} />
              </Link>
            </aside>
          )}
        </div>

        <div className="welcome-bottom-bar">
          <div
            className="welcome-chapters"
            role="group"
            aria-label="Сценарий презентации"
          >
            {welcomeChapters.map((item, index) => (
              <button
                key={item.name}
                aria-pressed={chapter === index}
                onClick={() => changeChapter(index)}
              >
                <span>0{index + 1}</span>
                {item.name}
                <span className="welcome-tab-line" />
              </button>
            ))}
          </div>
          <div className="welcome-timeline">
            <div>
              <label htmlFor="welcome-horizon">Горизонт прогноза</label>
              <output htmlFor="welcome-horizon">
                {horizon === 0 ? "Сейчас" : `+${horizon} мин`}
              </output>
            </div>
            <input
              id="welcome-horizon"
              type="range"
              min="0"
              max="15"
              step="1"
              value={horizon}
              aria-valuetext={
                horizon === 0 ? "Сейчас" : `${horizon} минут вперёд`
              }
              onChange={(e) => {
                const value = Number(e.target.value);
                setHorizon(value);
                if (value > 0 && chapter === 0) setChapter(1);
              }}
            />
            <div className="welcome-timeline-ticks">
              <span>Сейчас</span>
              <span>+5</span>
              <span>+10</span>
              <span>+15 мин</span>
            </div>
          </div>
        </div>
        <div className="welcome-hero-footer">
          <a href="#welcome-story">
            Узнать о проекте <ArrowDown size={14} />
          </a>
          <span>Интерактивная демонстрация · Данные иллюстративные</span>
          <span>SCROLL TO EXPLORE</span>
        </div>
      </section>

      <section className="welcome-story" id="welcome-story">
        <div className="welcome-story-heading" data-reveal>
          <h2>
            У движения есть ритм.
            <br />
            <span>У вас — полная картина.</span>
          </h2>
          <p>
            Transit Hub помогает диспетчеру увидеть, что происходит в сети
            сейчас, где нарастает риск и какой маршрут требует внимания.
          </p>
        </div>
        <div className="welcome-features">
          {[
            {
              icon: Radio,
              index: "01",
              title: "Чувствовать город",
              text: "Положение транспорта, состояние маршрутов и события — в одном пространстве.",
              link: "Обзор сети",
              to: "/overview",
              meta: "В РЕАЛЬНОМ ВРЕМЕНИ",
            },
            {
              icon: ScanLine,
              index: "02",
              title: "Видеть на 15 минут вперёд",
              text: "Текущие отклонения и прогноз задержки помогают заметить проблему до её развития.",
              link: "Аналитика",
              to: "/analytics",
              meta: "ГОРИЗОНТ 10–15 МИНУТ",
            },
            {
              icon: Waypoints,
              index: "03",
              title: "Принимать решения",
              text: "От события — к маршруту и транспорту. Оцените ситуацию и выберите диспетчерский сценарий.",
              link: "Управление",
              to: "/dispatch",
              meta: "ОТ СЕТИ К ОДНОМУ РЕЙСУ",
            },
          ].map(({ icon: Icon, ...item }) => (
            <article key={item.index} data-reveal>
              <div className="welcome-feature-top">
                <span>{item.index}</span>
                <Icon size={25} strokeWidth={1.2} />
              </div>
              <small>{item.meta}</small>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
              <Link to={item.to}>
                {item.link}
                <ArrowUpRight size={18} />
              </Link>
            </article>
          ))}
        </div>
        <div className="welcome-closing" data-reveal>
          <div>
            <span>TRANSIT HUB</span>
            <h2>
              Город не стоит на месте.
              <br />
              Будьте на шаг впереди.
            </h2>
          </div>
          <Link to="/overview" aria-label="Начать работу в Transit Hub">
            <ArrowRight size={40} strokeWidth={1.2} />
          </Link>
        </div>
        <footer className="welcome-footer">
          <span>TRANSIT / HUB © 2026</span>
          <a href="#welcome-experience">
            Вернуться к городу <ArrowUpRight size={14} />
          </a>
        </footer>
      </section>
    </main>
  );
}
