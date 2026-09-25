import { config } from "../config/env";
import { Component } from "react";
import type { ReactNode } from "react";
import { Activity, TriangleAlert } from "lucide-react";
import { riskLabels, riskHex, riskInk } from "./format";
import type { RiskLevel } from "../../entities/models";
export function RiskBadge({
  risk,
  probability,
}: {
  risk: RiskLevel;
  probability?: number;
}) {
  return (
    <span className={`risk-badge ${risk}`}>
      <span className="dot" />
      {riskLabels[risk]}
      {!config.csvMode &&
        probability !== 0 &&
        probability !== undefined &&
        ` · ${Math.round(probability * 100)}%`}
    </span>
  );
}
export function RouteBadge({
  number,
  risk = "normal",
}: {
  number: string;
  risk?: RiskLevel;
}) {
  return (
    <span
      className="route-badge"
      style={{
        color: riskInk[risk],
        borderColor: `${riskHex[risk]}50`,
        background: `${riskHex[risk]}18`,
      }}
    >
      {number}
    </span>
  );
}
export function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Empty({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="empty">
      <Activity size={26} />
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}
export class Boundary extends Component<
  { children: ReactNode; name: string },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="empty">
        <TriangleAlert />
        <strong>{this.props.name} недоступна</strong>
        <button onClick={() => this.setState({ failed: false })}>
          Повторить
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
