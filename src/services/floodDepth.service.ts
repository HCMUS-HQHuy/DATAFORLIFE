import fs from 'node:fs';
import path from 'node:path';
import { createCanvas } from 'canvas';
import * as geotiff from 'geotiff';
import chroma from 'chroma-js';

// Đường dẫn đến thư mục heatmaps
const HEATMAPS_DIR = path.join(process.cwd(), 'public', 'heatmaps');

// Đường dẫn đến file GeoTIFF flood depths (fallback)
const FLOOD_DEPTHS_PATH = path.join(process.cwd(), 'AIResponse', 'flood_depths.tif');

// Time frame mapping: API parameter -> file suffix
// Frontend sends: 'now', 'future-5', 'future-30', 'future-60'
const TIME_FRAME_MAP: Record<string, string> = {
    'now': '0min',
    'future-5': '5min',
    'future-30': '30min',
    'future-60': '60min',
    // Legacy support
    '5min': '5min',
    '30min': '30min',
    '60min': '60min'
};

interface Bounds {
    north: number;
    south: number;
    east: number;
    west: number;
}

interface FloodDepthData {
    width: number;
    height: number;
    data: Float32Array;
    bounds: Bounds;
    noDataValue?: number | undefined;
    min: number;
    max: number;
}

interface FloodDepthResult {
    success: boolean;
    data?: {
        image_url: string;
        bounds: { north: number; south: number; east: number; west: number };
        timestamp: string;
        max_depth: number;
        min_depth: number;
        legend: {
            colors: string[];
            values: number[];
        };
    };
    error?: string;
}

class FloodDepthService {
    private cachedData: FloodDepthData | null = null;

    /**
     * Đọc và parse dữ liệu GeoTIFF từ flood_depths.tif
     */
    private async readFloodDepthData(): Promise<FloodDepthData> {
        try {
            console.log('Reading flood depths file:', FLOOD_DEPTHS_PATH);
            
            if (!fs.existsSync(FLOOD_DEPTHS_PATH)) {
                throw new Error(`Flood depths file not found: ${FLOOD_DEPTHS_PATH}`);
            }

            // Đọc file GeoTIFF
            const arrayBuffer = fs.readFileSync(FLOOD_DEPTHS_PATH).buffer;
            const tiff = await geotiff.fromArrayBuffer(arrayBuffer);
            const image = await tiff.getImage();
            
            // Lấy thông tin metadata
            const width = image.getWidth();
            const height = image.getHeight();
            const bbox = image.getBoundingBox();
            
            console.log('Flood Depths GeoTIFF Info:', {
                width,
                height,
                bbox,
                fileStats: image.getFileDirectory()
            });

            // Đọc dữ liệu raster
            const rasterData = await image.readRasters();
            const data = new Float32Array(rasterData[0] as ArrayLike<number>);
            
            // Lấy giá trị NoData nếu có
            const noDataValue = image.getGDALNoData();
            console.log('NoData value:', noDataValue);

            // Tính toán min/max từ dữ liệu thực tế (bỏ qua NoData)
            let min = Infinity;
            let max = -Infinity;
            let validPixels = 0;

            for (let i = 0; i < data.length; i++) {
                const value = data[i];
                
                // Kiểm tra giá trị tồn tại
                if (value === undefined || value === null) {
                    continue;
                }
                
                // Bỏ qua NoData values
                if (noDataValue !== null && noDataValue !== undefined && 
                    Math.abs(value - noDataValue) < 0.0001) {
                    continue;
                }
                
                // Bỏ qua các giá trị không hợp lệ
                if (!Number.isFinite(value) || Number.isNaN(value)) {
                    continue;
                }
                
                validPixels++;
                min = Math.min(min, value);
                max = Math.max(max, value);
            }

            console.log(`Valid pixels: ${validPixels}/${data.length}`);
            console.log(`Flood depth range: ${min} to ${max}`);

            // Chuyển đổi bounds về lat/lng nếu cần
            let bounds: Bounds;
            if (bbox && bbox.length === 4 && 
                typeof bbox[0] === 'number' && typeof bbox[1] === 'number' && 
                typeof bbox[2] === 'number' && typeof bbox[3] === 'number') {
                // Kiểm tra xem có phải projected coordinates không
                if (Math.abs(bbox[0]) > 180 || Math.abs(bbox[1]) > 90 || Math.abs(bbox[2]) > 180 || Math.abs(bbox[3]) > 90) {
                    // Sử dụng bounds mặc định cho khu vực TPHCM - Việt Nam
                    bounds = {
                        north: 11.2,
                        south: 10.3,
                        east: 107.1,
                        west: 106.3
                    };
                } else {
                    bounds = {
                        north: bbox[3],
                        south: bbox[1], 
                        east: bbox[2],
                        west: bbox[0]
                    };
                }
            } else {
                // Fallback cho khu vực TPHCM
                bounds = {
                    north: 11.2,
                    south: 10.3,
                    east: 107.1,
                    west: 106.3
                };
            }

            return {
                width,
                height,
                data,
                bounds,
                noDataValue: noDataValue ?? undefined,
                min: min === Infinity ? 0 : min,
                max: max === -Infinity ? 5 : max // Giả sử max depth là 5m
            };

        } catch (error) {
            console.error('Error reading flood depths GeoTIFF:', error);
            throw error;
        }
    }

