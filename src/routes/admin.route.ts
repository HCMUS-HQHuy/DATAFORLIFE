import express from "express";
import adminController from "src/controllers/admin.controller";

const router = express.Router();

// GET /admin/get-board → gọi API opensource
router.get("/get-board", adminController.getBoard);

export default router;
