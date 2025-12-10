import { fromArrayBuffer } from 'geotiff';
import fs from "fs";
import path from 'path';
import adminService from './admin.service';

const AIResponseDir = path.join(__dirname, "../../AIResponse"); 
const elementsDir = path.join(__dirname, "../../elements"); 
const tifPath = path.join(AIResponseDir, "flood_depths.tif");

interface Grid {
  width: number;
  height: number;
  resolution_meters: number;
}

interface DataStats {
  max_depth_meters: number;
  flooded_area_pixels: number;
  flooded_percentage: number;
  unit: string;
  nodata_value: number;
}

interface Metadata {
  request_id: string;
  timestamp: string;
  location: string;
  simulation_type: string;
  water_level_param: number;
  bounds: any;
  grid: Grid;
  data_stats: DataStats;
  format: string;
}

interface Point {
  lat: number;
  lon: number;
}

// Đọc file GeoTIFF và chuyển thành ma trận NxM
async function readGeoTIFF(filePath: string): Promise<{ matrix: number[][], width: number, height: number }> {
  const fileBuffer = fs.readFileSync(filePath);
  const arrayBuffer = fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength);
  const tiff = await fromArrayBuffer(arrayBuffer);
  
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  
  const data = await image.readRasters();
  const array = data[0];

  if (!(array instanceof Float32Array || array instanceof Int16Array || array instanceof Uint8Array)) {
    throw new Error("Raster data is not a valid TypedArray");
  }
  const matrix: number[][] = [];
  for (let i = 0; i < height; i++) {
    matrix.push(Array.from(array.slice(i * width, (i + 1) * width)));
  }
  return { matrix, width, height };
}

function latLonToPixel(
  lat: number,
  lon: number, 
  bounds: { north: number, south: number, east: number, west: number }, 
  width: number, 
  height: number
): { x: number, y: number } {
  const x = Math.floor(((lon - bounds.west) / (bounds.east - bounds.west)) * width);
  const y = Math.floor(((bounds.north - lat) / (bounds.north - bounds.south)) * height);
  return { x, y };
}

// Ví dụ về metadata và polygons
const metadata: Metadata = {
  "request_id": "sim_hue_001",
  "timestamp": "2025-12-11T00:47:50Z",
  "location": "Hue City",
  "simulation_type": "static_inundation",
  "water_level_param": 2.0,
  "bounds": {
    "north": 16.74602801912226,
    "south": 15.987548023342475,
    "east": 108.19093975546386,
    "west": 107.01986856019406,
    "center": {
      "lat": 16.366788021232367,
      "lon": 107.60540415782896
    }
  },
  "grid": {
    "width": 4109,
    "height": 2681,
    "resolution_meters": 30.7250757233
  },
  "data_stats": {
    "max_depth_meters": 1.0,
    "flooded_area_pixels": 45093,
    "flooded_percentage": 0.8945653562589223,
    "unit": "meters",
    "nodata_value": -9999.0
  },
  "format": "geotiff"
}

async function process(matrix: number[][], width: number, height: number) {
    try {
        let depthStatus: {id: number, depth: number}[] = [];
        let idMatrix: number[][] = Array.from({ length: height }, () => Array(width).fill(0));
        const response = await adminService.getInfoSelectedArea({
            north: metadata.bounds.north,
            south: metadata.bounds.south,
            east: metadata.bounds.east,
            west: metadata.bounds.west
        });
        const wardIds: number[] = response.wards.map((ward: any) => ward.id);
        console.log(`Tổng số phường/xã nhận được từ OSM: ${wardIds.length}`);
        wardIds.forEach((wardId: number) => {
            const wardData = adminService.getBoard(wardId.toString());
            if (!wardData) {
                console.log(`Không tìm thấy dữ liệu cho phường/xã ID: ${wardId}`);
                return;
            }
            const id = wardData.id;
            const name = wardData.tags?.name || "Unknown";
            // console.log(`Xử lý phường/xã ID: ${id}, Tên: ${name}`);

            const boundary = wardData.members?.find((member: any) => member.role === "outer" && member.type === "way");
            if (!boundary) {
                console.log(`Không tìm thấy boundary cho phường/xã ID: ${id}`);
                return;
            }

            const coords: Point[] = boundary.geometry.map((point: any) => ({ 
                lat: point.lat, 
                lon: point.lon 
            }));
            let queue: {x: number, y: number}[] = [];
            coords.forEach((p: Point) => {
                const { x, y } = latLonToPixel(p.lat, p.lon, metadata.bounds, width, height);
                if (x >= 0 && x < width && y >= 0 && y < height) {
                    const depth = matrix[y]![x]!;
                    if (idMatrix[y]![x] !== 0) 
                        return; // Đã được gán ID khác
                    if (depth !== metadata.data_stats.nodata_value && depth > 0) {
                        idMatrix[y]![x] = id;
                        queue.push({x, y});
                    }
                } else {
                    console.log(`WARN: Điểm (${p.lat}, ${p.lon}) chuyển sang pixel (${x}, ${y}) nằm ngoài phạm vi ảnh.`);
                }
            });
            let depthCount = 0;
            while (queue.length > 0) {
                const { x, y } = queue.shift()!;
                depthCount += matrix[y]![x]!;
                const directions = [
                    { dx: -1, dy: 0 },
                    { dx: 1, dy: 0 },
                    { dx: 0, dy: -1 },
                    { dx: 0, dy: 1 }
                ];
                directions.forEach(({ dx, dy }) => {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                        const depth = matrix[ny]![nx]!;
                        if (depth !== metadata.data_stats.nodata_value && depth > 0 && idMatrix[ny]![nx] === 0) {
                            idMatrix[ny]![nx] = id;
                            queue.push({x: nx, y: ny});
                        }
                    }
                });
            }
            // console.log(`Tổng depth cho phường/xã ID: ${id}, Tên: ${name} là ${depthCount}`);
            depthStatus.push({id, depth: depthCount});
        });
        return depthStatus;
    } catch (error) {
        console.error("Error calling getInfoSelectedArea:", error);
    }
}

async function updateFilesWithFloodDepth(ans: { id: number, depth: number }[]) {
    try {
        const floodDepthStatusFilePath = path.join(elementsDir, 'floodDepthStatus.json');

        // Kiểm tra nếu tệp 'floodDepthStatus.json' đã tồn tại
        if (fs.existsSync(floodDepthStatusFilePath)) {
            console.log(`File ${floodDepthStatusFilePath} đã tồn tại. Đang cập nhật...`);
        } else {
            console.log(`Tạo mới file ${floodDepthStatusFilePath}...`);
        }

        // Ghi mảng ans vào file floodDepthStatus.json
        fs.writeFileSync(floodDepthStatusFilePath, JSON.stringify(ans, null, 2), 'utf-8');

        console.log("Cập nhật thành công vào file floodDepthStatus.json.");
    } catch (error) {
        console.error("Có lỗi khi cập nhật file:", error);
    }
}
    
readGeoTIFF(tifPath).then(async ({ matrix, width, height }) => {
    console.log(`Matrix kích thước: ${width} x ${height}`);
    const ans = await process(matrix, width, height);
    console.log("Kết quả cuối cùng:", ans);
    await updateFilesWithFloodDepth(ans!);
});