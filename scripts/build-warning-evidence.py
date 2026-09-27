"""Build a self-contained jury view from the complete, reproducible warning audit."""

import argparse
import html
import json
from pathlib import Path


def esc(value):
    return html.escape(str(value))


def clock(value):
    return esc(value[11:19]) if value else "—"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default="reports/early-warning-audit-2026-09-27-osm.json")
    parser.add_argument("--output", default="public/docs/early-warning")
    args = parser.parse_args()
    report = json.loads(Path(args.input).read_text())
    evidence = report["observed_onset_evidence"]
    rows = report["observed_outcomes"]
    assert len(rows) == evidence["same_original_warning_cohort"]
    assert not evidence["pending_outcomes"]
    assert not evidence["onset_window_violations"]
    assert not evidence["future_observation_leaks"]
    example = evidence["example_before_existing_delay"]
    assert example is not None
    table = []
    for row in sorted(rows, key=lambda r: (r["issued_at"], r["vehicle_id"])):
        outcome = "Подтверждён >2 мин" if row["risk_outcome"] == "confirmed" else "Ложный риск >2 мин"
        onset = row["lead_to_delay_onset_sec"]
        lead = f'{onset / 60:.1f} мин' if onset is not None else "Срок не нарушен"
        css = "" if row["risk_outcome"] == "confirmed" else ' class="false"'
        table.append(f"""<tr{css}>
<td>{esc(row["vehicle_id"].removeprefix("vehicle-"))}<small>цель {esc(row["target_stop_id"])}</small></td>
<td>{clock(row["issued_at"])}</td><td>{clock(row["target_time"])}</td>
<td>{clock(row["actual_arrival_at"])}</td><td>{clock(row["outcome_observed_at"])}</td>
<td>{row["actual_delay_sec"]:+.0f} с</td><td>{lead}</td><td>{outcome}</td></tr>""")
    source_json = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    content = f"""<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ранние предупреждения · доказательства Transit Hub</title>
<style>
:root{{color-scheme:light}}*{{box-sizing:border-box}}body{{margin:0;background:#f4f3ee;color:#18363e;font:16px/1.6 system-ui,sans-serif}}
main{{max-width:1280px;margin:auto;padding:40px 28px 80px}}a{{color:#006c82}}h1{{font-size:clamp(28px,4vw,48px);line-height:1.16;max-width:900px}}
h2{{font-size:25px;margin-top:0}}.eyebrow{{text-transform:uppercase;letter-spacing:.12em;font-size:12px;font-weight:700}}
.intro{{max-width:900px}}.cards{{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:30px 0}}
.card,section{{background:white;border:1px solid #cbd5d3;padding:24px}}.card strong{{display:block;font-size:34px;line-height:1.2}}
.card span{{font-size:14px}}section{{margin-top:22px}}.muted{{color:#536a70}}.timeline{{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:24px 0}}
.step{{border-top:4px solid #058578;padding:16px 8px 0}}.step strong{{display:block;font-size:22px}}
.step span{{display:block;font-size:14px}}.note{{background:#eaf3f0;padding:18px;border-left:4px solid #058578}}
.scroll{{overflow:auto}}table{{border-collapse:collapse;width:100%;font-size:13px;white-space:nowrap}}
th,td{{padding:13px 10px;text-align:left;border-bottom:1px solid #d9e0df}}th{{background:#eaf0ef}}
td small{{display:block;color:#62777b;font-size:11px}}tr.false{{background:#fff1e5}}
input{{display:block;margin:20px 0;width:min(460px,100%);padding:13px;border:1px solid #9bb1b2;border-radius:4px;font:inherit}}
li{{margin:7px 0}}.footer{{font-size:13px;margin-top:24px}}code{{font-size:.91em;overflow-wrap:anywhere}}
@media(max-width:800px){{main{{padding:24px 16px}}.cards,.timeline{{grid-template-columns:repeat(2,1fr)}}section{{padding:18px}}}}
</style></head><body><main>
<p class="eyebrow">Transit Hub · проверка основного этапа</p>
<h1>От первого сигнала до наблюдённого прибытия</h1>
<p class="intro">Воспроизведение официального архива за 6 января 2026 года. Первые сигналы проверены
на 91 срезе, затем поток продолжен ещё на {evidence["settlement_snapshots"]} срезов для наблюдения исходов.
Модель: {esc(report["model_version"])}. Дата расчёта: {esc(report["measured_at_utc"][:19])} UTC.
Все часы ниже — исходные часы CSV.</p>
<div class="cards">
<div class="card"><strong>{len(rows)}</strong><span>предупреждений с наблюдённым исходом</span></div>
<div class="card"><strong>{evidence["late_arrivals"]}</strong><span>нарушенных плановых сроков, сигнал за 10,5–13 минут</span></div>
<div class="card"><strong>{report["late_events_warned_in_event_window"]}/{report["late_events"]}</strong><span>обнаруженных опозданий более двух минут</span></div>
<div class="card"><strong>{report["false_alerts"]}/{report["scored_warnings"]}</strong><span>ложных сигналов риска &gt;2 минут, сохранены в оценке</span></div>
</div>
<section><h2>Пример: при сигнале автобус ещё не опаздывал</h2>
<p>ТС <strong>{esc(example["vehicle_id"].removeprefix("vehicle-"))}</strong>,
цель <code>{esc(example["target_stop_id"])}</code>.
По последнему известному прибытию: <strong>{example["current_delay_sec_at_issue"]:+.0f} с</strong>
(раньше расписания). Возраст GPS — {example["telemetry_age_sec_at_issue"]:.0f} с.
Вероятность опоздания &gt;2 минут — {example["risk_probability_at_issue"]:.1%};
точечный прогноз — {example["predicted_delay_sec_at_issue"]:.2f} с.</p>
<div class="timeline">
<div class="step"><strong>{clock(example["issued_at"])}</strong><span>Первый сигнал сохранён</span></div>
<div class="step"><strong>{clock(example["target_time"])}</strong><span>Плановый срок прибытия</span></div>
<div class="step"><strong>{clock(example["actual_arrival_at"])}</strong><span>Прибытие по факту</span></div>
<div class="step"><strong>{clock(example["outcome_observed_at"])}</strong><span>Факт стал доступен в потоке</span></div>
</div>
<p class="note">Предупреждение за <strong>{example["lead_to_delay_onset_sec"] / 60:.1f} минуты</strong>
до нарушенного планового срока; фактическое опоздание — <strong>{example["actual_delay_sec"]:.0f} с</strong>.
До наблюдения прибытия журнал хранит незавершённый исход. Подобных подтверждённых случаев
без уже наблюдаемого опоздания при выпуске сигнала: {evidence["confirmed_risk_without_existing_delay_at_issue"]}.</p>
</section>
<section><h2>Что именно проверяется</h2>
<ul>
<li><strong>Начало нарушения срока:</strong> плановое время, если фактическое прибытие позже него.
Это восстановленная граница нарушения расписания, подтверждённая последующим наблюдением прибытия;
она не выдаётся за отдельную GPS-метку или время возникновения дорожного затора.</li>
<li><strong>Риск &gt;2 минут:</strong> отдельный исход. Опоздание менее 120 секунд
не превращает ложный сигнал двухминутного риска в правильный.</li>
<li><strong>Фактическое прибытие:</strong> отдельная временная отметка.
Окно до него не подменяет окно до нарушения планового срока.</li>
<li><strong>Отсутствие данных:</strong> пропавший GPS не подтверждает задержку.
В NDTP исход закрывается только после наблюдаемого посещения целевой остановки.</li>
</ul>
<p>Знаменатель сохранён: {report["scheduled_targets_in_window"]} плановых целей, из них
{evidence["all_positive_delay_targets"]} с положительным отклонением и {report["late_events"]} с опозданием &gt;120 с.
Предупреждены {evidence["late_arrivals"]} из {evidence["all_positive_delay_targets"]} нарушенных сроков;
это полнота обнаружения, а не процент соблюдения горизонта.
Из {report["late_events"]} опозданий &gt;120 с пропущены {report["late_events_missed_in_event_window"]}.
Нулевые нарушения окна и утечки не означают отсутствие пропусков модели.</p>
</section>
<section><h2>Все {len(rows)} первых предупреждений</h2>
<label for="filter">Поиск ТС, целевой остановки или исхода</label>
<input id="filter" type="search" placeholder="Например, 131672 или «Ложный»">
<div class="scroll"><table><thead><tr><th>ТС / цель</th><th>Сигнал</th><th>План</th>
<th>Факт прибытия</th><th>Факт доступен</th><th>Опоздание</th><th>До нарушения срока</th>
<th>Риск &gt;2 мин</th></tr></thead><tbody>{''.join(table)}</tbody></table></div>
</section>
<p class="footer"><a href="audit.json">Полный JSON: сигналы, переходы состояний и все {report["scheduled_targets_in_window"]} целей</a> ·
<a href="/overview?source=official">К дашборду</a> · <a href="/docs/python/">PyDoc</a><br>
Это сохранённый аудит архива, не текущая телеметрия и не новая оценка скрытого теста.
Предоставленный test использовался при выборе модели. Оценку выставляет жюри.</p>
</main><script>document.querySelector('#filter').addEventListener('input',event=>{{
const query=event.target.value.trim().toLocaleLowerCase();
document.querySelectorAll('tbody tr').forEach(row=>row.hidden=!row.textContent.toLocaleLowerCase().includes(query));
}});</script></body></html>
"""
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    (output / "index.html").write_text(content, encoding="utf-8")
    (output / "audit.json").write_text(source_json, encoding="utf-8")
    print(f"Built {output}/index.html from {len(rows)} observed outcomes")


if __name__ == "__main__":
    main()
