import { Request, Response } from "express";
import adminService from "src/services/admin.service";

export default {
    getBoard: async (req: Request, res: Response) => {
        try {
            // Lấy id từ params
            const { id } = req.params;

            if (!id) {
                return res.status(400).json({
                    success: false,
                    error: "Tên element (id) là bắt buộc trong params"
                });
            }

            // Gọi service với name làm input
            const data = await adminService.getBoard(id);

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
