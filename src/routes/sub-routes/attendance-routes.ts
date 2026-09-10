import { Router } from "express";
import * as attendanceController from "../../controllers/attendance-controller";
import { requireAuth } from "../../middleware/auth-middleware";
import { validateBody } from "../../middleware/validate-middleware";
import { checkInSchema, checkOutSchema, locationPingSchema } from "../../validators/attendance-validator";

const router = Router();

router.use(requireAuth);

router.post("/check-in", validateBody(checkInSchema), attendanceController.checkIn);
router.post("/check-out", validateBody(checkOutSchema), attendanceController.checkOut);
router.post("/location-ping", validateBody(locationPingSchema), attendanceController.locationPing);

router.get("/status", attendanceController.status);
router.get("/me", attendanceController.myHistory);
router.get("/team/status", attendanceController.teamStatus);
router.get("/user/:userId", attendanceController.userHistory);

router.get("/:id", attendanceController.getById);
router.get("/:id/distance", attendanceController.distance);

export default router;
