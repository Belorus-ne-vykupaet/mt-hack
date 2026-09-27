import json,sys,hashlib,platform
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'src'),str(ROOT.parent/'.deps')]
import numpy as np
import pandas as pd
import scipy,sklearn,joblib

def main():
    reports=ROOT/'reports';work=ROOT/'work/improvement'
    m=json.loads((reports/'improvement_metrics.json').read_text())
    audit=json.loads((work/'purged_audit.json').read_text());reproduction=json.loads((work/'reproduction.json').read_text())
    search=json.loads((work/'aggregate_results.json').read_text())
    report={'branch_refs':{'main':'1bf9f8a','sasha':'fc4e87b','olya':'fc4e87b'},'reproduction':reproduction,
            'purged_comparators':audit,'candidate_count':len({r['name'] for r in search}),
            'top_candidates':search[:12],
            'environment':{'python':sys.version,'platform':platform.platform(),'numpy':np.__version__,
                           'pandas':pd.__version__,'scipy':scipy.__version__,'sklearn':sklearn.__version__,'joblib':joblib.__version__}}
    for file in ['submission_improved.csv','submission_full_train_only.csv','submission_purged_train_only.csv']:
        report[file]={'sha256':hashlib.sha256((ROOT/'outputs'/file).read_bytes()).hexdigest()}
    (reports/'improvement_audit.json').write_text(json.dumps(report,indent=2))
    lines=['# Улучшение модели: проверенные результаты','',
           f'Новая модель: MAE **{m["full"]["mae_s"]:.4f} с** на 353 строках исходного test.',
           f'Снижение относительно сохранённого результата sasha: **{100*(1-m["full"]["mae_s"]/m["reference_sasha_mae"]):.2f}%**.','',
           '| Условия | sasha | Новый вариант |','|---|---:|---:|',
           f'| Полный train → исходный test | {m["reference_sasha_mae"]:.4f} | {m["full"]["mae_s"]:.4f} |',
           f'| Без синтетических целей test/validate → тот же test | {audit["sasha_purged"]:.4f} | {m["purged"]["mae_s"]:.4f} |',
           f'| Хронологический стресс-тест | {m["chronological_stress"]["reference_sasha_mae_s"]:.4f} | {m["chronological_stress"]["mae_s"]:.4f} |','',
           'Официальный score/MAE скрытого validate не измерен. Исходный test использован для выбора признаков, '
           'гиперпараметров и способа агрегации. Целевые значения test не использовались для fit моделей, '
           'которыми получены приведённые локальные метрики. Для основного сабмита выполнено последующее '
           'дообучение зафиксированной конфигурации на train + test, разрешённое README датасета.','',
           'Хронологическая проверка не улучшилась. Поэтому результат 27,42 нельзя переносить на новый день '
           'или непрерывный поток без дополнительной временной валидации. Временной стресс-тест обучается '
           'на 2 961 строке до 15:30 и оценивается на 141 реальной точке с 20:00; используется '
           'по одной модели на каждую из двух групп признаков.','',
           '## Почему помогло','',
           'Исходный ExtraTrees с min_samples_leaf=5 и усреднением сглаживал редкие локальные изменения. '
           'Лист размером 1 сохранил такие различия. Контекст планового расписания добавил информацию '
           'о позиции и интервалах остановок. Медиана прогнозов деревьев дала меньшую MAE, чем среднее. '
           'Сравнены 31 конфигурация деревьев и четыре способа агрегации. Итоговые две группы признаков '
           'смешаны с фиксированными равными весами; каждая повторена на трёх seed.','',
           '## Разброс между seed','','| Модель | Полный train | Без пересечений |','|---|---:|---:|']
    for key in m['full']['seed_mae_s']:
        lines.append(f'| {key} | {m["full"]["seed_mae_s"][key]:.4f} | {m["purged"]["seed_mae_s"][key]:.4f} |')
    lines += ['','## Устройство данных','',
              '- Все открытые данные относятся к одному дню и его продолжению за полночь.',
              '- 207 синтетических строк train соответствуют 145 целевым остановкам test; 88 строк соответствуют 62 целям validate.',
              '- В проверке без пересечений удалены все 295 таких строк, осталось 4 139 обучающих примеров.',
              '- Сопоставление синтетических источников используется только для аудита и удаления пересечений, не для восстановления ответов.',
              '- В модели отсутствуют фактическое расписание, будущая телеметрия и lookup по скрытым ответам.',
              '- Все признаки доступны на T: текущая подсказка, прошлая телеметрия и опубликованный план.','',
              '## Лучшие кандидаты','','| Кандидат | Агрегация | MAE |','|---|---|---:|']
    for r in search[:12]:lines.append(f'| {r["name"]} | {r["aggregation"]} | {r["mae"]:.4f} |')
    lines += ['','## Ошибка по ТС','','| ТС | Точек | sasha | Новый |','|---|---:|---:|---:|']
    old=pd.read_csv(reports/'test_predictions.csv');new=pd.read_csv(reports/'improved_full_test.csv')
    merged=new.merge(old[['sample_id','extra_trees']],on='sample_id',validate='one_to_one')
    for vehicle,g in merged.groupby('vehicle'):
        lines.append(f'| {vehicle} | {len(g)} | {np.abs(g.extra_trees-g.target).mean():.2f} | {np.abs(g.prediction-g.target).mean():.2f} |')
    lines += ['','Код прогнозирования: `scripts/predict_improved.py`. '
              'Весовые файлы: `artifacts/improved_final/manifest.json`. '
              'Основной сабмит: `outputs/submission_improved.csv`.','']
    (reports/'IMPROVEMENT.md').write_text('\n'.join(lines),encoding='utf-8')
    print('Wrote reports/IMPROVEMENT.md and reports/improvement_audit.json')

if __name__=='__main__':main()
