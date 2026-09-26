"""Plot every sample of a soak report (optional dependency: matplotlib)."""
import argparse
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def plot(report, output):
    samples = report["samples"]
    minutes = [s["elapsedSec"] / 60 for s in samples]
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10})
    fig, axes = plt.subplots(3, 1, figsize=(12, 10), sharex=True, layout="constrained")
    fig.suptitle("100 автобусов · 15 WebSocket-клиентов · 30 минут NDTP\n"
                 "Синтетические позиции → реальные приёмник, признаки, ML, API и WS", fontsize=15)
    for key, label, color in [("pipelineMs", "Полный расчёт Backend", "#006f86"),
                              ("inferenceMs", "Вызов ML", "#ad6e15")]:
        axes[0].plot(minutes, [s["backend"][key] for s in samples], label=label, color=color, linewidth=1.3)
    axes[0].axhline(2000, color="#ad4444", linestyle=":", linewidth=1, label="Ориентир 2 с")
    axes[0].set_ylabel("Задержка, мс")
    axes[0].set_title("Последний расчёт на каждом опросе, шаг 10 с", loc="left")
    axes[0].set_ylim(bottom=0)
    for name, color in [("api", "#006f86"), ("backend", "#ad6e15"), ("ml", "#8455a3"), ("frontend", "#4a7d47")]:
        axes[1].plot(minutes, [s["rssMiB"][name] for s in samples], label=name, color=color, linewidth=1.3)
    axes[1].set_title("RSS отдельных процессов; показаны все срезы", loc="left")
    axes[1].set_ylabel("Память, МиБ")
    axes[1].set_ylim(bottom=0)
    axes[2].step(minutes, [s["backend"]["freshVehicles"] for s in samples], where="post", color="#006f86", label="Свежий GPS", linewidth=2)
    axes[2].step(minutes, [s["backend"]["predictedVehicles"] for s in samples], where="post", color="#ad6e15", linestyle="--", label="С прогнозом", linewidth=1.5)
    axes[2].set_title("Пауза GPS одного ТС на 210 с → устаревание → восстановление", loc="left")
    axes[2].set_ylabel("Автобусы")
    axes[2].set_yticks([99, 100])
    axes[2].set_ylim(98.7, 100.6)
    axes[2].set_xlabel("Минуты от начала измерения")
    for axis in axes:
        axis.axvspan(10, 13.5, color="#a2a2a2", alpha=.15)
        axis.axvline(20, color="#666666", linestyle="--", linewidth=1)
        axis.grid(alpha=.2)
        axis.legend(loc="upper right", ncol=2, framealpha=.95)
        axis.spines[["top", "right"]].set_visible(False)
        axis.set_xlim(0, 30)
    axes[2].text(10.1, 100.43, "GPS-пауза", color="#666666", fontsize=9)
    axes[2].text(20.2, 99.25, "TCP-реконнект", color="#666666", fontsize=9)
    fig.savefig(output, dpi=150)
    plt.close(fig)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    plot(json.loads(args.report.read_text()), args.output)