    /**
     * Tạo ảnh depth map từ dữ liệu flood depths và lưu vào file
     */
    private async createFloodDepthImage(floodData: FloodDepthData): Promise<string> {
        const { width, height, data, noDataValue, min, max } = floodData;
        
        console.log('Generating flood depth map image...');
        console.log('Image dimensions:', width, 'x', height);
        console.log('Depth range:', min, 'to', max);
        
        // Tạo canvas
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        
        // Tạo color scale từ xanh lam (không ngập) đến đỏ (ngập sâu)
        const colorScale = chroma.scale(['#0000FF', '#00FFFF', '#00FF00', '#FFFF00', '#FF0000'])
            .domain([min, max])
            .mode('lch');
        
        // Tạo ImageData
        const imageData = ctx.createImageData(width, height);
        const pixels = imageData.data;
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const index = y * width + x;
                const value = data[index];
                const pixelIndex = index * 4;
                
                // Kiểm tra giá trị tồn tại
                if (value === undefined || value === null) {
                    pixels[pixelIndex] = 0;     // R
                    pixels[pixelIndex + 1] = 0; // G
                    pixels[pixelIndex + 2] = 0; // B
                    pixels[pixelIndex + 3] = 0; // A (transparent)
                    continue;
                }
                
                // Kiểm tra NoData values
                if (noDataValue !== undefined && Math.abs(value - noDataValue) < 0.0001) {
                    // Trong suốt cho NoData
                    pixels[pixelIndex] = 0;     // R
                    pixels[pixelIndex + 1] = 0; // G
                    pixels[pixelIndex + 2] = 0; // B
                    pixels[pixelIndex + 3] = 0; // A (transparent)
                    continue;
                }
                
                // Kiểm tra giá trị hợp lệ
                if (!Number.isFinite(value) || Number.isNaN(value)) {
                    pixels[pixelIndex] = 0;
                    pixels[pixelIndex + 1] = 0;
                    pixels[pixelIndex + 2] = 0;
                    pixels[pixelIndex + 3] = 0;
                    continue;
                }
                
                // Nếu giá trị = 0 (không ngập), làm trong suốt
                if (value === 0) {
                    pixels[pixelIndex] = 0;
                    pixels[pixelIndex + 1] = 0;
                    pixels[pixelIndex + 2] = 0;
                    pixels[pixelIndex + 3] = 0;
                    continue;
                }
                
                // Chuyển đổi giá trị thành màu
                const color = colorScale(value).rgb();
                
                pixels[pixelIndex] = color[0];     // R
                pixels[pixelIndex + 1] = color[1]; // G
                pixels[pixelIndex + 2] = color[2]; // B
                pixels[pixelIndex + 3] = 180;      // A (70% opacity)
            }
        }
        
        // Vẽ lên canvas
        ctx.putImageData(imageData, 0, 0);
        
        // Tạo tên file với timestamp
        const timestamp = new Date().toISOString().split('T')[0];
        const filename = `flood_depthmap_${timestamp}.png`;
        
        // Đảm bảo thư mục heatmaps tồn tại
        const heatmapsDir = path.join(process.cwd(), 'public', 'heatmaps');
        if (!fs.existsSync(heatmapsDir)) {
            fs.mkdirSync(heatmapsDir, { recursive: true });
        }
        
        // Lưu file
        const filePath = path.join(heatmapsDir, filename);
        const buffer = canvas.toBuffer('image/png');
        fs.writeFileSync(filePath, buffer);
        
        console.log('Flood depth map image saved to:', filePath);
        return `/heatmaps/${filename}`;
    }

    /**
     * Lấy depth map theo time frame
     * @param timeFrame - 'now' | '5min' | '30min' | '60min'
     */
    public async getFloodDepthMap(timeFrame: string = 'now'): Promise<FloodDepthResult> {
        try {
            // Map time frame to file suffix
            const fileSuffix = TIME_FRAME_MAP[timeFrame] || '0min';
            const today = new Date().toISOString().split('T')[0];
            
            // Try to find pre-generated PNG file first
            const pngFilename = `flood_depthmap_${today}-${fileSuffix}.png`;
            const pngPath = path.join(HEATMAPS_DIR, pngFilename);
            
            console.log(`Looking for heatmap: ${pngPath}`);
            
            // Check if PNG file exists
            if (fs.existsSync(pngPath)) {
                console.log(`Found pre-generated PNG: ${pngFilename}`);
                
                // Read corresponding TIF file for metadata (if exists)
                const tifFilename = `flood_depthmap_${today}-${fileSuffix}.tif`;
                const tifPath = path.join(HEATMAPS_DIR, tifFilename);
                
                let minDepth = 0;
                let maxDepth = 5;
                
                // Try to get min/max from TIF file metadata
                if (fs.existsSync(tifPath)) {
                    try {
                        const stats = await this.getTifStats(tifPath);
                        minDepth = stats.min;
                        maxDepth = stats.max;
                    } catch (e) {
                        console.log('Could not read TIF stats, using defaults');
                    }
                }
                
                // Generate legend values
                const legendValues = [
                    minDepth,
                    minDepth + (maxDepth - minDepth) * 0.25,
                    minDepth + (maxDepth - minDepth) * 0.5,
                    minDepth + (maxDepth - minDepth) * 0.75,
                    maxDepth
                ];
                
                return {
                    success: true,
                    data: {
                        image_url: `/heatmaps/${pngFilename}`,
                        bounds: {
                            north: 11.2,
                            south: 10.3,
                            east: 107.1,
                            west: 106.3
                        },
                        timestamp: new Date().toISOString(),
                        max_depth: maxDepth,
                        min_depth: minDepth,
                        legend: {
                            colors: ['#0000FF', '#00FFFF', '#00FF00', '#FFFF00', '#FF0000'],
                            values: legendValues
                        }
                    }
                };
            }
            
            // Fallback: generate from original TIF file
            console.log(`PNG not found, falling back to generate from TIF...`);
            
            // Load dữ liệu nếu chưa có cache
            this.cachedData ??= await this.readFloodDepthData();
            const floodData = this.cachedData;
            
            // Tạo ảnh depth map
            const imageUrl = await this.createFloodDepthImage(floodData);
            
            // Tạo legend values (5 mức)
            const legendValues = [
                floodData.min,
                floodData.min + (floodData.max - floodData.min) * 0.25,
                floodData.min + (floodData.max - floodData.min) * 0.5,
                floodData.min + (floodData.max - floodData.min) * 0.75,
                floodData.max
            ];

            return {
                success: true,
                data: {
                    image_url: imageUrl,
                    bounds: {
                        north: floodData.bounds.north,
                        south: floodData.bounds.south,
                        east: floodData.bounds.east,
                        west: floodData.bounds.west
                    },
                    timestamp: new Date().toISOString(),
                    max_depth: floodData.max,
                    min_depth: floodData.min,
                    legend: {
                        colors: ['#0000FF', '#00FFFF', '#00FF00', '#FFFF00', '#FF0000'],
                        values: legendValues
                    }
                }
            };

        } catch (error: any) {
            console.error('Error in getFloodDepthMap:', error);
            return {
                success: false,
                error: error.message || 'Failed to generate flood depth map'
            };
        }
    }
    
    /**
     * Get min/max stats from a TIF file
     */
    private async getTifStats(tifPath: string): Promise<{ min: number; max: number }> {
        const arrayBuffer = fs.readFileSync(tifPath).buffer;
        const tiff = await geotiff.fromArrayBuffer(arrayBuffer);
        const image = await tiff.getImage();
        const rasterData = await image.readRasters();
        const data = new Float32Array(rasterData[0] as ArrayLike<number>);
        const noDataValue = image.getGDALNoData();
        
        let min = Infinity;
        let max = -Infinity;
        
        for (let i = 0; i < data.length; i++) {
            const value = data[i];
            if (value === undefined || value === null) continue;
            if (noDataValue !== null && noDataValue !== undefined && Math.abs(value - noDataValue) < 0.0001) continue;
            if (!Number.isFinite(value) || Number.isNaN(value)) continue;
            if (value === 0) continue;
            
            min = Math.min(min, value);
            max = Math.max(max, value);
        }
        
        return {
            min: min === Infinity ? 0 : min,
            max: max === -Infinity ? 5 : max
        };
    }

    /**
     * Tính độ ngập trung bình cho một vùng được chọn
     */
    public async getRegionFloodDepth(bounds: Bounds): Promise<any> {
        try {
            this.cachedData ??= await this.readFloodDepthData();
            const { data, bounds: tifBounds, width, height, noDataValue } = this.cachedData;

            // Convert lat/lng bounds to pixel coordinates
            const latRange = tifBounds.north - tifBounds.south;
            const lngRange = tifBounds.east - tifBounds.west;

            // Calculate pixel boundaries for the selected region
            const pixelNorth = Math.floor(((tifBounds.north - bounds.north) / latRange) * height);
            const pixelSouth = Math.ceil(((tifBounds.north - bounds.south) / latRange) * height);
            const pixelWest = Math.floor(((bounds.west - tifBounds.west) / lngRange) * width);
            const pixelEast = Math.ceil(((bounds.east - tifBounds.west) / lngRange) * width);

            // Clamp to image bounds
            const startY = Math.max(0, Math.min(pixelNorth, pixelSouth));
            const endY = Math.min(height, Math.max(pixelNorth, pixelSouth));
            const startX = Math.max(0, Math.min(pixelWest, pixelEast));
            const endX = Math.min(width, Math.max(pixelWest, pixelEast));

            console.log('Region analysis:', {
                selectedBounds: bounds,
                tifBounds,
                pixelRegion: { startX, endX, startY, endY },
                imageSize: { width, height }
            });

            // Extract flood depth values from the selected region
            const regionValues: number[] = [];
            let totalPixels = 0;

            for (let y = startY; y < endY; y++) {
                for (let x = startX; x < endX; x++) {
                    const index = y * width + x;
                    const value = data[index];
                    totalPixels++;

                    // Skip invalid values
                    if (value === undefined || value === null) continue;
                    if (noDataValue !== undefined && Math.abs(value - noDataValue) < 0.0001) continue;
                    if (!Number.isFinite(value) || Number.isNaN(value)) continue;

                    regionValues.push(value);
                }
            }

            if (regionValues.length === 0) {
                return {
                    success: true,
                    data: {
                        region_bounds: bounds,
                        total_pixels: totalPixels,
                        valid_pixels: 0,
                        average_depth: 0,
                        max_depth: 0,
                        min_depth: 0,
                        message: 'No valid flood data found in selected region'
                    }
                };
            }

            // Calculate statistics
            const avgDepth = regionValues.reduce((sum, val) => sum + val, 0) / regionValues.length;
            const maxDepth = Math.max(...regionValues);
            const minDepth = Math.min(...regionValues);

            // Classify flood levels
            const noFlood = regionValues.filter(v => v === 0).length;
            const shallow = regionValues.filter(v => v > 0 && v <= 0.5).length;
            const moderate = regionValues.filter(v => v > 0.5 && v <= 1.0).length;
            const deep = regionValues.filter(v => v > 1.0 && v <= 2.0).length;
            const veryDeep = regionValues.filter(v => v > 2.0).length;

            const validPixels = regionValues.length;

            return {
                success: true,
                data: {
                    region_bounds: bounds,
                    total_pixels: totalPixels,
                    valid_pixels: validPixels,
                    coverage_percentage: (validPixels / totalPixels) * 100,
                    average_depth: Number(avgDepth.toFixed(3)),
                    max_depth: Number(maxDepth.toFixed(3)),
                    min_depth: Number(minDepth.toFixed(3)),
                    flood_distribution: {
                        no_flood: { count: noFlood, percentage: (noFlood / validPixels) * 100 },
                        shallow: { count: shallow, percentage: (shallow / validPixels) * 100 },
                        moderate: { count: moderate, percentage: (moderate / validPixels) * 100 },
                        deep: { count: deep, percentage: (deep / validPixels) * 100 },
                        very_deep: { count: veryDeep, percentage: (veryDeep / validPixels) * 100 }
                    },
                    pixel_coordinates: {
                        start_x: startX,
                        end_x: endX,
                        start_y: startY,
                        end_y: endY
                    }
                }
            };

        } catch (error: any) {
            console.error('Error analyzing region flood depth:', error);
            return {
                success: false,
                error: error.message || 'Failed to analyze region flood depth'
            };
        }
    }

    /**
     * Lấy dữ liệu thống kê về flood depths
     */
    public async getFloodDepthStats(): Promise<any> {
        try {
            this.cachedData ??= await this.readFloodDepthData();
            const { data, noDataValue, min, max, width, height } = this.cachedData;

            // Thu thập các giá trị hợp lệ
            const validValues: number[] = [];
            for (let i = 0; i < data.length; i++) {
                const value = data[i];
                
                if (value === undefined || value === null) continue;
                if (noDataValue !== undefined && Math.abs(value - noDataValue) < 0.0001) continue;
                if (!Number.isFinite(value) || Number.isNaN(value)) continue;
                
                validValues.push(value);
            }

            // Phân loại theo độ ngập
            const noFlood = validValues.filter(v => v === 0);
            const shallow = validValues.filter(v => v > 0 && v <= 0.5);
            const moderate = validValues.filter(v => v > 0.5 && v <= 1);
            const deep = validValues.filter(v => v > 1 && v <= 2);
            const veryDeep = validValues.filter(v => v > 2);

            const totalValid = validValues.length;

            return {
                success: true,
                data: {
                    total_pixels: width * height,
                    valid_pixels: totalValid,
                    min_depth: min,
                    max_depth: max,
                    average_depth: validValues.reduce((a, b) => a + b, 0) / totalValid,
                    depth_distribution: {
                        no_flood: { count: noFlood.length, percentage: (noFlood.length / totalValid) * 100 },
                        shallow: { count: shallow.length, percentage: (shallow.length / totalValid) * 100 },
                        moderate: { count: moderate.length, percentage: (moderate.length / totalValid) * 100 },
                        deep: { count: deep.length, percentage: (deep.length / totalValid) * 100 },
                        very_deep: { count: veryDeep.length, percentage: (veryDeep.length / totalValid) * 100 }
                    }
                }
            };

        } catch (error: any) {
            console.error('Error getting flood depth stats:', error);
            return {
                success: false,
                error: error.message || 'Failed to get flood depth statistics'
            };
        }
    }
}

const floodDepthService = new FloodDepthService();
export default floodDepthService;