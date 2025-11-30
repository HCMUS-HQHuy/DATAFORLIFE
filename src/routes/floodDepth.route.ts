import { Router } from 'express';
import floodDepthController from '../controllers/floodDepth.controller';

const router = Router();

// GET /api/flood-depth/map - Lấy flood depth map
router.get('/map', floodDepthController.getFloodDepthMap);

// GET /api/flood-depth/stats - Lấy thống kê flood depths  
router.get('/stats', floodDepthController.getFloodDepthStats);

// POST /api/flood-depth/region - Tính độ ngập trung bình cho vùng được chọn
router.post('/region', floodDepthController.getRegionFloodDepth);

export default router;