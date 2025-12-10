import { Request, Response } from 'express';
import floodDepthService from '../services/floodDepth.service';

class FloodDepthController {
    
    /**
     * GET /api/flood-depth/map
     * Lấy flood depth map theo thời gian
     * Query params:
     *   - time: 'now' | '5min' | '30min' | '60min' (default: 'now')
     */
    public async getFloodDepthMap(req: Request, res: Response): Promise<void> {
        try {
            // Get time parameter from query string (e.g., ?time=5min)
            const timeParam = (req.query.time as string) || 'now';
            console.log(`Getting flood depth map for time: ${timeParam}`);
            
            const result = await floodDepthService.getFloodDepthMap(timeParam);
            
            if (result.success) {
                res.status(200).json(result);
            } else {
                res.status(500).json(result);
            }
        } catch (error: any) {
            console.error('Error in getFloodDepthMap controller:', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Internal server error'
            });
        }
    }

    /**
     * GET /api/flood-depth/stats
     * Lấy thống kê về flood depths
     */
    public async getFloodDepthStats(req: Request, res: Response): Promise<void> {
        try {
            console.log('Getting flood depth statistics...');
            
            const result = await floodDepthService.getFloodDepthStats();
            
            if (result.success) {
                res.status(200).json(result);
            } else {
                res.status(500).json(result);
            }
        } catch (error: any) {
            console.error('Error in getFloodDepthStats controller:', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Internal server error'
            });
        }
    }

    /**
     * POST /api/flood-depth/region
     * Tính độ ngập trung bình cho vùng được chọn
     */
    public async getRegionFloodDepth(req: Request, res: Response): Promise<void> {
        try {
            console.log('Getting region flood depth analysis...');
            
            const { north, south, east, west } = req.body;
            
            // Validate input bounds
            if (typeof north !== 'number' || typeof south !== 'number' || 
                typeof east !== 'number' || typeof west !== 'number') {
                res.status(400).json({
                    success: false,
                    error: 'Invalid bounds. Expected numbers for north, south, east, west.'
                });
                return;
            }

            if (north <= south || east <= west) {
                res.status(400).json({
                    success: false,
                    error: 'Invalid bounds. North must be > South, East must be > West.'
                });
                return;
            }

            const bounds = { north, south, east, west };
            const result = await floodDepthService.getRegionFloodDepth(bounds);
            
            if (result.success) {
                res.status(200).json(result);
            } else {
                res.status(500).json(result);
            }
        } catch (error: any) {
            console.error('Error in getRegionFloodDepth controller:', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Internal server error'
            });
        }
    }
}

const floodDepthController = new FloodDepthController();
export default floodDepthController;