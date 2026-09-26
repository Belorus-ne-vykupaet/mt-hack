import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Boundary } from "../shared/ui/primitives";
const Intro = lazy(() => import("../widgets/Intro"));
const Dashboard = lazy(() => import("./DashboardRoot"));
export default function Root() {
  return (
    <Boundary name="Приложение">
      <Suspense fallback={<div className="route-loading">Transit Hub</div>}>
        <Routes>
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="/welcome" element={<Intro />} />
          <Route path="/overview" element={<Dashboard />} />
          <Route path="/analytics" element={<Dashboard />} />
          <Route path="/dispatch" element={<Dashboard />} />
          <Route path="/reports" element={<Dashboard />} />
          <Route path="/integrations" element={<Dashboard />} />
          <Route path="/flow" element={<Dashboard />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Boundary>
  );
}
