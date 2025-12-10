import fs from "fs";
import axios from "axios";

const elementsDir = "./elements";
if (!fs.existsSync(elementsDir)) {
    fs.mkdirSync(elementsDir);
}

async function apifetching() {
    const query = `
        [out:json][timeout:300];
        area["boundary"="administrative"]["name"="Thành phố Huế"]["admin_level"="4"]->.hue;
        relation(area.hue)["boundary"="administrative"]["admin_level"="6"];
        out geom;
    `;

    console.log("Đang gửi truy vấn tới Overpass API (sử dụng endpoint của maps.mail.ru)...");
    console.log("Query:", query.trim());

    try {
        // --- THAY ĐỔI: Sử dụng một endpoint API khác ---
        const res = await axios.post(
            "https://overpass-api.de/api/interpreter",
            `data=${encodeURIComponent(query)}`,
            {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            }
        );

        if (!res.data || !res.data.elements || res.data.elements.length === 0) {
            console.warn("Cảnh báo: Vẫn không tìm thấy phần tử nào trên server này.");
            console.log("Dữ liệu thô trả về từ server:", JSON.stringify(res.data, null, 2));
            return {
                source: "OSM Overpass (maps.mail.ru)",
                borders: []
            };
        }
        
        const outputPath = `${elementsDir}/binhdinh_admin.json`;
        fs.writeFileSync(outputPath, JSON.stringify(res.data, null, 2));
        console.log(`Đã ghi dữ liệu thành công vào file: ${outputPath}`);

        return {
            source: "OSM Overpass (maps.mail.ru)",
            borders: res.data.elements
        };

    } catch (error) {
        if (error.response) {
            console.error("Lỗi từ server Overpass API:", error.response.status, error.response.statusText);
            console.error("Chi tiết:", error.response.data);
        } else if (error.request) {
            console.error("Lỗi request: Không nhận được phản hồi từ server.");
        } else {
            console.error("Lỗi không xác định:", error.message);
        }
        throw error;
    }
}

apifetching()
    .then(data => {
        if (data && data.borders.length > 0) {
            console.log(`\nThành công! Lấy được ${data.borders.length} ranh giới hành chính từ ${data.source}.`);
            console.log("Thông tin đối tượng:", {
                id: data.borders[0].id,
                type: data.borders[0].type,
                tags: data.borders[0].tags
            });
        } else {
            console.log("\nHoàn tất nhưng không có dữ liệu.");
        }
    })
    .catch(err => {
        console.error("\nĐã xảy ra lỗi trong quá trình lấy dữ liệu.");
    });