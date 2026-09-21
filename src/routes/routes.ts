import { Router } from "express";
import authRoutes from "./sub-routes/auth-routes";
import userRoutes from "./sub-routes/user-routes";
import microsoftRoutes from "./sub-routes/microsoft-routes";
import smartfloRoutes from "./sub-routes/smartflo-routes";
import leadRoutes from "./sub-routes/lead-routes";
import opportunityRoutes from "./sub-routes/opportunity-routes";
import activityRoutes from "./sub-routes/activity-routes";
import attendanceRoutes from "./sub-routes/attendance-routes";
import dashboardRoutes from "./sub-routes/dashboard-routes";
import geographyRoutes from "./sub-routes/geography-routes";
import salesTeamRoutes from "./sub-routes/sales-team-routes";
import levelRoutes from "./sub-routes/level-routes";
import officeRoutes from "./sub-routes/office-routes";
import targetRoutes from "./sub-routes/target-routes";
import incentivePlanRoutes from "./sub-routes/incentive-plan-routes";
import commissionRuleRoutes from "./sub-routes/commission-rule-routes";
import userIncentivePlanRoutes from "./sub-routes/user-incentive-plan-routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/integrations/microsoft", microsoftRoutes);
router.use("/integrations/smartflo", smartfloRoutes);
router.use("/leads", leadRoutes);
router.use("/opportunities", opportunityRoutes);
router.use("/activities", activityRoutes);
router.use("/attendance", attendanceRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/geography", geographyRoutes);
router.use("/sales-teams", salesTeamRoutes);
router.use("/levels", levelRoutes);
router.use("/offices", officeRoutes);
router.use("/targets", targetRoutes);
router.use("/incentive-plans", incentivePlanRoutes);
router.use("/commission-rules", commissionRuleRoutes);
router.use("/user-incentive-plans", userIncentivePlanRoutes);

router.get("/health", (_req, res) => {
  res.json({ success: true, message: "FieldForce API is running" });
});

export default router;
