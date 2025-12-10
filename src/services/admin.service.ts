import axios from "axios";
import fs from "fs";
import path from "path";

class AdminService {
    private elementsDir = path.join(__dirname, "../../elements"); 
    async apifetching() {
        const query = `
            [out:json][timeout:25];
            // Tìm tất cả các relation admin_level=6 thuộc TP.HCM (admin_level=4)
            area["boundary"="administrative"]["name"="Thành phố Hồ Chí Minh"]["admin_level"="4"]->.hcm;
            relation(area.hcm)["boundary"="administrative"]["admin_level"="6"];
            out geom;
        `;

        const res = await axios.post(
            "https://overpass-api.de/api/interpreter",
            `data=${encodeURIComponent(query)}`,
            {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            }
        );

        fs.writeFileSync("hcm_admin.json", JSON.stringify(res.data, null, 2));

        return {
            source: "OSM Overpass",
            borders: res.data.elements
        };
    }
    getBoard(id: string): any {
        if (!id) throw new Error("Tên element bắt buộc");

        // Chuyển name sang safeName giống lúc lưu file
        const safeName = id
            .normalize("NFD")                   // tách dấu
            .replace(/[\u0300-\u036f]/g, "")   // bỏ dấu
            .replace(/[^a-zA-Z0-9 _-]/g, "")  // loại ký tự đặc biệt
            .trim();

        const filePath = path.join(this.elementsDir, `${safeName}.json`);

        if (!fs.existsSync(filePath)) {
            console.log(`File element '${safeName}.json' không tồn tại`);
            return null;
        }

        const fileContent = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(fileContent);
    }

    getFloodDepthStatus(): any {
        const filePath = path.join(this.elementsDir, 'floodDepthStatus.json');

        if (!fs.existsSync(filePath)) {
            console.log(`File floodDepthStatus.json không tồn tại`);
            return null;
        }

        const fileContent = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(fileContent);
    }

    async getInfoSelectedArea(area: {
        north: number;
        south: number;
        east: number;
        west: number;
    }): Promise<any> {

        const { north, south, east, west } = area;

        const query = `
    [out:json][timeout:60];
    // TP Hồ Chí Minh admin_level=4
    area["boundary"="administrative"]["name"="Thành phố Huế"]["admin_level"="4"]->.hue;

    // Tất cả phường/xã admin_level=6 thuộc TP.HCM
    rel(area.hue)["boundary"="administrative"]["admin_level"="6"]->.wards;

    // Lọc theo bounding box người dùng chọn
    rel.wards(${south},${west},${north},${east});

    // Trả về các ID
    out ids;
        `;

        const res = await axios.post(
            "https://overpass-api.de/api/interpreter",
            `data=${encodeURIComponent(query)}`,
            {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            }
        );

        return {
            source: "OSM Overpass",
            wards: res.data.elements // chứa id của các phường/xã
        };
    }
}

export default new AdminService();
