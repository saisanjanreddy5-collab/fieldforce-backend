import { Router } from "express";
import authRoutes from "./sub-routes/auth-routes";
import leadRoutes from "./sub-routes/lead-routes";
import opportunityRoutes from "./sub-routes/opportunity-routes";
import activityRoutes from "./sub-routes/activity-routes";
import attendanceRoutes from "./sub-routes/attendance-routes";
import dashboardRoutes from "./sub-routes/dashboard-routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/leads", leadRoutes);
router.use("/opportunities", opportunityRoutes);
router.use("/activities", activityRoutes);
router.use("/attendance", attendanceRoutes);
router.use("/dashboard", dashboardRoutes);

// A geography module (zones/states/districts/areas lookups) can get mounted
// here later if the frontend needs dedicated endpoints for it.

router.get("/health", (_req, res) => {
  res.json({ success: true, message: "FieldForce API is running" });
});

export default router;
