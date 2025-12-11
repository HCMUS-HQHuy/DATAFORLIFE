import { fromArrayBuffer } from 'geotiff';
import fs from "fs";
import path from 'path';
import adminService from './admin.service';
import cron from "node-cron";
import { createCanvas } from 'canvas';

const AIResponseDir = path.join(__dirname, "../../AIResponse"); 
const elementsDir = path.join(__dirname, "../../elements"); 
const tifPath = path.join(AIResponseDir, "high_0000.tif");

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

function isPointInPolygon(point: Point, polygon: {lat: number, lon: number}[]): boolean {
    const x = point.lon;
    const y = point.lat;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i]!.lon, yi = polygon[i]!.lat;
        const xj = polygon[j]!.lon, yj = polygon[j]!.lat;
        const intersect = ((yi > y) !== (yj > y)) && 
                          (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

// Ví dụ về metadata và polygons
const metadata: Metadata = JSON.parse(fs.readFileSync(path.join(AIResponseDir, "metadata.json"), 'utf-8'));

async function process(matrix: number[][], width: number, height: number) {
    try {
        let depthStatus: {id: number, depth: number}[] = [];

        const response = await adminService.getInfoSelectedArea({
            north: metadata.bounds.north,
            south: metadata.bounds.south,
            east: metadata.bounds.east,
            west: metadata.bounds.west
        });

        const wardIds: number[] = response.wards.map((ward: any) => ward.id);
        console.log(`Tổng số phường/xã nhận được từ OSM: ${wardIds.length}`);

        for (const wardId of wardIds) {
            const wardData = adminService.getBoard(wardId.toString());
            if (!wardData) {
                console.log(`Không tìm thấy dữ liệu cho phường/xã ID: ${wardId}`);
                continue;
            }

            const id = wardData.id;
            const name = wardData.tags?.name || "Unknown";
            const outerWays = wardData.members?.filter(
                (member: any) => member.role === "outer" && member.type === "way" && member.geometry?.length > 2
            );

            if (!outerWays || outerWays.length === 0) {
                console.log(`Không tìm thấy outer ways cho phường/xã ID: ${id}`);
                continue;
            }

            let current_depth = 0, counted_pixels = 0;

            for (let x = 0; x < width; x++) {
                for (let y = 0; y < height; y++) {
                    const depth = matrix[y]![x]!;
                    const lon = metadata.bounds.west + (x + 0.5) * (metadata.bounds.east - metadata.bounds.west) / width;
                    const lat = metadata.bounds.north - (y + 0.5) * (metadata.bounds.north - metadata.bounds.south) / height;

                    // Kiểm tra từng outer way riêng biệt
                    let inside = false;
                    for (const way of outerWays) {
                        if (isPointInPolygon({ lat, lon }, way.geometry)) {
                            if (inside) inside = false;
                            else inside = true;
                        }
                      }
                    if (inside) {
                      if ((depth <= 0 || depth === metadata.data_stats.nodata_value) === false)
                        current_depth += depth;
                      counted_pixels++;
                    }
                }
            }
            console.log(`Phường/xã: ${name} (ID: ${id}) - Độ sâu trung bình: ${current_depth/(counted_pixels || 1)} mét trên ${counted_pixels} pixels bị ngập.`);
            depthStatus.push({ id, depth: current_depth/(counted_pixels || 1) });
        }
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
        await fs.promises.writeFile(floodDepthStatusFilePath, JSON.stringify(ans, null, 2), 'utf-8');

        console.log("Cập nhật thành công vào file floodDepthStatus.json.");
    } catch (error) {
        console.error("Có lỗi khi cập nhật file:", error);
    }
}
// Example task function
function runMyTask() {
  readGeoTIFF(tifPath).then(async ({ matrix, width, height }) => {
    console.log(`Matrix kích thước: ${width} x ${height}`);
    const ans = await process(matrix, width, height);
    await updateFilesWithFloodDepth(ans!);
  });
}

// readGeoTIFF(tifPath).then(async ({ matrix, width, height }) => {
//   console.log(`Matrix kích thước: ${width} x ${height}`);
//   const ans = await process(matrix, width, height);
//   await updateFilesWithFloodDepth(ans!);
// });

// Schedule the task
// This runs every minute: "*/1 * * * *"

export const startScheduler = () => {

  cron.schedule("*/5 * * * *", () => {
    console.log("Running scheduled task...");
  });
}
runMyTask();