import { Request, Response } from "express";
import adminService from "src/services/admin.service";

export default {
    getBoard: async (req: Request, res: Response) => {
        try {
            const data = await adminService.getBoard();
            res.status(200).json({
                success: true,
                data,
            });
        } catch (err: any) {
            res.status(500).json({
                success: false,
                error: err.message,
            });
        }
    }
};
