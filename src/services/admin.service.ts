import axios from "axios";

class AdminService {
    async getBoard() {
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

        return {
            source: "OSM Overpass",
            borders: res.data.elements
        };
    }
}

export default new AdminService();
