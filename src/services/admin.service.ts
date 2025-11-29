import axios from "axios";

class AdminService {
    async getBoard() {

        // Datameta bạn cung cấp
        const bounds = {
            north: -28.85018869290051,
            south: -29.139881772545678,
            east: 153.51035885238107,
            west: 153.17892320277826,
        };

        // Overpass Query: Lấy border của vùng hành chính trong bounding box
        const query = `
            [out:json][timeout:25];
            (
                relation["boundary"="administrative"]
                        ["admin_level"~"6|7|8"]
                        (${bounds.south},${bounds.west},${bounds.north},${bounds.east});
            );
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

        return {
            source: "OSM Overpass",
            bounds,
            borders: res.data.elements
        };
    }
}

export default new AdminService();
