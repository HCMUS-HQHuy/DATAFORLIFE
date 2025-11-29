import express from "express";
import adminController from "src/controllers/admin.controller";

const router = express.Router();

// GET /admin/get-board → gọi API opensource
router.get("/get-board/:id", adminController.getBoard);

export default router;
